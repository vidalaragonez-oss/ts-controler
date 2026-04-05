"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { createClient } from "@/utils/supabase";
import { toast } from "sonner";
import {
  BarChart3,
  Layers,
  LogOut,
  Loader2,
  Plus,
  Search,
  UserCircle,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface GestorPerfil {
  id: string;
  nome: string;
  role: "admin" | "gestor";
  operacao_id: string[] | null;
  user_id: string;
}

interface Operacao {
  id: string;
  nome: string;
  created_at: string;
}

// ─── Card Component ───────────────────────────────────────────────────────────

function HubCard({
  icon,
  title,
  description,
  onClick,
  disabled = false,
  accent = false,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  onClick: () => void;
  disabled?: boolean;
  accent?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        group text-left rounded-2xl border p-5 flex flex-col gap-4 transition-all duration-200
        disabled:opacity-40 disabled:cursor-not-allowed
        ${accent
          ? "border-amber-500/30 bg-[#1e1c18] hover:border-amber-500/50 hover:bg-[#221f19] hover:shadow-[0_4px_24px_rgba(245,166,35,0.10)]"
          : "border-[#2a2825] bg-[#171614] hover:border-[#3a3835] hover:bg-[#1c1a18] hover:shadow-[0_4px_24px_rgba(0,0,0,0.3)]"
        }
      `}
    >
      {/* Dot icon */}
      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-110 ${
        accent ? "bg-amber-500" : "bg-amber-500"
      }`}>
        <div className="text-[#111]">{icon}</div>
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-[#e8e2d8] leading-tight">{title}</p>
        {description && (
          <p className="text-[11px] text-[#7a7268] mt-1.5 leading-relaxed line-clamp-2">{description}</p>
        )}
      </div>
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PAGE
// ═══════════════════════════════════════════════════════════════════════════════

export default function HubPage() {
  const router = useRouter();

  const [perfil, setPerfil]       = useState<GestorPerfil | null>(null);
  const [operacoes, setOperacoes] = useState<Operacao[]>([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState("");

  // ── Auth + data ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const bootstrap = async () => {
      try {
        const sb = createClient();
        const { data: { user } } = await sb.auth.getUser();
        if (!user) { router.replace("/login"); return; }

        const { data: gestorData, error } = await sb
          .from("gestores")
          .select("id, nome, role, operacao_id, user_id")
          .eq("user_id", user.id)
          .single();

        if (error || !gestorData) { router.replace("/login"); return; }

        const rawOpId = gestorData.operacao_id;
        const cleanOpId: string[] = Array.isArray(rawOpId)
          ? (rawOpId as unknown[]).filter((v): v is string => typeof v === "string" && v.length > 0)
          : [];
        const p: GestorPerfil = { ...gestorData, operacao_id: cleanOpId.length > 0 ? cleanOpId : null };
        setPerfil(p);

        // Fetch operações acessíveis
        let query = supabase.from("operacoes").select("*").order("created_at", { ascending: true });
        if (p.role === "gestor" && p.operacao_id && p.operacao_id.length > 0) {
          query = query.in("id", p.operacao_id) as typeof query;
        }
        const { data: ops } = await query;
        setOperacoes((ops ?? []) as Operacao[]);
      } catch (err) {
        console.error("[hub] bootstrap:", err);
        router.replace("/login");
      } finally {
        setLoading(false);
      }
    };
    bootstrap();
  }, [router]);

  // ── Logoff ────────────────────────────────────────────────────────────────────
  const handleLogout = async () => {
    try { await createClient().auth.signOut(); } catch { /* ignora */ }
    router.push("/login");
    router.refresh();
  };

  // ── Nav para operação ─────────────────────────────────────────────────────────
  const goToOperacao = (op: Operacao) => {
    // Gestor sem acesso a essa operação
    if (perfil?.role === "gestor" && perfil.operacao_id && !perfil.operacao_id.includes(op.id)) {
      toast.error("Acesso restrito a esta operação.");
      return;
    }
    router.push(`/operacao?unidade=${encodeURIComponent(op.nome)}`);
  };

  // ── Filter ────────────────────────────────────────────────────────────────────
  const q = search.toLowerCase().trim();
  const filteredOps = operacoes.filter(op => op.nome.toLowerCase().includes(q));

  // ── Loading ───────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-[#0e0d0c] flex items-center justify-center">
        <Loader2 size={28} className="text-amber-500 animate-spin" />
      </div>
    );
  }

  const isAdmin = perfil?.role === "admin";

  // Build all cards for grid
  const diretoriaCard = isAdmin ? {
    id: "__diretoria__",
    title: "Diretoria",
    description: "Dashboard executivo de pacing e saúde da operação.",
    icon: <BarChart3 size={16} />,
    onClick: () => router.push("/diretoria"),
    disabled: false,
  } : null;

  const opCards = filteredOps.map(op => ({
    id: op.id,
    title: op.nome,
    description: "Clientes, Leads e Métricas da operação.",
    icon: <Layers size={16} />,
    onClick: () => goToOperacao(op),
    disabled: false,
  }));

  const novaOpCard = isAdmin ? {
    id: "__nova__",
    title: "Nova Operação",
    description: "Criar uma nova unidade de operação.",
    icon: <Plus size={16} />,
    onClick: () => router.push("/operacao?nova=1"),
    disabled: false,
  } : null;

  const allCards = [
    ...(diretoriaCard ? [diretoriaCard] : []),
    ...opCards,
    ...(novaOpCard ? [novaOpCard] : []),
  ];

  return (
    <div className="min-h-screen bg-[#0e0d0c] text-[#e8e2d8] flex flex-col">

      {/* ── Header ── */}
      <header className="shrink-0 px-6 md:px-10 pt-6 pb-0 flex items-start justify-between">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/LOGO-PRINCIPAL.svg" alt="TS HUB" className="h-8 w-auto" />
          <span className="text-[11px] font-bold tracking-[0.2em] text-[#7a7268] uppercase hidden sm:block">
            TS HUB
          </span>
        </div>

        <button
          onClick={handleLogout}
          title={`Sair (${perfil?.nome ?? ""})`}
          className="w-9 h-9 flex items-center justify-center rounded-xl text-amber-500 hover:bg-amber-500/10 transition-colors"
        >
          <LogOut size={18} />
        </button>
      </header>

      {/* ── Main ── */}
      <main className="flex-1 px-6 md:px-10 py-8 max-w-5xl w-full mx-auto">

        {/* Saudação */}
        <div className="mb-2 flex items-center gap-3">
          <UserCircle size={32} className="text-amber-400 shrink-0" />
          <div>
            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight leading-none">
              Bem Vindo, <span className="text-amber-400">{perfil?.nome ?? "—"}</span>
            </h1>
          </div>
        </div>
        <p className="text-sm text-[#7a7268] mb-8 ml-[44px]">
          Acesse rapidamente as operações e dashboards do TS HUB.
        </p>

        {/* Campo de busca */}
        <div className="relative mb-8 max-w-sm">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#4a4844] pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por operação ou dashboard..."
            className="w-full bg-transparent border border-amber-500/30 focus:border-amber-500/60 rounded-xl pl-9 pr-4 py-2.5 text-sm text-[#e8e2d8] placeholder:text-[#4a4844] outline-none transition-colors"
          />
        </div>

        {/* Grid de cards */}
        {allCards.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Layers size={40} className="text-[#2e2c29]" />
            <p className="text-[#7a7268] text-sm">Nenhuma operação encontrada.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {allCards.map(card => (
              <HubCard
                key={card.id}
                icon={card.icon}
                title={card.title}
                description={card.description}
                onClick={card.onClick}
                disabled={card.disabled}
              />
            ))}
          </div>
        )}
      </main>

      <footer className="shrink-0 px-6 py-4">
        <p className="text-[0.6rem] text-[#2e2c29] text-center">
          TS HUB · {new Date().getFullYear()}
        </p>
      </footer>
    </div>
  );
}
