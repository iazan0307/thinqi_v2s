import { useState, useCallback, useRef } from "react";
import {
  Upload, FileSpreadsheet, CreditCard, Landmark, X, Loader2,
  CheckCircle2, AlertCircle, FileText, Clock, XCircle, Calculator,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Pagination } from "@/components/Pagination";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

// ─── Upload queue types ───────────────────────────────────────────────────────

interface ArquivoStatus {
  id: string;
  nome_original: string;
  tamanho_bytes: number;
  status: "PENDENTE" | "PROCESSANDO" | "PROCESSADO" | "CONFIRMADO" | "ERRO";
  mensagem_erro?: string;
  _count?: { transacoes_bancarias: number };
}

type TipoUpload = "extrato" | "faturamento" | "cartao" | "estimativa";

// ─── History types ────────────────────────────────────────────────────────────

interface ArquivoHistorico {
  id: string;
  tipo: "OFX" | "CSV" | "PLANILHA";
  nome_original: string;
  tamanho_bytes: number;
  status: "PENDENTE" | "PROCESSANDO" | "CONFIRMADO" | "ERRO";
  uploaded_at: string;
  processado_at: string | null;
  mensagem_erro: string | null;
  empresa: { id: string; razao_social: string; cnpj: string } | null;
  uploader: { nome: string } | null;
}

