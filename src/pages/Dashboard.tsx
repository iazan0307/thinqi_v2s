import { useState, useEffect } from "react";
import { TrendingUp, TrendingDown, DollarSign, Landmark, Loader2, AlertTriangle, Users, FileText, Download } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { useAuth } from "@/contexts/AuthContext";
import { useViewAs } from "@/contexts/ViewAsContext";
import { api } from "@/lib/api";

interface DashboardData {
  empresa: { id: string; razao_social: string; regime_tributario: string };
  mes_ref: string;
  total_entradas: number;
  total_entradas_cartao: number;
  total_entradas_real: number;
  total_despesas: number;
  total_retiradas_socios: number;
  total_faturado: number;
  impostos_estimados: number;
  caixa_livre: number;
  periodo_liberado: boolean;
  conciliacao: { status: string; percentual_inconsistencia: number } | null;
}

interface HistoricoData {
  data: { mes: string; mes_label: string; receitas: number; despesas: number; retiradas: number }[];
}

const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

const mesAtual = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const Dashboard = () => {
  const { user } = useAuth();
  const { viewAs } = useViewAs();
  const [mes, setMes] = useState("");

  // Admin/Contador usa ?empresa_id — prefere o modo "Ver como cliente" quando ativo
  const empresaQueryId = user?.role === "CLIENTE"
    ? null
    : (viewAs?.empresaId ?? user?.empresa_id ?? null);
  const params = empresaQueryId ? `?empresa_id=${empresaQueryId}` : "";

  // Busca o último mês com dados; usa-o como padrão
  const { data: ultimoMesData, isLoading: loadingUltimoMes } = useQuery<{ mes: string | null }>({
    queryKey: ["portal-ultimo-mes", user?.empresa_id],
    queryFn: () => api.get<{ mes: string | null }>(`/portal/ultimo-mes${params}`),
    enabled: !!user && mes === "",
    staleTime: Infinity,
  });

  useEffect(() => {
    if (ultimoMesData !== undefined && mes === "") {
      setMes(ultimoMesData.mes ?? mesAtual());
    }
  }, [ultimoMesData]);

  const { data, isLoading, isError } = useQuery<DashboardData>({
    queryKey: ["portal-dashboard", mes, user?.empresa_id],
    queryFn: () => api.get<DashboardData>(`/portal/dashboard/${mes}${params}`),
    enabled: !!user && !!mes,
  });

  const { data: historico } = useQuery<HistoricoData>({
    queryKey: ["portal-historico", user?.empresa_id],
    queryFn: () => api.get<HistoricoData>(`/portal/historico${params}`),
    enabled: !!user && !!mes,
  });

  const estimativaQueryString = params
    ? `${params}&mes_ref=${mes}`
    : `?mes_ref=${mes}`;

  const { data: estimativa } = useQuery<{ id: string; nome_original: string; tamanho_bytes: number; valor_total: number }>({
    queryKey: ["portal-estimativa", user?.empresa_id, mes],
    queryFn: () => api.get(`/estimativa-imposto${estimativaQueryString}`),
    enabled: !!user && !!mes,
    retry: false,
  });

  // Histórico de todas as versões de estimativas (todos os meses + todas as versões
  // por mês). Usado para o cliente revisitar PDFs antigos.
  // Filtro opcional por período (dropdown) — quando ausente, respeita a janela
  // configurada na empresa (estimativa_historico_meses).
  const [periodoEstimativa, setPeriodoEstimativa] = useState<"all" | "last_3_months" | "last_6_months" | "last_year">("all");
  const histEstParams = (() => {
    const sp = new URLSearchParams();
    if (empresaQueryId) sp.set("empresa_id", empresaQueryId);
    if (periodoEstimativa !== "all") sp.set("period", periodoEstimativa);
    const s = sp.toString();
    return s ? `?${s}` : "";
  })();

  const { data: historicoEstimativas } = useQuery<{
    data: { id: string; mes_ref: string; nome_original: string; tamanho_bytes: number; uploaded_at: string; valor_total: number; vigente: boolean }[]
  }>({
    queryKey: ["portal-estimativa-historico", user?.empresa_id, periodoEstimativa],
    queryFn: () => api.get(`/estimativa-imposto/historico${histEstParams}`),
    enabled: !!user,
    retry: false,
  });

  const baixarEstimativaPorId = async (id: string) => {
    try {
      const blob = await api.downloadBlob(`/estimativa-imposto/${id}/pdf`);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch {
      /* silencioso */
    }
  };

  const baixarEstimativa = async () => {
    if (!estimativa) return;
    await baixarEstimativaPorId(estimativa.id);
  };

  // Perfil SECRETARIA: oculta informações de retiradas/distribuição de sócios.
  // Quando em modo "Ver como cliente" (admin/contador), ignora essa restrição.
  const esconderRetiradas =
    user?.role === "CLIENTE" && user.perfil_cliente === "SECRETARIA" && !viewAs;

  const kpis = data
    ? [
        {
          label: "Entradas Totais",
          value: fmtBRL(data.total_entradas_real),
          icon: TrendingUp,
          colorClass: "kpi-green",
          bgClass: "kpi-green-bg",
          note: undefined,
        },
        {
          label: "Despesas Realizadas",
          value: fmtBRL(data.total_despesas),
          icon: TrendingDown,
          colorClass: "kpi-red",
          bgClass: "kpi-red-bg",
          note: "Pagamentos operacionais (exclui retiradas de sócios).",
        },
        ...(esconderRetiradas
          ? []
          : [{
              label: "Retiradas de Sócios",
              value: fmtBRL(data.total_retiradas_socios),
              icon: Users,
              colorClass: "kpi-orange",
              bgClass: "kpi-orange-bg",
              note: "Distribuição de lucros e pró-labore.",
            }]),
        {
          // Bug 4: disclaimer obrigatório — alíquota é estimativa pelo regime; valor real depende de cálculo contábil
          label: "Impostos Estimados",
          value: fmtBRL(data.impostos_estimados),
          icon: Landmark,
          colorClass: "kpi-orange",
          bgClass: "kpi-orange-bg",
          note: "Estimativa pelo regime tributário. Consulte seu contador.",
        },
        {
          // Bug 7: caixa livre negativo recebe destaque visual em vermelho
          label: "Caixa Livre",
          value: fmtBRL(data.caixa_livre),
          icon: DollarSign,
          colorClass: data.caixa_livre < 0 ? "kpi-red" : "kpi-blue",
          bgClass: data.caixa_livre < 0 ? "kpi-red-bg" : "kpi-blue-bg",
          note: data.caixa_livre < 0 ? "Despesas superaram as entradas do período." : undefined,
        },
      ]
    : [];

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Visão Geral</h1>
        {mes && (
          <input
            type="month"
            value={mes}
            onChange={e => setMes(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        )}
      </div>

      {(loadingUltimoMes || (!mes && !loadingUltimoMes) || isLoading) && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 size={16} className="animate-spin" /> Carregando dados...
        </div>
      )}

      {isError && (
        <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 rounded-lg px-4 py-3">
          <AlertTriangle size={16} /> Não foi possível carregar os dados. Verifique se há extratos importados para este mês.
        </div>
      )}

      {data && !data.periodo_liberado && (
        <div className="flex items-center gap-2 text-amber-700 text-sm bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <AlertTriangle size={16} /> Este período ainda não foi conciliado pelo seu contador.
        </div>
      )}

      {/* KPIs */}
      {data && (
        <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 ${esconderRetiradas ? "xl:grid-cols-4" : "xl:grid-cols-5"} gap-4`}>
          {kpis.map((kpi, i) => (
            <div
              key={kpi.label}
              className="bg-card rounded-xl border border-border p-5 shadow-sm animate-reveal"
              style={{ animationDelay: `${i * 80}ms` }}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{kpi.label}</p>
                  <p className="text-xl font-bold mt-1">{kpi.value}</p>
                  {kpi.note && (
                    <p className="text-xs text-muted-foreground mt-1 leading-tight">{kpi.note}</p>
                  )}
                </div>
                <div className={`${kpi.bgClass} p-2.5 rounded-lg`}>
                  <kpi.icon size={20} className={kpi.colorClass} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Estimativa de Impostos (PDF manual) */}
      {estimativa && (
        <div className="bg-card rounded-xl border border-border p-4 shadow-sm flex items-center justify-between gap-3 animate-reveal">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg kpi-orange-bg">
              <FileText size={20} className="kpi-orange" />
            </div>
            <div>
              <p className="text-sm font-medium">Estimativa de Impostos — {mes}</p>
              <p className="text-xs text-muted-foreground">
                {estimativa.nome_original} · PDF disponibilizado pelo contador
                {estimativa.valor_total > 0 && ` · Total: ${fmtBRL(estimativa.valor_total)}`}
              </p>
            </div>
          </div>
          <button
            onClick={baixarEstimativa}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Download size={14} /> Baixar PDF
          </button>
        </div>
      )}

      {/* Histórico de estimativas — Secretária NÃO vê (só sócio) */}
      {!esconderRetiradas && historicoEstimativas && historicoEstimativas.data.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-6 shadow-sm animate-reveal">
          <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
            <h2 className="text-base font-semibold">Histórico de Estimativas</h2>
            <select
              value={periodoEstimativa}
              onChange={(e) => setPeriodoEstimativa(e.target.value as typeof periodoEstimativa)}
              className="text-xs border border-border rounded px-2 py-1 bg-background"
            >
              <option value="all">Todos os meses</option>
              <option value="last_3_months">Últimos 3 meses</option>
              <option value="last_6_months">Últimos 6 meses</option>
              <option value="last_year">Último ano</option>
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left py-2 pr-3 font-medium">Mês</th>
                  <th className="text-left py-2 pr-3 font-medium">Versão</th>
                  <th className="text-left py-2 pr-3 font-medium">Arquivo</th>
                  <th className="text-right py-2 pr-3 font-medium">Total</th>
                  <th className="text-left py-2 pr-3 font-medium">Enviado em</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {historicoEstimativas.data.map(item => (
                  <tr
                    key={item.id}
                    className={`border-b border-border/40 last:border-0 ${!item.vigente ? "opacity-60" : ""}`}
                  >
                    <td className="py-2 pr-3 capitalize">
                      {new Date(item.mes_ref).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" })}
                    </td>
                    <td className="py-2 pr-3">
                      {item.vigente ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded bg-[hsl(var(--kpi-green-bg))] text-[hsl(var(--kpi-green))]">
                          Vigente
                        </span>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">Substituída</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 truncate max-w-xs" title={item.nome_original}>{item.nome_original}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {item.valor_total > 0 ? fmtBRL(item.valor_total) : "—"}
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">
                      {new Date(item.uploaded_at).toLocaleDateString("pt-BR")}
                    </td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() => baixarEstimativaPorId(item.id)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-muted"
                        title="Baixar PDF"
                      >
                        <Download size={12} /> Baixar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Gráfico histórico */}
      {historico && historico.data.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-6 shadow-sm animate-reveal">
          <h2 className="text-base font-semibold mb-4">
            {esconderRetiradas
              ? `Receitas e Despesas — Últimos ${historico.data.length} meses`
              : `Receitas, Despesas e Retiradas — Últimos ${historico.data.length} meses`}
          </h2>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={historico.data} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(220 13% 91%)" />
                <XAxis dataKey="mes_label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis
                  tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                  tick={{ fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  formatter={(v: number) => fmtBRL(v)}
                  contentStyle={{ borderRadius: 8, border: "1px solid hsl(220 13% 91%)", fontSize: 13 }}
                />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                <Bar dataKey="receitas" name="Receitas" fill="hsl(263 70% 58%)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="despesas" name="Despesas" fill="hsl(263 45% 80%)" radius={[4, 4, 0, 0]} />
                {!esconderRetiradas && (
                  <Bar dataKey="retiradas" name="Retiradas de Sócios" fill="hsl(25 85% 55%)" radius={[4, 4, 0, 0]} />
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

    </div>
  );
};

export default Dashboard;
