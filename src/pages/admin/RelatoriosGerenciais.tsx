import { useState } from "react";
import { Download, Mail, Loader2, RefreshCw, AlertCircle, CheckCircle2, AlertTriangle, Archive } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Pagination } from "@/components/Pagination";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api";
import { toast } from "sonner";

interface Empresa { id: string; razao_social: string }
interface EmpresasResponse { data: Empresa[] }

interface Relatorio {
  id: string;
  empresa_id: string;
  mes_ref: string;
  total_entradas: number;
  total_faturado: number;
  total_cartao: number;
  diferenca: number;
  percentual_inconsistencia: number;
  status: "OK" | "AVISO" | "ALERTA";
  enviado_em: string | null;
  created_at: string;
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

function gerarMeses() {
  const out: { val: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(now.getFullYear(), now.getMonth() - i, 1));
    out.push({
      val: d.toISOString().slice(0, 7),
      label: d.toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }),
    });
  }
  return out;
}
const MESES = gerarMeses();

const statusBadge = (status: "OK" | "AVISO" | "ALERTA", pct: number) => {
  const pctStr = `${Number(pct).toFixed(1)}%`;
  if (status === "OK")
    return (
      <Badge className="bg-[hsl(var(--kpi-green-bg))] text-[hsl(var(--kpi-green))] border-0 gap-1 tabular-nums">
        <CheckCircle2 size={11} /> {pctStr}
      </Badge>
    );
  if (status === "AVISO")
    return (
      <Badge className="bg-[hsl(var(--kpi-orange-bg))] text-[hsl(var(--kpi-orange))] border-0 gap-1 tabular-nums">
        <AlertTriangle size={11} /> {pctStr}
      </Badge>
    );
  return (
    <Badge className="bg-[hsl(var(--kpi-red-bg))] text-[hsl(var(--kpi-red))] border-0 gap-1 tabular-nums">
      <AlertCircle size={11} /> {pctStr}
    </Badge>
  );
};

