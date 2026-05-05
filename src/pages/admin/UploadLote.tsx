/**
 * Upload em Lote Unificado — admin envia múltiplos arquivos misturados (OFX,
 * CSV, XLSX, PDF) e o backend identifica o tipo de cada um e o cliente pelo
 * CNPJ contido no próprio arquivo.
 *
 * Cartão NÃO é roteado por CNPJ (extratos de adquirente não trazem o CNPJ do
 * lojista de forma confiável) — quando o usuário envia um arquivo de cartão
 * pelo lote unificado, o handler tenta detectar; caso falhe, o item aparece
 * como erro com a mensagem "selecione uma empresa". Isso é a EXCEÇÃO
 * documentada no escopo do produto.
 */

import { useCallback, useRef, useState } from "react";
import { Upload, X, Loader2, CheckCircle2, AlertCircle, Download, RefreshCw, Info } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api";
import { toast } from "sonner";

// ─── Tipos ────────────────────────────────────────────────────────────────────

type TipoLote =
  | "extrato_ofx"
  | "extrato_csv"
  | "cartao"
  | "faturamento_iazan"
  | "estimativa_pdf"
  | "contracheque_pdf"
  | "desconhecido";

interface ItemResultado {
  nome_original: string;
  tamanho_bytes: number;
  tipo_detectado: TipoLote | null;
  status: "sucesso" | "erro";
  empresa_id: string | null;
  empresa_razao: string | null;
  detalhes: string;
  erro: string | null;
}