interface ArquivosResponse {
  data: ArquivoHistorico[];
  meta: { total: number };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtBytes = (b: number) =>
  b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`;

const fmtDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("pt-BR", {
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      })
    : "—";

function QueueBadge({ status }: { status: ArquivoStatus["status"] }) {
  switch (status) {
    case "CONFIRMADO": return <Badge className="bg-[hsl(var(--kpi-green-bg))] text-[hsl(var(--kpi-green))] border-0 text-[10px]">Confirmado</Badge>;
    case "PROCESSADO": return <Badge className="bg-[hsl(var(--kpi-blue-bg))] text-[hsl(var(--kpi-blue))] border-0 text-[10px]">Processado</Badge>;
    case "PROCESSANDO": return <Badge className="bg-[hsl(var(--kpi-blue-bg))] text-[hsl(var(--kpi-blue))] border-0 text-[10px]">Processando…</Badge>;
    case "ERRO": return <Badge className="bg-[hsl(var(--kpi-red-bg))] text-[hsl(var(--kpi-red))] border-0 text-[10px]">Erro</Badge>;
    default: return <Badge variant="outline" className="text-[10px]">Na fila</Badge>;
  }
}

function HistBadge({ status, erro }: { status: ArquivoHistorico["status"]; erro: string | null }) {
  if (status === "CONFIRMADO")
    return <Badge className="bg-[hsl(var(--kpi-green-bg))] text-[hsl(var(--kpi-green))] border-0 gap-1"><CheckCircle2 size={11} /> Processado</Badge>;
  if (status === "ERRO")
    return <Badge className="bg-[hsl(var(--kpi-red-bg))] text-[hsl(var(--kpi-red))] border-0 gap-1" title={erro ?? ""}><XCircle size={11} /> Erro</Badge>;
  if (status === "PROCESSANDO")
    return <Badge className="bg-[hsl(var(--kpi-orange-bg))] text-[hsl(var(--kpi-orange))] border-0 gap-1"><Loader2 size={11} className="animate-spin" /> Processando</Badge>;
  return <Badge variant="outline" className="gap-1 text-muted-foreground"><Clock size={11} /> Pendente</Badge>;
}

// ─── DropZone ─────────────────────────────────────────────────────────────────

interface DropZoneProps {
  title: string;
  icon: React.ElementType;
  accept: string;
  description: string;
  tipo: TipoUpload;
  multiple?: boolean;
  onFiles: (files: File[], tipo: TipoUpload) => void;
}

const DropZone = ({ title, icon: Icon, accept, description, tipo, multiple, onFiles }: DropZoneProps) => {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); }, []);
  const handleDragLeave = useCallback(() => setIsDragging(false), []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) onFiles(multiple ? files : files.slice(0, 1), tipo);
  }, [onFiles, tipo, multiple]);

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={`border-2 border-dashed rounded-lg p-6 text-center transition-all cursor-pointer hover:border-primary/40 hover:bg-accent/50 ${isDragging ? "border-primary bg-accent" : "border-border"}`}
    >
      <input ref={inputRef} type="file" accept={accept} multiple={multiple} className="hidden"
        onChange={e => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) onFiles(files, tipo);
          if (inputRef.current) inputRef.current.value = "";
        }} />
      <div className="flex flex-col items-center gap-2">
        <div className="p-3 rounded-lg bg-accent">
          <Icon size={24} className="text-primary" />
        </div>
        <p className="font-medium text-sm">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
        <Badge variant="outline" className="text-[10px] mt-1">
          {accept.toUpperCase()}{multiple ? " · múltiplos" : ""}
        </Badge>
      </div>
    </div>
  );
};

// ─── Page ─────────────────────────────────────────────────────────────────────

type HistTab = "extratos" | "iazan";

const CentralUploads = () => {
  const qc = useQueryClient();

  // Empresa selecionada — compartilhada entre upload e filtro do histórico
  const [empresaId, setEmpresaId] = useState("");

  // Fila de processamento da sessão atual
  const [fila, setFila] = useState<ArquivoStatus[]>([]);

  // Modal mês de referência (faturamento IAZAN)
  const [showFatModal, setShowFatModal] = useState(false);
  const [pendingFatFile, setPendingFatFile] = useState<File | null>(null);
  const [mesRef, setMesRef] = useState("");

  // Modal mês de referência (estimativa de impostos PDF)
  const [showEstModal, setShowEstModal] = useState(false);
  const [pendingEstFile, setPendingEstFile] = useState<File | null>(null);
  const [estMesRef, setEstMesRef] = useState("");

  // Histórico
  const [histTab, setHistTab] = useState<HistTab>("extratos");
  const [histEmpresa, setHistEmpresa] = useState("same"); // "same" = usa empresaId do upload
  const [page, setPage] = useState(1);
  const LIMIT = 12;

  const { data: empresasData } = useQuery<EmpresasResponse>({
    queryKey: ["empresas"],
    queryFn: () => api.get<EmpresasResponse>("/empresas?limit=100"),
  });
  const empresas = empresasData?.data ?? [];

  // Empresa efetiva para o filtro do histórico
  const empresaFiltro = histEmpresa === "same" ? empresaId : histEmpresa === "all" ? "" : histEmpresa;

  const buildHistParams = () => {
    const p = new URLSearchParams({ limit: String(LIMIT), page: String(page) });
    if (empresaFiltro) p.set("empresa_id", empresaFiltro);
    if (histTab === "iazan") p.set("tipo", "PLANILHA");
    return p.toString();
  };

  const { data: histData, isLoading: histLoading } = useQuery<ArquivosResponse>({
    queryKey: ["admin-arquivos", histTab, empresaFiltro, page],
    queryFn: () => api.get<ArquivosResponse>(`/admin/arquivos?${buildHistParams()}`),
  });

  const histArquivos = (histData?.data ?? []).filter(a =>
    histTab === "iazan" ? a.tipo === "PLANILHA" : ["OFX", "CSV"].includes(a.tipo)
  );

  // ─── Uploads ───────────────────────────────────────────────────────────────

  const pollStatus = (id: string) => {
    const interval = setInterval(async () => {
      try {
        const status = await api.get<ArquivoStatus>(`/upload/status/${id}`);
        setFila(prev => prev.map(a => a.id === id ? status : a));
        if (["PROCESSADO", "CONFIRMADO", "ERRO"].includes(status.status)) {
          clearInterval(interval);
          qc.invalidateQueries({ queryKey: ["admin-arquivos"] });
          if (status.status === "PROCESSADO") {
            toast.success(`${status.nome_original}: ${status._count?.transacoes_bancarias ?? 0} transações detectadas`);
          }
        }
      } catch { clearInterval(interval); }
    }, 2000);
  };

  const uploadExtrato = useMutation({
    mutationFn: async (file: File) => {
      if (!empresaId) { toast.error("Selecione uma empresa primeiro"); return; }
      const fd = new FormData();
      fd.append("arquivo", file);
      fd.append("empresa_id", empresaId);
      return api.upload<ArquivoStatus>("/upload", fd);
    },
    onSuccess: (result) => {
      if (!result) return;
      setFila(prev => [result, ...prev]);
      toast.success("Upload iniciado! Processando…");
      pollStatus(result.id);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const uploadFaturamento = useMutation({
    mutationFn: async ({ file, mes }: { file: File; mes: string }) => {
      if (!empresaId) { toast.error("Selecione uma empresa primeiro"); return; }
      const fd = new FormData();
      fd.append("arquivo", file);
      fd.append("empresa_id", empresaId);
      fd.append("mes_ref", mes);
      return api.upload<{ meses_importados: number }>("/faturamento/upload", fd);
    },
    onSuccess: (result) => {
      if (!result) return;
      toast.success(`Faturamento importado: ${result.meses_importados} mês(es)`);
      qc.invalidateQueries({ queryKey: ["admin-arquivos"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const uploadEstimativa = useMutation({
    mutationFn: async ({ file, mes }: { file: File; mes: string }) => {
      if (!empresaId) { toast.error("Selecione uma empresa primeiro"); return; }
      const fd = new FormData();
      fd.append("arquivo", file);
      fd.append("empresa_id", empresaId);
      fd.append("mes_ref", mes);
      return api.upload<{ id: string; nome_original: string }>("/estimativa-imposto/upload", fd);
    },
    onSuccess: (result) => {
      if (!result) return;
      toast.success(`Estimativa de impostos enviada: ${result.nome_original}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const uploadCartao = useMutation({
    mutationFn: async (file: File) => {
      if (!empresaId) { toast.error("Selecione uma empresa primeiro"); return; }
      const fd = new FormData();
      fd.append("arquivo", file);
      fd.append("empresa_id", empresaId);
      return api.upload<{ adquirente: string; transacoes_importadas: number }>("/cartao/upload", fd);
    },
    onSuccess: (result) => {
      if (!result) return;
      toast.success(`${result.adquirente}: ${result.transacoes_importadas} transações importadas`);
      qc.invalidateQueries({ queryKey: ["admin-arquivos"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const confirmar = useMutation({
    mutationFn: (id: string) => api.post<ArquivoStatus>(`/upload/${id}/confirmar`),
    onSuccess: (result) => {
      setFila(prev => prev.map(a => a.id === result.id ? result : a));
      qc.invalidateQueries({ queryKey: ["retiradas"] });
      qc.invalidateQueries({ queryKey: ["admin-arquivos"] });
      toast.success("Retiradas consolidadas com sucesso!");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleFiles = (files: File[], tipo: TipoUpload) => {
    if (!empresaId) { toast.error("Selecione uma empresa primeiro"); return; }
    if (files.length === 0) return;

    if (tipo === "faturamento") {
      if (files.length > 1) {
        toast.info("Faturamento requer mês de referência — envie um arquivo por vez.");
      }
      setPendingFatFile(files[0]);
      setShowFatModal(true);
      return;
    }

    if (tipo === "estimativa") {
      if (files.length > 1) {
        toast.info("Estimativa de impostos requer mês de referência — envie um arquivo por vez.");
      }
      setPendingEstFile(files[0]);
      setShowEstModal(true);
      return;
    }

    if (files.length > 1) {
      toast.success(`Enviando ${files.length} arquivos em lote…`);
    }
    for (const file of files) {
      if (tipo === "extrato") uploadExtrato.mutate(file);
      else if (tipo === "cartao") uploadCartao.mutate(file);
    }
  };

  const confirmFaturamento = () => {
    if (!pendingFatFile || !mesRef) return;
    uploadFaturamento.mutate({ file: pendingFatFile, mes: mesRef });
    setShowFatModal(false);
    setPendingFatFile(null);
    setMesRef("");
  };

  const confirmEstimativa = () => {
    if (!pendingEstFile || !estMesRef) return;
    uploadEstimativa.mutate({ file: pendingEstFile, mes: estMesRef });
    setShowEstModal(false);
    setPendingEstFile(null);
    setEstMesRef("");
  };

  const handleHistTab = (v: string) => { setHistTab(v as HistTab); setPage(1); };
  const handleHistEmpresa = (v: string) => { setHistEmpresa(v); setPage(1); };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Central de Uploads</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Envie extratos e relatórios dos clientes e acompanhe o histórico completo de arquivos.
        </p>
      </div>

      {/* ── Empresa + drop zones ── */}
      <Card className="shadow-sm animate-reveal">
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <CardTitle className="text-lg">Novo Upload</CardTitle>
            <Select value={empresaId} onValueChange={v => { setEmpresaId(v); setHistEmpresa("same"); setPage(1); }}>
              <SelectTrigger className="w-full sm:w-[260px] h-9">
                <SelectValue placeholder="Selecione a empresa" />
              </SelectTrigger>
              <SelectContent>
                {empresas.map(e => (
                  <SelectItem key={e.id} value={e.id}>{e.razao_social}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <DropZone title="Extratos Bancários" icon={Landmark} accept=".ofx,.csv" multiple
              description="OFX ou CSV do banco" tipo="extrato" onFiles={handleFiles} />
            <DropZone title="Faturamento / Robô IAZAN" icon={FileSpreadsheet} accept=".xlsx,.csv"
              description="Notas fiscais e dados do ERP" tipo="faturamento" onFiles={handleFiles} />
            <DropZone title="Operadoras de Cartão" icon={CreditCard} accept=".csv,.xlsx" multiple
              description="Stone, Cielo, Rede, PagSeguro…" tipo="cartao" onFiles={handleFiles} />
            <DropZone title="Estimativa de Impostos" icon={Calculator} accept=".pdf"
              description="PDF mensal disponibilizado ao cliente" tipo="estimativa" onFiles={handleFiles} />
          </div>
        </CardContent>
      </Card>

      {/* ── Fila da sessão ── */}
      {fila.length > 0 && (
        <Card className="shadow-sm animate-reveal">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Upload size={15} /> Fila de Processamento
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {fila.map(arquivo => (
                <div key={arquivo.id} className="flex items-center gap-4 p-3 rounded-lg border border-border bg-muted/20">
                  <Upload size={15} className="text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm font-medium truncate">{arquivo.nome_original}</p>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="text-xs text-muted-foreground">{fmtBytes(arquivo.tamanho_bytes)}</span>
                        <QueueBadge status={arquivo.status} />
                        {arquivo.status === "PROCESSADO" && (
                          <Button size="sm" className="h-6 text-[10px] px-2"
                            onClick={() => confirmar.mutate(arquivo.id)}
                            disabled={confirmar.isPending}>
                            {confirmar.isPending ? <Loader2 size={10} className="animate-spin" /> : "Confirmar"}
                          </Button>
                        )}
                      </div>
                    </div>
                    {arquivo.status === "PROCESSANDO" && (
                      <Progress value={undefined} className="h-1.5 animate-pulse" />
                    )}
                    {arquivo.status === "PROCESSADO" && arquivo._count && (
                      <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                        <CheckCircle2 size={10} className="text-green-500" />
                        {arquivo._count.transacoes_bancarias} transações detectadas
                      </p>
                    )}
                    {arquivo.status === "ERRO" && arquivo.mensagem_erro && (
                      <p className="text-xs text-destructive mt-1 flex items-center gap-1">
                        <AlertCircle size={10} /> {arquivo.mensagem_erro}
                      </p>
                    )}
                  </div>
                  <button onClick={() => setFila(prev => prev.filter(a => a.id !== arquivo.id))}
                    className="text-muted-foreground hover:text-destructive transition-colors">
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Histórico ── */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <Tabs value={histTab} onValueChange={handleHistTab}>
            <TabsList>
              <TabsTrigger value="extratos" className="gap-2">
                <FileText size={13} /> Extratos bancários
              </TabsTrigger>
              <TabsTrigger value="iazan" className="gap-2">
                <FileSpreadsheet size={13} /> Robô IAZAN
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <Select value={histEmpresa} onValueChange={handleHistEmpresa}>
            <SelectTrigger className="w-full sm:w-[220px] h-9 ml-auto">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {empresaId && (
                <SelectItem value="same">
                  {empresas.find(e => e.id === empresaId)?.razao_social ?? "Empresa selecionada"}
                </SelectItem>
              )}
              <SelectItem value="all">Todas as empresas</SelectItem>
              {empresas.filter(e => e.id !== empresaId).map(e => (
                <SelectItem key={e.id} value={e.id}>{e.razao_social}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Card className="shadow-sm animate-reveal">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              {histTab === "iazan"
                ? <><FileSpreadsheet size={15} /> Planilhas do Robô IAZAN</>
                : <><FileText size={15} /> Extratos Bancários</>}
              {histData?.meta.total !== undefined && (
                <span className="text-muted-foreground font-normal text-sm">
                  ({histData.meta.total} arquivo{histData.meta.total !== 1 ? "s" : ""})
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {histLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm py-8 justify-center">
                <Loader2 size={16} className="animate-spin" /> Carregando…
              </div>
            ) : histArquivos.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">
                <AlertCircle size={28} className="mx-auto mb-3 opacity-30" />
                <p>Nenhum arquivo encontrado.</p>
                <p className="mt-1 text-xs">
                  {histTab === "iazan"
                    ? "Faça upload de uma planilha IAZAN acima."
                    : "Faça upload de um extrato OFX/CSV acima."}
                </p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Arquivo</TableHead>
                        <TableHead>Empresa</TableHead>
                        <TableHead className="text-center">Tipo</TableHead>
                        <TableHead className="text-center">Status</TableHead>
                        <TableHead className="text-right">Tamanho</TableHead>
                        <TableHead className="text-right">Enviado em</TableHead>
                        <TableHead>Por</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {histArquivos.map(a => (
                        <TableRow key={a.id}>
                          <TableCell className="font-medium max-w-[200px] truncate" title={a.nome_original}>
                            {a.nome_original}
                          </TableCell>
                          <TableCell className="text-sm">
                            {a.empresa?.razao_social ?? <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant="outline" className="text-xs font-mono">{a.tipo}</Badge>
                          </TableCell>
                          <TableCell className="text-center">
                            <HistBadge status={a.status} erro={a.mensagem_erro} />
                          </TableCell>
                          <TableCell className="text-right text-sm text-muted-foreground tabular-nums">
                            {fmtBytes(a.tamanho_bytes)}
                          </TableCell>
                          <TableCell className="text-right text-sm text-muted-foreground tabular-nums">
                            {fmtDate(a.uploaded_at)}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {a.uploader?.nome ?? "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {histData && (
                  <Pagination page={page} total={histData.meta.total} limit={LIMIT} onPage={setPage} />
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Modal mês de referência (estimativa de impostos) ── */}
      <Dialog open={showEstModal} onOpenChange={setShowEstModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Estimativa de Impostos</DialogTitle>
            <DialogDescription>
              Envia o PDF mensal da estimativa gerada externamente. O cliente poderá visualizar e baixar pelo portal.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>Arquivo selecionado</Label>
              <p className="text-sm text-muted-foreground">{pendingEstFile?.name}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="est_mes_ref">Mês de Referência</Label>
              <Input id="est_mes_ref" type="month" value={estMesRef} onChange={e => setEstMesRef(e.target.value)} />
              <p className="text-xs text-muted-foreground">
                Se já existir PDF cadastrado para este mês, será substituído.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowEstModal(false); setPendingEstFile(null); }}>
              Cancelar
            </Button>
            <Button onClick={confirmEstimativa} disabled={!estMesRef || uploadEstimativa.isPending}>
              {uploadEstimativa.isPending && <Loader2 size={14} className="animate-spin mr-1" />}
              Enviar Estimativa
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Modal mês de referência (faturamento) ── */}
      <Dialog open={showFatModal} onOpenChange={setShowFatModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mês de Referência</DialogTitle>
            <DialogDescription>
              Informe o mês/ano ao qual este faturamento se refere.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>Arquivo selecionado</Label>
              <p className="text-sm text-muted-foreground">{pendingFatFile?.name}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="mes_ref">Mês de Referência</Label>
              <Input id="mes_ref" type="month" value={mesRef} onChange={e => setMesRef(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowFatModal(false); setPendingFatFile(null); }}>
              Cancelar
            </Button>
            <Button onClick={confirmFaturamento} disabled={!mesRef || uploadFaturamento.isPending}>
              {uploadFaturamento.isPending && <Loader2 size={14} className="animate-spin mr-1" />}
              Importar Faturamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CentralUploads;