const RelatoriosGerenciais = () => {
  const [empresaFiltro, setEmpresaFiltro] = useState<string>("all");
  const [statusFiltro, setStatusFiltro] = useState<string>("all");
  const [mesFiltro, setMesFiltro] = useState<string>("all");
  const [page, setPage] = useState(1);
  const LIMIT = 10;
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailTarget, setEmailTarget] = useState<Relatorio | null>(null);
  const [emailDest, setEmailDest] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [zipLoading, setZipLoading] = useState(false);

  const { data: empresasData } = useQuery<EmpresasResponse>({
    queryKey: ["empresas"],
    queryFn: () => api.get<EmpresasResponse>("/empresas?limit=100"),
  });
  const empresas = empresasData?.data ?? [];

  const queryParams = new URLSearchParams({ limit: String(LIMIT), page: String(page) });
  if (empresaFiltro && empresaFiltro !== "all") queryParams.set("empresa_id", empresaFiltro);
  if (statusFiltro && statusFiltro !== "all") queryParams.set("status", statusFiltro);
  if (mesFiltro && mesFiltro !== "all") queryParams.set("mes_ref", mesFiltro);

  const { data, isLoading, refetch } = useQuery<RelatoriosResponse>({
    queryKey: ["relatorios", empresaFiltro, statusFiltro, mesFiltro, page],
    queryFn: () => api.get<RelatoriosResponse>(`/relatorio-desconforto?${queryParams}`),
  });

  const relatorios = data?.data ?? [];

  const downloadPDF = (id: string, mes: string) => {
    api.downloadBlob(`/relatorio-desconforto/${id}/pdf`)
      .then(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `relatorio_${mes}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch(() => toast.error("Erro ao baixar PDF"));
  };

  const enviarEmail = useMutation({
    mutationFn: ({ id, email }: { id: string; email: string }) =>
      api.post(`/relatorio-desconforto/${id}/enviar`, { email }),
    onSuccess: () => {
      toast.success(`Relatório enviado para ${emailDest}`);
      setShowEmailModal(false);
      setEmailTarget(null);
      setEmailDest("");
      refetch();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const openEmail = (rel: Relatorio) => {
    setEmailTarget(rel);
    setShowEmailModal(true);
  };

  const toggleRow = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const togglePage = () => {
    const pageIds = relatorios.map(r => r.id);
    const allSelected = pageIds.every(id => selectedIds.has(id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSelected) pageIds.forEach(id => next.delete(id));
      else pageIds.forEach(id => next.add(id));
      return next;
    });
  };

  const downloadZip = async () => {
    if (selectedIds.size === 0) return;
    setZipLoading(true);
    try {
      const ids = Array.from(selectedIds).join(",");
      const blob = await api.downloadBlob(`/relatorio-desconforto/export-zip?ids=${ids}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `thinqi_relatorios_${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`${selectedIds.size} relatório(s) baixados em ZIP`);
      setSelectedIds(new Set());
    } catch {
      toast.error("Erro ao gerar ZIP");
    } finally {
      setZipLoading(false);
    }
  };

  const downloadAllMonth = async () => {
    if (mesFiltro === "all") {
      toast.info("Selecione um mês para baixar todos os relatórios.");
      return;
    }
    setZipLoading(true);
    try {
      const lp = new URLSearchParams({ limit: "500", page: "1", mes_ref: mesFiltro });
      if (empresaFiltro !== "all") lp.set("empresa_id", empresaFiltro);
      if (statusFiltro !== "all") lp.set("status", statusFiltro);

      const lista = await api.get<RelatoriosResponse>(`/relatorio-desconforto?${lp}`);
      const ids = lista.data.map(r => r.id);
      if (ids.length === 0) {
        toast.info("Nenhum relatório encontrado para o mês selecionado.");
        return;
      }

      const blob = await api.downloadBlob(`/relatorio-desconforto/export-zip?ids=${ids.join(",")}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `thinqi_relatorios_${mesFiltro}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`${ids.length} relatório(s) de ${mesFiltro} baixados em ZIP`);
    } catch {
      toast.error("Erro ao gerar ZIP do mês");
    } finally {
      setZipLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Relatórios Gerenciais</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Consolidado de auditoria fiscal — Motor de Desconforto.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <Button size="sm" className="gap-2" onClick={downloadZip} disabled={zipLoading}>
              {zipLoading ? <Loader2 size={14} className="animate-spin" /> : <Archive size={14} />}
              Baixar ZIP ({selectedIds.size})
            </Button>
          )}
          {selectedIds.size === 0 && mesFiltro !== "all" && (
            <Button size="sm" className="gap-2" onClick={downloadAllMonth} disabled={zipLoading}>
              {zipLoading ? <Loader2 size={14} className="animate-spin" /> : <Archive size={14} />}
              Baixar todos os relatórios do mês
            </Button>
          )}
          <Button variant="outline" size="sm" className="gap-2" onClick={() => refetch()}>
            <RefreshCw size={14} />
            Atualizar
          </Button>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-3">
        <Select value={empresaFiltro} onValueChange={v => { setEmpresaFiltro(v); setPage(1); }}>
          <SelectTrigger className="w-full sm:w-[240px] h-9">
            <SelectValue placeholder="Todas as empresas" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as empresas</SelectItem>
            {empresas.map(e => (
              <SelectItem key={e.id} value={e.id}>{e.razao_social}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFiltro} onValueChange={v => { setStatusFiltro(v); setPage(1); }}>
          <SelectTrigger className="w-full sm:w-[180px] h-9">
            <SelectValue placeholder="Todos os status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            <SelectItem value="OK">OK (≤ 2%)</SelectItem>
            <SelectItem value="AVISO">Atenção (2-5%)</SelectItem>
            <SelectItem value="ALERTA">Alerta (&gt; 5%)</SelectItem>
          </SelectContent>
        </Select>
        <Select value={mesFiltro} onValueChange={v => { setMesFiltro(v); setPage(1); }}>
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
      </div>

      <Card className="shadow-sm animate-reveal">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">
            Relatórios de Desconforto Financeiro
            {data?.meta.total !== undefined && (
              <span className="text-muted-foreground font-normal text-sm ml-2">
                ({data.meta.total} total)
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm py-8 justify-center">
              <Loader2 size={16} className="animate-spin" /> Carregando relatórios...
            </div>
          ) : data && relatorios.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              <p className="mb-2">Nenhum relatório gerado ainda.</p>
              <p>Acesse <span className="font-medium">Conciliação Fiscal</span> para gerar relatórios.</p>
            </div>
          ) : (
            <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={relatorios.length > 0 && relatorios.every(r => selectedIds.has(r.id))}
                        onCheckedChange={togglePage}
                        aria-label="Selecionar todos"
                      />
                    </TableHead>
                    <TableHead>Empresa</TableHead>
                    <TableHead>Período</TableHead>
                    <TableHead className="text-right">Entradas Reais</TableHead>
                    <TableHead className="text-right">Faturamento</TableHead>
                    <TableHead className="text-right">Diferença</TableHead>
                    <TableHead className="text-center">% Risco</TableHead>
                    <TableHead className="text-center">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {relatorios.map((rel) => {
                    const mesSlug = new Date(rel.mes_ref).toISOString().slice(0, 7);
                    return (
                      <TableRow key={rel.id} data-state={selectedIds.has(rel.id) ? "selected" : undefined}>
                        <TableCell>
                          <Checkbox
                            checked={selectedIds.has(rel.id)}
                            onCheckedChange={() => toggleRow(rel.id)}
                            aria-label={`Selecionar ${rel.empresa.razao_social}`}
                          />
                        </TableCell>
                        <TableCell className="font-medium">{rel.empresa.razao_social}</TableCell>
                        <TableCell className="capitalize text-muted-foreground">{fmtMes(rel.mes_ref)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtBRL(Number(rel.total_entradas))}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtBRL(Number(rel.total_faturado))}</TableCell>
                        <TableCell className="text-right tabular-nums font-semibold text-destructive">
                          {fmtBRL(Number(rel.diferenca))}
                        </TableCell>
                        <TableCell className="text-center">
                          {statusBadge(rel.status, Number(rel.percentual_inconsistencia))}
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1 text-xs h-7 px-2"
                              onClick={() => downloadPDF(rel.id, mesSlug)}
                            >
                              <Download size={11} />
                              PDF
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1 text-xs h-7 px-2"
                              onClick={() => openEmail(rel)}
                            >
                              <Mail size={11} />
                              {rel.enviado_em ? "Reenviar" : "Enviar"}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            {data && (
              <Pagination
                page={page}
                total={data.meta.total}
                limit={LIMIT}
                onPage={setPage}
              />
            )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Modal envio e-mail */}
      <Dialog open={showEmailModal} onOpenChange={setShowEmailModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enviar Relatório por E-mail</DialogTitle>
            <DialogDescription>
              {emailTarget && (
                <>
                  <strong>{emailTarget.empresa.razao_social}</strong> — {fmtMes(emailTarget.mes_ref)}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label>E-mail do destinatário</Label>
              <Input
                type="email"
                placeholder="cliente@empresa.com.br"
                value={emailDest}
                onChange={e => setEmailDest(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEmailModal(false)}>Cancelar</Button>
            <Button
              onClick={() => emailTarget && enviarEmail.mutate({ id: emailTarget.id, email: emailDest })}
              disabled={!emailDest || enviarEmail.isPending}
            >
              {enviarEmail.isPending && <Loader2 size={14} className="animate-spin mr-1" />}
              Enviar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default RelatoriosGerenciais;
