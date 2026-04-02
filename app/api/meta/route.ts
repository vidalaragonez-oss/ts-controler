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

// ─── Tipos ────────────────────────────────────────────────────────────────────

type ActionEntry = { action_type: string; value: string };

interface AdInsights {
  spend: number;
  results: number;
  cpr: number;
}

interface AdNode {
  id: string;
  name: string;
  status: string;
  insights: AdInsights;
}

interface AdSetNode {
  id: string;
  name: string;
  status: string;
  insights: AdInsights;
  ads: AdNode[];
}

interface CampaignNode {
  id: string;
  name: string;
  objective: string;
  objective_label: string;
  status: string;
  insights: AdInsights;
  adsets: AdSetNode[];
}

interface ObjectiveGroup {
  objective: string;
  objective_label: string;
  total_spend: number;
  total_results: number;
  cpr: number;
  campaigns: CampaignNode[];
}

// ─── Mapa de objectives ────────────────────────────────────────────────────────

const OBJECTIVE_LABEL: Record<string, string> = {
  OUTCOME_LEADS:         "Leads",
  OUTCOME_ENGAGEMENT:    "Engajamento",
  OUTCOME_AWARENESS:     "Reconhecimento",
  OUTCOME_TRAFFIC:       "Tráfego",
  OUTCOME_SALES:         "Vendas",
  OUTCOME_APP_PROMOTION: "App",
  MESSAGES:              "Mensagens",
  UNKNOWN:               "—",
};

// ─── Extrai métricas de results de um array de actions ────────────────────────

// Mapa: objective → action_type estrito que define "resultado"
const OBJECTIVE_ACTION_MAP: Record<string, string[]> = {
  OUTCOME_LEADS:      ["lead", "onsite_conversion.lead_grouped"],
  OUTCOME_ENGAGEMENT: ["post_engagement"],
  MESSAGES:           ["onsite_conversion.messaging_conversation_started_7d"],
  OUTCOME_TRAFFIC:    ["link_click"],
};

function extractInsights(
  actions: ActionEntry[],
  cpaList: ActionEntry[],
  spend: number,
  objective: string = "UNKNOWN",
): AdInsights {
  const targetTypes = OBJECTIVE_ACTION_MAP[objective];

  let results = 0;
  if (targetTypes) {
    // Contagem estrita: apenas as action_types do objetivo da campanha
    const targetSet = new Set(targetTypes);
    for (const a of actions) {
      if (targetSet.has(a.action_type)) results += parseInt(a.value ?? "0", 10);
    }
  }
  // Sem fallback genérico — se o objective não é mapeado, results fica 0

  let cpr = 0;
  if (targetTypes) {
    const targetSet = new Set(targetTypes);
    // Tenta obter CPR do cost_per_action_type para a mesma ação do resultado
    for (const c of cpaList) {
      if (targetSet.has(c.action_type)) {
        const v = parseFloat(c.value ?? "0");
        if (v > 0 && (cpr === 0 || v < cpr)) cpr = v;
      }
    }
  }
  // Se não veio no cost_per_action_type, calcula spend / results
  if (cpr === 0 && results > 0) cpr = spend / results;

  return { spend, results, cpr };
}

