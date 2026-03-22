"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Papa from "papaparse";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

type PlatformKey = "meta" | "google" | "gls";

interface Platform {
  key: PlatformKey;
  label: string;
  campaigns: string[];
}

interface Client {
  id: string;
  nome: string;
  gestor: string;
  gestorEstrategico: string;
  platforms: Platform[];
  status: "active" | "inactive";
  createdAt: string;
}

interface Lead {
  id: string;
  nome: string;
  telefone: string;
  data: string;
  plataforma: string;
}

// ─── Platform definitions ─────────────────────────────────────────────────────

const PLATFORM_DEFS = [
  {
    key: "meta" as PlatformKey,
    label: "Meta Ads",
    campaigns: [
      "Direct Messages (Meta)",
      "Engagement (Meta)",
      "Lead Generation (Meta)",
      "Leads Form (Meta)",
      "WhatsApp Leads",
      "Website Traffic",
      "Sales/Conversion",
    ],
  },
  {
    key: "google" as PlatformKey,
    label: "Google Ads",
    campaigns: [
      "Search Network (G-Ads)",
      "Performance Max",
      "Display Network",
      "YouTube Ads",
      "App Install",
    ],
  },
  {
    key: "gls" as PlatformKey,
    label: "Google Local Services",
    campaigns: ["Local Service Ads (GLS)", "Local Awareness"],
  },
];

const PLATFORM_SVG: Record<PlatformKey, React.ReactNode> = {
  meta: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
      <path d="M24 12.073c0-6.627-5.372-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" fill="#1877F2" />
    </svg>
  ),
  google: (
    <svg width="15" height="15" viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  ),
  gls: (
    <svg width="15" height="15" viewBox="0 0 48 48" fill="none">
      <circle cx="24" cy="24" r="20" fill="#34A853" />
      <path d="M34.5858 17.5858L21.4142 30.7574L14.8284 24.1716L12 27L21.4142 36.4142L37.4142 20.4142L34.5858 17.5858Z" fill="white" />
    </svg>
  ),
};

const PLATFORM_CHIP_COLOR: Record<PlatformKey, string> = {
  meta: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  google: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  gls: "bg-purple-500/15 text-purple-400 border-purple-500/30",
};

// ─── Storage ──────────────────────────────────────────────────────────────────

const STORAGE_KEY = "ts_clients_v3";

function loadClients(): Client[] {
  if (typeof window === "undefined") return INITIAL_CLIENTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Client[];
  } catch { /* ignore */ }
  return INITIAL_CLIENTS;
}

