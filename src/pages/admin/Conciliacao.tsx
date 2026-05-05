import { useState } from "react";
import { Calculator, CheckCircle2, AlertTriangle, AlertCircle, Download, Mail, Loader2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { toast } from "sonner";

interface Empresa { id: string; razao_social: string; cnpj: string }
interface EmpresasResponse { data: Empresa[] }

interface ResultadoConciliacao {
  empresa_id: string;
  mes_ref: string;
  total_faturado: number;
  total_entradas_banco: number;
  total_aporte_socios: number;
  total_recebimentos_cartao: number;
  total_rendimento_aplicacao: number;
  total_resgate_aplicacao: number;
  total_vendas_cartao: number;
  total_entradas_real: number;
  // Aliases legados
  total_banco: number;
  total_socios_banco: number;
  total_cartao: number;
  total_entradas: number;
  diferenca: number;
  percentual_inconsistencia: number;
  status: "OK" | "AVISO" | "ALERTA";
}

interface GerarResponse { id: string; pdf_gerado: boolean }

const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

const fmtPct = (v: number) => `${Number(v).toFixed(2)}%`;

const fmtMes = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });

const STATUS_CONFIG = {
  OK: { label: "Dentro do limite (≤ 2%)", icon: CheckCircle2, color: "bg-[hsl(var(--kpi-green-bg))] text-[hsl(var(--kpi-green))]" },
  AVISO: { label: "Atenção (2% a 5%)", icon: AlertTriangle, color: "bg-[hsl(var(--kpi-orange-bg))] text-[hsl(var(--kpi-orange))]" },
  ALERTA: { label: "Risco fiscal alto (> 5%)", icon: AlertCircle, color: "bg-[hsl(var(--kpi-red-bg))] text-[hsl(var(--kpi-red))]" },
};

function LinhaValor({ label, value, destaque, negativo }: { label: string; value: string; destaque?: boolean; negativo?: boolean }) {
  return (
    <div className={`flex justify-between items-center py-3 px-4 ${destaque ? "bg-muted/50 rounded-lg" : "border-b border-border last:border-0"}`}>
      <span className={`text-sm ${destaque ? "font-semibold" : "text-muted-foreground"}`}>{label}</span>
      <span className={`text-sm font-medium tabular-nums ${negativo ? "text-destructive" : destaque ? "font-bold" : ""}`}>{value}</span>
    </div>
  );
}

