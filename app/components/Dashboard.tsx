import { useMemo } from "react";
import { motion } from "framer-motion";
import { 
  BarChart3, 
  TrendingUp, 
  Calendar, 
  Info, 
  Trophy,
  Activity
} from "lucide-react";
import { 
  ResponsiveContainer, 
  PieChart, Pie, Cell, Tooltip as ReTooltip, Legend, 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, 
} from "recharts";

// ─── Tipo local (espelha o Lead do page.tsx) ──────────────────────────────────

interface Lead {
  id: string;
  nome: string;
  email: string;
  telefone: string;
  data: string;
  plataforma: string;
  operacao?: string;
  cliente?: string;
  operacao_id?: string;
}

// ─── Paleta ───────────────────────────────────────────────────────────────────

const CHART_COLORS = [
  "#f5a623","#a78bfa","#34d399","#60a5fa",
  "#f472b6","#fb923c","#4ade80","#e879f9",
];

// ─── Tooltips ─────────────────────────────────────────────────────────────────

function PieTooltip({ active, payload }: { active?: boolean; payload?: { name: string; value: number }[] }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#1a1917] border border-[#2e2c29] rounded-xl px-3 py-2 shadow-xl text-xs">
      <p className="font-semibold text-[#e8e2d8]">{payload[0].name}</p>
      <p className="text-amber-400 font-bold">{payload[0].value} lead{payload[0].value !== 1 ? "s" : ""}</p>
    </div>
  );
}

function BarTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#1a1917] border border-[#2e2c29] rounded-xl px-3 py-2 shadow-xl text-xs">
      <p className="text-[#7a7268] mb-0.5">{label}</p>
      <p className="text-amber-400 font-bold">{payload[0].value} lead{payload[0].value !== 1 ? "s" : ""}</p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORT: ClienteDashboard
// ═══════════════════════════════════════════════════════════════════════════════

