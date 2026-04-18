import { Building2, FileCheck, ShieldAlert, Users, Loader2, AlertTriangle, TrendingDown } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api";
import { STATUS_DISTRIBUICAO, calcularIrDevido } from "@/lib/distribuicao";

interface EmpresasResponse {
  meta: { total: number };
}

interface Retirada {
  id: string;
  mes_ref: string;
  valor_total: number;
  ir_devido?: number;
  alerta_limite: boolean;
  socio: { nome: string; cpf_mascara: string };
  empresa: { razao_social: string };
}

interface RetiradasResponse {
  data: Retirada[];
  meta: { total: number };
}

interface Relatorio {
  id: string;
  mes_ref: string;
  total_entradas: number;
  diferenca: number;
  percentual_inconsistencia: number;
  status: "OK" | "AVISO" | "ALERTA";
  empresa: { id: string; razao_social: string; cnpj: string };
}

interface RelatoriosResponse {
  data: Relatorio[];
  meta: { total: number };
}

const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

const fmtMes = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { month: "short", year: "numeric", timeZone: "UTC" });

const AdminDashboard = () => {
  const nav = useNavigate();

  const { data: empresas } = useQuery<EmpresasResponse>({
    queryKey: ["empresas-count"],
    queryFn: () => api.get<EmpresasResponse>("/empresas?limit=1"),
  });

  const { data: tributadas, isLoading: loadingTrib } = useQuery<RetiradasResponse>({
    queryKey: ["retiradas-tributadas"],
    queryFn: () => api.get<RetiradasResponse>("/retiradas?alerta_limite=true&limit=10"),
  });

  const { data: risco, isLoading: loadingRisco } = useQuery<RelatoriosResponse>({
    queryKey: ["relatorios-risco"],
    queryFn: () => api.get<RelatoriosResponse>("/relatorio-desconforto?status=ALERTA&limit=10"),
  });

  const totalEmpresas = empresas?.meta.total ?? 0;
  const totalTributadas = tributadas?.meta.total ?? 0;
  const totalRisco = risco?.meta.total ?? 0;
  const retiradas = tributadas?.data ?? [];
  const relatoriosRisco = risco?.data ?? [];

  const kpis = [
    {
      title: "Empresas Ativas",
      value: String(totalEmpresas),
      icon: Building2,
      colorClass: "kpi-blue", bgClass: "kpi-blue-bg",
      onClick: () => nav("/admin/empresas"),
    },
    {
      title: `Sócios em ${STATUS_DISTRIBUICAO.TRIBUTADA}`,
      value: String(totalTributadas),
      icon: Users,
      colorClass: "kpi-orange", bgClass: "kpi-orange-bg",
      onClick: () => nav("/admin/retiradas?alerta_limite=true"),
    },
    {
      title: "Empresas Risco Alto",
      value: String(totalRisco),
      icon: ShieldAlert,
      colorClass: "kpi-red", bgClass: "kpi-red-bg",
      onClick: () => nav("/admin/relatorios?status=ALERTA"),
    },
    {
      title: "Relatórios Gerados",
      value: "—", subtitle: "últimos 30 dias",
      icon: FileCheck,
      colorClass: "kpi-green", bgClass: "kpi-green-bg",
      onClick: () => nav("/admin/relatorios"),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Visão Geral</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Indicadores prioritários — clique nos cards para abrir o módulo relacionado.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 animate-reveal">
        {kpis.map((kpi) => (
          <Card
            key={kpi.title}
            role="button"
            tabIndex={0}
            onClick={kpi.onClick}
            onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); kpi.onClick(); } }}
            className="shadow-sm cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{kpi.title}</p>
                  <p className={`text-3xl font-bold mt-1 ${kpi.colorClass}`}>{kpi.value}</p>
                  {kpi.subtitle && <p className="text-xs text-muted-foreground mt-0.5">{kpi.subtitle}</p>}
                </div>
                <div className={`p-2.5 rounded-lg ${kpi.bgClass}`}>
                  <kpi.icon size={20} className={kpi.colorClass} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="shadow-sm animate-reveal" style={{ animationDelay: "100ms" }}>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <TrendingDown size={16} className="kpi-orange" />
              Sócios em {STATUS_DISTRIBUICAO.TRIBUTADA}
              {totalTributadas > 0 && (
                <Badge variant="outline" className="ml-1">{totalTributadas}</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingTrib ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
                <Loader2 size={14} className="animate-spin" /> Carregando...
              </div>
            ) : retiradas.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                Nenhum sócio em distribuição tributada no momento.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sócio</TableHead>
                    <TableHead>Empresa</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead className="text-right">IR</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {retiradas.map(r => {
                    const valor = Number(r.valor_total);
                    const ir = r.ir_devido ?? calcularIrDevido(valor);
                    return (
                      <TableRow
                        key={r.id}
                        className="cursor-pointer hover:bg-muted/40"
                        onClick={() => nav("/admin/retiradas")}
                      >
                        <TableCell className="font-medium">{r.socio.nome}</TableCell>
                        <TableCell className="text-muted-foreground text-sm truncate max-w-[160px]">
                          {r.empresa.razao_social}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-semibold">
                          {fmtBRL(valor)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums kpi-red font-semibold">
                          {fmtBRL(ir)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm animate-reveal" style={{ animationDelay: "150ms" }}>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <AlertTriangle size={16} className="kpi-red" />
              Empresas com Risco Fiscal Alto
              {totalRisco > 0 && (
                <Badge variant="outline" className="ml-1">{totalRisco}</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingRisco ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
                <Loader2 size={14} className="animate-spin" /> Carregando...
              </div>
            ) : relatoriosRisco.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                Nenhuma empresa com risco fiscal alto no momento.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Empresa</TableHead>
                    <TableHead>Período</TableHead>
                    <TableHead className="text-right">Diferença</TableHead>
                    <TableHead className="text-right">% Risco</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {relatoriosRisco.map(r => (
                    <TableRow
                      key={r.id}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => nav("/admin/relatorios")}
                    >
                      <TableCell className="font-medium">{r.empresa.razao_social}</TableCell>
                      <TableCell className="text-muted-foreground text-sm capitalize">
                        {fmtMes(r.mes_ref)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums kpi-red font-semibold">
                        {fmtBRL(Number(r.diferenca))}
                      </TableCell>
                      <TableCell className="text-right tabular-nums kpi-red font-semibold">
                        {Number(r.percentual_inconsistencia).toFixed(1)}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default AdminDashboard;