const Conciliacao = () => {
  const qc = useQueryClient();
  const [empresaId, setEmpresaId] = useState("");
  const [mesRef, setMesRef] = useState("");
  const [resultado, setResultado] = useState<ResultadoConciliacao | null>(null);
  const [relatorioId, setRelatorioId] = useState<string | null>(null);

  const { data: empresasData } = useQuery<EmpresasResponse>({
    queryKey: ["empresas"],
    queryFn: () => api.get<EmpresasResponse>("/empresas?limit=100"),
  });
  const empresas = empresasData?.data ?? [];

  const calcular = useMutation({
    mutationFn: () => {
      if (!empresaId || !mesRef) throw new Error("Selecione empresa e mês");
      return api.get<ResultadoConciliacao>(`/conciliacao/${empresaId}/${mesRef}`);
    },
    onSuccess: (data) => {
      setResultado(data);
      setRelatorioId(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const gerarRelatorio = useMutation({
    mutationFn: () =>
      api.post<GerarResponse>("/relatorio-desconforto", {
        empresa_id: empresaId,
        mes_ref: mesRef,
      }),
    onSuccess: (data) => {
      setRelatorioId(data.id);
      qc.invalidateQueries({ queryKey: ["relatorios"] });
      toast.success("Relatório gerado com sucesso!");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const enviarEmail = useMutation({
    mutationFn: () =>
      api.post<{ enviado: boolean; destinatarios: string[] }>(`/relatorio-desconforto/${relatorioId}/enviar`),
    onSuccess: (data) => {
      const lista = data.destinatarios.join(", ");
      toast.success(`Relatório enviado para: ${lista}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const downloadPDF = () => {
    if (!relatorioId) return;
    api.downloadBlob(`/relatorio-desconforto/${relatorioId}/pdf`)
      .then(blob => {
        const objUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = objUrl;
        a.download = `relatorio_${mesRef}.pdf`;
        a.click();
        URL.revokeObjectURL(objUrl);
      })
      .catch(() => toast.error("Erro ao baixar PDF"));
  };

  const statusConfig = resultado ? STATUS_CONFIG[resultado.status] : null;
  const StatusIcon = statusConfig?.icon;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Conciliação Fiscal</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Cruza entradas bancárias + liquidações de cartão com o faturamento declarado.
        </p>
      </div>

      {/* Seleção */}
      <Card className="shadow-sm animate-reveal">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Parâmetros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4 items-end">
            <div className="flex-1 space-y-2">
              <Label>Empresa</Label>
              <Select value={empresaId} onValueChange={setEmpresaId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a empresa" />
                </SelectTrigger>
                <SelectContent>
                  {empresas.map(e => (
                    <SelectItem key={e.id} value={e.id}>{e.razao_social}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-full sm:w-48 space-y-2">
              <Label>Mês de Referência</Label>
              <Input
                type="month"
                value={mesRef}
                onChange={e => setMesRef(e.target.value)}
              />
            </div>
            <Button
              onClick={() => calcular.mutate()}
              disabled={!empresaId || !mesRef || calcular.isPending}
              className="gap-2"
            >
              {calcular.isPending
                ? <Loader2 size={16} className="animate-spin" />
                : <Calculator size={16} />}
              Calcular
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Resultado */}
      {resultado && (
        <div className="space-y-4 animate-reveal">
          {/* Status banner */}
          <div className={`rounded-xl p-4 flex items-center gap-4 ${statusConfig?.color}`}>
            {StatusIcon && <StatusIcon size={28} />}
            <div className="flex-1">
              <p className="font-bold text-lg">{fmtPct(resultado.percentual_inconsistencia)} de inconsistência</p>
              <p className="text-sm opacity-80">{statusConfig?.label}</p>
            </div>
            <div className="text-right">
              <p className="text-xs opacity-70">Período</p>
              <p className="font-semibold text-sm capitalize">{fmtMes(resultado.mes_ref)}</p>
            </div>
          </div>

          {/* Tabela de valores — ordem: faturamento primeiro (referência), depois entradas */}
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Demonstrativo Detalhado</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 pt-0">
              <LinhaValor label="Faturamento (NFS emitidas)" value={fmtBRL(resultado.total_faturado)} destaque />
              <div className="pt-2 mt-2 border-t border-border" />
              <LinhaValor label="Entradas Banco" value={fmtBRL(resultado.total_entradas_banco)} />
              <LinhaValor label="(−) Aporte de Sócios" value={fmtBRL(resultado.total_aporte_socios)} negativo />
              <LinhaValor label="(−) Recebimentos CC/CD" value={fmtBRL(resultado.total_recebimentos_cartao)} negativo />
              <LinhaValor label="(−) Rendimento Aplicação Automática" value={fmtBRL(resultado.total_rendimento_aplicacao)} negativo />
              <LinhaValor label="(−) Resgate Aplicações Financeiras" value={fmtBRL(resultado.total_resgate_aplicacao)} negativo />
              <LinhaValor label="(+) Vendas CC/CD" value={fmtBRL(resultado.total_vendas_cartao)} />
              <LinhaValor label="ENTRADAS REAIS" value={fmtBRL(resultado.total_entradas_real)} destaque />
              <div className="pt-2 mt-2 border-t border-border">
                <LinhaValor
                  label={
                    resultado.diferenca > 0
                      ? "DIFERENÇA NÃO FATURADA (Entradas > Faturamento)"
                      : "Faturamento ≥ Entradas — sem inconsistência"
                  }
                  value={fmtBRL(resultado.diferenca)}
                  destaque
                  negativo={resultado.diferenca > 0}
                />
              </div>
            </CardContent>
          </Card>

          {/* Ações */}
          <div className="flex flex-wrap gap-3">
            <Button
              onClick={() => gerarRelatorio.mutate()}
              disabled={gerarRelatorio.isPending}
              className="gap-2"
            >
              {gerarRelatorio.isPending
                ? <Loader2 size={16} className="animate-spin" />
                : <Calculator size={16} />}
              Gerar Relatório PDF
            </Button>

            {relatorioId && (
              <>
                <Button variant="outline" className="gap-2" onClick={downloadPDF}>
                  <Download size={16} />
                  Baixar PDF
                </Button>
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={() => enviarEmail.mutate()}
                  disabled={enviarEmail.isPending}
                >
                  {enviarEmail.isPending
                    ? <Loader2 size={16} className="animate-spin" />
                    : <Mail size={16} />}
                  Enviar por E-mail
                </Button>
              </>
            )}
          </div>

          {relatorioId && (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <CheckCircle2 size={12} className="text-green-500" />
              Relatório salvo. ID: {relatorioId}
            </p>
          )}
        </div>
      )}

    </div>
  );
};

export default Conciliacao;
