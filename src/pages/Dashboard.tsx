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
  ultimas_transacoes: {
    data: string;
    descricao: string;
    valor: number;
    tipo: "ENTRADA" | "SAIDA";
  }[];
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

  const { data: estimativa } = useQuery<{ id: string; nome_original: string; tamanho_bytes: number }>({
    queryKey: ["portal-estimativa", user?.empresa_id, mes],
    queryFn: () => api.get(`/estimativa-imposto${estimativaQueryString}`),
    enabled: !!user && !!mes,
    retry: false,
  });

  const baixarEstimativa = async () => {
    if (!estimativa) return;
    try {
      const blob = await api.downloadBlob(`/estimativa-imposto/${estimativa.id}/pdf`);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch {
      /* silencioso — link de download já exibe erro 404 via ausência do bloco */
    }
  };

  // Perfil ADMINISTRATIVO: oculta informações de retiradas/distribuição de sócios.
  // Quando em modo "Ver como cliente" (admin/contador), ignora essa restrição.
  const esconderRetiradas =
    user?.role === "CLIENTE" && user.perfil_cliente === "ADMINISTRATIVO" && !viewAs;

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

      {/* Últimas transações */}
      {data && data.ultimas_transacoes.length > 0 && (
        <div className="bg-card rounded-xl border border-border shadow-sm animate-reveal">
          <div className="p-6 pb-4">
            <h2 className="text-base font-semibold">Últimas Transações</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-t border-border text-muted-foreground">
                  <th className="text-left font-medium px-6 py-3">Data</th>
                  <th className="text-left font-medium px-6 py-3">Descrição</th>
                  <th className="text-right font-medium px-6 py-3">Valor</th>
                </tr>
              </thead>
              <tbody>
                {data.ultimas_transacoes.map((t, i) => (
                  <tr key={i} className="border-t border-border hover:bg-muted/40 transition-colors">
                    <td className="px-6 py-3 tabular-nums text-muted-foreground">
                      {new Date(t.data).toLocaleDateString("pt-BR", { timeZone: "UTC" })}
                    </td>
                    <td className="px-6 py-3 max-w-xs truncate">{t.descricao}</td>
                    <td className={`px-6 py-3 text-right font-medium tabular-nums ${t.tipo === "ENTRADA" ? "kpi-green" : "kpi-red"}`}>
                      {t.tipo === "ENTRADA" ? "+" : "-"}{fmtBRL(Math.abs(t.valor))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data && data.ultimas_transacoes.length === 0 && !isLoading && (
        <div className="text-center py-12 text-muted-foreground text-sm bg-card rounded-xl border border-border">
          Nenhuma transação encontrada para este mês. Solicite ao seu contador o upload dos extratos.
        </div>
      )}
    </div>
  );
};

export default Dashboard;
