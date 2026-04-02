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

// ─── Mapa estrito: objective → action_types que definem "resultado" ────────────
// SEM fallback genérico. Se o evento não está aqui, results = 0.

const OBJECTIVE_ACTION_MAP: Record<string, string[]> = {
  OUTCOME_LEADS:      ["lead", "onsite_conversion.lead_grouped"],
  OUTCOME_ENGAGEMENT: ["post_engagement"],
  MESSAGES:           ["onsite_conversion.messaging_conversation_started_7d"],
  OUTCOME_TRAFFIC:    ["link_click"],
  OUTCOME_SALES:      ["purchase", "omni_purchase"],
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
    const targetSet = new Set(targetTypes);
    for (const a of actions) {
      if (targetSet.has(a.action_type)) results += parseInt(a.value ?? "0", 10);
    }
  }
  // SEM fallback — se objective não mapeado ou sem eventos, results = 0

  let cpr = 0;
  if (targetTypes) {
    const targetSet = new Set(targetTypes);
    for (const c of cpaList) {
      if (targetSet.has(c.action_type)) {
        const v = parseFloat(c.value ?? "0");
        if (v > 0 && (cpr === 0 || v < cpr)) cpr = v;
      }
    }
  }
  if (cpr === 0 && results > 0) cpr = spend / results;

  return { spend, results, cpr };
}

