"use client";

import { useState, useCallback, useRef } from "react";
import Papa from "papaparse";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

type Operation = "Op 01" | "Op 02" | "Op 03";

interface Lead {
  id: string;
  nome: string;
  telefone: string;
  data: string;
  plataforma: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const OPERATIONS: Operation[] = ["Op 01", "Op 02", "Op 03"];

const PLATFORM_COLORS: Record<string, string> = {
  meta: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  google: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  gls: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  default: "bg-amber-500/15 text-amber-400 border-amber-500/30",
};

function getPlatformStyle(plataforma: string): string {
  const lower = plataforma.toLowerCase();
  if (lower.includes("meta") || lower.includes("facebook"))
    return PLATFORM_COLORS.meta;
  if (lower.includes("google ads") || lower.includes("g-ads"))
    return PLATFORM_COLORS.google;
  if (lower.includes("local service") || lower.includes("gls"))
    return PLATFORM_COLORS.gls;
  return PLATFORM_COLORS.default;
}

function getPlatformIcon(plataforma: string): string {
  const lower = plataforma.toLowerCase();
  if (lower.includes("meta") || lower.includes("facebook")) return "📘";
  if (lower.includes("google ads") || lower.includes("g-ads")) return "🔍";
  if (lower.includes("local service") || lower.includes("gls")) return "📍";
  return "📣";
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
  nome: "nome",
  name: "nome",
  fullname: "nome",
  nomecompleto: "nome",
  telefone: "telefone",
  phone: "telefone",
  celular: "telefone",
  whatsapp: "telefone",
  data: "data",
  date: "data",
  datacriacao: "data",
  createdat: "data",
  plataforma: "plataforma",
  platform: "plataforma",
  origem: "plataforma",
  source: "plataforma",
  campanha: "plataforma",
  campaign: "plataforma",
};

function parseLeadsFromCSV(rawRows: Record<string, string>[]): Lead[] {
  if (rawRows.length === 0) return [];

  const firstRow = rawRows[0];
  const originalHeaders = Object.keys(firstRow);
  const headerMapping: Record<string, keyof Lead> = {};

  for (const original of originalHeaders) {
    const normalized = normalizeHeader(original);
    const mapped = HEADER_MAP[normalized];
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

// ─── Sub-components ───────────────────────────────────────────────────────────

function LogoIcon() {
  return (
    <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shadow-[0_0_16px_rgba(245,166,35,0.18)] overflow-hidden">
      {/* Inline SVG approximation of the hawk logo */}
      <svg
        viewBox="0 0 100 100"
        className="w-6 h-6"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M15 20 Q30 10 55 30 Q70 15 90 12 Q80 35 65 38 Q80 50 85 68 Q65 55 55 60 Q45 72 35 80 Q38 65 30 58 Q18 55 10 65 Q12 48 25 42 Q10 35 15 20Z"
          fill="#f5a623"
        />
        <path
          d="M28 55 Q22 60 18 68 Q24 62 32 64Z"
          fill="rgba(255,255,255,0.15)"
        />
      </svg>
    </div>
  );
}

interface OperationSelectorProps {
  selected: Operation;
  onChange: (op: Operation) => void;
}

function OperationSelector({ selected, onChange }: OperationSelectorProps) {
  return (
    <div className="flex items-center gap-2 p-1 rounded-xl bg-[#1a1917] border border-[#2e2c29]">
      {OPERATIONS.map((op) => (
        <button
          key={op}
          onClick={() => onChange(op)}
          className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all duration-200 ${
            selected === op
              ? "bg-amber-500 text-[#111] shadow-[0_2px_12px_rgba(245,166,35,0.35)]"
              : "text-[#7a7268] hover:text-[#e8e2d8]"
          }`}
        >
          {op}
        </button>
      ))}
    </div>
  );
}

interface DropzoneProps {
  onLeadsParsed: (leads: Lead[]) => void;
  disabled: boolean;
}

function Dropzone({ onLeadsParsed, disabled }: DropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(
    (file: File) => {
      if (!file.name.endsWith(".csv")) {
        toast.error("Formato inválido. Envie um arquivo .CSV");
        return;
      }

      Papa.parse<Record<string, string>>(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          try {
            const leads = parseLeadsFromCSV(results.data);
            if (leads.length === 0) {
              toast.error(
                "Nenhum lead encontrado. Verifique as colunas do CSV."
              );
              return;
            }
            onLeadsParsed(leads);
            toast.success(`${leads.length} leads importados com sucesso!`);
          } catch {
            toast.error("Erro ao processar o CSV. Tente novamente.");
          }
        },
        error: () => toast.error("Falha na leitura do arquivo."),
      });
    },
    [onLeadsParsed]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (disabled) return;
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile, disabled]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
      e.target.value = "";
    },
    [processFile]
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      onClick={() => !disabled && inputRef.current?.click()}
      className={`
        relative rounded-2xl border-2 border-dashed p-8 text-center cursor-pointer
        transition-all duration-300 group
        ${
          isDragging
            ? "border-amber-500 bg-amber-500/10 shadow-[0_0_30px_rgba(245,166,35,0.2)]"
            : "border-[#2e2c29] hover:border-amber-500/50 hover:bg-amber-500/5"
        }
        ${disabled ? "opacity-40 cursor-not-allowed" : ""}
      `}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={handleChange}
        disabled={disabled}
      />
      <div className="flex flex-col items-center gap-3">
        <div
          className={`
          w-14 h-14 rounded-2xl flex items-center justify-center text-2xl
          transition-all duration-300
          ${
            isDragging
              ? "bg-amber-500/20 scale-110"
              : "bg-[#201f1d] border border-[#2e2c29] group-hover:bg-amber-500/10"
          }
        `}
        >
          📂
        </div>
        <div>
          <p className="text-[#e8e2d8] font-semibold text-sm">
            {isDragging
              ? "Solte o arquivo aqui"
              : "Arraste seu CSV ou clique para selecionar"}
          </p>
          <p className="text-[#7a7268] text-xs mt-1">
            Colunas esperadas:{" "}
            <span className="text-amber-500/80">
              Nome, Telefone, Data, Plataforma
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}

interface LeadTableProps {
  leads: Lead[];
  searchTerm: string;
  platformFilter: string;
}

function LeadTable({ leads, searchTerm, platformFilter }: LeadTableProps) {
  const filtered = leads.filter((l) => {
    const matchSearch =
      !searchTerm ||
      l.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
      l.telefone.includes(searchTerm);
    const matchPlatform =
      !platformFilter ||
      l.plataforma.toLowerCase().includes(platformFilter.toLowerCase());
    return matchSearch && matchPlatform;
  });

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <span className="text-4xl">🔍</span>
        <p className="text-[#7a7268] text-sm">
          {leads.length === 0
            ? "Nenhum lead importado ainda."
            : "Nenhum lead encontrado para esses filtros."}
        </p>
      </div>
    );
  }

  return (
    /*
     * SCROLL FIX (mobile):
     * - "overscroll-x-contain" prevents the horizontal scroll inside the table
     *   from bubbling up and locking the vertical page scroll on iOS/Android.
     * - "-webkit-overflow-scrolling: touch" (via style prop) enables momentum
     *   scrolling on iOS without creating an isolated scroll prison.
     * - The outer rounded border is kept via a wrapper div since the scrollable
     *   element itself can't clip border-radius reliably on all mobile browsers.
     */
    <div className="rounded-xl border border-[#2e2c29] overflow-hidden">
      <div
        className="overflow-x-auto overscroll-x-contain"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#2e2c29] bg-[#1a1917]">
              {["Nome", "Telefone", "Data", "Plataforma"].map((h) => (
                <th
                  key={h}
                  className="px-4 py-3 text-left text-xs uppercase tracking-widest text-[#7a7268] whitespace-nowrap font-semibold"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((lead, idx) => (
              <tr
                key={lead.id}
                className={`
                  border-b border-[#2e2c29]/50 transition-colors duration-150
                  hover:bg-amber-500/5
                  ${idx % 2 === 0 ? "bg-[#201f1d]" : "bg-[#1c1b19]"}
                `}
              >
                <td className="px-4 py-3 font-medium text-[#e8e2d8] max-w-[180px] truncate">
                  {lead.nome || "—"}
                </td>
                <td className="px-4 py-3 text-[#7a7268] font-mono text-xs whitespace-nowrap">
                  {lead.telefone || "—"}
                </td>
                <td className="px-4 py-3 text-[#7a7268] whitespace-nowrap">
                  {lead.data || "—"}
                </td>
                <td className="px-4 py-3">
                  {lead.plataforma ? (
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${getPlatformStyle(
                        lead.plataforma
                      )}`}
                    >
                      <span className="text-[10px]">
                        {getPlatformIcon(lead.plataforma)}
                      </span>
                      {lead.plataforma}
                    </span>
                  ) : (
                    <span className="text-[#7a7268]">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Home() {
  const [selectedOp, setSelectedOp] = useState<Operation>("Op 01");
  const [leadsByOp, setLeadsByOp] = useState<Record<Operation, Lead[]>>({
    "Op 01": [],
    "Op 02": [],
    "Op 03": [],
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [platformFilter, setPlatformFilter] = useState("");

  const currentLeads = leadsByOp[selectedOp];

  const handleLeadsParsed = useCallback(
    (newLeads: Lead[]) => {
      setLeadsByOp((prev) => ({
        ...prev,
        [selectedOp]: [
          ...prev[selectedOp],
          ...newLeads.map((l) => ({ ...l, id: `${selectedOp}-${l.id}` })),
        ],
      }));
    },
    [selectedOp]
  );

  const handleClearLeads = () => {
    setLeadsByOp((prev) => ({ ...prev, [selectedOp]: [] }));
    toast.success(`Leads da ${selectedOp} removidos.`);
  };

  // Unique platforms for filter
  const platformOptions = Array.from(
    new Set(currentLeads.map((l) => l.plataforma).filter(Boolean))
  ).sort();

  return (
    // SCROLL FIX: wrapper is block-level with no height/overflow constraints.
    // Only the native document scroll is used — no nested scroll contexts.
    <div className="w-full bg-[#111010] text-[#e8e2d8] font-sans" style={{ overscrollBehavior: "none" }}>
      {/* Ambient background — fixed but pointer-events-none, no overflow side-effects */}
      <div
        className="pointer-events-none fixed inset-0 z-0"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(ellipse 60% 40% at 10% 0%, rgba(245,166,35,0.07) 0%, transparent 60%), radial-gradient(ellipse 40% 30% at 90% 100%, rgba(245,166,35,0.05) 0%, transparent 60%)",
        }}
      />

      {/* ── Header ── */}
      <header className="sticky top-0 z-50 h-16 flex items-center justify-between px-4 md:px-8 bg-[#111010]/85 backdrop-blur-xl border-b border-[#2e2c29]">
        <div className="flex items-center gap-2.5">
          <LogoIcon />
          <span className="font-bold text-[1.05rem] tracking-tight">
            TS <span className="text-amber-500">Controler</span>
          </span>
        </div>
        <span className="text-[0.65rem] font-semibold uppercase tracking-widest text-[#7a7268] bg-[#1a1917] border border-[#2e2c29] px-3 py-1 rounded-full">
          Painel do Gestor
        </span>
      </header>

      {/* ── Main ── */}
      <main className="relative max-w-5xl mx-auto px-4 md:px-8 py-8 space-y-8">

        {/* ── Section: Operação + Upload ── */}
        <section className="space-y-5">
          {/* Section header */}
          <div>
            <p className="text-[0.65rem] font-bold uppercase tracking-[0.15em] text-amber-500 mb-1">
              Importação
            </p>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight leading-tight">
              Upload de Leads
            </h1>
          </div>

          {/* Operation selector */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <span className="text-xs font-semibold uppercase tracking-widest text-[#7a7268] shrink-0">
              Operação Ativa:
            </span>
            <OperationSelector selected={selectedOp} onChange={(op) => { setSelectedOp(op); setSearchTerm(""); setPlatformFilter(""); }} />
          </div>

          {/* Dropzone */}
          <Dropzone
            onLeadsParsed={handleLeadsParsed}
            disabled={false}
          />

          {/* CSV format hint */}
          <div className="rounded-xl bg-[#1a1917] border border-[#2e2c29] p-4 text-xs text-[#7a7268] space-y-1.5">
            <p className="font-semibold text-[#e8e2d8] text-xs uppercase tracking-wider">
              📋 Formato esperado do CSV
            </p>
            <p>
              O arquivo deve conter cabeçalhos com as colunas (em qualquer
              idioma):
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              {["Nome / Name", "Telefone / Phone", "Data / Date", "Plataforma / Campaign"].map(
                (c) => (
                  <span
                    key={c}
                    className="px-2.5 py-1 rounded-md bg-[#201f1d] border border-[#2e2c29] text-[#e8e2d8] font-mono"
                  >
                    {c}
                  </span>
                )
              )}
            </div>
          </div>
        </section>

        {/* ── Section: Dashboard ── */}
        <section className="space-y-5">
          {/* Panel header */}
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div>
              <p className="text-[0.65rem] font-bold uppercase tracking-[0.15em] text-amber-500 mb-1">
                Gerenciamento
              </p>
              <h2 className="text-xl md:text-2xl font-extrabold tracking-tight">
                Leads da{" "}
                <span className="text-amber-500">{selectedOp}</span>
              </h2>
              {/* Stats */}
              <div className="flex items-center gap-4 mt-2">
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  <span className="text-[0.7rem] font-semibold text-[#7a7268]">
                    <span className="text-[#e8e2d8]">{currentLeads.length}</span>{" "}
                    total
                  </span>
                </div>
                {platformOptions.slice(0, 2).map((p) => (
                  <div key={p} className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    <span className="text-[0.7rem] font-semibold text-[#7a7268] truncate max-w-[100px]">
                      <span className="text-[#e8e2d8]">
                        {currentLeads.filter((l) => l.plataforma === p).length}
                      </span>{" "}
                      {p}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            {currentLeads.length > 0 && (
              <button
                onClick={handleClearLeads}
                className="self-start sm:self-auto flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/25 text-red-400 text-xs font-semibold hover:bg-red-500/20 transition-colors"
              >
                🗑️ Limpar leads
              </button>
            )}
          </div>

          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3">
            {/* Search */}
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#7a7268] text-sm pointer-events-none">
                🔎
              </span>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar por nome ou telefone..."
                className="w-full bg-[#201f1d] border border-[#2e2c29] rounded-xl pl-9 pr-4 py-2.5 text-sm text-[#e8e2d8] placeholder:text-[#7a7268] outline-none focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/20 transition"
              />
            </div>
            {/* Platform filter */}
            <div className="relative sm:w-52">
              <select
                value={platformFilter}
                onChange={(e) => setPlatformFilter(e.target.value)}
                className="w-full appearance-none bg-[#201f1d] border border-[#2e2c29] rounded-xl px-4 pr-9 py-2.5 text-sm text-[#e8e2d8] outline-none focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/20 transition cursor-pointer"
              >
                <option value="">Todas as plataformas</option>
                {platformOptions.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#7a7268] text-xs">
          
