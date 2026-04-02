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

interface AdInsights { spend: number; results: number; cpr: number; }
interface AdNode { id: string; name: string; status: string; insights: AdInsights; }
interface AdSetNode { id: string; name: string; status: string; insights: AdInsights; ads: AdNode[]; }
interface CampaignNode {
  id: string; name: string; objective: string; objective_label: string;
  status: string; insights: AdInsights; adsets: AdSetNode[];
}
interface ObjectiveGroup {
  objective: string; objective_label: string;
  total_spend: number; total_results: number; cpr: number;
  campaigns: CampaignNode[];
}

const OBJECTIVE_LABEL: Record<string, string> = {
  OUTCOME_LEADS: "Leads", OUTCOME_ENGAGEMENT: "Engajamento",
  OUTCOME_AWARENESS: "Reconhecimento", OUTCOME_TRAFFIC: "Tráfego",
  OUTCOME_SALES: "Vendas", OUTCOME_APP_PROMOTION: "App",
  MESSAGES: "Mensagens", UNKNOWN: "—",
};

// Mapa estrito: objective → action_types que definem "resultado"
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
  objective = "UNKNOWN",
): AdInsights {
  const targetTypes = OBJECTIVE_ACTION_MAP[objective];
  let results = 0;
  if (targetTypes) {
    const targetSet = new Set(targetTypes);
    for (const a of actions) {
      if (targetSet.has(a.action_type)) results += parseInt(a.value ?? "0", 10);
    }
  }
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

// ─── Rota principal ───────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const action      = searchParams.get("action");
  const clientToken = searchParams.get("token");

  try {
    const token = resolveToken(clientToken);

    // ── Listar contas ──────────────────────────────────────────────────────────
    if (action === "accounts") {
      const data = await metaFetch("/me/adaccounts", {
        access_token: token, fields: "id,name,account_status,currency", limit: "100",
      });
      return NextResponse.json({
        accounts: (data.data ?? []).map((a: Record<string, unknown>) => ({
          id: a.id, name: a.name, status: a.account_status, currency: a.currency,
        })),
      });
    }

    // ── Auto-sync de leads Meta Ads ────────────────────────────────────────────
    //
    // ARQUITETURA CORRETA (System User Token com acesso a múltiplas contas):
    //
    //  O token pode gerenciar dezenas de contas/páginas. Para não misturar leads
    //  de clientes diferentes, o vínculo é feito assim:
    //
    //  1. Busca as campanhas da conta específica (accountId do cliente)
    //     com promoted_object para extrair os page_ids DESSA conta.
    //  2. Busca /me/accounts para obter o page_access_token de cada página
    //     (necessário pois leadgen_forms exige Page Token, não System User Token).
    //  3. Só processa formulários das páginas que pertencem a ESSA conta.
    //
    if (action === "leads") {
      const accountId = searchParams.get("account_id");
      if (!accountId) return NextResponse.json({ error: "account_id obrigatório" }, { status: 400 });

      type LeadRow = {
        meta_lead_id: string; nome: string; email: string; telefone: string;
        created_time: string; form_id: string; form_name: string;
      };
      const leads: LeadRow[] = [];

      // Filtro: últimos 15 dias
      const fifteenDaysAgo = Math.floor((Date.now() - 15 * 24 * 60 * 60 * 1000) / 1000);
      const leadsFiltering = JSON.stringify([
        { field: "time_created", operator: "GREATER_THAN", value: fifteenDaysAgo },
      ]);

      function parseFieldData(fieldData: { name: string; values: string[] }[]) {
        let nome = ""; let email = ""; let telefone = "";
        for (const f of (fieldData ?? [])) {
          const key = (f.name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
          const val = f.values?.[0] ?? "";
          if (!val) continue;
          if (["fullname", "nome", "name", "firstname"].includes(key)) nome = nome ? `${nome} ${val}` : val;
          else if (key === "lastname") nome = nome ? `${nome} ${val}` : val;
          else if (["email", "emailaddress"].includes(key)) email = val;
          else if (["phonenumber", "phone", "telefone", "celular", "whatsapp"].includes(key)) telefone = val;
        }
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

      async function fetchLeadsForForm(formId: string, formName: string, pageToken: string) {
        let cursor: string | null = null;
        let pageCount = 0;
        while (pageCount < 5) {
          const params: Record<string, string> = {
            access_token: pageToken,
            fields: "id,field_data,created_time",
            limit: "100",
            filtering: leadsFiltering,
          };
          if (cursor) params.after = cursor;
          let leadsData: Record<string, unknown>;
          try {
            leadsData = await metaFetch(`/${formId}/leads`, params);
          } catch (e: unknown) {
            console.error(`[leads] form ${formId}: ${e instanceof Error ? e.message : String(e)}`);
            break;
          }
          for (const row of (leadsData.data ?? []) as { id: string; created_time: string; field_data: { name: string; values: string[] }[] }[]) {
            const { nome, email, telefone } = parseFieldData(row.field_data ?? []);
            leads.push({ meta_lead_id: row.id, nome, email, telefone, created_time: row.created_time, form_id: formId, form_name: formName });
          }
          const paging = leadsData.paging as { cursors?: { after?: string }; next?: string } | undefined;
          cursor = paging?.cursors?.after ?? null;
          if (!cursor || !paging?.next) break;
          pageCount++;
        }
      }

      // ── PASSO 1: Descobre page_ids vinculados a ESTA conta de anúncios ───────
      // Usa promoted_object das campanhas para garantir que só pega
      // as páginas que anunciam por esta conta — sem misturar com outros clientes.
      const accountPageIds = new Set<string>();
      try {
        const campData = await metaFetch(`/${accountId}/campaigns`, {
          access_token: token,
          fields: "promoted_object",
          limit: "200",
        });
        for (const camp of (campData.data ?? []) as { promoted_object?: { page_id?: string } }[]) {
          const pid = camp.promoted_object?.page_id;
          if (pid) accountPageIds.add(pid);
        }
      } catch (e: unknown) {
        console.error(`[leads] Erro ao buscar campanhas de ${accountId}: ${e instanceof Error ? e.message : String(e)}`);
      }

      if (accountPageIds.size === 0) {
        // Nenhuma página encontrada via campanhas — retorna vazio sem contaminar
        console.warn(`[leads] Nenhum page_id encontrado para a conta ${accountId}`);
        return NextResponse.json({ leads: [], pages_scanned: 0 });
      }

      // ── PASSO 2: Busca page_access_tokens via /me/accounts ───────────────────
      // O System User Token não pode usar leadgen_forms com token próprio.
      // /me/accounts retorna o access_token específico de cada página.
      const pageTokenMap = new Map<string, string>(); // page_id → page_access_token
      try {
        const pagesData = await metaFetch("/me/accounts", {
          access_token: token,
          fields: "id,access_token",
          limit: "200",
        });
        for (const pg of (pagesData.data ?? []) as { id: string; access_token?: string }[]) {
          if (pg.access_token) pageTokenMap.set(pg.id, pg.access_token);
        }
      } catch (e: unknown) {
        console.error(`[leads] Erro ao buscar page tokens: ${e instanceof Error ? e.message : String(e)}`);
      }

      // ── PASSO 3: Processa SOMENTE as páginas desta conta ─────────────────────
      for (const pageId of accountPageIds) {
        const pageToken = pageTokenMap.get(pageId);
        if (!pageToken) {
          console.warn(`[leads] Sem page token para página ${pageId} — pulando`);
          continue;
        }

        let forms: { id: string; name: string }[] = [];
        try {
          const formsData = await metaFetch(`/${pageId}/leadgen_forms`, {
            access_token: pageToken,
            fields: "id,name,status",
            limit: "100",
          });
          forms = (formsData.data ?? []) as { id: string; name: string }[];
        } catch (e: unknown) {
          console.error(`[leads] Formulários de ${pageId}: ${e instanceof Error ? e.message : String(e)}`);
          continue;
        }

        for (const form of forms) {
          try {
            await fetchLeadsForForm(form.id, form.name, pageToken);
          } catch { /* segue */ }
        }
      }

      return NextResponse.json({ leads, pages_scanned: accountPageIds.size });
    }

    // ── Árvore Radar: Campaigns → AdSets → Ads ────────────────────────────────
    if (action === "tree") {
      const accountId = searchParams.get("account_id");
      const since     = searchParams.get("since");
      const until     = searchParams.get("until");
      if (!accountId) return NextResponse.json({ error: "account_id obrigatório" }, { status: 400 });

      const accountData = await metaFetch(`/${accountId}`, {
        access_token: token, fields: "account_status,name,currency",
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

        const campRow  = ((camp.insights as { data?: Record<string, unknown>[] })?.data ?? [])[0] ?? {};
        const campInsights = extractInsights(
          (campRow.actions as ActionEntry[]) ?? [],
          (campRow.cost_per_action_type as ActionEntry[]) ?? [],
          parseFloat((campRow.spend as string) ?? "0") || 0,
          objective,
        );

        let adsetNodes: AdSetNode[] = [];
        try {
          const adsetData = await metaFetch(`/${campId}/adsets`, {
            access_token: token,
            fields: `id,name,status,insights{${insightFields}}`,
            limit: "100",
            ...timeParam,
          });
          for (const adset of (adsetData.data ?? []) as Record<string, unknown>[]) {
            const adsetRow = ((adset.insights as { data?: Record<string, unknown>[] })?.data ?? [])[0] ?? {};
            const adsetInsights = extractInsights(
              (adsetRow.actions as ActionEntry[]) ?? [],
              (adsetRow.cost_per_action_type as ActionEntry[]) ?? [],
              parseFloat((adsetRow.spend as string) ?? "0") || 0,
              objective,
            );
            let adNodes: AdNode[] = [];
            try {
              const adsData = await metaFetch(`/${adset.id as string}/ads`, {
                access_token: token,
                fields: `id,name,status,insights{${insightFields}}`,
                limit: "100",
                ...timeParam,
              });
              adNodes = ((adsData.data ?? []) as Record<string, unknown>[]).map(ad => {
                const adRow = ((ad.insights as { data?: Record<string, unknown>[] })?.data ?? [])[0] ?? {};
                return {
                  id: ad.id as string, name: (ad.name as string) ?? "Anúncio",
                  status: (ad.status as string) ?? "UNKNOWN",
                  insights: extractInsights(
                    (adRow.actions as ActionEntry[]) ?? [],
                    (adRow.cost_per_action_type as ActionEntry[]) ?? [],
                    parseFloat((adRow.spend as string) ?? "0") || 0,
                    objective,
                  ),
                };
              });
            } catch { /* sem ads */ }

            adsetNodes.push({
              id: adset.id as string, name: (adset.name as string) ?? "Conjunto",
              status: (adset.status as string) ?? "UNKNOWN",
              insights: adsetInsights, ads: adNodes,
            });
          }
        } catch { /* sem adsets */ }

        campaignNodes.push({
          id: campId, name: campName, objective, objective_label: objectiveLabel,
          status: (camp.status as string) ?? "UNKNOWN",
          insights: campInsights, adsets: adsetNodes,
        });
      }

      const groupMap = new Map<string, ObjectiveGroup>();
      for (const camp of campaignNodes) {
        if (!groupMap.has(camp.objective)) {
          groupMap.set(camp.objective, {
            objective: camp.objective, objective_label: camp.objective_label,
            total_spend: 0, total_results: 0, cpr: 0, campaigns: [],
          });
        }
        const g = groupMap.get(camp.objective)!;
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

    // ── Insights legado (badges externos) ─────────────────────────────────────
    if (action === "insights") {
      const accountId = searchParams.get("account_id");
      const since     = searchParams.get("since");
      const until     = searchParams.get("until");
      if (!accountId) return NextResponse.json({ error: "account_id obrigatório" }, { status: 400 });

      const accountData = await metaFetch(`/${accountId}`, {
        access_token: token, fields: "account_status,name,currency",
      });

      const objectiveMap = new Map<string, string>();
      try {
        const campData = await metaFetch(`/${accountId}/campaigns`, {
          access_token: token, fields: "id,objective", limit: "500",
        });
        for (const c of (campData.data ?? []) as { id: string; objective: string }[])
          objectiveMap.set(c.id, c.objective ?? "UNKNOWN");
      } catch { /* sem permissão */ }

      const insightParams: Record<string, string> = {
        access_token: token,
        fields: "campaign_id,campaign_name,spend,actions,cost_per_action_type",
        level: "campaign", limit: "500",
      };
      if (since && until) insightParams.time_range = JSON.stringify({ since, until });
      else insightParams.date_preset = "maximum";

      type CampaignRow = {
        campaign_name: string; objective: string; objective_label: string; spend: string;
        form_leads: number; msg_leads: number; form_cpl: number; msg_cpl: number;
      };
      const OBJ_LABEL: Record<string, string> = {
        OUTCOME_LEADS: "Leads", OUTCOME_ENGAGEMENT: "Engajamento",
        OUTCOME_AWARENESS: "Reconhecimento", OUTCOME_TRAFFIC: "Tráfego",
        OUTCOME_SALES: "Vendas", OUTCOME_APP_PROMOTION: "App",
        MESSAGES: "Mensagens", UNKNOWN: "—",
      };

      let totalSpend = 0; let totalFormLeads = 0; let totalMsgLeads = 0;
      const campaigns: CampaignRow[] = [];

      try {
        const insightData = await metaFetch(`/${accountId}/insights`, insightParams);
        for (const row of (insightData.data ?? []) as Record<string, unknown>[]) {
          const campId    = (row.campaign_id as string) ?? "";
          const campSpend = parseFloat((row.spend as string) ?? "0");
          totalSpend += campSpend;
          const objective = objectiveMap.get(campId) ?? "UNKNOWN";
          const ins = extractInsights(
            (row.actions as ActionEntry[]) ?? [],
            (row.cost_per_action_type as ActionEntry[]) ?? [],
            campSpend, objective,
          );
          const campFormLeads = objective === "OUTCOME_LEADS" ? ins.results : 0;
          const campMsgLeads  = objective === "MESSAGES"      ? ins.results : 0;
          totalFormLeads += campFormLeads;
          totalMsgLeads  += campMsgLeads;
          campaigns.push({
            campaign_name:   (row.campaign_name as string) ?? "Campanha",
            objective, objective_label: OBJ_LABEL[objective] ?? objective,
            spend:     campSpend.toFixed(2),
            form_leads: campFormLeads, msg_leads: campMsgLeads,
            form_cpl:   objective === "OUTCOME_LEADS" ? ins.cpr : 0,
            msg_cpl:    objective === "MESSAGES"      ? ins.cpr : 0,
          });
        }
      } catch { /* sem dados */ }

      const totalLeads = totalFormLeads + totalMsgLeads;
      const cpl        = totalLeads > 0 ? totalSpend / totalLeads : 0;
      const formSpend  = totalLeads > 0 && totalFormLeads > 0 ? totalSpend * (totalFormLeads / totalLeads) : 0;
      const msgSpend   = totalLeads > 0 && totalMsgLeads  > 0 ? totalSpend * (totalMsgLeads  / totalLeads) : 0;

      return NextResponse.json({
        account_status: accountData.account_status as number,
        account_name:   accountData.name as string,
        currency:       (accountData.currency as string) ?? "BRL",
        spend: totalSpend, leads: totalFormLeads, messages: totalMsgLeads,
        total_leads: totalLeads, cpl,
        form_leads: totalFormLeads, form_spend: formSpend,
        form_cpl: totalFormLeads > 0 ? formSpend / totalFormLeads : 0,
        msg_leads: totalMsgLeads, msg_spend: msgSpend,
        msg_cpl: totalMsgLeads > 0 ? msgSpend / totalMsgLeads : 0,
        campaigns,
      });
    }

    // ── DEBUG (diagnóstico) ────────────────────────────────────────────────────
    if (action === "debug") {
      const accountId = searchParams.get("account_id") ?? "";
      const report: Record<string, unknown> = {};

      try { report.me = await metaFetch("/me", { access_token: token, fields: "id,name" }); }
      catch (e) { report.me_error = e instanceof Error ? e.message : String(e); }

      try {
        const perms = await metaFetch("/me/permissions", { access_token: token });
        report.permissions = perms.data ?? [];
      } catch (e) { report.permissions_error = e instanceof Error ? e.message : String(e); }

      // page_ids desta conta
      if (accountId) {
        const pageIds = new Set<string>();
        try {
          const campData = await metaFetch(`/${accountId}/campaigns`, {
            access_token: token, fields: "id,name,objective,promoted_object", limit: "20",
          });
          report.campaigns_sample = campData.data ?? [];
          for (const c of (campData.data ?? []) as { promoted_object?: { page_id?: string } }[]) {
            const pid = c.promoted_object?.page_id;
            if (pid) pageIds.add(pid);
          }
        } catch (e) { report.campaigns_error = e instanceof Error ? e.message : String(e); }
        report.page_ids_from_campaigns = [...pageIds];

        // Testa formulários usando page token correto
        if (pageIds.size > 0) {
          const pageTokenMap = new Map<string, string>();
          try {
            const pd = await metaFetch("/me/accounts", {
              access_token: token, fields: "id,name,access_token", limit: "200",
            });
            for (const pg of (pd.data ?? []) as { id: string; name: string; access_token?: string }[]) {
              if (pg.access_token) pageTokenMap.set(pg.id, pg.access_token);
            }
          } catch (e) { report.page_tokens_error = e instanceof Error ? e.message : String(e); }

          const formsReport = [];
          for (const pid of pageIds) {
            const pt = pageTokenMap.get(pid);
            if (!pt) { formsReport.push({ page_id: pid, error: "sem page token" }); continue; }
            try {
              const fd = await metaFetch(`/${pid}/leadgen_forms`, {
                access_token: pt, fields: "id,name,status", limit: "10",
              });
              formsReport.push({ page_id: pid, forms: fd.data ?? [], error: null });
            } catch (e) { formsReport.push({ page_id: pid, forms: [], error: e instanceof Error ? e.message : String(e) }); }
          }
          report.leadgen_forms_by_page = formsReport;
        }
      }

      return NextResponse.json(report);
    }

    return NextResponse.json({ error: "action inválida" }, { status: 400 });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
