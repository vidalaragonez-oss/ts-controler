"use client";

/**
 * ARQUITETURA DE SCROLL — REGRAS ABSOLUTAS:
 *
 * 1. O ÚNICO scroller da página é o <body> / documento nativo.
 *    Nenhum container pai tem height, overflow, ou flex-1 que crie um
 *    scroll context secundário.
 *
 * 2. O wrapper raiz (#root-layout) é flex flex-col min-h-screen.
 *    NUNCA tem overflow-hidden/auto/scroll.
 *
 * 3. O <main> tem flex-1. NÃO tem overflow. Ele cresce livremente.
 *
 * 4. touch-action: pan-y em botões/toggles → o iOS não cancela o gesto
 *    de scroll vertical quando o dedo começa em cima de um elemento interativo.
 *
 * 5. O único container com overflow-x-auto é a tabela (scroll horizontal),
 *    protegido por overscroll-x-contain para não "vazar" para o scroll
 *    vertical do documento.
 */

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

function getPlatformStyle(p: string): string {
  const l = p.toLowerCase();
  if (l.includes("meta") || l.includes("facebook")) return PLATFORM_COLORS.meta;
  if (l.includes("google ads") || l.includes("g-ads")) return PLATFORM_COLORS.google;
  if (l.includes("local service") || l.includes("gls")) return PLATFORM_COLORS.gls;
  return PLATFORM_COLORS.default;
}

function getPlatformIcon(p: string): string {
  const l = p.toLowerCase();
  if (l.includes("meta") || l.includes("facebook")) return "📘";
  if (l.includes("google ads") || l.includes("g-ads")) return "🔍";
  if (l.includes("local service") || l.includes("gls")) return "📍";
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

// ─── LogoIcon ─────────────────────────────────────────────────────────────────

function LogoIcon() {
  return (
    <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shadow-[0_0_16px_rgba(245,166,35,0.18)] overflow-hidden shrink-0">
      <svg viewBox="0 0 100 100" className="w-6 h-6" fill="none">
        <path
          d="M15 20 Q30 10 55 30 Q70 15 90 12 Q80 35 65 38 Q80 50 85 68 Q65 55 55 60 Q45 72 35 80 Q38 65 30 58 Q18 55 10 65 Q12 48 25 42 Q10 35 15 20Z"
          fill="#f5a623"
        />
        <path d="M28 55 Q22 60 18 68 Q24 62 32 64Z" fill="rgba(255,255,255,0.15)" />
      </svg>
    </div>
  );
}

// ─── OperationSelector ────────────────────────────────────────────────────────

interface OperationSelectorProps {
  selected: Operation;
  onChange: (op: Operation) => void;
}

function OperationSelector({ selected, onChange }: OperationSelectorProps) {
  return (
    <div className="flex items-center gap-1.5 p-1 rounded-xl bg-[#1a1917] border border-[#2e2c29]">
      {OPERATIONS.map((op) => (
        <button
          key={op}
          onClick={() => onChange(op)}
          style={{ touchAction: "pan-y" }}
          className={[
            "px-3 py-1.5 rounded-lg text-sm font-semibold transition-all duration-200 select-none",
            selected === op
              ? "bg-amber-500 text-[#111] shadow-[0_2px_12px_rgba(245,166,35,0.35)]"
              : "text-[#7a7268] hover:text-[#e8e2d8]",
          ].join(" ")}
        >
          {op}
        </button>
      ))}
    </div>
  );
}

// ─── Dropzone ─────────────────────────────────────────────────────────────────

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
            toast.success(`${leads.length} leads importados com sucesso!`);
          } catch {
            toast.error("Erro ao processar o CSV. Tente novamente.");
          }
        },
        error: () => {
          setIsLoading(false);
          toast.error("Falha na leitura do arquivo.");
        },
      });
    },
    [onLeadsParsed]
  );

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        const f = e.dataTransfer.files[0];
        if (f) processFile(f);
      }}
      onClick={() => inputRef.current?.click()}
      style={{ touchAction: "manipulation" }}
      className={[
        "rounded-2xl border-2 border-dashed p-8 text-center cursor-pointer transition-all duration-300",
        isDragging
          ? "border-amber-500 bg-amber-500/10 shadow-[0_0_30px_rgba(245,166,35,0.2)]"
          : "border-[#2e2c29] hover:border-amber-500/50 hover:bg-amber-500/5",
        isLoading ? "opacity-60 pointer-events-none" : "",
      ].join(" ")}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) processFile(f);
          e.target.value = "";
        }}
      />
      <div className="flex flex-col items-center gap-3 pointer-events-none">
        <div className={[
          "w-14 h-14 rounded-2xl flex items-center justify-center text-2xl transition-all duration-300",
          isDragging ? "bg-amber-500/20 scale-110" : "bg-[#201f1d] border border-[#2e2c29]",
        ].join(" ")}>
          {isLoading ? "⏳" : "📂"}
        </div>
        <div>
          <p className="text-[#e8e2d8] font-semibold text-sm">
            {isLoading
              ? "Processando..."
              : isDragging
              ? "Solte o arquivo aqui"
              : "Arraste seu CSV ou toque para selecionar"}
          </p>
          <p className="text-[#7a7268] text-xs mt-1">
            Colunas:{" "}
            <span className="text-amber-500/80">Nome · Telefone · Data · Plataforma</span>
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── LeadTable ────────────────────────────────────────────────────────────────

