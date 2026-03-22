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

// ─── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = "ts_analytics_clients_v2";

const PLATFORM_META: { key: PlatformKey; label: string; campaigns: string[] } = {
  key: "meta",
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
};

const PLATFORM_GOOGLE: { key: PlatformKey; label: string; campaigns: string[] } = {
  key: "google",
  label: "Google Ads",
  campaigns: [
    "Search Network (G-Ads)",
    "Performance Max",
    "Display Network",
    "YouTube Ads",
    "App Install",
  ],
};

const PLATFORM_GLS: { key: PlatformKey; label: string; campaigns: string[] } = {
  key: "gls",
  label: "Google Local Services",
  campaigns: ["Local Service Ads (GLS)", "Local Awareness"],
};

const ALL_PLATFORMS = [PLATFORM_META, PLATFORM_GOOGLE, PLATFORM_GLS];

// SVG icons inline (sem dependência externa)
const PLATFORM_SVG: Record<PlatformKey, React.ReactNode> = {
  meta: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path
        d="M24 12.073c0-6.627-5.372-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"
        fill="#1877F2"
      />
    </svg>
  ),
  google: (
    <svg width="16" height="16" viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  ),
  gls: (
    <svg width="16" height="16" viewBox="0 0 48 48" fill="none">
      <circle cx="24" cy="24" r="20" fill="#34A853" />
      <path d="M34.5858 17.5858L21.4142 30.7574L14.8284 24.1716L12 27L21.4142 36.4142L37.4142 20.4142L34.5858 17.5858Z" fill="white" />
    </svg>
  ),
};

const PLATFORM_COLORS: Record<PlatformKey, string> = {
  meta: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  google: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  gls: "bg-purple-500/15 text-purple-400 border-purple-500/30",
};

// ─── Storage helpers ──────────────────────────────────────────────────────────

function loadClientsFromStorage(): Client[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Client[]) : INITIAL_CLIENTS;
  } catch {
    return INITIAL_CLIENTS;
  }
}

function saveClientsToStorage(clients: Client[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clients));
  } catch {
    /* silently fail */
  }
}

// ─── CSV Parser ───────────────────────────────────────────────────────────────

function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

const HEADER_MAP: Record<string, keyof Lead> = {
  nome: "nome", name: "nome", fullname: "nome", nomecompleto: "nome",
  telefone: "telefone", phone: "telefone", celular: "telefone", whatsapp: "telefone",
  data: "data", date: "data", datacriacao: "data", createdat: "data",
  plataforma: "plataforma", platform: "plataforma", origem: "plataforma",
  source: "plataforma", campanha: "plataforma", campaign: "plataforma",
};

function parseLeadsFromCSV(rawRows: Record<string, string>[]): Lead[] {
  if (rawRows.length === 0) return [];
  const headerMapping: Record<string, keyof Lead> = {};
  for (const original of Object.keys(rawRows[0])) {
    const mapped = HEADER_MAP[normalizeHeader(original)];
    if (mapped) headerMapping[original] = mapped;
  }
  return rawRows
    .map((row, i) => {
      const lead: Partial<Lead> = { id: `lead-${Date.now()}-${i}` };
      for (const [original, field] of Object.entries(headerMapping)) {
        lead[field] = row[original]?.trim() ?? "";
      }
      return lead as Lead;
    })
    .filter((l) => l.nome || l.telefone);
}

// ─── Utility ──────────────────────────────────────────────────────────────────

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2);