// ─── Rotas ────────────────────────────────────────────────────────────────────

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

    // ── Auto-sync de leads Meta Ads ────────────────────────────────────────────
    //
    // PROBLEMA RAIZ (confirmado pelo debug):
    //   O token é de um "Conversions API System User" — um User Token de sistema.
    //   A API /me/accounts retorna as páginas, mas com seus próprios Page Access Tokens.
    //   Para chamar /{pageId}/leadgen_forms, PRECISA usar o Page Access Token da página,
    //   não o User Token do sistema.
    //
    // SOLUÇÃO:
    //   1. GET /me/accounts → obtém páginas + page_access_token de cada uma
    //   2. Para cada página, usa o page_access_token dela (não o token do sistema)
    //      para chamar /{pageId}/leadgen_forms
    //   3. Para cada formulário, usa o page_access_token para /{formId}/leads
    //
    if (action === "leads") {
      const accountId = searchParams.get("account_id");
      if (!accountId) return NextResponse.json({ error: "account_id obrigatório" }, { status: 400 });

      type LeadRow = {
        meta_lead_id: string;
        nome: string;
        email: string;
        telefone: string;
        created_time: string;
        form_id: string;
        form_name: string;
        page_name: string;
      };

      const leads: LeadRow[] = [];

      // Filtro: apenas leads dos últimos 15 dias (evita timeout)
      const fifteenDaysAgo = Math.floor((Date.now() - 15 * 24 * 60 * 60 * 1000) / 1000);
      const leadsFiltering = JSON.stringify([
        { field: "time_created", operator: "GREATER_THAN", value: fifteenDaysAgo },
      ]);

      // ── Helper: parseia field_data de um lead ────────────────────────────────
      function parseFieldData(fieldData: { name: string; values: string[] }[]): {
        nome: string; email: string; telefone: string;
      } {
        let nome = ""; let email = ""; let telefone = "";
        for (const field of (fieldData ?? [])) {
          const key = (field.name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
          const val = field.values?.[0] ?? "";
          if (!val) continue;
          if (["fullname", "nome", "name", "firstname"].includes(key)) nome = nome ? `${nome} ${val}` : val;
          else if (key === "lastname") nome = nome ? `${nome} ${val}` : val;
          else if (["email", "emailaddress"].includes(key)) email = val;
          else if (["phonenumber", "phone", "telefone", "celular", "whatsapp"].includes(key)) telefone = val;
        }
        // Fallbacks por padrão de valor
        if (!email) {
          const ef = fieldData?.find(f => (f.values?.[0] ?? "").includes("@"));
          if (ef) email = ef.values?.[0] ?? "";
        }
        if (!telefone) {
          const pf = fieldData?.find(f => /^[+() 0-9\-\.]{9,20}$/.test(f.values?.[0] ?? ""));
          if (pf) telefone = pf.values?.[0] ?? "";
        }
        return { nome: nome || "Lead Meta", email, telefone };
      }

      // ── Helper: busca leads de um formulário usando o Page Access Token ───────
      async function fetchLeadsForForm(
        formId: string,
        formName: string,
        pageName: string,
        pageToken: string,
      ): Promise<void> {
        let cursor: string | null = null;
        let pageCount = 0;
        while (pageCount < 5) {
          const params: Record<string, string> = {
            access_token: pageToken,   // ← usa o Page Token, não o System User Token
            fields: "id,field_data,created_time",
            limit: "100",
            filtering: leadsFiltering,
          };
          if (cursor) params.after = cursor;

          let leadsData: Record<string, unknown>;
          try {
            leadsData = await metaFetch(`/${formId}/leads`, params);
          } catch (fetchErr: unknown) {
            const errMsg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
            console.error(`[Meta Leads] form ${formId} (${formName}): ${errMsg}`);
            break;
          }

          const rows = (leadsData.data ?? []) as {
            id: string;
            created_time: string;
            field_data: { name: string; values: string[] }[];
          }[];

          for (const row of rows) {
            const { nome, email, telefone } = parseFieldData(row.field_data ?? []);
            leads.push({
              meta_lead_id: row.id,
              nome, email, telefone,
              created_time: row.created_time,
              form_id:      formId,
              form_name:    formName,
              page_name:    pageName,
            });
          }

          const paging = leadsData.paging as { cursors?: { after?: string }; next?: string } | undefined;
          cursor = paging?.cursors?.after ?? null;
          if (!cursor || !paging?.next) break;
          pageCount++;
        }
      }

      // ── 1. Busca páginas + page_access_token via /me/accounts ─────────────────
      // O System User Token tem acesso a /me/accounts e recebe o access_token de cada página.
      // Esse page_access_token é o que deve ser usado para leadgen_forms e leads.
      let pages: { id: string; name: string; access_token: string }[] = [];
      try {
        const pagesData = await metaFetch("/me/accounts", {
          access_token: token,
          fields: "id,name,access_token",   // ← pede o access_token da página
          limit: "100",
        });
        pages = (pagesData.data ?? []) as { id: string; name: string; access_token: string }[];
      } catch (err: unknown) {
        console.error(`[Meta Leads] Erro ao listar páginas: ${err instanceof Error ? err.message : String(err)}`);
      }

      // ── 2. Para cada Página → formulários → leads (usando o Page Token) ────────
      for (const pg of pages) {
        const pageToken = pg.access_token || token; // prefere o page token; fallback pro system token

        let forms: { id: string; name: string }[] = [];
        try {
          const formsData = await metaFetch(`/${pg.id}/leadgen_forms`, {
            access_token: pageToken,   // ← Page Token aqui
            fields: "id,name,status",
            limit: "100",
          });
          forms = (formsData.data ?? []) as { id: string; name: string }[];
        } catch (err: unknown) {
          console.error(`[Meta Leads] Formulários da página ${pg.id} (${pg.name}): ${err instanceof Error ? err.message : String(err)}`);
          continue;
        }

        for (const form of forms) {
          try {
            await fetchLeadsForForm(form.id, form.name, pg.name, pageToken);
          } catch { /* segue para o próximo formulário */ }
        }
      }

      return NextResponse.json({ leads, pages_scanned: pages.length });
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

      const timeParam: Record<string, string> = since && until
        ? { time_range: JSON.stringify({ since, until }) }
        : { date_preset: "last_7d" };

      const insightFields = "spend,actions,cost_per_action_type";

      const campaignData = await metaFetch(`/${accountId}/campaigns`, {
        access_token: token,
        fields: `id,name,objective,status,insights{${insightFields}}`,
        limit: "100",
        ...timeParam,
      });

      const campaignNodes: CampaignNode[] = [];

      for (const camp of (campaignData.data ?? []) as Record<string, unknown>[]) {
        const campId         = camp.id as string;
        const campName       = (camp.name as string) ?? "Campanha";
        const objective      = (camp.objective as string) ?? "UNKNOWN";
        const objectiveLabel = OBJECTIVE_LABEL[objective] ?? objective;

        const campInsightRow = ((camp.insights as { data?: Record<string, unknown>[] })?.data ?? [])[0] ?? {};
        const campSpend   = parseFloat((campInsightRow.spend as string) ?? "0") || 0;
        const campActions = (campInsightRow.actions as ActionEntry[]) ?? [];
        const campCpa     = (campInsightRow.cost_per_action_type as ActionEntry[]) ?? [];
        const campInsights = extractInsights(campActions, campCpa, campSpend, objective);

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
            } catch { /* sem ads */ }

            adsetNodes.push({
              id:       adsetId,
              name:     adsetName,
              status:   (adset.status as string) ?? "UNKNOWN",
              insights: adsetInsights,
              ads:      adNodes,
            });
          }
        } catch { /* sem adsets */ }

        campaignNodes.push({
          id: campId, name: campName, objective, objective_label: objectiveLabel,
          status: (camp.status as string) ?? "UNKNOWN",
          insights: campInsights, adsets: adsetNodes,
        });
      }

      // Agrupa por objetivo
      const groupMap = new Map<string, ObjectiveGroup>();
      for (const camp of campaignNodes) {
        const key = camp.objective;
        if (!groupMap.has(key)) {
          groupMap.set(key, {
            objective: camp.objective, objective_label: camp.objective_label,
            total_spend: 0, total_results: 0, cpr: 0, campaigns: [],
          });
        }
        const g = groupMap.get(key)!;
        g.total_spend   += camp.insights.spend;
        g.total_results += camp.insights.results;
        g.campaigns.push(camp);
      }

      const groups: ObjectiveGroup[] = [];
      for (const g of groupMap.values()) {
        g.cpr = g.total_results > 0 ? g.total_spend / g.total_results : 0;
        g.campaigns.sort((a, b) => b.insights.spend - a.insights.spend);
        groups.push(g);
      }
      groups.sort((a, b) => b.total_spend - a.total_spend);

      return NextResponse.json({
        account_status: accountData.account_status as number,
        account_name:   accountData.name as string,
        currency:       (accountData.currency as string) ?? "BRL",
        groups,
      });
    }

    // ── Insights (legado — badges externos) ───────────────────────────────────
    if (action === "insights") {
      const accountId = searchParams.get("account_id");
      const since     = searchParams.get("since");
      const until     = searchParams.get("until");
      if (!accountId) return NextResponse.json({ error: "account_id obrigatório" }, { status: 400 });

      const accountData = await metaFetch(`/${accountId}`, {
        access_token: token,
        fields: "account_status,name,currency",
      });

      const objectiveMap = new Map<string, string>();
      try {
        const campData = await metaFetch(`/${accountId}/campaigns`, {
          access_token: token, fields: "id,objective", limit: "500",
        });
        for (const c of (campData.data ?? []) as { id: string; objective: string }[]) {
          objectiveMap.set(c.id, c.objective ?? "UNKNOWN");
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
        OUTCOME_LEADS: "Leads", OUTCOME_ENGAGEMENT: "Engajamento",
        OUTCOME_AWARENESS: "Reconhecimento", OUTCOME_TRAFFIC: "Tráfego",
        OUTCOME_SALES: "Vendas", OUTCOME_APP_PROMOTION: "App",
        MESSAGES: "Mensagens", UNKNOWN: "—",
      };

      type CampaignRow = {
        campaign_name: string; objective: string; objective_label: string;
        spend: string; form_leads: number; msg_leads: number;
        form_cpl: number; msg_cpl: number;
      };

      let totalSpend = 0; let totalFormLeads = 0; let totalMsgLeads = 0;
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

          // Usa extractInsights estrito por objective
          const ins = extractInsights(actions, cpaList, campSpend, objective);

          // Separa form_leads vs msg_leads baseado no objective
          let campFormLeads = 0; let campMsgLeads = 0;
          let campFormCpl = 0;   let campMsgCpl = 0;

          if (objective === "OUTCOME_LEADS") {
            campFormLeads = ins.results;
            campFormCpl   = ins.cpr;
          } else if (objective === "MESSAGES") {
            campMsgLeads = ins.results;
            campMsgCpl   = ins.cpr;
          }

          totalFormLeads += campFormLeads;
          totalMsgLeads  += campMsgLeads;

          campaigns.push({
            campaign_name:   (row.campaign_name as string) ?? "Campanha",
            objective, objective_label: objectiveLabel,
            spend:     campSpend.toFixed(2),
            form_leads: campFormLeads, msg_leads: campMsgLeads,
            form_cpl:   campFormCpl,  msg_cpl:   campMsgCpl,
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
        spend: totalSpend, leads: totalFormLeads, messages: totalMsgLeads,
        total_leads: totalLeads, cpl,
        form_leads: totalFormLeads, form_spend: formSpend, form_cpl: formCpl,
        msg_leads: totalMsgLeads,  msg_spend: msgSpend,   msg_cpl: msgCpl,
        campaigns,
      });
    }

    // ── DEBUG: diagnóstico do token (não expor em produção) ───────────────────
    if (action === "debug") {
      const accountId = searchParams.get("account_id") ?? "";
      const report: Record<string, unknown> = {};

      try {
        report.me = await metaFetch("/me", { access_token: token, fields: "id,name" });
      } catch (e) { report.me_error = e instanceof Error ? e.message : String(e); }

      try {
        const perms = await metaFetch("/me/permissions", { access_token: token });
        report.permissions = perms.data ?? [];
      } catch (e) { report.permissions_error = e instanceof Error ? e.message : String(e); }

      try {
        const pd = await metaFetch("/me/accounts", {
          access_token: token, fields: "id,name,access_token", limit: "50",
        });
        // Oculta os tokens completos por segurança — mostra só os primeiros 20 chars
        report.pages_via_me_accounts = ((pd.data ?? []) as { id: string; name: string; access_token?: string }[])
          .map(p => ({ id: p.id, name: p.name, has_page_token: !!p.access_token }));
      } catch (e) { report.pages_via_me_accounts_error = e instanceof Error ? e.message : String(e); }

      if (accountId && accountId !== "SEU_ACT_ID") {
        try {
          const campData = await metaFetch(`/${accountId}/campaigns`, {
            access_token: token, fields: "id,name,objective,promoted_object", limit: "10",
          });
          report.campaigns_sample = campData.data ?? [];
        } catch (e) { report.campaigns_error = e instanceof Error ? e.message : String(e); }
      }

      // Testa leadgen_forms usando o page_access_token correto
      try {
        const pagesWithToken = await metaFetch("/me/accounts", {
          access_token: token, fields: "id,name,access_token", limit: "10",
        });
        const formsReport = [];
        for (const pg of ((pagesWithToken.data ?? []) as { id: string; name: string; access_token: string }[]).slice(0, 5)) {
          try {
            const fd = await metaFetch(`/${pg.id}/leadgen_forms`, {
              access_token: pg.access_token,   // ← usa o page token
              fields: "id,name,status", limit: "5",
            });
            formsReport.push({ page_id: pg.id, page_name: pg.name, forms_count: (fd.data ?? []).length, forms: fd.data ?? [], error: null });
          } catch (e) {
            formsReport.push({ page_id: pg.id, page_name: pg.name, forms_count: 0, error: e instanceof Error ? e.message : String(e) });
          }
        }
        report.leadgen_forms_by_page = formsReport;
      } catch (e) { report.leadgen_forms_error = e instanceof Error ? e.message : String(e); }

      return NextResponse.json(report);
    }

    return NextResponse.json({ error: "action inválida" }, { status: 400 });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