interface LoteResponse {
  total: number;
  sucesso: number;
  falha: number;
  resultados: ItemResultado[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ACEITOS = ".ofx,.csv,.xlsx,.xls,.pdf,.xml";
const MAX_FILES = 50;
const MAX_SIZE_MB = 20;

const fmtBytes = (b: number) =>
  b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`;

const labelTipo = (t: TipoLote | null): string => {
  switch (t) {
    case "extrato_ofx": return "Extrato OFX";
    case "extrato_csv": return "Extrato CSV";
    case "cartao": return "Cartão";
    case "faturamento_iazan": return "Faturamento (IAZAN)";
    case "estimativa_pdf": return "Estimativa de Impostos";
    case "contracheque_pdf": return "Contracheque";
    case "desconhecido": return "Desconhecido";
    default: return "—";
  }
};

function escapeCsv(s: string): string {
  // Escapa: aspas, vírgula, quebra de linha
  if (/[",\n\r;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadCSV(resultados: ItemResultado[]): void {
  const linhas = [
    ["Arquivo", "Tipo Detectado", "Cliente", "Status", "Detalhes / Erro"].map(escapeCsv).join(";"),
    ...resultados.map(r =>
      [
        r.nome_original,
        labelTipo(r.tipo_detectado),
        r.empresa_razao ?? "—",
        r.status === "sucesso" ? "Importado" : "Erro",
        r.detalhes,
      ].map(escapeCsv).join(";"),
    ),
  ];
  // BOM para o Excel reconhecer UTF-8
  const csv = "﻿" + linhas.join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `upload-lote-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── DropZone ─────────────────────────────────────────────────────────────────

interface DropZoneProps {
  onFiles: (files: File[]) => void;
  desabilitado: boolean;
}

const DropZone = ({ onFiles, desabilitado }: DropZoneProps) => {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (files: File[]) => {
    if (files.length === 0) return;
    if (files.length > MAX_FILES) {
      toast.error(`Limite de ${MAX_FILES} arquivos por lote`);
      return;
    }
    const grandes = files.filter(f => f.size > MAX_SIZE_MB * 1024 * 1024);
    if (grandes.length > 0) {
      toast.error(`${grandes.length} arquivo(s) acima de ${MAX_SIZE_MB}MB foram ignorados: ${grandes.map(f => f.name).join(", ")}`);
    }
    const validos = files.filter(f => f.size <= MAX_SIZE_MB * 1024 * 1024);
    if (validos.length > 0) onFiles(validos);
  };

  return (
    <div
      onDragOver={e => { e.preventDefault(); if (!desabilitado) setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={e => {
        e.preventDefault();
        setIsDragging(false);
        if (desabilitado) return;
        handleFiles(Array.from(e.dataTransfer.files));
      }}
      onClick={() => !desabilitado && inputRef.current?.click()}
      className={`border-2 border-dashed rounded-lg p-10 text-center transition-all ${desabilitado ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:border-primary/40 hover:bg-accent/50"} ${isDragging ? "border-primary bg-accent" : "border-border"}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACEITOS}
        multiple
        className="hidden"
        onChange={e => {
          const files = Array.from(e.target.files ?? []);
          handleFiles(files);
          if (inputRef.current) inputRef.current.value = "";
        }}
      />
      <div className="flex flex-col items-center gap-3">
        <div className="p-4 rounded-full bg-accent">
          <Upload size={32} className="text-primary" />
        </div>
        <div>
          <p className="font-medium text-base">Arraste arquivos ou clique para selecionar</p>
          <p className="text-sm text-muted-foreground mt-1">
            Aceita extratos OFX, CSV, planilhas XLSX e PDFs (estimativa, contracheque)
          </p>
        </div>
        <div className="flex flex-wrap gap-1 justify-center">
          {[".OFX", ".CSV", ".XLSX", ".PDF"].map(t => (
            <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Máx {MAX_FILES} arquivos · {MAX_SIZE_MB} MB cada
        </p>
      </div>
    </div>
  );
};

// ─── Página ───────────────────────────────────────────────────────────────────

const UploadLote = () => {
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [resultados, setResultados] = useState<ItemResultado[] | null>(null);

  const enviar = useMutation<LoteResponse, Error, File[]>({
    mutationFn: async (files: File[]) => {
      const fd = new FormData();
      for (const f of files) fd.append("arquivos", f);
      return api.upload<LoteResponse>("/upload-lote", fd);
    },
    onSuccess: (resp) => {
      setResultados(resp.resultados);
      setArquivos([]);
      if (resp.sucesso > 0) {
        toast.success(`${resp.sucesso} arquivo(s) processados com sucesso`);
      }
      if (resp.falha > 0) {
        toast.error(`${resp.falha} arquivo(s) com erro — confira a tabela de resultado`);
      }
    },
    onError: (err) => toast.error(err.message),
  });

  const handleFiles = useCallback((novos: File[]) => {
    setArquivos(prev => {
      // Deduplica por nome+tamanho — evita upload acidental do mesmo arquivo 2x
      const chave = (f: File) => `${f.name}|${f.size}`;
      const existentes = new Set(prev.map(chave));
      const adicionar = novos.filter(f => !existentes.has(chave(f)));
      const total = prev.length + adicionar.length;
      if (total > MAX_FILES) {
        toast.error(`Limite de ${MAX_FILES} arquivos no lote — ${total - MAX_FILES} arquivo(s) ignorado(s)`);
        return [...prev, ...adicionar.slice(0, MAX_FILES - prev.length)];
      }
      return [...prev, ...adicionar];
    });
  }, []);

  const removerArquivo = (idx: number) => {
    setArquivos(prev => prev.filter((_, i) => i !== idx));
  };

  const limparTudo = () => {
    setArquivos([]);
    setResultados(null);
  };

  const enviarLote = () => {
    if (arquivos.length === 0) {
      toast.error("Adicione arquivos antes de enviar");
      return;
    }
    enviar.mutate(arquivos);
  };

  const tentarNovamenteFalhas = () => {
    if (!resultados) return;
    const nomesFalhas = new Set(resultados.filter(r => r.status === "erro").map(r => r.nome_original));
    // Reabre a tela vazia — o usuário precisa selecionar de novo os arquivos.
    // Não temos como manter os File objects originais depois da resposta porque
    // o fetch consome o FormData; mostramos a lista por nome para orientar.
    setResultados(null);
    setArquivos([]);
    toast.info(
      `Re-selecione os ${nomesFalhas.size} arquivo(s) com erro: ${Array.from(nomesFalhas).slice(0, 3).join(", ")}${nomesFalhas.size > 3 ? "…" : ""}`,
      { duration: 8000 },
    );
  };

  // ─── Render ─────────────────────────────────────────────────────────────────

  const sucessos = resultados?.filter(r => r.status === "sucesso") ?? [];
  const erros = resultados?.filter(r => r.status === "erro") ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Upload em Lote</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Envie múltiplos arquivos de tipos diferentes — o sistema identifica o cliente
          automaticamente: <strong>OFX</strong> via BANKID+ACCTID (conta cadastrada),
          demais arquivos via CNPJ extraído do conteúdo.
        </p>
      </div>

      {/* Aviso sobre identificação */}
      <Card className="border-amber-200 bg-amber-50/50 dark:border-amber-900/40 dark:bg-amber-950/20 shadow-sm">
        <CardContent className="pt-4 pb-4 flex gap-3 items-start">
          <Info size={18} className="text-amber-600 dark:text-amber-500 shrink-0 mt-0.5" />
          <div className="text-sm space-y-1">
            <p className="font-medium text-amber-900 dark:text-amber-200">Antes de subir extratos OFX</p>
            <p className="text-amber-800/80 dark:text-amber-300/80">
              OFX brasileiro <em>não traz CNPJ</em> nas tags do header — a identificação acontece
              por BANKID+ACCTID. Cadastre cada conta em <strong>Empresas &amp; Sócios → Contas Bancárias</strong> antes
              do primeiro upload em lote.
            </p>
            <p className="text-amber-800/80 dark:text-amber-300/80 pt-1">
              Extratos de cartão (Cielo, Rede etc.) que não tragam o CNPJ do lojista continuam
              exigindo seleção manual via <strong>Central de Uploads</strong>.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Drop zone + lista pendente */}
      <Card className="shadow-sm animate-reveal">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Arquivos a enviar</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <DropZone onFiles={handleFiles} desabilitado={enviar.isPending} />

          {arquivos.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">
                  {arquivos.length} arquivo{arquivos.length !== 1 ? "s" : ""} selecionado{arquivos.length !== 1 ? "s" : ""}
                </p>
                <Button variant="ghost" size="sm" onClick={limparTudo} disabled={enviar.isPending}>
                  Limpar
                </Button>
              </div>
              <div className="border rounded-lg max-h-64 overflow-y-auto">
                {arquivos.map((f, idx) => (
                  <div
                    key={`${f.name}-${idx}`}
                    className="flex items-center gap-3 px-3 py-2 border-b last:border-b-0 text-sm"
                  >
                    <Upload size={13} className="text-muted-foreground shrink-0" />
                    <span className="flex-1 truncate" title={f.name}>{f.name}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">{fmtBytes(f.size)}</span>
                    <button
                      onClick={() => removerArquivo(idx)}
                      disabled={enviar.isPending}
                      className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-30"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
              <Button
                onClick={enviarLote}
                disabled={enviar.isPending || arquivos.length === 0}
                className="w-full"
              >
                {enviar.isPending ? (
                  <><Loader2 size={14} className="animate-spin mr-2" /> Processando lote…</>
                ) : (
                  <>Enviar {arquivos.length} arquivo{arquivos.length !== 1 ? "s" : ""}</>
                )}
              </Button>
              {enviar.isPending && (
                <Progress value={undefined} className="h-1.5 animate-pulse" />
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tabela de resultado */}
      {resultados && (
        <Card className="shadow-sm animate-reveal">
          <CardHeader className="pb-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <CardTitle className="text-lg flex items-center gap-3">
                Resultado do lote
                <Badge variant="outline" className="font-normal">
                  {resultados.length} arquivo{resultados.length !== 1 ? "s" : ""}
                </Badge>
                {sucessos.length > 0 && (
                  <Badge className="bg-[hsl(var(--kpi-green-bg))] text-[hsl(var(--kpi-green))] border-0 gap-1">
                    <CheckCircle2 size={11} /> {sucessos.length} sucesso
                  </Badge>
                )}
                {erros.length > 0 && (
                  <Badge className="bg-[hsl(var(--kpi-red-bg))] text-[hsl(var(--kpi-red))] border-0 gap-1">
                    <AlertCircle size={11} /> {erros.length} erro{erros.length !== 1 ? "s" : ""}
                  </Badge>
                )}
              </CardTitle>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => downloadCSV(resultados)} className="gap-2">
                  <Download size={13} /> Baixar relatório
                </Button>
                {erros.length > 0 && (
                  <Button variant="outline" size="sm" onClick={tentarNovamenteFalhas} className="gap-2">
                    <RefreshCw size={13} /> Tentar novamente
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Arquivo</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Cliente Identificado</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    <TableHead>Detalhes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {resultados.map((r, idx) => (
                    <TableRow key={`${r.nome_original}-${idx}`}>
                      <TableCell className="font-medium max-w-[240px] truncate" title={r.nome_original}>
                        {r.nome_original}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs font-mono">
                          {labelTipo(r.tipo_detectado)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {r.empresa_razao ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-center">
                        {r.status === "sucesso" ? (
                          <Badge className="bg-[hsl(var(--kpi-green-bg))] text-[hsl(var(--kpi-green))] border-0 gap-1">
                            <CheckCircle2 size={11} /> Importado
                          </Badge>
                        ) : (
                          <Badge className="bg-[hsl(var(--kpi-red-bg))] text-[hsl(var(--kpi-red))] border-0 gap-1">
                            <AlertCircle size={11} /> Erro
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[360px]">
                        {r.detalhes}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default UploadLote;