function getStatusInfo(client: Client): { label: string; dot: string; badge: string } {
  if (client.status === "inactive")
    return {
      label: "Cancelamento",
      dot: "bg-red-500",
      badge: "bg-red-500/10 text-red-400 border-red-500/25",
    };
  if (!client.platforms?.length)
    return {
      label: "Sem Campanha",
      dot: "bg-amber-500",
      badge: "bg-amber-500/10 text-amber-400 border-amber-500/25",
    };
  return {
    label: "Ativo",
    dot: "bg-emerald-500",
    badge: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25",
  };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function LogoIcon() {
  return (
    <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shadow-[0_0_16px_rgba(245,166,35,0.18)] overflow-hidden shrink-0">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.png" alt="Logo" className="h-7 w-auto object-contain p-0.5" />
    </div>
  );
}

// ── Platform chips no card ─────────────────────────────────────────────────

function PlatformChip({ platform }: { platform: Platform }) {
  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${PLATFORM_COLORS[platform.key]}`}
    >
      <span className="shrink-0">{PLATFORM_SVG[platform.key]}</span>
      {platform.label}
      {platform.campaigns.length > 0 && (
        <>
          <span className="opacity-40">·</span>
          <span className="opacity-70 truncate max-w-[120px]">
            {platform.campaigns.join(", ")}
          </span>
        </>
      )}
    </div>
  );
}

// ── Client Card ───────────────────────────────────────────────────────────────

interface ClientCardProps {
  client: Client;
  isActive: boolean;
  onSelect: (id: string) => void;
  onEdit: (client: Client) => void;
  onDelete: (id: string) => void;
}

function ClientCard({ client, isActive, onSelect, onEdit, onDelete }: ClientCardProps) {
  const status = getStatusInfo(client);
  const gestorColor =
    client.gestorEstrategico === "Duda"
      ? "bg-blue-600/20 text-blue-400 border-blue-500/30"
      : client.gestorEstrategico === "Diego"
      ? "bg-purple-600/20 text-purple-400 border-purple-500/30"
      : "bg-[#2e2c29] text-[#7a7268] border-[#3a3835]";

  return (
    <div
      onClick={() => onSelect(client.id)}
      style={{ touchAction: "pan-y" }}
      className={[
        "rounded-2xl border p-5 flex flex-col gap-3 cursor-pointer transition-all duration-200",
        "hover:border-amber-500/40 hover:shadow-[0_4px_20px_rgba(245,166,35,0.1)]",
        isActive
          ? "border-amber-500 shadow-[0_0_0_1px_rgba(245,166,35,0.3),0_4px_24px_rgba(245,166,35,0.15)] bg-[#201f1d]"
          : client.status === "inactive"
          ? "border-red-500/30 bg-[#1e1b1b]"
          : !client.platforms?.length
          ? "border-amber-500/30 bg-[#1e1d1a]"
          : "border-[#2e2c29] bg-[#1a1917]",
      ].join(" ")}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-bold text-[#e8e2d8] text-sm leading-tight truncate">
            {client.nome}
          </p>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${status.badge}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
              {status.label.toUpperCase()}
            </span>
            {isActive && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/40">
                ★ SELECIONADO
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Platforms */}
      <div className="flex flex-wrap gap-1.5">
        {client.platforms?.length ? (
          client.platforms.map((p, i) => <PlatformChip key={i} platform={p} />)
        ) : (
          <span className="text-[#7a7268] text-xs italic">Nenhuma plataforma ativa</span>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-1 border-t border-[#2e2c29]/60">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#201f1d] border border-[#2e2c29] text-[#7a7268]">
            🗂 {client.gestor}
          </span>
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${gestorColor}`}>
            👤 {client.gestorEstrategico}
          </span>
          <span className="text-[10px] text-[#7a7268]">📅 {client.createdAt}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(client); }}
            style={{ touchAction: "manipulation" }}
            className="text-[10px] px-2 py-1 rounded-lg bg-[#201f1d] border border-[#2e2c29] text-[#7a7268] hover:text-[#e8e2d8] hover:border-[#7a7268] transition-colors"
          >
            ✏️
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(client.id); }}
            style={{ touchAction: "manipulation" }}
            className="text-[10px] px-2 py-1 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors"
          >
            🗑
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Dropzone ──────────────────────────────────────────────────────────────────

interface DropzoneProps {
  onLeadsParsed: (leads: Lead[]) => void;
}