interface LeadTableProps {
  leads: Lead[];
  searchTerm: string;
  platformFilter: string;
}

function LeadTable({ leads, searchTerm, platformFilter }: LeadTableProps) {
  const filtered = leads.filter((l) => {
    const s = searchTerm.toLowerCase();
    const matchSearch = !s || l.nome.toLowerCase().includes(s) || l.telefone.includes(s);
    const matchPlatform =
      !platformFilter || l.plataforma.toLowerCase().includes(platformFilter.toLowerCase());
    return matchSearch && matchPlatform;
  });

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 rounded-xl border border-[#2e2c29] bg-[#1a1917]">
        <span className="text-4xl">{leads.length === 0 ? "📭" : "🔍"}</span>
        <p className="text-[#7a7268] text-sm text-center px-4">
          {leads.length === 0
            ? "Nenhum lead importado ainda. Faça o upload de um CSV acima."
            : "Nenhum lead encontrado para esses filtros."}
        </p>
      </div>
    );
  }

  return (
    /*
     * SCROLL FIX — tabela:
     * Wrapper externo: overflow-hidden só para clipar border-radius.
     * Wrapper interno: overflow-x-auto + overscroll-x-contain.
     *   → o scroll horizontal NÃO vaza para o scroll vertical do documento.
     * SEM height fixo → documento cresce naturalmente.
     */
    <div className="rounded-xl border border-[#2e2c29] overflow-hidden">
      <div
        className="overflow-x-auto overscroll-x-contain"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        <table className="w-full text-sm min-w-[520px]">
          <thead>
            <tr className="border-b border-[#2e2c29] bg-[#1a1917]">
              {["#", "Nome", "Telefone", "Data", "Plataforma"].map((h) => (
                <th
                  key={h}
                  className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-[#7a7268] whitespace-nowrap"
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
                className={[
                  "border-b border-[#2e2c29]/40 transition-colors duration-150 hover:bg-amber-500/5",
                  idx % 2 === 0 ? "bg-[#201f1d]" : "bg-[#1c1b19]",
                ].join(" ")}
              >
                <td className="px-4 py-3 text-[#7a7268] text-xs font-mono">{idx + 1}</td>
                <td className="px-4 py-3 font-medium text-[#e8e2d8] max-w-[160px] truncate">
                  {lead.nome || "—"}
                </td>
                <td className="px-4 py-3 text-[#7a7268] font-mono text-xs whitespace-nowrap">
                  {lead.telefone || "—"}
                </td>
                <td className="px-4 py-3 text-[#7a7268] whitespace-nowrap text-xs">
                  {lead.data || "—"}
                </td>
                <td className="px-4 py-3">
                  {lead.plataforma ? (
                    <span
                      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold border whitespace-nowrap ${getPlatformStyle(lead.plataforma)}`}
                    >
                      <span>{getPlatformIcon(lead.plataforma)}</span>
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

// ─── Page ─────────────────────────────────────────────────────────────────────

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

  const handleOpChange = (op: Operation) => {
    setSelectedOp(op);
    setSearchTerm("");
    setPlatformFilter("");
  };

  const platformOptions = Array.from(
    new Set(currentLeads.map((l) => l.plataforma).filter(Boolean))
  ).sort();

  // ─────────────────────────────────────────────────────────────────────────
  // ESTRUTURA DE LAYOUT — por que funciona no mobile:
  //
  //  <body>                   → scroll nativo do documento (height: auto no CSS)
  //    #root-layout            → flex flex-col min-h-screen
  //                              SEM overflow, SEM height fixo
  //      <header>              → sticky top-0, NÃO cria scroll context próprio
  //      <main>                → flex-1, SEM overflow, cresce livremente
  //        conteúdo...         → empurra o documento para baixo normalmente
  //      <footer>              → shrink-0, sempre no final
  //
  // Resultado: nenhum container filho "prende" eventos de touch.
  // O body é o único scroller — o gesto pan-y nunca é interceptado.
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div
      id="root-layout"
      className="flex flex-col min-h-screen bg-[#111010] text-[#e8e2d8]"
    >

      {/* Ambient glow — fixed, sem influência no layout/scroll */}
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
        <span className="text-[0.6rem] font-semibold uppercase tracking-widest text-[#7a7268] bg-[#1a1917] border border-[#2e2c29] px-3 py-1 rounded-full">
          Painel do Gestor
        </span>
      </header>

      {/* ── Main ── */}
      {/* flex-1 = empurra o footer para baixo. SEM overflow. SEM z-index. */}
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 md:px-8 py-8 pb-16 space-y-10">

        {/* ── Seção Upload ── */}
        <section className="space-y-5">
          <div>
            <p className="text-[0.6rem] font-bold uppercase tracking-[0.18em] text-amber-500 mb-1">
              Importação
            </p>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">
              Upload de Leads
            </h1>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <span className="text-xs font-semibold uppercase tracking-widest text-[#7a7268] shrink-0">
              Operação ativa:
            </span>
            <OperationSelector selected={selectedOp} onChange={handleOpChange} />
          </div>

          <Dropzone onLeadsParsed={handleLeadsParsed} />

          <div className="rounded-xl bg-[#1a1917] border border-[#2e2c29] p-4 space-y-2">
            <p className="font-semibold text-[#e8e2d8] text-xs uppercase tracking-wider">
              📋 Formato esperado do CSV
            </p>
            <p className="text-xs text-[#7a7268]">
              Cabeçalhos aceitos em PT ou EN:
            </p>
            <div className="flex flex-wrap gap-2">
              {[
                "Nome / Name",
                "Telefone / Phone",
                "Data / Date",
                "Plataforma / Campaign",
              ].map((c) => (
                <span
                  key={c}
                  className="px-2.5 py-1 rounded-md bg-[#201f1d] border border-[#2e2c29] text-[#e8e2d8] font-mono text-xs"
                >
                  {c}
                </span>
              ))}
            </div>
          </div>
        </section>

        <div className="border-t border-[#2e2c29]" />

        {/* ── Seção Dashboard ── */}
        <section className="space-y-5">

          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div className="space-y-2">
              <p className="text-[0.6rem] font-bold uppercase tracking-[0.18em] text-amber-500">
                Gerenciamento
              </p>
              <h2 className="text-xl md:text-2xl font-extrabold tracking-tight">
                Leads da <span className="text-amber-500">{selectedOp}</span>
              </h2>
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                  <span className="text-[0.7rem] font-semibold text-[#7a7268]">
                    <span className="text-[#e8e2d8]">{currentLeads.length}</span> total
                  </span>
                </div>
                {platformOptions.slice(0, 3).map((p) => (
                  <div key={p} className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                    <span className="text-[0.7rem] font-semibold text-[#7a7268] max-w-[120px] truncate">
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
                onClick={() => {
                  setLeadsByOp((prev) => ({ ...prev, [selectedOp]: [] }));
                  toast.success(`Leads da ${selectedOp} removidos.`);
                }}
                style={{ touchAction: "manipulation" }}
                className="self-start sm:self-auto flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/25 text-red-400 text-xs font-semibold hover:bg-red-500/20 active:scale-95 transition-all"
              >
                🗑️ Limpar leads
              </button>
            )}
          </div>

          {/* Filtros */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#7a7268] text-sm pointer-events-none select-none">
                🔎
              </span>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar por nome ou telefone..."
                className="w-full bg-[#201f1d] border border-[#2e2c29] rounded-xl pl-9 pr-4 py-2.5 text-sm text-[#e8e2d8] placeholder:text-[#7a7268] outline-none focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/20 transition-colors"
              />
            </div>
            <div className="relative sm:w-52">
              <select
                value={platformFilter}
                onChange={(e) => setPlatformFilter(e.target.value)}
                className="w-full appearance-none bg-[#201f1d] border border-[#2e2c29] rounded-xl px-4 pr-9 py-2.5 text-sm text-[#e8e2d8] outline-none focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/20 transition-colors cursor-pointer"
              >
                <option value="">Todas as plataformas</option>
                {platformOptions.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#7a7268] text-xs select-none">
                ▾
              </span>
            </div>
          </div>

          <LeadTable
            leads={currentLeads}
            searchTerm={searchTerm}
            platformFilter={platformFilter}
          />

          {currentLeads.length > 0 && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 flex items-start gap-3">
              <span className="text-xl shrink-0 mt-0.5">📄</span>
              <div>
                <p className="text-xs font-semibold text-amber-500 uppercase tracking-wider">
                  Próximo passo
                </p>
                <p className="text-xs text-[#7a7268] mt-0.5">
                  Exportação de PDF com coluna de Feedback editável — módulo em breve.
                </p>
              </div>
            </div>
          )}

        </section>
      </main>

      {/* ── Footer ── */}
      <footer className="shrink-0 border-t border-[#2e2c29] py-4 px-4 md:px-8">
        <p className="text-center text-[0.65rem] text-[#7a7268]">
          TS Controler · Painel Interno · {new Date().getFullYear()}
        </p>
      </footer>

    </div>
  );
}
