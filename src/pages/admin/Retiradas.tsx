import { useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Download, TrendingDown } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Pagination } from "@/components/Pagination";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { STATUS_DISTRIBUICAO, calcularIrDevido } from "@/lib/distribuicao";

interface Empresa { id: string; razao_social: string }
interface EmpresasResponse { data: Empresa[] }

interface Retirada {
  id: string;
  mes_ref: string;
  valor_total: number;
  qtd_transferencias: number;
  alerta_limite: boolean;
  ir_devido?: number;
  status_distribuicao?: string;
  socio: { nome: string; cpf_mascara: string };
  empresa: { razao_social: string };
}

interface RetiradasResponse {
  data: Retirada[];
  meta: { total: number; pages: number };
}

const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

const fmtMes = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });

// Gera lista de meses: mês atual e 11 anteriores
function gerarMeses() {
  const meses = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(now.getFullYear(), now.getMonth() - i, 1));
    const val = d.toISOString().slice(0, 7); // "YYYY-MM"
    const label = d.toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
    meses.push({ val, label });
  }
  return meses;
}
const MESES = gerarMeses();

const Retiradas = () => {
  const [empresaFiltro, setEmpresaFiltro] = useState("all");
  const [mesFiltro, setMesFiltro]         = useState("all");
  const [alertaFiltro, setAlertaFiltro]   = useState("all");
  const [page, setPage] = useState(1);
  const LIMIT = 15;

  const { data: empresasData } = useQuery<EmpresasResponse>({
    queryKey: ["empresas"],
    queryFn: () => api.get<EmpresasResponse>("/empresas?limit=100"),
  });
  const empresas = empresasData?.data ?? [];

  const buildParams = () => {
    const p = new URLSearchParams({ limit: String(LIMIT), page: String(page) });
    if (empresaFiltro !== "all") p.set("empresa_id", empresaFiltro);
    if (mesFiltro !== "all")     p.set("mes_ref", `${mesFiltro}-01`);
    if (alertaFiltro !== "all")  p.set("alerta_limite", alertaFiltro);
    return p.toString();
  };

  const { data, isLoading } = useQuery<RetiradasResponse>({
    queryKey: ["retiradas-admin", empresaFiltro, mesFiltro, alertaFiltro, page],
    queryFn: () => api.get<RetiradasResponse>(`/retiradas?${buildParams()}`),
  });
  const retiradas = data?.data ?? [];

  const totalAlertas = retiradas.filter(r => r.alerta_limite).length;

  const exportXLSX = () => {
    const p = new URLSearchParams();
    if (empresaFiltro !== "all") p.set("empresa_id", empresaFiltro);
    if (mesFiltro !== "all")     p.set("mes_ref", `${mesFiltro}-01`);
    if (alertaFiltro !== "all")  p.set("alerta_limite", alertaFiltro);

    api.downloadBlob(`/retiradas/export/xlsx?${p}`)
      .then(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "retiradas_socios.xlsx";
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch(() => toast.error("Erro ao exportar Excel"));
  };

  const handleFilter = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Distribuição de Lucros</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Monitoramento de retiradas de sócios por empresa — alertas de limite de isenção.
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={exportXLSX}>
          <Download size={14} /> Exportar Excel
        </Button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3">
        <Select value={empresaFiltro} onValueChange={handleFilter(setEmpresaFiltro)}>
          <SelectTrigger className="w-full sm:w-[220px] h-9">
            <SelectValue placeholder="Todas as empresas" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as empresas</SelectItem>
            {empresas.map(e => (
              <SelectItem key={e.id} value={e.id}>{e.razao_social}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={mesFiltro} onValueChange={handleFilter(setMesFiltro)}>
          <SelectTrigger className="w-full sm:w-[200px] h-9">
            <SelectValue placeholder="Todos os meses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os meses</SelectItem>
            {MESES.map(m => (
              <SelectItem key={m.val} value={m.val} className="capitalize">{m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={alertaFiltro} onValueChange={handleFilter(setAlertaFiltro)}>
          <SelectTrigger className="w-full sm:w-[220px] h-9">
            <SelectValue placeholder="Todos os status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            <SelectItem value="true">Somente {STATUS_DISTRIBUICAO.TRIBUTADA}</SelectItem>
            <SelectItem value="false">Somente {STATUS_DISTRIBUICAO.ISENTA}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Card de distribuições tributadas na página atual */}
      {totalAlertas > 0 && (
        <div className="flex items-start gap-3 bg-[hsl(var(--kpi-red-bg))] border border-[hsl(var(--kpi-red))]/20 rounded-lg p-4">
          <AlertTriangle size={18} className="text-[hsl(var(--kpi-red))] shrink-0 mt-0.5" />
          <p className="text-sm text-[hsl(var(--kpi-red))]">
            <strong>{totalAlertas} sócio{totalAlertas > 1 ? "s" : ""}</strong> em {STATUS_DISTRIBUICAO.TRIBUTADA.toLowerCase()} nesta página.
          </p>
        </div>
      )}

      <Card className="shadow-sm animate-reveal">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <TrendingDown size={16} /> Retiradas de Sócios
            {data && (
              <span className="text-muted-foreground font-normal text-sm">
                ({data.meta.total} registros)
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm py-8 justify-center">
              <Loader2 size={16} className="animate-spin" /> Carregando...
            </div>
          ) : retiradas.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              <p>Nenhuma retirada encontrada para os filtros selecionados.</p>
              <p className="mt-1">Faça upload de extratos bancários para processar as retiradas.</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Empresa</TableHead>
                      <TableHead>Sócio</TableHead>
                      <TableHead className="hidden sm:table-cell">CPF</TableHead>
                      <TableHead className="hidden md:table-cell">Mês</TableHead>
                      <TableHead className="text-right">Retiradas</TableHead>
                      <TableHead className="text-right">IR Devido</TableHead>
                      <TableHead className="text-center hidden sm:table-cell">Transferências</TableHead>
                      <TableHead className="text-center">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {retiradas.map((r) => {
                      const valor = Number(r.valor_total);
                      const ir = r.ir_devido ?? calcularIrDevido(valor);
                      return (
                        <TableRow key={r.id} className={r.alerta_limite ? "bg-[hsl(var(--kpi-red-bg))]/40" : ""}>
                          <TableCell className="text-sm font-medium">{r.empresa.razao_social}</TableCell>
                          <TableCell className="font-medium">{r.socio.nome}</TableCell>
                          <TableCell className="hidden sm:table-cell text-muted-foreground text-sm tabular-nums">
                            {r.socio.cpf_mascara}
                          </TableCell>
                          <TableCell className="hidden md:table-cell text-muted-foreground text-sm capitalize">
                            {fmtMes(r.mes_ref)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-semibold">
                            {fmtBRL(valor)}
                          </TableCell>
                          <TableCell className={`text-right tabular-nums ${ir > 0 ? "text-[hsl(var(--kpi-red))] font-semibold" : "text-muted-foreground"}`}>
                            {ir > 0 ? fmtBRL(ir) : "Isento"}
                          </TableCell>
                          <TableCell className="text-center hidden sm:table-cell text-muted-foreground text-sm">
                            {r.qtd_transferencias}x
                          </TableCell>
                          <TableCell className="text-center">
                            {!r.alerta_limite ? (
                              <Badge className="bg-[hsl(var(--kpi-green-bg))] text-[hsl(var(--kpi-green))] border-0 gap-1">
                                <CheckCircle2 size={11} /> {STATUS_DISTRIBUICAO.ISENTA}
                              </Badge>
                            ) : (
                              <Badge className="bg-[hsl(var(--kpi-red-bg))] text-[hsl(var(--kpi-red))] border-0 gap-1">
                                <AlertTriangle size={11} /> {STATUS_DISTRIBUICAO.TRIBUTADA}
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              {data && (
                <Pagination page={page} total={data.meta.total} limit={LIMIT} onPage={setPage} />
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Retiradas;
