import { NextRequest, NextResponse } from "next/server";

const META_API_VERSION = "v21.0";
const META_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveToken(clientToken?: string | null): string {
  const token = clientToken?.trim() || process.env.META_GENERAL_TOKEN || "";
  if (!token) throw new Error("Nenhum token Meta Ads disponível.");
  return token;
}

async function metaFetch(path: string, params: Record<string, string>) {
  const url = new URL(`${META_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { next: { revalidate: 0 } });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message ?? "Erro Meta API");
  return json;
}

// ─── GET /api/meta?action=accounts ───────────────────────────────────────────
// ─── GET /api/meta?action=insights&account_id=act_xxx&since=&until= ──────────

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const action     = searchParams.get("action");
  const clientToken = searchParams.get("token");

  try {
    const token = resolveToken(clientToken);

    // ── Listar contas disponíveis ────────────────────────────────────────────
    if (action === "accounts") {
      const data = await metaFetch("/me/adaccounts", {
        access_token: token,
        fields: "id,name,account_status,currency",
        limit: "100",
      });

      const accounts = (data.data ?? []).map((a: Record<string, unknown>) => ({
        id:      a.id,
        name:    a.name,
        status:  a.account_status,
        currency: a.currency,
      }));

      return NextResponse.json({ accounts });
    }

    // ── Buscar insights de uma conta ─────────────────────────────────────────
    if (action === "insights") {
      const accountId = searchParams.get("account_id");
      const since     = searchParams.get("since");
      const until     = searchParams.get("until");

      if (!accountId) return NextResponse.json({ error: "account_id obrigatório" }, { status: 400 });

      // 1. Status + moeda da conta
      const accountData = await metaFetch(`/${accountId}`, {
        access_token: token,
        fields: "account_status,name,currency",
      });

      // 2. Insights por CAMPANHA — resolve dois problemas:
      //    a) gasto real inclui campanhas sem conversões
      //    b) action_types por campanha não sofrem agrupamento duplo
      const insightParams: Record<string, string> = {
        access_token: token,
        fields: "campaign_name,spend,actions,cost_per_action_type",
        level: "campaign",
        limit: "500",
      };

      if (since && until) {
        insightParams.time_range = JSON.stringify({ since, until });
      } else {
        insightParams.date_preset = "maximum";
      }

      // Tipos de lead que NÃO devem ser somados juntos (são aliases do mesmo evento)
      // Hierarquia Meta: lead > leadgen_grouped (ambos representam leads de formulário)
      // Regra: usar APENAS "lead" para formulário — é o mais granular e sem duplicação
      const FORM_LEAD_TYPE  = "lead";
      const MSG_LEAD_TYPES  = new Set([
        "onsite_conversion.messaging_conversation_started_7d",
        "onsite_conversion.lead_grouped",
      ]);
      // Tipos a IGNORAR pois são agrupamentos que duplicam "lead"
      const SKIP_LEAD_TYPES = new Set(["leadgen_grouped"]);

      type CampaignRow = {
        campaign_name: string;
        spend: string;
        form_leads: number;
        msg_leads: number;
        form_cpl: number;
        msg_cpl: number;
      };

      let totalSpend    = 0;
      let totalFormLeads = 0;
      let totalMsgLeads  = 0;
      const campaigns: CampaignRow[] = [];

      try {
        const insightData = await metaFetch(`/${accountId}/insights`, insightParams);
        const rows: Record<string, unknown>[] = insightData.data ?? [];

        for (const row of rows) {
          const campSpend = parseFloat((row.spend as string) ?? "0");
          totalSpend += campSpend;

          const actions: { action_type: string; value: string }[] =
            (row.actions as { action_type: string; value: string }[]) ?? [];
          const cpaList: { action_type: string; value: string }[] =
            (row.cost_per_action_type as { action_type: string; value: string }[]) ?? [];

          let campFormLeads = 0;
          let campMsgLeads  = 0;

          for (const act of actions) {
            if (SKIP_LEAD_TYPES.has(act.action_type)) continue; // ignora alias duplicado
            if (act.action_type === FORM_LEAD_TYPE) {
              campFormLeads += parseInt(act.value ?? "0", 10);
            }
            if (MSG_LEAD_TYPES.has(act.action_type)) {
              campMsgLeads += parseInt(act.value ?? "0", 10);
            }
          }

          totalFormLeads += campFormLeads;
          totalMsgLeads  += campMsgLeads;

          // CPL por campanha — direto do cost_per_action_type
          let campFormCpl = 0;
          let campMsgCpl  = 0;
          for (const cpa of cpaList) {
            if (SKIP_LEAD_TYPES.has(cpa.action_type)) continue;
            if (cpa.action_type === FORM_LEAD_TYPE) {
              const v = parseFloat(cpa.value ?? "0");
              if (v > 0) campFormCpl = v;
            }
            if (MSG_LEAD_TYPES.has(cpa.action_type)) {
              const v = parseFloat(cpa.value ?? "0");
              if (v > 0 && (campMsgCpl === 0 || v < campMsgCpl)) campMsgCpl = v;
            }
          }

          // Fallback: calcula CPL pela proporção de spend/leads desta campanha
          const campTotal = campFormLeads + campMsgLeads;
          if (campTotal > 0) {
            if (campFormCpl === 0 && campFormLeads > 0) {
              campFormCpl = (campSpend * (campFormLeads / campTotal)) / campFormLeads;
            }
            if (campMsgCpl === 0 && campMsgLeads > 0) {
              campMsgCpl = (campSpend * (campMsgLeads / campTotal)) / campMsgLeads;
            }
          }

          campaigns.push({
            campaign_name: (row.campaign_name as string) ?? "Campanha",
            spend: campSpend.toFixed(2),
            form_leads: campFormLeads,
            msg_leads:  campMsgLeads,
            form_cpl:   campFormCpl,
            msg_cpl:    campMsgCpl,
          });
        }
      } catch {
        // Conta sem dados de insight — retorna zeros
      }

      const totalLeads = totalFormLeads + totalMsgLeads;
      const cpl = totalLeads > 0 ? totalSpend / totalLeads : 0;

      // CPL global por objetivo: spend proporcional / qtd leads
      const formSpend = totalLeads > 0 && totalFormLeads > 0
        ? totalSpend * (totalFormLeads / totalLeads) : 0;
      const msgSpend = totalLeads > 0 && totalMsgLeads > 0
        ? totalSpend * (totalMsgLeads / totalLeads) : 0;
      const formCpl = totalFormLeads > 0 ? formSpend / totalFormLeads : 0;
      const msgCpl  = totalMsgLeads  > 0 ? msgSpend  / totalMsgLeads  : 0;

      return NextResponse.json({
        account_status: accountData.account_status as number,
        account_name:   accountData.name as string,
        currency:       (accountData.currency as string) ?? "BRL",
        spend:          totalSpend,
        leads:          totalFormLeads,
        messages:       totalMsgLeads,
        total_leads:    totalLeads,
        cpl,
        // Por objetivo (totais)
        form_leads: totalFormLeads,
        form_spend: formSpend,
        form_cpl:   formCpl,
        msg_leads:  totalMsgLeads,
        msg_spend:  msgSpend,
        msg_cpl:    msgCpl,
        // Detalhamento por campanha
        campaigns,
      });
    }

    return NextResponse.json({ error: "action inválida" }, { status: 400 });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
