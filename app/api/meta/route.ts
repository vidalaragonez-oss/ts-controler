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

      // 1. Status da conta
      const accountData = await metaFetch(`/${accountId}`, {
        access_token: token,
        fields: "account_status,name,currency",
      });

      // 2. Insights no nível de campanha — traz objective para agrupar corretamente
      const insightParams: Record<string, string> = {
        access_token: token,
        fields: "campaign_name,objective,spend,actions,cost_per_action_type,clicks",
        level: "campaign",
        limit: "500",
      };

      if (since && until) {
        insightParams.time_range = JSON.stringify({ since, until });
      } else {
        insightParams.date_preset = "maximum";
      }

      // ── Buckets por família de objetivo ──────────────────────────────────────
      // form     → OUTCOME_LEADS / LEAD_GENERATION — leads de formulário
      // messages → OUTCOME_MESSAGES / OUTCOME_ENGAGEMENT — conversas iniciadas
      // other    → tudo o mais (tráfego, awareness, engajamento, app install…)
      //            agrupados como "Outros Objetivos" com resultado principal

      let totalSpend  = 0;
      let formLeads   = 0;
      let formSpend   = 0;
      let msgLeads    = 0;
      let msgSpend    = 0;

      // "Outros Objetivos" — bucket unificado para qualquer objective que não
      // seja formulário ou mensagens. Guardamos o resultado mais relevante de
      // cada campanha e acumulamos gasto + contagem.
      type OtherCampaign = {
        name:         string;   // campaign_name
        objective:    string;   // objective raw
        result_label: string;   // ex: "Cliques", "Engajamentos", "Alcance"
        result_count: number;
        spend:        number;
      };
      const otherCampaigns: OtherCampaign[] = [];

      try {
        const insightData = await metaFetch(`/${accountId}/insights`, insightParams);
        const campaigns: Record<string, unknown>[] = insightData.data ?? [];

        for (const row of campaigns) {
          const objective    = String(row.objective ?? "").toUpperCase();
          const campaignName = String(row.campaign_name ?? "—");
          const spend        = parseFloat(String(row.spend ?? "0"));
          const actions: { action_type: string; value: string }[] = (row.actions as typeof actions) ?? [];
          const clicks       = parseInt(String((row.clicks as string) ?? "0"), 10);

          if (spend <= 0) continue; // ignora campanhas sem gasto
          totalSpend += spend;

          // ── Formulário (leads nativos) ─────────────────────────────────
          if (objective === "OUTCOME_LEADS" || objective === "LEAD_GENERATION") {
            let count = 0;
            for (const act of actions) {
              if (
                act.action_type === "lead" ||
                act.action_type === "leadgen_grouped" ||
                act.action_type === "onsite_conversion.lead_grouped"
              ) count += parseInt(act.value ?? "0", 10);
            }
            if (count === 0) {
              for (const act of actions) {
                if (act.action_type === "link_click" || act.action_type === "landing_page_view")
                  count += parseInt(act.value ?? "0", 10);
              }
            }
            formLeads += count;
            formSpend += spend;

          // ── Mensagens / Conversas ──────────────────────────────────────
          } else if (
            objective === "OUTCOME_MESSAGES" || objective === "MESSAGES" ||
            objective === "OUTCOME_ENGAGEMENT" || objective === "POST_ENGAGEMENT"
          ) {
            let count = 0;
            for (const act of actions) {
              if (
                act.action_type === "onsite_conversion.messaging_conversation_started_7d" ||
                act.action_type === "onsite_conversion.lead_grouped" ||
                act.action_type === "onsite_conversion.total_messaging_connection"
              ) count += parseInt(act.value ?? "0", 10);
            }
            if (count === 0) {
              for (const act of actions) {
                if (act.action_type === "lead") count += parseInt(act.value ?? "0", 10);
              }
            }
            msgLeads += count;
            msgSpend += spend;

          // ── Outros Objetivos ───────────────────────────────────────────
          } else {
            // Escolhe o resultado mais relevante para o objetivo
            let resultLabel = "Resultado";
            let resultCount = 0;

            if (
              objective === "OUTCOME_TRAFFIC" ||
              objective === "LINK_CLICKS" ||
              objective === "LANDING_PAGE_VIEWS"
            ) {
              resultLabel = "Cliques no Link";
              for (const act of actions) {
                if (act.action_type === "link_click" || act.action_type === "landing_page_view")
                  resultCount += parseInt(act.value ?? "0", 10);
              }
              if (resultCount === 0) resultCount = clicks;

            } else if (objective === "OUTCOME_AWARENESS" || objective === "REACH" || objective === "BRAND_AWARENESS") {
              resultLabel = "Alcance";
              // Reach não vem em actions — usamos clicks ou 0
              resultCount = clicks;

            } else if (objective === "VIDEO_VIEWS") {
              resultLabel = "Visualizações";
              for (const act of actions) {
                if (act.action_type === "video_view")
                  resultCount += parseInt(act.value ?? "0", 10);
              }

            } else {
              // Genérico: pega o maior valor em actions como proxy de resultado
              resultLabel = "Engajamentos";
              for (const act of actions) {
                if (
                  act.action_type === "post_engagement" ||
                  act.action_type === "page_engagement"
                ) resultCount += parseInt(act.value ?? "0", 10);
              }
              if (resultCount === 0 && actions.length > 0) {
                resultCount = parseInt(actions[0].value ?? "0", 10);
              }
            }

            otherCampaigns.push({
              name:         campaignName,
              objective:    objective,
              result_label: resultLabel,
              result_count: resultCount,
              spend,
            });
          }
        }
      } catch {
        // Conta sem dados de insight — retorna zeros
      }

      // ── CPL calculado APENAS sobre gasto form + msg (leads reais) ─────────
      const totalLeads   = formLeads + msgLeads;
      const leadGenSpend = formSpend + msgSpend;
      const cpl          = totalLeads > 0 ? leadGenSpend / totalLeads : 0;
      const formCpl      = formLeads  > 0 ? formSpend / formLeads  : 0;
      const msgCpl       = msgLeads   > 0 ? msgSpend  / msgLeads   : 0;

      // Totais do bucket "Outros"
      const otherSpend  = otherCampaigns.reduce((s, c) => s + c.spend, 0);
      const otherCount  = otherCampaigns.reduce((s, c) => s + c.result_count, 0);

      return NextResponse.json({
        account_status:    accountData.account_status as number,
        account_name:      accountData.name           as string,
        currency:          (accountData.currency      as string) ?? "BRL",
        // ── Totais gerais ────────────────────────────────────────────────
        spend:             totalSpend,
        total_leads:       totalLeads,
        cpl,
        // ── Formulário ───────────────────────────────────────────────────
        form_leads:        formLeads,
        form_spend:        formSpend,
        form_cpl:          formCpl,
        // ── Mensagens ────────────────────────────────────────────────────
        msg_leads:         msgLeads,
        msg_spend:         msgSpend,
        msg_cpl:           msgCpl,
        // ── Outros Objetivos (tráfego, awareness, engajamento…) ──────────
        other_spend:       otherSpend,
        other_count:       otherCount,
        other_campaigns:   otherCampaigns,  // detalhamento interno completo
        // ── Legado ───────────────────────────────────────────────────────
        leads:             formLeads,
        messages:          msgLeads,
      });
    }

    return NextResponse.json({ error: "action inválida" }, { status: 400 });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