export function ClienteDashboard({ leads }: { leads: Lead[] }) {
  const { leadsPorPlataforma, leadsPorData, topPlataforma, diaTop } = useMemo(() => {
    if (!leads.length) return { leadsPorPlataforma: [], leadsPorData: [], topPlataforma: "—", diaTop: "—" };

    const byPlat: Record<string, number> = {};
    for (const l of leads) {
      const key = l.plataforma || "Sem plataforma";
      byPlat[key] = (byPlat[key] ?? 0) + 1;
    }
    const leadsPorPlataforma = Object.entries(byPlat)
      .sort((a, b) => b[1] - a[1])
      .map(([name, value]) => ({ name, value }));

    const byDate: Record<string, number> = {};
    for (const l of leads) {
      const raw = l.data ?? "";
      const dmy = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
      const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
      let label = "";
      if (dmy)      label = `${dmy[1]}/${dmy[2]}`;
      else if (ymd) label = `${ymd[3]}/${ymd[2]}`;
      else          label = "—";
      const sortKey = dmy ? `${dmy[3]}-${dmy[2]}-${dmy[1]}` : ymd ? raw.slice(0, 10) : "9999-99-99";
      if (!byDate[sortKey]) byDate[sortKey] = 0;
      byDate[sortKey]++;
      (byDate as Record<string, unknown>)[`__lbl_${sortKey}`] = label;
    }
    const leadsPorData = Object.keys(byDate)
      .filter(k => !k.startsWith("__lbl_"))
      .sort()
      .map(k => ({
        data: (byDate as Record<string, unknown>)[`__lbl_${k}`] as string,
        leads: byDate[k],
        _sortKey: k,
      }));

    const topPlataforma = leadsPorPlataforma[0]?.name ?? "—";
    const diaTopEntry   = [...leadsPorData].sort((a, b) => b.leads - a.leads)[0];
    const diaTop        = diaTopEntry ? diaTopEntry.data : "—";

    return { leadsPorPlataforma, leadsPorData, topPlataforma, diaTop };
  }, [leads]);

  if (!leads.length) {
    return (
      <motion.div 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-[#2e2c29] bg-[#16151380] p-8 flex flex-col items-center gap-3 text-center"
      >
        <BarChart3 size={32} className="text-[#7a7268]" />
        <p className="text-sm font-semibold text-[#e8e2d8]">Dashboard vazio</p>
        <p className="text-xs text-[#7a7268] max-w-xs">
          Nenhum lead encontrado para o período selecionado. Ajuste os filtros ou importe leads.
        </p>
      </motion.div>
    );
  }

  const diaTopMax = [...leadsPorData].sort((a, b) => b.leads - a.leads)[0]?.leads ?? 0;

  return (
    <div className="space-y-4">
      <motion.div 
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        className="flex items-center gap-2"
      >
        <Activity size={12} className="text-amber-500" />
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#7a7268]">Dashboard do Período</span>
        <div className="flex-1 h-px bg-[#2e2c29]" />
      </motion.div>

      {/* Cards de métricas */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <motion.div 
          whileHover={{ y: -2 }}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="rounded-2xl border border-[#2e2c29] bg-[#16151380] p-4 flex flex-col gap-1.5"
        >
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#7a7268]">Total no Período</p>
            <TrendingUp size={12} className="text-amber-500" />
          </div>
          <p className="text-3xl font-extrabold text-[#e8e2d8] tracking-tight leading-none">{leads.length}</p>
          <p className="text-[10px] text-[#7a7268]">lead{leads.length !== 1 ? "s" : ""} capturado{leads.length !== 1 ? "s" : ""}</p>
        </motion.div>

        <motion.div 
          whileHover={{ y: -2 }}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-4 flex flex-col gap-1.5"
        >
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-widest text-violet-400/70">Plataforma Campeã</p>
            <Trophy size={12} className="text-violet-400" />
          </div>
          <p className="text-lg font-extrabold text-[#e8e2d8] tracking-tight leading-tight truncate">{topPlataforma}</p>
          <p className="text-[10px] text-[#7a7268]">
            {leadsPorPlataforma[0]?.value ?? 0} leads
            {leads.length > 0 && ` · ${Math.round(((leadsPorPlataforma[0]?.value ?? 0) / leads.length) * 100)}%`}
          </p>
        </motion.div>

        <motion.div 
          whileHover={{ y: -2 }}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 flex flex-col gap-1.5"
        >
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-400/70">Dia com Mais Leads</p>
            <Calendar size={12} className="text-emerald-400" />
          </div>
          <p className="text-3xl font-extrabold text-[#e8e2d8] tracking-tight leading-none">{diaTop}</p>
          <p className="text-[10px] text-[#7a7268]">{diaTopMax} lead{diaTopMax !== 1 ? "s" : ""} nesse dia</p>
        </motion.div>
      </div>

      {/* Gráficos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <motion.div 
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.4 }}
          className="rounded-2xl border border-[#2e2c29] bg-[#16151380] p-5 flex flex-col gap-4"
        >
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#7a7268]">Leads por Plataforma</p>
          {leadsPorPlataforma.length === 0 ? (
            <p className="text-xs text-[#7a7268] text-center py-8">Sem dados</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={leadsPorPlataforma} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value" strokeWidth={0}>
                  {leadsPorPlataforma.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Pie>
                <ReTooltip content={<PieTooltip />} />
                <Legend formatter={(v) => <span style={{ color: "#a09890", fontSize: 11 }}>{v}</span>} iconSize={8} iconType="circle" />
              </PieChart>
            </ResponsiveContainer>
          )}
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.5 }}
          className="rounded-2xl border border-[#2e2c29] bg-[#16151380] p-5 flex flex-col gap-4"
        >
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#7a7268]">Leads por Dia</p>
          {leadsPorData.length === 0 ? (
            <p className="text-xs text-[#7a7268] text-center py-8">Sem dados com data válida</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={leadsPorData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }} barSize={leadsPorData.length > 20 ? 6 : leadsPorData.length > 10 ? 10 : 18}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2e2c29" vertical={false} />
                <XAxis dataKey="data" tick={{ fill: "#7a7268", fontSize: 10 }} axisLine={false} tickLine={false} interval={leadsPorData.length > 14 ? Math.floor(leadsPorData.length / 7) : 0} />
                <YAxis tick={{ fill: "#7a7268", fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <ReTooltip content={<BarTooltip />} cursor={{ fill: "rgba(245,166,35,0.06)" }} />
                <Bar dataKey="leads" radius={[4, 4, 0, 0]}>
                  {leadsPorData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} fillOpacity={0.85} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </motion.div>
      </div>
    </div>
  );
}

