import { useState, useEffect } from "react";
import { AlertTriangle, Building2, FileText, CheckCircle2, Loader2, TrendingDown } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useViewAs } from "@/contexts/ViewAsContext";
import { api } from "@/lib/api";
import { STATUS_DISTRIBUICAO, calcularIrDevido } from "@/lib/distribuicao";

interface AlertasData {
  retiradas_alerta: {
    id: string;
    mes_ref: string;
    valor_total: number;
    limite_isencao: number;
    ir_devido?: number;
    socio_nome: string;
    socio_cpf_mascara: string;
  }[];
  conciliacao_alerta: {
    mes_ref: string;
    percentual: number;
    diferenca: number;
    status: "AVISO" | "ALERTA";
  } | null;
}

interface DashboardData {
  total_entradas_real: number;
  total_faturado: number;
  conciliacao: { status: string; percentual_inconsistencia: number; diferenca: number } | null;
}

const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

const fmtMes = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });

const RiscoFiscal = () => {
  const { user } = useAuth();
  const { viewAs } = useViewAs();
  const [mes, setMes] = useState("");

  const empresaQueryId = user?.role === "CLIENTE"
    ? null
    : (viewAs?.empresaId ?? user?.empresa_id ?? null);
  const params = empresaQueryId ? `?empresa_id=${empresaQueryId}` : "";

  const { data: ultimoMesData } = useQuery<{ mes: string | null }>({
    queryKey: ["portal-ultimo-mes", user?.empresa_id],
    queryFn: () => api.get<{ mes: string | null }>(`/portal/ultimo-mes${params}`),
    enabled: !!user && mes === "",
    staleTime: Infinity,
  });

  useEffect(() => {
    if (ultimoMesData !== undefined && mes === "") {
      const d = new Date();
      const atual = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      setMes(ultimoMesData.mes ?? atual);
    }
  }, [ultimoMesData]);

  const { data: alertas, isLoading: loadingAlertas } = useQuery<AlertasData>({
    queryKey: ["portal-alertas", user?.empresa_id],
    queryFn: () => api.get<AlertasData>(`/portal/alertas${params}`),
    enabled: !!user,
  });

  const { data: dash, isLoading: loadingDash } = useQuery<DashboardData>({
    queryKey: ["portal-dashboard", mes, user?.empresa_id],
    queryFn: () => api.get<DashboardData>(`/portal/dashboard/${mes}${params}`),
    enabled: !!user && !!mes,
  });

  const isLoading = loadingAlertas || loadingDash || !mes;

  const entradasFinanceiras = dash?.total_entradas_real ?? 0;
  const faturamentoEmitido = dash?.total_faturado ?? 0;

  // Bug 2: usa dados do relatório auditado quando disponível; evita divergência entre badge e valor
  const conciliacao = dash?.conciliacao ?? null;
  const diferenca = conciliacao
    ? conciliacao.diferenca
    : entradasFinanceiras - faturamentoEmitido;
  const percentualRisco = conciliacao
    ? conciliacao.percentual_inconsistencia.toFixed(1)
    : entradasFinanceiras > 0
      ? ((diferenca / entradasFinanceiras) * 100).toFixed(1)
      : "0.0";

  const statusConciliacao = conciliacao?.status ?? null;
  const temRisco = diferenca > 0 && entradasFinanceiras > 0;

  return (
    <div className="space-y-6 max-w-5xl">
      <h1 className="text-2xl font-bold tracking-tight animate-reveal">
        Auditoria de Entradas vs Faturamento
      </h1>

      <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed animate-reveal">
        Comparativo entre os valores que entraram nas contas bancárias e maquininhas de cartão
        versus o total de notas fiscais emitidas no período.
      </p>

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 size={16} className="animate-spin" /> Carregando dados...
        </div>
      )}

      {!isLoading && (
        <>
          {/* Cards de comparação */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-card rounded-xl border border-border p-6 shadow-sm animate-reveal">
              <div className="flex items-center gap-3 mb-4">
                <div className="kpi-blue-bg p-2.5 rounded-lg">
                  <Building2 size={20} className="kpi-blue" />
                </div>
                <h3 className="font-semibold text-sm">Entradas Financeiras</h3>
              </div>
              <p className="text-3xl font-bold tabular-nums">{fmtBRL(entradasFinanceiras)}</p>
              <p className="text-xs text-muted-foreground mt-2">Bancos + Maquininhas de Cartão</p>
            </div>

            <div className="bg-card rounded-xl border border-border p-6 shadow-sm animate-reveal">
              <div className="flex items-center gap-3 mb-4">
                <div className="kpi-green-bg p-2.5 rounded-lg">
                  <FileText size={20} className="kpi-green" />
                </div>
                <h3 className="font-semibold text-sm">Faturamento Emitido</h3>
              </div>
              <p className="text-3xl font-bold tabular-nums">{fmtBRL(faturamentoEmitido)}</p>
              <p className="text-xs text-muted-foreground mt-2">Notas Fiscais do ERP</p>
            </div>
          </div>

          {/* Resultado */}
          {entradasFinanceiras === 0 ? (
            <div className="bg-card rounded-xl border border-border p-8 text-center text-muted-foreground text-sm">
              Sem dados de entradas para o mês atual. Solicite ao seu contador o upload dos extratos.
            </div>
          ) : temRisco ? (
            <div className="bg-card rounded-xl border-2 border-destructive/30 p-6 shadow-sm animate-reveal">
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="kpi-red-bg p-3 rounded-lg shrink-0 self-start">
                  <AlertTriangle size={24} className="kpi-red" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold">Diferença Não Faturada (Outras Receitas)</h3>
                  <div className="flex items-baseline gap-3 mt-2">
                    <span className="text-3xl font-bold kpi-red tabular-nums">
                      {fmtBRL(diferenca)}
                    </span>
                    <span className={`text-sm font-medium px-2.5 py-0.5 rounded-full ${
                      statusConciliacao === "OK" ? "kpi-green kpi-green-bg" :
                      statusConciliacao === "AVISO" ? "kpi-orange kpi-orange-bg" :
                      "kpi-red kpi-red-bg"
                    }`}>
                      {percentualRisco}% de risco
                    </span>
                  </div>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-border">
                <p className="text-sm text-muted-foreground leading-relaxed">
                  <strong className="text-foreground">Atenção:</strong> A Receita Federal cruza
                  automaticamente os dados de movimentação bancária, operadoras de cartão e notas
                  fiscais emitidas. Divergências podem levar sua empresa à malha fina.
                </p>
              </div>
            </div>
          ) : (
            <div className="bg-card rounded-xl border-2 border-green-200 p-6 shadow-sm animate-reveal">
              <div className="flex items-center gap-4">
                <div className="kpi-green-bg p-3 rounded-lg">
                  <CheckCircle2 size={24} className="kpi-green" />
                </div>
                <div>
                  <h3 className="font-semibold">Faturamento Dentro do Esperado</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Entradas e faturamento estão alinhados para este período.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Bug 8: alerta de conciliação do endpoint /alertas (estava sendo descartado) */}
          {alertas?.conciliacao_alerta && (
            <div className="bg-card rounded-xl border-2 border-orange-200 p-5 shadow-sm animate-reveal">
              <div className="flex items-center gap-3">
                <div className="kpi-orange-bg p-2.5 rounded-lg shrink-0">
                  <AlertTriangle size={18} className="kpi-orange" />
                </div>
                <div>
                  <p className="font-semibold text-sm">
                    Inconsistência Fiscal em {fmtMes(alertas.conciliacao_alerta.mes_ref)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Divergência de {fmtBRL(alertas.conciliacao_alerta.diferenca)} —{" "}
                    {alertas.conciliacao_alerta.percentual.toFixed(1)}% de inconsistência ·{" "}
                    Status:{" "}
                    <span className={`font-medium ${alertas.conciliacao_alerta.status === "ALERTA" ? "kpi-red" : "kpi-orange"}`}>
                      {alertas.conciliacao_alerta.status}
                    </span>
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Alertas de retiradas de sócios */}
          {alertas && alertas.retiradas_alerta.length > 0 && (
            <div className="bg-card rounded-xl border border-border shadow-sm animate-reveal">
              <div className="p-5 border-b border-border flex items-center gap-2">
                <TrendingDown size={16} className="kpi-orange" />
                <h3 className="font-semibold text-sm">Sócios em {STATUS_DISTRIBUICAO.TRIBUTADA}</h3>
              </div>
              <div className="divide-y divide-border">
                {alertas.retiradas_alerta.map((r) => {
                  const ir = r.ir_devido ?? calcularIrDevido(r.valor_total);
                  return (
                    <div key={r.id} className="p-4 flex items-center justify-between gap-4">
                      <div>
                        <p className="font-medium text-sm">{r.socio_nome}</p>
                        <p className="text-xs text-muted-foreground">
                          {r.socio_cpf_mascara} · {fmtMes(r.mes_ref)}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-semibold kpi-red tabular-nums">{fmtBRL(r.valor_total)}</p>
                        <p className="text-xs text-muted-foreground">IR devido: <span className="kpi-red font-medium">{fmtBRL(ir)}</span></p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default RiscoFiscal;