function Dropzone({ onLeadsParsed }: DropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(
    (file: File) => {
      if (!file.name.toLowerCase().endsWith(".csv")) {
        toast.error("Formato inválido. Envie um arquivo .CSV");
        return;
      }
      setIsLoading(true);
      Papa.parse<Record<string, string>>(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          setIsLoading(false);
          try {
            const leads = parseLeadsFromCSV(results.data);
            if (leads.length === 0) {
              toast.error("Nenhum lead encontrado. Verifique as colunas do CSV.");
              return;
            }
            onLeadsParsed(leads);
            toast.success(`${leads.length} leads importados!`);
          } catch {
            toast.error("Erro ao processar o CSV.");
          }
        },
        error: () => { setIsLoading(false); toast.error("Falha na leitura do arquivo."); },
      });
    },
    [onLeadsParsed]
  );

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if (f) processFile(f); }}
      onClick={() => inputRef.current?.click()}
      style={{ touchAction: "manipulation" }}
      className={[
        "rounded-2xl border-2 border-dashed p-6 text-center cursor-pointer transition-all duration-300",
        isDragging ? "border-amber-500 bg-amber-500/10" : "border-[#2e2c29] hover:border-amber-500/40 hover:bg-amber-500/5",
        isLoading ? "opacity-60 pointer-events-none" : "",
      ].join(" ")}
    >
      <input ref={inputRef} type="file" accept=".csv" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) processFile(f); e.target.value = ""; }} />
      <div className="flex flex-col items-center gap-2 pointer-events-none">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl transition-all ${isDragging ? "bg-amber-500/20 scale-110" : "bg-[#201f1d] border border-[#2e2c29]"}`}>
          {isLoading ? "⏳" : "📂"}
        </div>
        <p className="text-[#e8e2d8] font-semibold text-sm">
          {isLoading ? "Processando..." : isDragging ? "Solte aqui!" : "Arraste o CSV ou toque para selecionar"}
        </p>
        <p className="text-[#7a7268] text-xs">
          Colunas: <span className="text-amber-500/70">Nome · Telefone · Data · Plataforma</span>
        </p>
      </div>
    </div>
  );
}

// ── Lead Table ────────────────────────────────────────────────────────────────

function LeadTable({ leads, searchTerm, platformFilter }: { leads: Lead[]; searchTerm: string; platformFilter: string }) {
  const filtered = leads.filter((l) => {
    const s = searchTerm.toLowerCase();
    return (
      (!s || l.nome.toLowerCase().includes(s) || l.telefone.includes(s)) &&
      (!platformFilter || l.plataforma.toLowerCase().includes(platformFilter.toLowerCase()))
    );
  });

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3 rounded-xl border border-[#2e2c29] bg-[#1a1917]">
        <span className="text-4xl">{leads.length === 0 ? "📭" : "🔍"}</span>
        <p className="text-[#7a7268] text-sm text-center px-4">
          {leads.length === 0 ? "Nenhum lead importado. Faça o upload de um CSV acima." : "Nenhum resultado para esses filtros."}
        </p>
      </div>
    );
  }

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
            {filtered.map((lead, idx) => (
              <tr key={lead.id} className={`border-b border-[#2e2c29]/40 hover:bg-amber-500/5 transition-colors ${idx % 2 === 0 ? "bg-[#201f1d]" : "bg-[#1c1b19]"}`}>
                <td className="px-4 py-3 text-[#7a7268] text-xs font-mono">{idx + 1}</td>
                <td className="px-4 py-3 font-medium text-[#e8e2d8] max-w-[160px] truncate">{lead.nome || "—"}</td>
                <td className="px-4 py-3 text-[#7a7268] font-mono text-xs whitespace-nowrap">{lead.telefone || "—"}</td>
                <td className="px-4 py-3 text-[#7a7268] whitespace-nowrap text-xs">{lead.data || "—"}</td>
                <td className="px-4 py-3">
                  {lead.plataforma ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border bg-amber-500/10 text-amber-400 border-amber-500/25 whitespace-nowrap">
                      {lead.plataforma}
                    </span>
                  ) : <span className="text-[#7a7268]">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Client Modal ──────────────────────────────────────────────────────────────

interface ClientModalProps {
  mode: "new" | "edit";
  initial?: Client;
  onSave: (data: Omit<Client, "id" | "createdAt">) => void;
  onClose: () => void;
}

function ClientModal({ mode, initial, onSave, onClose }: ClientModalProps) {
  const [nome, setNome] = useState(initial?.nome ?? "");
  const [gestor, setGestor] = useState(initial?.gestor ?? "DS");
  const [gestorEstrat, setGestorEstrat] = useState(initial?.gestorEstrategico ?? "");
  const [status, setStatus] = useState<"active" | "inactive">(initial?.status ?? "active");
  const [activePlatforms, setActivePlatforms] = useState<Record<PlatformKey, boolean>>({
    meta: initial?.platforms.some((p) => p.key === "meta") ?? false,
    google: initial?.platforms.some((p) => p.key === "google") ?? false,
    gls: initial?.platforms.some((p) => p.key === "gls") ?? false,
  });
  const [selectedCampaigns, setSelectedCampaigns] = useState<Record<PlatformKey, string[]>>({
    meta: initial?.platforms.find((p) => p.key === "meta")?.campaigns ?? [],
    google: initial?.platforms.find((p) => p.key === "google")?.campaigns ?? [],
    gls: initial?.platforms.find((p) => p.key === "gls")?.campaigns ?? [],
  });

  const toggleCampaign = (key: PlatformKey, camp: string) => {
    setSelectedCampaigns((prev) => ({
      ...prev,
      [key]: prev[key].includes(camp) ? prev[key].filter((c) => c !== camp) : [...prev[key], camp],
    }));
  };

  const handleSave = () => {
    if (!nome.trim()) { toast.error("Informe o nome do cliente."); return; }
    if (!gestor) { toast.error("Selecione o Gestor de Tráfego."); return; }
    if (!gestorEstrat) { toast.error("Selecione o Gestor Estratégico."); return; }
    const platforms: Platform[] = ALL_PLATFORMS
      .filter((p) => activePlatforms[p.key])
      .map((p) => ({ key: p.key, label: p.label, campaigns: selectedCampaigns[p.key] }));
    onSave({ nome: nome.trim(), gestor, gestorEstrategico: gestorEstrat, platforms, status });
  };

  return (
    // Overlay — NÃO usa overflow-hidden no body, usa position fixed + z-index
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/*
       * SCROLL FIX — Modal:
       * max-h-[85dvh] garante que o modal nunca ultrapasse a tela.
       * overflow-y-auto com WebkitOverflowScrolling: touch dá scroll
       * interno suave no iOS SEM travar o body.
       * O body em si NÃO recebe overflow:hidden (o Sonner/Radix não é usado aqui).
       */}
      <div
        className="w-full sm:max-w-lg bg-[#1a1917] border border-[#2e2c29] rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col"
        style={{ maxHeight: "85dvh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal header — fixo no topo */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2e2c29] shrink-0">
          <h2 className="font-bold text-[#e8e2d8]">
            {mode === "new" ? "✨ Novo Cliente" : "✏️ Editar Cliente"}
          </h2>
          <button
            onClick={onClose}
            style={{ touchAction: "manipulation" }}
            className="w-8 h-8 flex items-center justify-center rounded-xl bg-[#201f1d] border border-[#2e2c29] text-[#7a7268] hover:text-[#e8e2d8] transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Scrollable body */}
        <div
          className="flex-1 overflow-y-auto px-5 py-5 space-y-5"
          style={{ WebkitOverflowScrolling: "touch", overscrollBehavior: "contain" }}
        >
          {/* Nome */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-[#7a7268]">Nome do Cliente</label>
            <input
              type="text"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex: JAC Cosméticos"
              className="w-full bg-[#201f1d] border border-[#2e2c29] rounded-xl px-4 py-2.5 text-sm text-[#e8e2d8] placeholder:text-[#7a7268] outline-none focus:border-amber-500/60 transition-colors"
            />
          </div>

          {/* Gestor Tráfego */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-[#7a7268]">Gestor de Tráfego</label>
            <div className="relative">
              <select
                value={gestor}
                onChange={(e) => setGestor(e.target.value)}
                className="w-full appearance-none bg-[#201f1d] border border-[#2e2c29] rounded-xl px-4 pr-9 py-2.5 text-sm text-[#e8e2d8] outline-none focus:border-amber-500/60 transition-colors cursor-pointer"
              >
                {["DS", "AV", "GB", "JR"].map((g) => <option key={g}>{g}</option>)}
              </select>
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#7a7268] text-xs">▾</span>
            </div>
          </div>

          {/* Gestor Estratégico */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-[#7a7268]">Gestor Estratégico</label>
            <div className="flex gap-2 flex-wrap">
              {["Duda", "Diego"].map((g) => (
                <button
                  key={g}
                  onClick={() => setGestorEstrat(g)}
                  style={{ touchAction: "manipulation" }}
                  className={[
                    "px-4 py-1.5 rounded-full text-sm font-semibold border transition-all",
                    gestorEstrat === g && g === "Duda"
                      ? "bg-blue-600 border-blue-500 text-white"
                      : gestorEstrat === g && g === "Diego"
                      ? "bg-purple-600 border-purple-500 text-white"
                      : "bg-[#201f1d] border-[#2e2c29] text-[#7a7268] hover:text-[#e8e2d8]",
                  ].join(" ")}
                >
                  👤 {g}
                </button>
              ))}
            </div>
          </div>

          {/* Status (apenas edição) */}
          {mode === "edit" && (
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#7a7268]">Status</label>
              <div className="relative">
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as "active" | "inactive")}
                  className="w-full appearance-none bg-[#201f1d] border border-[#2e2c29] rounded-xl px-4 pr-9 py-2.5 text-sm text-[#e8e2d8] outline-none focus:border-amber-500/60 transition-colors cursor-pointer"
                >
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
            <div className="space-y-2">
              {ALL_PLATFORMS.map((plat) => (
                <div
                  key={plat.key}
                  className={`rounded-xl border transition-colors ${activePlatforms[plat.key] ? "border-amber-500/60 bg-amber-500/5" : "border-[#2e2c29] bg-[#201f1d]"}`}
                >
                  {/* Platform toggle row */}
                  <div
                    className="flex items-center gap-3 px-4 py-3 cursor-pointer"
                    style={{ touchAction: "pan-y" }}
                    onClick={() =>
                      setActivePlatforms((prev) => ({ ...prev, [plat.key]: !prev[plat.key] }))
                    }
                  >
                    <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${activePlatforms[plat.key] ? "bg-amber-500 border-amber-500" : "border-[#3a3835]"}`}>
                      {activePlatforms[plat.key] && <span className="text-[#111] text-xs font-bold">✓</span>}
                    </div>
                    <span className="shrink-0">{PLATFORM_SVG[plat.key]}</span>
                    <span className="font-semibold text-sm text-[#e8e2d8]">{plat.label}</span>
                  </div>

                  {/* Campaign sub-options */}
                  {activePlatforms[plat.key] && (
                    <div className="px-4 pb-3 pt-1 border-t border-[#2e2c29]/60 grid grid-cols-1 gap-1">
                      {plat.campaigns.map((camp) => (
                        <label
                          key={camp}
                          className="flex items-center gap-2.5 py-1.5 cursor-pointer group"
                          style={{ touchAction: "pan-y" }}
                        >
                          <div
                            className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${selectedCampaigns[plat.key].includes(camp) ? "bg-amber-500 border-amber-500" : "border-[#3a3835] group-hover:border-amber-500/50"}`}
                            onClick={() => toggleCampaign(plat.key, camp)}
                          >
                            {selectedCampaigns[plat.key].includes(camp) && (
                              <span className="text-[#111] text-[9px] font-bold">✓</span>
                            )}
                          </div>
                          <span
                            className={`text-xs transition-colors ${selectedCampaigns[plat.key].includes(camp) ? "text-[#e8e2d8] font-medium" : "text-[#7a7268]"}`}
                            onClick={() => toggleCampaign(plat.key, camp)}
                          >
                            {camp}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Padding final para o botão não sobrepor conteúdo */}
          <div className="pb-2" />
        </div>

        {/* Actions — fixos no rodapé */}
        <div className="shrink-0 px-5 py-4 border-t border-[#2e2c29] flex gap-3">
          <button
            onClick={onClose}
            style={{ touchAction: "manipulation" }}
            className="flex-1 py-2.5 rounded-xl bg-[#201f1d] border border-[#2e2c29] text-[#7a7268] text-sm font-semibold hover:text-[#e8e2d8] transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            style={{ touchAction: "manipulation" }}
            className="flex-1 py-2.5 rounded-xl bg-amber-500 text-[#111] text-sm font-bold hover:bg-amber-400 active:scale-95 transition-all shadow-[0_4px_16px_rgba(245,166,35,0.35)]"
          >
            {mode === "new" ? "⚡ Cadastrar" : "💾 Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Home() {
  const [clients, setClients] = useState<Client[]>([]);
  const [activeClientId, setActiveClientId] = useState<string | null>(null);
  const [leadsByClient, setLeadsByClient] = useState<Record<string, Lead[]>>({});
  const [searchTerm, setSearchTerm] = useState("");
  const [clientSearch, setClientSearch] = useState("");
  const [platformFilter, setPlatformFilter] = useState("");
  const [modal, setModal] = useState<{ mode: "new" | "edit"; client?: Client } | null>(null);

  // Hydrate from localStorage on mount
  useEffect(() => {
    const stored = loadClientsFromStorage();
    setClients(stored);
  }, []);

  const persist = (updated: Client[]) => {
    setClients(updated);
    saveClientsToStorage(updated);
  };

  const activeClient = clients.find((c) => c.id === activeClientId) ?? null;
  const activeLeads = activeClientId ? (leadsByClient[activeClientId] ?? []) : [];

  const filteredClients = clients.filter((c) =>
    !clientSearch || c.nome.toLowerCase().includes(clientSearch.toLowerCase())
  );

  // Stats
  const stats = {
    total: clients.length,
    active: clients.filter((c) => c.status !== "inactive" && c.platforms?.length > 0).length,
    none: clients.filter((c) => c.status !== "inactive" && (!c.platforms?.length)).length,
    cancel: clients.filter((c) => c.status === "inactive").length,
  };

  const handleSaveClient = (data: Omit<Client, "id" | "createdAt">) => {
    if (modal?.mode === "new") {
      const newClient: Client = { id: uid(), createdAt: new Date().toLocaleDateString("pt-BR"), ...data };
      const updated = [newClient, ...clients];
      persist(updated);
      toast.success(`${data.nome} cadastrado!`);
    } else if (modal?.client) {
      const updated = clients.map((c) => c.id === modal.client!.id ? { ...c, ...data } : c);
      persist(updated);
      toast.success("Alterações salvas!");
    }
    setModal(null);
  };

  const handleDeleteClient = (id: string) => {
    if (!confirm("Excluir este cliente?")) return;
    const updated = clients.filter((c) => c.id !== id);
    persist(updated);
    if (activeClientId === id) setActiveClientId(null);
    toast.success("Cliente removido.");
  };

  const handleLeadsParsed = useCallback((newLeads: Lead[]) => {
    if (!activeClientId) return;
    setLeadsByClient((prev) => ({
      ...prev,
      [activeClientId]: [...(prev[activeClientId] ?? []), ...newLeads],
    }));
  }, [activeClientId]);

  const platformOptions = Array.from(
    new Set(activeLeads.map((l) => l.plataforma).filter(Boolean))
  ).sort();

  return (
    <div id="root-layout" className="flex flex-col min-h-screen bg-[#111010] text-[#e8e2d8]">

      {/* Ambient glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 select-none"
        style={{
          background: [
            "radial-gradient(ellipse 60% 40% at 10% 0%, rgba(245,166,35,0.07) 0%, transparent 60%)",
            "radial-gradient(ellipse 40% 30% at 90% 100%, rgba(245,166,35,0.05) 0%, transparent 60%)",
          ].join(", "),
        }}
      />

      {/* ── Header ── */}
      <header className="sticky top-0 z-50 shrink-0 h-16 flex items-center justify-between px-4 md:px-8 bg-[#111010]/90 backdrop-blur-xl border-b border-[#2e2c29]">
        <div className="flex items-center gap-2.5">
          <LogoIcon />
          <span className="font-bold text-[1.05rem] tracking-tight leading-none">
            TS <span className="text-amber-500">Controler</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[0.6rem] font-semibold uppercase tracking-widest text-[#7a7268] bg-[#1a1917] border border-[#2e2c29] px-3 py-1 rounded-full hidden sm:block">
            Painel do Gestor
          </span>
          <button
            onClick={() => setModal({ mode: "new" })}
            style={{ touchAction: "manipulation" }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500 text-[#111] text-xs font-bold hover:bg-amber-400 active:scale-95 transition-all shadow-[0_2px_12px_rgba(245,166,35,0.3)]"
          >
            ➕ <span className="hidden sm:inline">Novo Cliente</span><span className="sm:hidden">Cliente</span>
          </button>
        </div>
      </header>

      {/* ── Main ── */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 md:px-8 py-6 pb-16">

        {/* ══ TOPO: Stats ══ */}
        <div className="flex items-center gap-4 mb-6 flex-wrap">
          <div>
            <p className="text-[0.6rem] font-bold uppercase tracking-[0.18em] text-amber-500 mb-0.5">Gerenciamento</p>
            <h1 className="text-xl md:text-2xl font-extrabold tracking-tight">Clientes da Operação</h1>
          </div>
          <div className="flex items-center gap-3 flex-wrap ml-auto">
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

        {/* ══ LAYOUT DOIS PAINÉIS ══ */}
        <div className="flex flex-col lg:flex-row gap-6">

          {/* ── Painel Esquerdo: Lista de Clientes ── */}
          <aside className="w-full lg:w-[420px] xl:w-[460px] shrink-0 space-y-3">

            {/* Busca de clientes */}
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#7a7268] text-sm pointer-events-none">🔎</span>
              <input
                type="text"
                value={clientSearch}
                onChange={(e) => setClientSearch(e.target.value)}
                placeholder="Buscar cliente por nome..."
                className="w-full bg-[#201f1d] border border-[#2e2c29] rounded-xl pl-9 pr-4 py-2.5 text-sm text-[#e8e2d8] placeholder:text-[#7a7268] outline-none focus:border-amber-500/60 transition-colors"
              />
            </div>

            {/* Cards */}
            <div className="space-y-3">
              {filteredClients.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3 rounded-xl border border-[#2e2c29] bg-[#1a1917]">
                  <span className="text-4xl">📋</span>
                  <p className="text-[#7a7268] text-sm text-center px-4">
                    {clientSearch ? "Nenhum cliente encontrado." : "Nenhum cliente cadastrado. Clique em '+ Novo Cliente'."}
                  </p>
                </div>
              ) : (
                filteredClients.map((client) => (
                  <ClientCard
                    key={client.id}
                    client={client}
                    isActive={activeClientId === client.id}
                    onSelect={(id) => {
                      setActiveClientId(id);
                      setSearchTerm("");
                      setPlatformFilter("");
                    }}
                    onEdit={(c) => setModal({ mode: "edit", client: c })}
                    onDelete={handleDeleteClient}
                  />
                ))
              )}
            </div>
          </aside>

          {/* ── Painel Direito: Leads do Cliente Ativo ── */}
          <section className="flex-1 min-w-0 space-y-5">
            {!activeClient ? (
              // Placeholder — nenhum cliente selecionado
              <div className="flex flex-col items-center justify-center py-24 gap-4 rounded-2xl border border-dashed border-[#2e2c29]">
                <span className="text-5xl">👈</span>
                <div className="text-center">
                  <p className="font-bold text-[#e8e2d8]">Selecione um cliente</p>
                  <p className="text-[#7a7268] text-sm mt-1">
                    Clique em um cliente na lista para gerenciar seus leads.
                  </p>
                </div>
              </div>
            ) : (
              <>
                {/* Cabeçalho do painel de leads */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <p className="text-[0.6rem] font-bold uppercase tracking-[0.18em] text-amber-500 mb-0.5">
                      Cliente ativo
                    </p>
                    <h2 className="text-lg md:text-xl font-extrabold tracking-tight">
                      {activeClient.nome}
                    </h2>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {activeClient.platforms.map((p, i) => (
                        <PlatformChip key={i} platform={p} />
                      ))}
                    </div>
                  </div>
                  {activeLeads.length > 0 && (
                    <button
                      onClick={() => {
                        setLeadsByClient((prev) => ({ ...prev, [activeClientId!]: [] }));
                        toast.success("Leads removidos.");
                      }}
                      style={{ touchAction: "manipulation" }}
                      className="self-start sm:self-auto flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/25 text-red-400 text-xs font-semibold hover:bg-red-500/20 active:scale-95 transition-all"
                    >
                      🗑️ Limpar leads
                    </button>
                  )}
                </div>

                {/* Dropzone */}
                <Dropzone onLeadsParsed={handleLeadsParsed} />

                {/* Filtros de leads */}
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#7a7268] text-sm pointer-events-none select-none">🔎</span>
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="Buscar lead por nome ou telefone..."
                      className="w-full bg-[#201f1d] border border-[#2e2c29] rounded-xl pl-9 pr-4 py-2.5 text-sm text-[#e8e2d8] placeholder:text-[#7a7268] outline-none focus:border-amber-500/60 transition-colors"
                    />
                  </div>
                  {platformOptions.length > 0 && (
                    <div className="relative sm:w-48">
                      <select
                        value={platformFilter}
                        onChange={(e) => setPlatformFilter(e.target.value)}
                        className="w-full appearance-none bg-[#201f1d] border border-[#2e2c29] rounded-xl px-4 pr-9 py-2.5 text-sm text-[#e8e2d8] outline-none focus:border-amber-500/60 transition-colors cursor-pointer"
                      >
                        <option value="">Todas as plataformas</option>
                        {platformOptions.map((p) => <option key={p}>{p}</option>)}
                      </select>
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#7a7268] text-xs select-none">▾</span>
                    </div>
                  )}
                </div>

                {/* Tabela de leads */}
                <LeadTable leads={activeLeads} searchTerm={searchTerm} platformFilter={platformFilter} />

                {/* Hint de exportação */}
                {activeLeads.length > 0 && (
                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 flex items-start gap-3">
                    <span className="text-xl shrink-0 mt-0.5">📄</span>
                    <div>
                      <p className="text-xs font-semibold text-amber-500 uppercase tracking-wider">Próximo passo</p>
                      <p className="text-xs text-[#7a7268] mt-0.5">
                        Exportação de PDF com coluna de Feedback editável — módulo em breve.
                      </p>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </main>

      {/* ── Footer ── */}
      <footer className="shrink-0 border-t border-[#2e2c29] py-4 px-4 md:px-8">
        <p className="text-center text-[0.65rem] text-[#7a7268]">
          TS Controler · Painel Interno · {new Date().getFullYear()}
        </p>
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

// ─── Initial seed data ────────────────────────────────────────────────────────

const INITIAL_CLIENTS: Client[] = [
  { id: "init-0", nome: "JAC COSMETICOS", gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "meta", label: "Meta Ads", campaigns: ["Direct Messages (Meta)"] }] },
  { id: "init-1", nome: "ASC PAINTING", gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "gls", label: "Google Local Services", campaigns: ["Local Service Ads (GLS)"] }, { key: "meta", label: "Meta Ads", campaigns: ["Engagement (Meta)"] }] },
  { id: "init-2", nome: "JP HARDWOOD FLOORS", gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "meta", label: "Meta Ads", campaigns: ["Direct Messages (Meta)"] }] },
  { id: "init-3", nome: "NEW FAMILY IGLESIA", gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "google", label: "Google Ads", campaigns: ["Search Network (G-Ads)"] }, { key: "meta", label: "Meta Ads", campaigns: ["Lead Generation (Meta)"] }] },
  { id: "init-4", nome: "P&A PAINTING SERVICES", gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "meta", label: "Meta Ads", campaigns: ["Lead Generation (Meta)"] }, { key: "google", label: "Google Ads", campaigns: ["Search Network (G-Ads)"] }, { key: "gls", label: "Google Local Services", campaigns: ["Local Service Ads (GLS)"] }] },
  { id: "init-5", nome: "D&S HARDWOOD FLOORS", gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "gls", label: "Google Local Services", campaigns: ["Local Service Ads (GLS)"] }] },
  { id: "init-6", nome: "LB FLOOR & BATH", gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "meta", label: "Meta Ads", campaigns: ["Lead Generation (Meta)"] }] },
  { id: "init-7", nome: "LIONS SIDING & ROOFING", gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "gls", label: "Google Local Services", campaigns: ["Local Service Ads (GLS)"] }, { key: "meta", label: "Meta Ads", campaigns: ["Engagement (Meta)"] }, { key: "google", label: "Google Ads", campaigns: ["Search Network (G-Ads)"] }] },
  { id: "init-8", nome: "ELITE TILE & FLOORS", gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "gls", label: "Google Local Services", campaigns: ["Local Service Ads (GLS)"] }, { key: "meta", label: "Meta Ads", campaigns: ["Lead Generation (Meta)"] }] },
  { id: "init-9", nome: "IMAGINE CONSTRUCTION", gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "google", label: "Google Ads", campaigns: ["Search Network (G-Ads)"] }, { key: "gls", label: "Google Local Services", campaigns: ["Local Service Ads (GLS)"] }, { key: "meta", label: "Meta Ads", campaigns: ["Lead Generation (Meta)"] }] },
  { id: "init-10", nome: "GOLDEN GUTTER & CONSTRUCTION", gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "gls", label: "Google Local Services", campaigns: ["Local Service Ads (GLS)"] }, { key: "google", label: "Google Ads", campaigns: ["Search Network (G-Ads)"] }] },
  { id: "init-11", nome: "JT HOME BUILDING", gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "google", label: "Google Ads", campaigns: ["Performance Max"] }, { key: "gls", label: "Google Local Services", campaigns: ["Local Service Ads (GLS)"] }, { key: "meta", label: "Meta Ads", campaigns: ["Lead Generation (Meta)"] }] },
  { id: "init-12", nome: "AQ HARDWOOD FLOORS", gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "gls", label: "Google Local Services", campaigns: ["Local Service Ads (GLS)"] }, { key: "meta", label: "Meta Ads", campaigns: ["Engagement (Meta)"] }, { key: "google", label: "Google Ads", campaigns: ["Performance Max"] }] },
  { id: "init-13", nome: "SURFACE SYSTEMS", gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "gls", label: "Google Local Services", campaigns: ["Local Service Ads (GLS)"] }, { key: "meta", label: "Meta Ads", campaigns: ["Lead Generation (Meta)"] }] },
  { id: "init-14", nome: "MASS CONSTRUCTION INC", gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "meta", label: "Meta Ads", campaigns: ["Lead Generation (Meta)"] }] },
  { id: "init-15", nome: "SISTER'S CLEANING", gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "meta", label: "Meta Ads", campaigns: ["Direct Messages (Meta)"] }, { key: "google", label: "Google Ads", campaigns: ["Search Network (G-Ads)"] }] },
  { id: "init-16", nome: "DURABLE FENCE", gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "gls", label: "Google Local Services", campaigns: ["Local Service Ads (GLS)"] }, { key: "google", label: "Google Ads", campaigns: ["Search Network (G-Ads)"] }] },
  { id: "init-17", nome: "CUNHA PAINTING SERVICES", gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "gls", label: "Google Local Services", campaigns: ["Local Service Ads (GLS)"] }, { key: "meta", label: "Meta Ads", campaigns: ["Lead Generation (Meta)"] }, { key: "google", label: "Google Ads", campaigns: ["Performance Max"] }] },
  { id: "init-18", nome: "SOUZA HOME CLEANING", gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "gls", label: "Google Local Services", campaigns: ["Local Service Ads (GLS)"] }, { key: "google", label: "Google Ads", campaigns: ["Search Network (G-Ads)"] }, { key: "meta", label: "Meta Ads", campaigns: ["Lead Generation (Meta)"] }] },
  { id: "init-19", nome: "MR BLU POOL LLC", gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "gls", label: "Google Local Services", campaigns: ["Local Service Ads (GLS)"] }, { key: "meta", label: "Meta Ads", campaigns: ["Leads Form (Meta)"] }] },
  { id: "init-20", nome: "FONESI CONSTRUCTION INC", gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "meta", label: "Meta Ads", campaigns: ["Direct Messages (Meta)"] }, { key: "gls", label: "Google Local Services", campaigns: ["Local Service Ads (GLS)"] }] },
  { id: "init-21", nome: "CASALI CLEANING SERVICES LLC", gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "gls", label: "Google Local Services", campaigns: ["Local Service Ads (GLS)"] }, { key: "google", label: "Google Ads", campaigns: ["Search Network (G-Ads)"] }] },
  { id: "init-22", nome: "LEMA FLOORING", gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "gls", label: "Google Local Services", campaigns: ["Local Service Ads (GLS)"] }] },
  { id: "init-23", nome: "EBM HARDWOOD FLOORS", gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "meta", label: "Meta Ads", campaigns: ["Lead Generation (Meta)", "Engagement (Meta)"] }] },
  { id: "init-24", nome: "INCANTO", gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [{ key: "meta", label: "Meta Ads", campaigns: ["Direct Messages (Meta)"] }, { key: "google", label: "Google Ads", campaigns: ["Search Network (G-Ads)"] }] },
  { id: "init-25", nome: "SOUZA MOVING COMPANY", gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [] },
  { id: "init-26", nome: "RENO FLOORS LLC", gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [] },
  { id: "init-27", nome: "LUCAS PAINTING", gestor: "DS", gestorEstrategico: "Duda", status: "active", createdAt: "16/03/2026", platforms: [] },
];