function saveClients(list: Client[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

// ─── CSV helpers ──────────────────────────────────────────────────────────────

const HEADER_MAP: Record<string, keyof Lead> = {
  nome: "nome", name: "nome", fullname: "nome", nomecompleto: "nome",
  telefone: "telefone", phone: "telefone", celular: "telefone", whatsapp: "telefone",
  data: "data", date: "data", datacriacao: "data", createdat: "data",
  plataforma: "plataforma", platform: "plataforma", origem: "plataforma",
  source: "plataforma", campanha: "plataforma", campaign: "plataforma",
};

function normalizeH(h: string) {
  return h.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}

function parseCSV(rows: Record<string, string>[]): Lead[] {
  if (!rows.length) return [];
  const map: Record<string, keyof Lead> = {};
  for (const k of Object.keys(rows[0])) { const m = HEADER_MAP[normalizeH(k)]; if (m) map[k] = m; }
  return rows
    .map((r, i) => {
      const l: Partial<Lead> = { id: `l-${Date.now()}-${i}` };
      for (const [k, f] of Object.entries(map)) l[f] = r[k]?.trim() ?? "";
      return l as Lead;
    })
    .filter((l) => l.nome || l.telefone);
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2);

// ─── Status helper ────────────────────────────────────────────────────────────

function clientStatus(c: Client) {
  if (c.status === "inactive") return { label: "CANCELAMENTO", dot: "bg-red-500", badge: "bg-red-500/10 text-red-400 border-red-500/30" };
  if (!c.platforms?.length) return { label: "SEM CAMPANHA", dot: "bg-amber-500", badge: "bg-amber-500/10 text-amber-400 border-amber-500/30" };
  return { label: "ATIVO", dot: "bg-emerald-500", badge: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" };
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

// ── Dropzone ──────────────────────────────────────────────────────────────────

function Dropzone({ onParsed }: { onParsed: (leads: Lead[]) => void }) {
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  const process = useCallback((file: File) => {
    if (!file.name.toLowerCase().endsWith(".csv")) { toast.error("Envie um arquivo .CSV"); return; }
    setLoading(true);
    Papa.parse<Record<string, string>>(file, {
      header: true, skipEmptyLines: true,
      complete: (r) => {
        setLoading(false);
        const leads = parseCSV(r.data);
        if (!leads.length) { toast.error("Nenhum lead encontrado. Verifique as colunas."); return; }
        onParsed(leads);
        toast.success(`${leads.length} leads importados!`);
      },
      error: () => { setLoading(false); toast.error("Falha ao ler o arquivo."); },
    });
  }, [onParsed]);

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) process(f); }}
      onClick={() => ref.current?.click()}
      style={{ touchAction: "manipulation" }}
      className={`rounded-2xl border-2 border-dashed p-7 text-center cursor-pointer transition-all duration-200 ${dragging ? "border-amber-500 bg-amber-500/10" : "border-[#2e2c29] hover:border-amber-500/40 hover:bg-amber-500/5"} ${loading ? "opacity-50 pointer-events-none" : ""}`}
    >
      <input ref={ref} type="file" accept=".csv" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) process(f); e.target.value = ""; }} />
      <div className="flex flex-col items-center gap-2 pointer-events-none">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl transition-all ${dragging ? "bg-amber-500/20 scale-110" : "bg-[#201f1d] border border-[#2e2c29]"}`}>
          {loading ? "⏳" : "📂"}
        </div>
        <p className="font-semibold text-[#e8e2d8] text-sm">
          {loading ? "Processando..." : dragging ? "Solte o arquivo!" : "Arraste o CSV ou toque para selecionar"}
        </p>
        <p className="text-xs text-[#7a7268]">Colunas: <span className="text-amber-500/70">Nome · Telefone · Data · Plataforma</span></p>
      </div>
    </div>
  );
}

// ── Lead Table ────────────────────────────────────────────────────────────────

function LeadTable({ leads, search, platFilter }: { leads: Lead[]; search: string; platFilter: string }) {
  const filtered = leads.filter((l) => {
    const s = search.toLowerCase();
    return (!s || l.nome.toLowerCase().includes(s) || l.telefone.includes(s))
      && (!platFilter || l.plataforma.toLowerCase().includes(platFilter.toLowerCase()));
  });

  if (!filtered.length) return (
    <div className="flex flex-col items-center justify-center py-14 gap-3 rounded-xl border border-[#2e2c29] bg-[#1a1917]">
      <span className="text-4xl">{leads.length === 0 ? "📭" : "🔍"}</span>
      <p className="text-[#7a7268] text-sm text-center px-4">
        {leads.length === 0 ? "Nenhum lead importado. Faça o upload do CSV acima." : "Nenhum resultado para esses filtros."}
      </p>
    </div>
  );

  return (
    <div className="rounded-xl border border-[#2e2c29] overflow-hidden">
      <div className="overflow-x-auto overscroll-x-contain" style={{ WebkitOverflowScrolling: "touch" }}>
        <table className="w-full text-sm min-w-[480px]">
          <thead>
            <tr className="border-b border-[#2e2c29] bg-[#1a1917]">
              {["#", "Nome", "Telefone", "Data", "Plataforma"].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-[#7a7268] whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((lead, i) => (
              <tr key={lead.id} className={`border-b border-[#2e2c29]/40 hover:bg-amber-500/5 transition-colors ${i % 2 === 0 ? "bg-[#201f1d]" : "bg-[#1c1b19]"}`}>
                <td className="px-4 py-3 text-[#7a7268] text-xs font-mono">{i + 1}</td>
                <td className="px-4 py-3 font-medium text-[#e8e2d8] max-w-[160px] truncate">{lead.nome || "—"}</td>
                <td className="px-4 py-3 text-[#7a7268] font-mono text-xs whitespace-nowrap">{lead.telefone || "—"}</td>
                <td className="px-4 py-3 text-[#7a7268] text-xs whitespace-nowrap">{lead.data || "—"}</td>
                <td className="px-4 py-3">
                  {lead.plataforma
                    ? <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold border bg-amber-500/10 text-amber-400 border-amber-500/25 whitespace-nowrap">{lead.plataforma}</span>
                    : <span className="text-[#7a7268]">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Client Card ───────────────────────────────────────────────────────────────

function ClientCard({
  client, onSelect, onEdit, onDelete,
}: {
  client: Client;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const st = clientStatus(client);
  const gestorColor = client.gestorEstrategico === "Duda"
    ? "bg-blue-600/20 text-blue-400 border-blue-500/30"
    : client.gestorEstrategico === "Diego"
    ? "bg-purple-600/20 text-purple-400 border-purple-500/30"
    : "bg-[#201f1d] text-[#7a7268] border-[#2e2c29]";

  // Deduplicate platforms by key for display
  const uniquePlats = client.platforms.filter((p, i, a) => a.findIndex(x => x.key === p.key) === i);

  return (
    <div
      onClick={onSelect}
      style={{ touchAction: "pan-y" }}
      className={`rounded-2xl border p-4 flex flex-col gap-3 cursor-pointer transition-all duration-200 hover:border-amber-500/40 hover:shadow-[0_4px_20px_rgba(245,166,35,0.08)] ${
        client.status === "inactive" ? "border-red-500/30 bg-[#1e1b1b]"
        : !client.platforms?.length ? "border-amber-500/25 bg-[#1e1d1a]"
        : "border-[#2e2c29] bg-[#1a1917]"
      }`}
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-bold text-[#e8e2d8] text-sm leading-tight truncate">{client.nome}</p>
          <span className={`inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold border ${st.badge}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
            {st.label}
          </span>
        </div>
        {/* Action buttons — stopPropagation so they don't trigger onSelect */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
            style={{ touchAction: "manipulation" }}
            className="w-7 h-7 flex items-center justify-center rounded-lg bg-[#201f1d] border border-[#2e2c29] text-[#7a7268] hover:text-[#e8e2d8] hover:border-[#7a7268] transition-colors text-xs"
          >✏️</button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            style={{ touchAction: "manipulation" }}
            className="w-7 h-7 flex items-center justify-center rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors text-xs"
          >🗑</button>
        </div>
      </div>

      {/* Platform chips */}
      <div className="flex flex-wrap gap-1.5">
        {uniquePlats.length ? uniquePlats.map((p) => (
          <span key={p.key} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${PLATFORM_CHIP_COLOR[p.key]}`}>
            {PLATFORM_SVG[p.key]}
            {p.label}
            {p.campaigns.length > 0 && <><span className="opacity-30">·</span><span className="opacity-60 truncate max-w-[100px]">{p.campaigns.join(", ")}</span></>}
          </span>
        )) : <span className="text-[#7a7268] text-xs italic">Nenhuma plataforma</span>}
      </div>

      {/* Footer meta */}
      <div className="flex items-center gap-2 flex-wrap border-t border-[#2e2c29]/50 pt-2">
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#201f1d] border border-[#2e2c29] text-[#7a7268]">🗂 {client.gestor}</span>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${gestorColor}`}>👤 {client.gestorEstrategico}</span>
        <span className="text-[10px] text-[#7a7268] ml-auto">📅 {client.createdAt}</span>
      </div>
    </div>
  );
}

// ── Client Modal (New / Edit) ─────────────────────────────────────────────────

function ClientModal({
  mode, initial, onSave, onClose,
}: {
  mode: "new" | "edit";
  initial?: Client;
  onSave: (data: Omit<Client, "id" | "createdAt">) => void;
  onClose: () => void;
}) {
  const [nome, setNome] = useState(initial?.nome ?? "");
  const [gestor, setGestor] = useState(initial?.gestor ?? "DS");
  const [gestorEstrat, setGestorEstrat] = useState(initial?.gestorEstrategico ?? "");
  const [status, setStatus] = useState<"active" | "inactive">(initial?.status ?? "active");
  const [active, setActive] = useState<Record<PlatformKey, boolean>>({
    meta: initial?.platforms.some((p) => p.key === "meta") ?? false,
    google: initial?.platforms.some((p) => p.key === "google") ?? false,
    gls: initial?.platforms.some((p) => p.key === "gls") ?? false,
  });
  const [camps, setCamps] = useState<Record<PlatformKey, string[]>>({
    meta: initial?.platforms.find((p) => p.key === "meta")?.campaigns ?? [],
    google: initial?.platforms.find((p) => p.key === "google")?.campaigns ?? [],
    gls: initial?.platforms.find((p) => p.key === "gls")?.campaigns ?? [],
  });

  const toggleCamp = (key: PlatformKey, c: string) =>
    setCamps((prev) => ({ ...prev, [key]: prev[key].includes(c) ? prev[key].filter((x) => x !== c) : [...prev[key], c] }));

  const handleSave = () => {
    if (!nome.trim()) { toast.error("Informe o nome do cliente."); return; }
    if (!gestor) { toast.error("Selecione o Gestor de Tráfego."); return; }
    if (!gestorEstrat) { toast.error("Selecione o Gestor Estratégico."); return; }
    const platforms: Platform[] = PLATFORM_DEFS
      .filter((p) => active[p.key])
      .map((p) => ({ key: p.key, label: p.label, campaigns: camps[p.key] }));
    onSave({ nome: nome.trim(), gestor, gestorEstrategico: gestorEstrat, platforms, status });
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full sm:max-w-lg bg-[#1a1917] border border-[#2e2c29] rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col"
        style={{ maxHeight: "88dvh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2e2c29] shrink-0">
          <h2 className="font-bold text-[#e8e2d8]">{mode === "new" ? "✨ Novo Cliente" : "✏️ Editar Cliente"}</h2>
          <button onClick={onClose} style={{ touchAction: "manipulation" }}
            className="w-8 h-8 flex items-center justify-center rounded-xl bg-[#201f1d] border border-[#2e2c29] text-[#7a7268] hover:text-[#e8e2d8] transition-colors">✕</button>
        </div>

        {/* Scrollable body — has own scroll, body is NOT locked */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5"
          style={{ WebkitOverflowScrolling: "touch", overscrollBehavior: "contain" }}>

          {/* Nome */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-[#7a7268]">Nome do Cliente</label>
            <input type="text" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: JAC Cosméticos"
              className="w-full bg-[#201f1d] border border-[#2e2c29] rounded-xl px-4 py-2.5 text-sm text-[#e8e2d8] placeholder:text-[#7a7268] outline-none focus:border-amber-500/60 transition-colors" />
          </div>

          {/* Gestor Tráfego */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-[#7a7268]">Gestor de Tráfego</label>
            <div className="relative">
              <select value={gestor} onChange={(e) => setGestor(e.target.value)}
                className="w-full appearance-none bg-[#201f1d] border border-[#2e2c29] rounded-xl px-4 pr-9 py-2.5 text-sm text-[#e8e2d8] outline-none focus:border-amber-500/60 transition-colors cursor-pointer">
                {["DS", "AV", "GB", "JR"].map((g) => <option key={g}>{g}</option>)}
              </select>
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#7a7268] text-xs">▾</span>
            </div>
          </div>

          {/* Gestor Estratégico */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-[#7a7268]">Gestor Estratégico</label>
            <div className="flex gap-2">
              {["Duda", "Diego"].map((g) => (
                <button key={g} onClick={() => setGestorEstrat(g)} style={{ touchAction: "manipulation" }}
                  className={`px-5 py-1.5 rounded-full text-sm font-semibold border transition-all ${
                    gestorEstrat === g && g === "Duda" ? "bg-blue-600 border-blue-500 text-white"
                    : gestorEstrat === g && g === "Diego" ? "bg-purple-600 border-purple-500 text-white"
                    : "bg-[#201f1d] border-[#2e2c29] text-[#7a7268] hover:text-[#e8e2d8]"}`}>
                  👤 {g}
                </button>
              ))}
            </div>
          </div>

          {/* Status (edit only) */}
          {mode === "edit" && (
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#7a7268]">Status</label>
              <div className="relative">
                <select value={status} onChange={(e) => setStatus(e.target.value as "active" | "inactive")}
                  className="w-full appearance-none bg-[#201f1d] border border-[#2e2c29] rounded-xl px-4 pr-9 py-2.5 text-sm text-[#e8e2d8] outline-none focus:border-amber-500/60 transition-colors cursor-pointer">
                  <option value="active">🟢 Ativo</option>
                  <option value="inactive">🔴 Inativo (Cancelamento)</option>
                </select>
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#7a7268] text-xs">▾</span>
              </div>
            </div>
          )}

          {/* Plataformas */}
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-widest text-[#7a7268]">Plataformas & Campanhas</label>
            {PLATFORM_DEFS.map((plat) => (
              <div key={plat.key} className={`rounded-xl border transition-colors ${active[plat.key] ? "border-amber-500/50 bg-amber-500/5" : "border-[#2e2c29] bg-[#201f1d]"}`}>
                <div className="flex items-center gap-3 px-4 py-3 cursor-pointer" style={{ touchAction: "pan-y" }}
                  onClick={() => setActive((prev) => ({ ...prev, [plat.key]: !prev[plat.key] }))}>
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors shrink-0 ${active[plat.key] ? "bg-amber-500 border-amber-500" : "border-[#3a3835]"}`}>
                    {active[plat.key] && <span className="text-[#111] text-xs font-bold leading-none">✓</span>}
                  </div>
                  <span className="shrink-0">{PLATFORM_SVG[plat.key]}</span>
                  <span className="font-semibold text-sm text-[#e8e2d8]">{plat.label}</span>
                </div>
                {active[plat.key] && (
                  <div className="px-4 pb-3 border-t border-[#2e2c29]/60 space-y-0.5 pt-2">
                    {plat.campaigns.map((c) => (
                      <label key={c} className="flex items-center gap-2.5 py-1 cursor-pointer" style={{ touchAction: "pan-y" }}>
                        <div onClick={() => toggleCamp(plat.key, c)}
                          className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${camps[plat.key].includes(c) ? "bg-amber-500 border-amber-500" : "border-[#3a3835]"}`}>
                          {camps[plat.key].includes(c) && <span className="text-[#111] text-[9px] font-bold leading-none">✓</span>}
                        </div>
                        <span onClick={() => toggleCamp(plat.key, c)}
                          className={`text-xs transition-colors ${camps[plat.key].includes(c) ? "text-[#e8e2d8] font-medium" : "text-[#7a7268]"}`}>
                          {c}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="pb-1" />
        </div>

        {/* Footer actions */}
        <div className="shrink-0 px-5 py-4 border-t border-[#2e2c29] flex gap-3">
          <button onClick={onClose} style={{ touchAction: "manipulation" }}
            className="flex-1 py-2.5 rounded-xl bg-[#201f1d] border border-[#2e2c29] text-[#7a7268] text-sm font-semibold hover:text-[#e8e2d8] transition-colors">
            Cancelar
          </button>
          <button onClick={handleSave} style={{ touchAction: "manipulation" }}
            className="flex-1 py-2.5 rounded-xl bg-amber-500 text-[#111] text-sm font-bold hover:bg-amber-400 active:scale-95 transition-all shadow-[0_4px_16px_rgba(245,166,35,0.3)]">
            {mode === "new" ? "⚡ Cadastrar" : "💾 Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PAGE
// ═══════════════════════════════════════════════════════════════════════════════

export default function Home() {
  // ── State ──────────────────────────────────────────────────────────────────

  const [clients, setClients] = useState<Client[]>([]);
  // null = mostrando lista de clientes | string = ID do cliente ativo (tela de leads)
  const [clienteAtivo, setClienteAtivo] = useState<string | null>(null);
  const [leadsByClient, setLeadsByClient] = useState<Record<string, Lead[]>>({});
  const [clientSearch, setClientSearch] = useState("");
  const [leadSearch, setLeadSearch] = useState("");
  const [platFilter, setPlatFilter] = useState("");
  const [modal, setModal] = useState<{ mode: "new" | "edit"; client?: Client } | null>(null);

  useEffect(() => { setClients(loadClients()); }, []);

  // Garante que o body nunca fique travado — sobrepõe qualquer CSS externo
  useEffect(() => {
    document.documentElement.style.height = "auto";
    document.documentElement.style.overflow = "visible";
    document.body.style.height = "auto";
    document.body.style.overflow = "visible";
    document.body.style.overflowX = "hidden";
    document.body.style.position = "static";
  }, []);

  const persist = (list: Client[]) => { setClients(list); saveClients(list); };

  const activeClient = clients.find((c) => c.id === clienteAtivo) ?? null;
  const activeLeads = clienteAtivo ? (leadsByClient[clienteAtivo] ?? []) : [];
  const platOptions = [...new Set(activeLeads.map((l) => l.plataforma).filter(Boolean))].sort();

  const stats = {
    total: clients.length,
    active: clients.filter((c) => c.status !== "inactive" && c.platforms?.length > 0).length,
    none: clients.filter((c) => c.status !== "inactive" && !c.platforms?.length).length,
    cancel: clients.filter((c) => c.status === "inactive").length,
  };

  const filteredClients = clients.filter((c) =>
    !clientSearch || c.nome.toLowerCase().includes(clientSearch.toLowerCase())
  );

  const handleSaveClient = (data: Omit<Client, "id" | "createdAt">) => {
    if (modal?.mode === "new") {
      const nc: Client = { id: uid(), createdAt: new Date().toLocaleDateString("pt-BR"), ...data };
      persist([nc, ...clients]);
      toast.success(`${data.nome} cadastrado!`);
    } else if (modal?.client) {
      persist(clients.map((c) => c.id === modal.client!.id ? { ...c, ...data } : c));
      toast.success("Alterações salvas!");
    }
    setModal(null);
  };

  const handleDelete = (id: string) => {
    if (!confirm("Excluir este cliente?")) return;
    persist(clients.filter((c) => c.id !== id));
    if (clienteAtivo === id) setClienteAtivo(null);
    toast.success("Cliente removido.");
  };

  const handleLeadsParsed = useCallback((leads: Lead[]) => {
    if (!clienteAtivo) return;
    setLeadsByClient((prev) => ({ ...prev, [clienteAtivo]: [...(prev[clienteAtivo] ?? []), ...leads] }));
  }, [clienteAtivo]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div id="root-layout" className="min-h-screen bg-[#111010] text-[#e8e2d8]">

      {/* Ambient glow */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0 select-none" style={{
        background: "radial-gradient(ellipse 60% 40% at 10% 0%, rgba(245,166,35,0.07) 0%, transparent 60%), radial-gradient(ellipse 40% 30% at 90% 100%, rgba(245,166,35,0.05) 0%, transparent 60%)",
      }} />

      {/* ── Header ── */}
      <header className="sticky top-0 z-50 shrink-0 h-16 flex items-center justify-between px-4 md:px-8 bg-[#111010]/90 backdrop-blur-xl border-b border-[#2e2c29]">
        <div className="flex items-center gap-2.5">
          {/* Logo SVG inline — sem dependência de arquivo externo */}
          <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
            <svg viewBox="0 0 120 110" className="w-7 h-7" fill="none" xmlns="http://www.w3.org/2000/svg">
              {/* Asa esquerda */}
              <path d="M8 48 Q2 28 18 14 Q28 6 44 18 Q34 30 30 46 Q20 44 8 48Z" fill="#f5a623"/>
              {/* Corpo central */}
              <path d="M44 18 Q58 8 78 16 Q92 6 112 4 Q104 28 88 34 Q96 46 100 62 Q80 52 68 58 Q56 68 46 80 Q48 66 40 56 Q30 52 18 62 Q22 46 36 40 Q40 30 44 18Z" fill="#f5a623"/>
              {/* Cauda direita */}
              <path d="M88 34 Q106 38 114 52 Q104 50 96 58 Q90 50 88 34Z" fill="#f5a623"/>
              {/* Bico */}
              <path d="M18 62 Q10 70 8 80 Q14 72 22 74 Q20 68 18 62Z" fill="#f5a623"/>
              {/* Reflexo asa */}
              <path d="M30 46 Q24 54 20 62 Q28 58 36 60 Q34 52 30 46Z" fill="rgba(255,255,255,0.12)"/>
              {/* Reflexo cauda */}
              <path d="M68 58 Q74 66 72 76 Q66 68 62 70 Q64 64 68 58Z" fill="rgba(255,255,255,0.10)"/>
            </svg>
          </div>
          <span className="font-bold text-[1.05rem] tracking-tight">
            TS <span className="text-amber-500">Controler</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Botão Voltar — só aparece na tela de leads */}
          {clienteAtivo && (
            <button
              onClick={() => { setClienteAtivo(null); setLeadSearch(""); setPlatFilter(""); }}
              style={{ touchAction: "manipulation" }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#201f1d] border border-[#2e2c29] text-[#7a7268] text-xs font-semibold hover:text-[#e8e2d8] hover:border-[#7a7268] transition-colors"
            >
              ← Voltar
            </button>
          )}
          <span className="text-[0.6rem] font-semibold uppercase tracking-widest text-[#7a7268] bg-[#1a1917] border border-[#2e2c29] px-3 py-1 rounded-full hidden sm:block">
            Painel do Gestor
          </span>
          {/* Botão novo cliente — só na tela de lista */}
          {!clienteAtivo && (
            <button
              onClick={() => setModal({ mode: "new" })}
              style={{ touchAction: "manipulation" }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500 text-[#111] text-xs font-bold hover:bg-amber-400 active:scale-95 transition-all shadow-[0_2px_12px_rgba(245,166,35,0.3)]"
            >
              ➕ <span className="hidden sm:inline">Novo Cliente</span><span className="sm:hidden">Novo</span>
            </button>
          )}
        </div>
      </header>

      {/* ── Main ── */}
      <main className="w-full max-w-6xl mx-auto px-4 md:px-8 py-6 pb-24">

        {/* ══════════════════════════════════════
            TELA A: LISTA DE CLIENTES
            Visível quando clienteAtivo === null
        ══════════════════════════════════════ */}
        {clienteAtivo === null && (
          <div className="space-y-5">

            {/* Título + stats */}
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
              <div>
                <p className="text-[0.6rem] font-bold uppercase tracking-[0.18em] text-amber-500 mb-0.5">Gerenciamento</p>
                <h1 className="text-2xl font-extrabold tracking-tight">Clientes da Operação</h1>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {[
                  { dot: "bg-emerald-500", label: `Ativos: ${stats.active}` },
                  { dot: "bg-amber-500", label: `Sem Camp.: ${stats.none}` },
                  { dot: "bg-red-500", label: `Cancel.: ${stats.cancel}` },
                ].map((s) => (
                  <div key={s.label} className="flex items-center gap-1.5">
                    <div className={`w-2 h-2 rounded-full ${s.dot}`} />
                    <span className="text-[0.7rem] font-semibold text-[#7a7268]">{s.label}</span>
                  </div>
                ))}
                <span className="text-[0.7rem] font-semibold text-[#7a7268]">Total: <span className="text-[#e8e2d8]">{stats.total}</span></span>
              </div>
            </div>

            {/* Busca */}
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#7a7268] text-sm pointer-events-none select-none">🔎</span>
              <input
                type="text"
                value={clientSearch}
                onChange={(e) => setClientSearch(e.target.value)}
                placeholder="Buscar cliente por nome..."
                className="w-full bg-[#201f1d] border border-[#2e2c29] rounded-xl pl-9 pr-4 py-2.5 text-sm text-[#e8e2d8] placeholder:text-[#7a7268] outline-none focus:border-amber-500/60 transition-colors"
              />
            </div>

            {/* Grid de cards */}
            {filteredClients.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3 rounded-xl border border-dashed border-[#2e2c29]">
                <span className="text-4xl">📋</span>
                <p className="text-[#7a7268] text-sm text-center px-4">
                  {clientSearch ? "Nenhum cliente encontrado." : "Nenhum cliente cadastrado. Clique em '+ Novo'."}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 pb-24">
                {filteredClients.map((c) => (
                  <ClientCard
                    key={c.id}
                    client={c}
                    onSelect={() => { setClienteAtivo(c.id); setLeadSearch(""); setPlatFilter(""); }}
                    onEdit={() => setModal({ mode: "edit", client: c })}
                    onDelete={() => handleDelete(c.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════
            TELA B: PAINEL DE LEADS
            Visível quando clienteAtivo !== null
        ══════════════════════════════════════ */}
        {clienteAtivo !== null && activeClient && (
          <div className="space-y-5">

            {/* Cabeçalho do cliente ativo */}
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-2">
                <p className="text-[0.6rem] font-bold uppercase tracking-[0.18em] text-amber-500">Cliente Ativo</p>
                <h2 className="text-xl font-extrabold tracking-tight">{activeClient.nome}</h2>
                {/* Plataformas do cliente */}
                <div className="flex flex-wrap gap-1.5">
                  {activeClient.platforms.filter((p, i, a) => a.findIndex(x => x.key === p.key) === i).map((p) => (
                    <span key={p.key} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${PLATFORM_CHIP_COLOR[p.key]}`}>
                      {PLATFORM_SVG[p.key]}{p.label}
                    </span>
                  ))}
                  {!activeClient.platforms.length && <span className="text-xs text-[#7a7268] italic">Nenhuma plataforma cadastrada</span>}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {activeLeads.length > 0 && (
                  <button
                    onClick={() => { setLeadsByClient((p) => ({ ...p, [clienteAtivo]: [] })); toast.success("Leads removidos."); }}
                    style={{ touchAction: "manipulation" }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/25 text-red-400 text-xs font-semibold hover:bg-red-500/20 transition-colors"
                  >🗑️ Limpar leads</button>
                )}
                <button
                  onClick={() => { setClienteAtivo(null); setLeadSearch(""); setPlatFilter(""); }}
                  style={{ touchAction: "manipulation" }}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-[#201f1d] border border-[#2e2c29] text-[#7a7268] text-xs font-semibold hover:text-[#e8e2d8] hover:border-[#7a7268] transition-colors"
                >← Voltar para Clientes</button>
              </div>
            </div>

            {/* Stats de leads */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                <span className="text-xs font-semibold text-[#7a7268]"><span className="text-[#e8e2d8]">{activeLeads.length}</span> leads</span>
              </div>
            </div>

            {/* Dropzone */}
            <Dropzone onParsed={handleLeadsParsed} />

            {/* Filtros de leads */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#7a7268] text-sm pointer-events-none select-none">🔎</span>
                <input
                  type="text"
                  value={leadSearch}
                  onChange={(e) => setLeadSearch(e.target.value)}
                  placeholder="Buscar por nome ou telefone..."
                  className="w-full bg-[#201f1d] border border-[#2e2c29] rounded-xl pl-9 pr-4 py-2.5 text-sm text-[#e8e2d8] placeholder:text-[#7a7268] outline-none focus:border-amber-500/60 transition-colors"
                />
              </div>
              {platOptions.length > 0 && (
                <div className="relative sm:w-52">
                  <select value={platFilter} onChange={(e) => setPlatFilter(e.target.value)}
                    className="w-full appearance-none bg-[#201f1d] border border-[#2e2c29] rounded-xl px-4 pr-9 py-2.5 text-sm text-[#e8e2d8] outline-none focus:border-amber-500/60 transition-colors cursor-pointer">
                    <option value="">Todas as plataformas</option>
                    {platOptions.map((p) => <option key={p}>{p}</option>)}
                  </select>
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#7a7268] text-xs select-none">▾</span>
                </div>
              )}
            </div>

            {/* Tabela */}
            <LeadTable leads={activeLeads} search={leadSearch} platFilter={platFilter} />

            {/* Exportação hint */}
            {activeLeads.length > 0 && (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 flex items-start gap-3">
                <span className="text-xl shrink-0 mt-0.5">📄</span>
                <div>
                  <p className="text-xs font-semibold text-amber-500 uppercase tracking-wider">Próximo passo</p>
                  <p className="text-xs text-[#7a7268] mt-0.5">Exportação de PDF com coluna de Feedback editável — módulo em breve.</p>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* ── Footer ── */}
      <footer className="shrink-0 border-t border-[#2e2c29] py-4 px-4 md:px-8">
        <p className="text-center text-[0.65rem] text-[#7a7268]">TS Controler · Painel Interno · {new Date().getFullYear()}</p>
      </footer>

      {/* ── Modal ── */}
      {modal && (
        <ClientModal
          mode={modal.mode}
          initial={modal.client}
          onSave={handleSaveClient}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

// ─── Seed data — TODOS os 55 clientes do HTML original ────────────────────────

const INITIAL_CLIENTS: Client[] = [
  { id: "init-0",  nome: "JAC COSMETICOS",            gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "meta",   label: "Meta Ads",                campaigns: ["Direct Messages (Meta)"]    }] },
  { id: "init-1",  nome: "ASC PAINTING",               gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "gls",    label: "Google Local Services",   campaigns: ["Local Service Ads (GLS)"]   }, { key: "meta", label: "Meta Ads", campaigns: ["Engagement (Meta)"] }] },
  { id: "init-2",  nome: "JP HARDWOOD FLOORS",         gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "meta",   label: "Meta Ads",                campaigns: ["Direct Messages (Meta)"]    }] },
  { id: "init-3",  nome: "NEW FAMILY IGLESIA",         gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "google", label: "Google Ads",              campaigns: ["Search Network (G-Ads)"]    }, { key: "meta", label: "Meta Ads", campaigns: ["Lead Generation (Meta)"] }] },
  { id: "init-4",  nome: "P&A PAINTING SERVICES",      gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "meta",   label: "Meta Ads",                campaigns: ["Lead Generation (Meta)"]    }, { key: "google", label: "Google Ads", campaigns: ["Search Network (G-Ads)"] }, { key: "gls", label: "Google Local Services", campaigns: ["Local Service Ads (GLS)"] }] },
  { id: "init-5",  nome: "D&S HARDWOOD FLOORS",        gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "gls",    label: "Google Local Services",   campaigns: ["Local Service Ads (GLS)"]   }] },
  { id: "init-6",  nome: "LB FLOOR & BATH",            gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "meta",   label: "Meta Ads",                campaigns: ["Lead Generation (Meta)"]    }] },
  { id: "init-7",  nome: "LIONS SIDING & ROOFING",     gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "gls",    label: "Google Local Services",   campaigns: ["Local Service Ads (GLS)"]   }, { key: "meta", label: "Meta Ads", campaigns: ["Engagement (Meta)"] }, { key: "google", label: "Google Ads", campaigns: ["Search Network (G-Ads)"] }] },
  { id: "init-8",  nome: "ELITE TILE & FLOORS",        gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "gls",    label: "Google Local Services",   campaigns: ["Local Service Ads (GLS)"]   }, { key: "meta", label: "Meta Ads", campaigns: ["Lead Generation (Meta)"] }] },
  { id: "init-9",  nome: "IMAGINE CONSTRUCTION",       gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "google", label: "Google Ads",              campaigns: ["Search Network (G-Ads)"]    }, { key: "gls", label: "Google Local Services", campaigns: ["Local Service Ads (GLS)"] }, { key: "meta", label: "Meta Ads", campaigns: ["Lead Generation (Meta)"] }] },
  { id: "init-10", nome: "GOLDEN GUTTER & CONSTRUCTION", gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "gls", label: "Google Local Services", campaigns: ["Local Service Ads (GLS)"] }, { key: "google", label: "Google Ads", campaigns: ["Search Network (G-Ads)"] }] },
  { id: "init-11", nome: "JT HOME BUILDING",           gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "google", label: "Google Ads",              campaigns: ["Performance Max"]           }, { key: "gls", label: "Google Local Services", campaigns: ["Local Service Ads (GLS)"] }, { key: "meta", label: "Meta Ads", campaigns: ["Lead Generation (Meta)"] }] },
  { id: "init-12", nome: "AQ HARDWOOD FLOORS",         gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "gls",    label: "Google Local Services",   campaigns: ["Local Service Ads (GLS)"]   }, { key: "meta", label: "Meta Ads", campaigns: ["Engagement (Meta)"] }, { key: "google", label: "Google Ads", campaigns: ["Performance Max"] }] },
  { id: "init-13", nome: "SURFACE SYSTEMS",            gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "gls",    label: "Google Local Services",   campaigns: ["Local Service Ads (GLS)"]   }, { key: "meta", label: "Meta Ads", campaigns: ["Lead Generation (Meta)"] }] },
  { id: "init-14", nome: "MASS CONSTRUCTION INC",      gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "meta",   label: "Meta Ads",                campaigns: ["Lead Generation (Meta)"]    }] },
  { id: "init-15", nome: "SISTER'S CLEANING",          gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "meta",   label: "Meta Ads",                campaigns: ["Direct Messages (Meta)"]    }, { key: "google", label: "Google Ads", campaigns: ["Search Network (G-Ads)"] }] },
  { id: "init-16", nome: "ZARELO",                     gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "meta",   label: "Meta Ads",                campaigns: ["Direct Messages (Meta)"]    }] },
  { id: "init-17", nome: "TS JIU",                     gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "meta",   label: "Meta Ads",                campaigns: ["Direct Messages (Meta)"]    }] },
  { id: "init-18", nome: "DONY SANTO'S LANDSCAPING",   gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "meta",   label: "Meta Ads",                campaigns: ["Lead Generation (Meta)"]    }] },
  { id: "init-19", nome: "LUMAR CONSTRUCTION",         gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "meta",   label: "Meta Ads",                campaigns: ["Lead Generation (Meta)"]    }] },
  { id: "init-20", nome: "SOUZA MOVING COMPANY",       gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [] },
  { id: "init-21", nome: "ESTEVAOS SERVICES",          gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "google", label: "Google Ads",              campaigns: ["Search Network (G-Ads)"]    }] },
  { id: "init-22", nome: "SARTORI PAINTING",           gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "meta",   label: "Meta Ads",                campaigns: ["Direct Messages (Meta)"]    }] },
  { id: "init-23", nome: "SARTORI CLEANING",           gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "meta",   label: "Meta Ads",                campaigns: ["Direct Messages (Meta)"]    }, { key: "gls", label: "Google Local Services", campaigns: ["Local Service Ads (GLS)"] }] },
  { id: "init-24", nome: "DFL PAINTING & REMODELING",  gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "meta",   label: "Meta Ads",                campaigns: ["Direct Messages (Meta)"]    }] },
  { id: "init-25", nome: "P A CONSTRUCTION",           gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "google", label: "Google Ads",              campaigns: ["Search Network (G-Ads)"]    }] },
  { id: "init-26", nome: "SOUZA HOME CLEANING",        gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "gls",    label: "Google Local Services",   campaigns: ["Local Service Ads (GLS)"]   }, { key: "google", label: "Google Ads", campaigns: ["Search Network (G-Ads)"] }, { key: "meta", label: "Meta Ads", campaigns: ["Lead Generation (Meta)"] }] },
  { id: "init-27", nome: "DURABLE FENCE",              gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "gls",    label: "Google Local Services",   campaigns: ["Local Service Ads (GLS)"]   }, { key: "google", label: "Google Ads", campaigns: ["Search Network (G-Ads)"] }] },
  { id: "init-28", nome: "LEMA FLOORING",              gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "gls",    label: "Google Local Services",   campaigns: ["Local Service Ads (GLS)"]   }] },
  { id: "init-29", nome: "CUNHA PAINTING SERVICES",    gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "gls",    label: "Google Local Services",   campaigns: ["Local Service Ads (GLS)"]   }, { key: "meta", label: "Meta Ads", campaigns: ["Lead Generation (Meta)"] }, { key: "google", label: "Google Ads", campaigns: ["Performance Max"] }] },
  { id: "init-30", nome: "CASALI CLEANING SERVICES LLC", gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "gls", label: "Google Local Services", campaigns: ["Local Service Ads (GLS)"] }, { key: "google", label: "Google Ads", campaigns: ["Search Network (G-Ads)"] }] },
  { id: "init-31", nome: "MR BLU POOL LLC",            gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "gls",    label: "Google Local Services",   campaigns: ["Local Service Ads (GLS)"]   }, { key: "meta", label: "Meta Ads", campaigns: ["Leads Form (Meta)"] }] },
  { id: "init-32", nome: "ELIANA BRAZILIAN CLEANING",  gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "meta",   label: "Meta Ads",                campaigns: ["Leads Form (Meta)"]         }] },
  { id: "init-33", nome: "UP MOTORS",                  gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "meta",   label: "Meta Ads",                campaigns: ["WhatsApp Leads"]            }] },
  { id: "init-34", nome: "PH PAINTING",                gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "meta",   label: "Meta Ads",                campaigns: ["Engagement (Meta)"]         }] },
  { id: "init-35", nome: "JJ CONSTRUCTION",            gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "meta",   label: "Meta Ads",                campaigns: ["Direct Messages (Meta)"]    }] },
  { id: "init-36", nome: "VERTEX BUILDERS LLC",        gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "meta",   label: "Meta Ads",                campaigns: ["Lead Generation (Meta)"]    }] },
  { id: "init-37", nome: "MTM CONSTRUCTION",           gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [] },
  { id: "init-38", nome: "ALL CONSTRUCTION",           gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "meta",   label: "Meta Ads",                campaigns: ["Engagement (Meta)"]         }] },
  { id: "init-39", nome: "INCANTO",                    gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "meta",   label: "Meta Ads",                campaigns: ["Direct Messages (Meta)", "Engagement (Meta)"] }, { key: "google", label: "Google Ads", campaigns: ["Search Network (G-Ads)"] }] },
  { id: "init-40", nome: "VH INSTALLATION",            gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "meta",   label: "Meta Ads",                campaigns: ["Direct Messages (Meta)", "Engagement (Meta)"] }] },
  { id: "init-41", nome: "PHOTOS BY BRUNA OLIVEIRA",   gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [] },
  { id: "init-42", nome: "CAPE PRO PAINTING LLC",      gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "meta",   label: "Meta Ads",                campaigns: ["Direct Messages (Meta)", "Engagement (Meta)"] }] },
  { id: "init-43", nome: "EBM HARDWOOD FLOORS",        gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "meta",   label: "Meta Ads",                campaigns: ["Lead Generation (Meta)", "Engagement (Meta)"] }] },
  { id: "init-44", nome: "SL CARPENTRY",               gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "meta",   label: "Meta Ads",                campaigns: ["Lead Generation (Meta)"]    }] },
  { id: "init-45", nome: "FONESI CONSTRUCTION INC",    gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "meta",   label: "Meta Ads",                campaigns: ["Direct Messages (Meta)"]    }, { key: "gls", label: "Google Local Services", campaigns: ["Local Service Ads (GLS)"] }] },
  { id: "init-46", nome: "CT WOODFLOOR LLC",           gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "meta",   label: "Meta Ads",                campaigns: ["Lead Generation (Meta)"]    }] },
  { id: "init-47", nome: "DDS PAINTING LLC",           gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "gls",    label: "Google Local Services",   campaigns: ["Local Service Ads (GLS)"]   }] },
  { id: "init-48", nome: "COELHO CARPENTRY",           gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "google", label: "Google Ads",              campaigns: ["Search Network (G-Ads)"]    }] },
  { id: "init-49", nome: "LINDA'S FLOORS",             gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [] },
  { id: "init-50", nome: "FINEST CUSTOM WOODWORK",     gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [] },
  { id: "init-51", nome: "TRUST INTERIOR LLC",         gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "meta",   label: "Meta Ads",                campaigns: ["Lead Generation (Meta)"]    }] },
  { id: "init-52", nome: "RENO FLOORS LLC",            gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [] },
  { id: "init-53", nome: "ACCEL BUILDING & REMODELING", gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [] },
  { id: "init-54", nome: "LUCAS PAINTING",             gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [] },
];