// ─── GET /api/meta?action=accounts ────────────────────────────────────────────
// ─── GET /api/meta?action=insights&account_id=act_xxx&since=&until= ───────────
// ─── GET /api/meta?action=tree&account_id=act_xxx&since=&until= ───────────────
// ─── GET /api/meta?action=leads&account_id=act_xxx ────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const action      = searchParams.get("action");
  const clientToken = searchParams.get("token");

  try {
    const token = resolveToken(clientToken);

    // ── Listar contas disponíveis ──────────────────────────────────────────────
    if (action === "accounts") {
      const data = await metaFetch("/me/adaccounts", {
        access_token: token,
        fields: "id,name,account_status,currency",
        limit: "100",
      });
      const accounts = (data.data ?? []).map((a: Record<string, unknown>) => ({
        id:       a.id,
        name:     a.name,
        status:   a.account_status,
        currency: a.currency,
      }));
      return NextResponse.json({ accounts });
    }

    // ── Buscar leads dos formulários (para auto-sync) ──────────────────────────
    if (action === "leads") {
      const accountId = searchParams.get("account_id");
      if (!accountId) return NextResponse.json({ error: "account_id obrigatório" }, { status: 400 });

      // 1. Busca formulários da conta
      const formsData = await metaFetch(`/${accountId}/leadgen_forms`, {
        access_token: token,
        fields: "id,name,status",
        limit: "100",
      });

      const leads: {
        meta_lead_id: string;
        nome: string;
        email: string;
        telefone: string;
        created_time: string;
        form_id: string;
        form_name: string;
      }[] = [];

      // 2. Para cada formulário, busca os leads (apenas últimos 15 dias)
      const fifteenDaysAgo = Math.floor((Date.now() - 15 * 24 * 60 * 60 * 1000) / 1000);
      const leadsFiltering = JSON.stringify([
        { field: "time_created", operator: "GREATER_THAN", value: fifteenDaysAgo },
      ]);

      for (const form of (formsData.data ?? []) as { id: string; name: string }[]) {
        try {
          let cursor: string | null = null;
          let page = 0;
          while (page < 5) { // máximo 5 páginas por formulário (500 leads)
            const params: Record<string, string> = {
              access_token: token,
              fields: "id,field_data,created_time",
              limit: "100",
              filtering: leadsFiltering,
            };
            if (cursor) params.after = cursor;

            let leadsData: Record<string, unknown>;
            try {
              leadsData = await metaFetch(`/${form.id}/leads`, params);
            } catch (fetchErr: unknown) {
              const errMsg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
              const isPermissionError =
                errMsg.toLowerCase().includes("permission") ||
                errMsg.toLowerCase().includes("leads_retrieval") ||
                errMsg.toLowerCase().includes("oauth");
              if (isPermissionError) {
                console.error(
                  `[Meta Leads] Erro de permissão ao buscar leads do formulário ${form.id} (${form.name}). ` +
                  `Verifique se o token possui a permissão 'leads_retrieval'. Detalhes: ${errMsg}`
                );
              } else {
                console.error(`[Meta Leads] Erro ao buscar leads do formulário ${form.id}: ${errMsg}`);
              }
              break; // interrompe paginação deste formulário, vai pro próximo
            }
            const rows = (leadsData.data ?? []) as {
              id: string;
              created_time: string;
              field_data: { name: string; values: string[] }[];
            }[];

            for (const row of rows) {
              // Mapeamento flexível dos field_data
              let nome = "";
              let email = "";
              let telefone = "";

              for (const field of (row.field_data ?? [])) {
                const key = (field.name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
                const val = field.values?.[0] ?? "";
                if (!val) continue;

                if (["fullname", "nome", "name", "firstname"].includes(key)) {
                  nome = nome ? `${nome} ${val}` : val;
                } else if (key === "lastname" && nome) {
                  nome = `${nome} ${val}`;
                } else if (["email", "emailaddress"].includes(key)) {
                  email = val;
                } else if (["phonenumber", "phone", "telefone", "celular", "whatsapp"].includes(key)) {
                  telefone = val;
                }
              }

              // Fallback por padrão no valor se campo não mapeado
              if (!email) {
                const emailField = row.field_data?.find(f => (f.values?.[0] ?? "").includes("@"));
                if (emailField) email = emailField.values?.[0] ?? "";
              }
              if (!telefone) {
                const phoneField = row.field_data?.find(f => /^[\+\(\)0-9\-\.\s]{9,20}$/.test(f.values?.[0] ?? ""));
                if (phoneField) telefone = phoneField.values?.[0] ?? "";
              }

              leads.push({
                meta_lead_id: row.id,
                nome:         nome || "Lead Meta",
                email,
                telefone,
                created_time: row.created_time,
                form_id:      form.id,
                form_name:    form.name,
              });
            }

            cursor = leadsData.paging?.cursors?.after ?? null;
            if (!cursor || !leadsData.paging?.next) break;
            page++;
          }
        } catch {
          // Formulário sem permissão ou sem leads — segue
        }
      }

      return NextResponse.json({ leads });
    }

    // ── Buscar árvore completa Campaigns → AdSets → Ads com insights ──────────
    if (action === "tree") {
      const accountId = searchParams.get("account_id");
      const since     = searchParams.get("since");
      const until     = searchParams.get("until");

      if (!accountId) return NextResponse.json({ error: "account_id obrigatório" }, { status: 400 });

      const accountData = await metaFetch(`/${accountId}`, {
        access_token: token,
        fields: "account_status,name,currency",
      });

      // Parâmetros de período
      const timeParam: Record<string, string> = since && until
        ? { time_range: JSON.stringify({ since, until }) }
        : { date_preset: "last_7d" };

      const insightFields = "spend,actions,cost_per_action_type";

      // 1. Busca campanhas com insights
      const campaignData = await metaFetch(`/${accountId}/campaigns`, {
        access_token: token,
        fields: `id,name,objective,status,insights{${insightFields}}`,
        limit: "100",
        ...timeParam,
      });

      const campaignNodes: CampaignNode[] = [];

      for (const camp of (campaignData.data ?? []) as Record<string, unknown>[]) {
        const campId   = camp.id as string;
        const campName = (camp.name as string) ?? "Campanha";
        const objective      = (camp.objective as string) ?? "UNKNOWN";
        const objectiveLabel = OBJECTIVE_LABEL[objective] ?? objective;

        const campInsightRow = ((camp.insights as { data?: Record<string, unknown>[] })?.data ?? [])[0] ?? {};
        const campSpend   = parseFloat((campInsightRow.spend as string) ?? "0") || 0;
        const campActions = (campInsightRow.actions as ActionEntry[]) ?? [];
        const campCpa     = (campInsightRow.cost_per_action_type as ActionEntry[]) ?? [];
        const campInsights = extractInsights(campActions, campCpa, campSpend, objective);

        // 2. Busca adsets desta campanha com insights
        let adsetNodes: AdSetNode[] = [];
        try {
          const adsetData = await metaFetch(`/${campId}/adsets`, {
            access_token: token,
            fields: `id,name,status,insights{${insightFields}}`,
            limit: "100",
            ...timeParam,
          });

          for (const adset of (adsetData.data ?? []) as Record<string, unknown>[]) {
            const adsetId   = adset.id as string;
            const adsetName = (adset.name as string) ?? "Conjunto";

            const adsetInsightRow = ((adset.insights as { data?: Record<string, unknown>[] })?.data ?? [])[0] ?? {};
            const adsetSpend   = parseFloat((adsetInsightRow.spend as string) ?? "0") || 0;
            const adsetActions = (adsetInsightRow.actions as ActionEntry[]) ?? [];
            const adsetCpa     = (adsetInsightRow.cost_per_action_type as ActionEntry[]) ?? [];
            const adsetInsights = extractInsights(adsetActions, adsetCpa, adsetSpend, objective);

            // 3. Busca ads do adset com insights
            let adNodes: AdNode[] = [];
            try {
              const adsData = await metaFetch(`/${adsetId}/ads`, {
                access_token: token,
                fields: `id,name,status,insights{${insightFields}}`,
                limit: "100",
                ...timeParam,
              });

              adNodes = ((adsData.data ?? []) as Record<string, unknown>[]).map(ad => {
                const adInsightRow = ((ad.insights as { data?: Record<string, unknown>[] })?.data ?? [])[0] ?? {};
                const adSpend   = parseFloat((adInsightRow.spend as string) ?? "0") || 0;
                const adActions = (adInsightRow.actions as ActionEntry[]) ?? [];
                const adCpa     = (adInsightRow.cost_per_action_type as ActionEntry[]) ?? [];
                return {
                  id:       ad.id as string,
                  name:     (ad.name as string) ?? "Anúncio",
                  status:   (ad.status as string) ?? "UNKNOWN",
                  insights: extractInsights(adActions, adCpa, adSpend, objective),
                };
              });
            } catch {
              // Sem permissão para ads — segue sem eles
            }

            adsetNodes.push({
              id:       adsetId,
              name:     adsetName,
              status:   (adset.status as string) ?? "UNKNOWN",
              insights: adsetInsights,
              ads:      adNodes,
            });
          }
        } catch {
          // Sem permissão para adsets — segue sem eles
        }

        campaignNodes.push({
          id:               campId,
          name:             campName,
          objective,
          objective_label:  objectiveLabel,
          status:           (camp.status as string) ?? "UNKNOWN",
          insights:         campInsights,
          adsets:           adsetNodes,
        });
      }

      // Agrupa por objetivo
      const groupMap = new Map<string, ObjectiveGroup>();
      for (const camp of campaignNodes) {
        const key = camp.objective;
        if (!groupMap.has(key)) {
          groupMap.set(key, {
            objective:       camp.objective,
            objective_label: camp.objective_label,
            total_spend:     0,
            total_results:   0,
            cpr:             0,
            campaigns:       [],
          });
        }
        const g = groupMap.get(key)!;
        g.total_spend   += camp.insights.spend;
        g.total_results += camp.insights.results;
        g.campaigns.push(camp);
      }

      // Calcula CPR por grupo
      const groups: ObjectiveGroup[] = [];
      for (const g of groupMap.values()) {
        g.cpr = g.total_results > 0 ? g.total_spend / g.total_results : 0;
        // Ordena campanhas por gasto desc
        g.campaigns.sort((a, b) => b.insights.spend - a.insights.spend);
        groups.push(g);
      }
      // Ordena grupos por gasto desc
      groups.sort((a, b) => b.total_spend - a.total_spend);

      return NextResponse.json({
        account_status: accountData.account_status as number,
        account_name:   accountData.name as string,
        currency:       (accountData.currency as string) ?? "BRL",
        groups,
      });
    }

    // ── Buscar insights de uma conta (legado — mantido para badges externos) ───
    if (action === "insights") {
      const accountId = searchParams.get("account_id");
      const since     = searchParams.get("since");
      const until     = searchParams.get("until");

      if (!accountId) return NextResponse.json({ error: "account_id obrigatório" }, { status: 400 });

      const accountData = await metaFetch(`/${accountId}`, {
        access_token: token,
        fields: "account_status,name,currency",
      });

      // Mapa de objectives para campanhas
      const objectiveMap = new Map<string, string>();
      try {
        let url: string | null = `/${accountId}/campaigns`;
        while (url) {
          const campData = await metaFetch(url, {
            access_token: token,
            fields: "id,objective",
            limit: "500",
          });
          for (const c of (campData.data ?? []) as { id: string; objective: string }[]) {
            objectiveMap.set(c.id, c.objective ?? "UNKNOWN");
          }
          url = campData.paging?.cursors?.after
            ? `/${accountId}/campaigns?after=${campData.paging.cursors.after}`
            : null;
          if (campData.paging?.next === undefined) break;
        }
      } catch { /* sem permissão */ }

      const insightParams: Record<string, string> = {
        access_token: token,
        fields: "campaign_id,campaign_name,spend,actions,cost_per_action_type",
        level: "campaign",
        limit: "500",
      };

      if (since && until) {
        insightParams.time_range = JSON.stringify({ since, until });
      } else {
        insightParams.date_preset = "maximum";
      }

      const OBJECTIVE_LABEL_MAP: Record<string, string> = {
        OUTCOME_LEADS:            "Leads",
        OUTCOME_ENGAGEMENT:       "Engajamento",
        OUTCOME_AWARENESS:        "Reconhecimento",
        OUTCOME_TRAFFIC:          "Tráfego",
        OUTCOME_SALES:            "Vendas",
        OUTCOME_APP_PROMOTION:    "App",
        MESSAGES:                 "Mensagens",
        UNKNOWN:                  "—",
      };

      const FORM_LEAD_TYPE  = "lead";
      const MSG_LEAD_TYPES  = new Set([
        "onsite_conversion.messaging_conversation_started_7d",
        "onsite_conversion.lead_grouped",
      ]);
      const SKIP_LEAD_TYPES = new Set(["leadgen_grouped"]);

      type CampaignRow = {
        campaign_name: string;
        objective: string;
        objective_label: string;
        spend: string;
        form_leads: number;
        msg_leads: number;
        form_cpl: number;
        msg_cpl: number;
      };

      let totalSpend     = 0;
      let totalFormLeads = 0;
      let totalMsgLeads  = 0;
      const campaigns: CampaignRow[] = [];

      try {
        const insightData = await metaFetch(`/${accountId}/insights`, insightParams);
        const rows: Record<string, unknown>[] = insightData.data ?? [];

        for (const row of rows) {
          const campId    = (row.campaign_id as string) ?? "";
          const campSpend = parseFloat((row.spend as string) ?? "0");
          totalSpend += campSpend;

          const objective      = objectiveMap.get(campId) ?? "UNKNOWN";
          const objectiveLabel = OBJECTIVE_LABEL_MAP[objective] ?? objective;

          const actions: ActionEntry[] = (row.actions as ActionEntry[]) ?? [];
          const cpaList: ActionEntry[] = (row.cost_per_action_type as ActionEntry[]) ?? [];

          let campFormLeads = 0;
          let campMsgLeads  = 0;

          for (const act of actions) {
            if (SKIP_LEAD_TYPES.has(act.action_type)) continue;
            if (act.action_type === FORM_LEAD_TYPE)    campFormLeads += parseInt(act.value ?? "0", 10);
            if (MSG_LEAD_TYPES.has(act.action_type))   campMsgLeads  += parseInt(act.value ?? "0", 10);
          }

          totalFormLeads += campFormLeads;
          totalMsgLeads  += campMsgLeads;

          let campFormCpl = 0;
          let campMsgCpl  = 0;
          for (const cpa of cpaList) {
            if (SKIP_LEAD_TYPES.has(cpa.action_type)) continue;
            if (cpa.action_type === FORM_LEAD_TYPE) {
              const v = parseFloat(cpa.value ?? "0"); if (v > 0) campFormCpl = v;
            }
            if (MSG_LEAD_TYPES.has(cpa.action_type)) {
              const v = parseFloat(cpa.value ?? "0"); if (v > 0 && (campMsgCpl === 0 || v < campMsgCpl)) campMsgCpl = v;
            }
          }

          const campTotal = campFormLeads + campMsgLeads;
          if (campTotal > 0) {
            if (campFormCpl === 0 && campFormLeads > 0) campFormCpl = (campSpend * (campFormLeads / campTotal)) / campFormLeads;
            if (campMsgCpl === 0 && campMsgLeads  > 0) campMsgCpl  = (campSpend * (campMsgLeads  / campTotal)) / campMsgLeads;
          }

          campaigns.push({
            campaign_name:   (row.campaign_name as string) ?? "Campanha",
            objective,
            objective_label: objectiveLabel,
            spend:           campSpend.toFixed(2),
            form_leads:      campFormLeads,
            msg_leads:       campMsgLeads,
            form_cpl:        campFormCpl,
            msg_cpl:         campMsgCpl,
          });
        }
      } catch { /* sem dados */ }

      const totalLeads = totalFormLeads + totalMsgLeads;
      const cpl        = totalLeads > 0 ? totalSpend / totalLeads : 0;
      const formSpend  = totalLeads > 0 && totalFormLeads > 0 ? totalSpend * (totalFormLeads / totalLeads) : 0;
      const msgSpend   = totalLeads > 0 && totalMsgLeads  > 0 ? totalSpend * (totalMsgLeads  / totalLeads) : 0;
      const formCpl    = totalFormLeads > 0 ? formSpend / totalFormLeads : 0;
      const msgCpl     = totalMsgLeads  > 0 ? msgSpend  / totalMsgLeads  : 0;

      return NextResponse.json({
        account_status: accountData.account_status as number,
        account_name:   accountData.name as string,
        currency:       (accountData.currency as string) ?? "BRL",
        spend:          totalSpend,
        leads:          totalFormLeads,
        messages:       totalMsgLeads,
        total_leads:    totalLeads,
        cpl,
        form_leads:     totalFormLeads,
        form_spend:     formSpend,
        form_cpl:       formCpl,
        msg_leads:      totalMsgLeads,
        msg_spend:      msgSpend,
        msg_cpl:        msgCpl,
        campaigns,
      });
    }

    return NextResponse.json({ error: "action inválida" }, { status: 400 });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
