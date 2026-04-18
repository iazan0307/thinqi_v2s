import { AlertTriangle, CheckCircle2, Info, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useViewAs } from "@/contexts/ViewAsContext";
import { api } from "@/lib/api";
import { STATUS_DISTRIBUICAO, calcularIrDevido } from "@/lib/distribuicao";

interface Retirada {
  id: string;
  mes_ref: string;
  valor_total: number;
  alerta_limite: boolean;
  ir_devido?: number;
  socio: { nome: string; cpf_mascara: string };
}

interface RetiradasResponse {
  data: Retirada[];
  meta: { total: number };
}

const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

const fmtMes = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
};

const Socios = () => {
  const { user } = useAuth();
  const { viewAs } = useViewAs();
  const empresaId = user?.role === "CLIENTE"
    ? user.empresa_id
    : (viewAs?.empresaId ?? user?.empresa_id);

  const { data, isLoading } = useQuery<RetiradasResponse>({
    queryKey: ["retiradas", empresaId],
    queryFn: () =>
      api.get<RetiradasResponse>(
        `/retiradas?limit=50${empresaId ? `&empresa_id=${empresaId}` : ""}`
      ),
    enabled: !!user,
  });

  const retiradas = data?.data ?? [];

  return (
    <div className="space-y-6 max-w-5xl">
      <h1 className="text-2xl font-bold tracking-tight animate-reveal">
        Monitoramento de Distribuição de Lucros
      </h1>

      <div
        className="bg-card border border-border rounded-xl p-5 flex gap-4 items-start shadow-sm animate-reveal"
        style={{ animationDelay: "80ms" }}
      >
        <div className="kpi-orange-bg p-2.5 rounded-lg shrink-0">
          <Info size={20} className="kpi-orange" />
        </div>
        <div>
          <p className="font-semibold text-sm">Atenção ao Limite de Isenção</p>
          <p className="text-sm text-muted-foreground mt-1 leading-relaxed max-w-2xl">
            Retiradas de pró-labore e distribuição de lucros acima do limite legal estão sujeitas à
            tributação de IRPF. Monitore os valores mensais de cada sócio para evitar autuações.
          </p>
        </div>
      </div>

      <div
        className="bg-card rounded-xl border border-border shadow-sm animate-reveal"
        style={{ animationDelay: "160ms" }}
      >
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm p-6">
            <Loader2 size={14} className="animate-spin" /> Carregando retiradas...
          </div>
        ) : retiradas.length === 0 ? (
          <div className="text-center text-muted-foreground text-sm p-8">
            Nenhuma retirada registrada. Faça o upload de um extrato bancário para iniciar a auditoria.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left font-medium px-6 py-4">Sócio</th>
                  <th className="text-left font-medium px-6 py-4 hidden sm:table-cell">CPF</th>
                  <th className="text-left font-medium px-6 py-4 hidden md:table-cell">Mês</th>
                  <th className="text-right font-medium px-6 py-4">Retiradas</th>
                  <th className="text-right font-medium px-6 py-4">IR Devido</th>
                  <th className="text-center font-medium px-6 py-4">Status</th>
                </tr>
              </thead>
              <tbody>
                {retiradas.map((r) => {
                  const valor = Number(r.valor_total);
                  const ir = r.ir_devido ?? calcularIrDevido(valor);
                  return (
                    <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors">
                      <td className="px-6 py-4 font-medium">{r.socio.nome}</td>
                      <td className="px-6 py-4 text-muted-foreground hidden sm:table-cell tabular-nums">{r.socio.cpf_mascara}</td>
                      <td className="px-6 py-4 text-muted-foreground hidden md:table-cell capitalize">{fmtMes(r.mes_ref)}</td>
                      <td className="px-6 py-4 text-right tabular-nums font-medium">{fmtBRL(valor)}</td>
                      <td className={`px-6 py-4 text-right tabular-nums ${ir > 0 ? "kpi-red font-semibold" : "text-muted-foreground"}`}>
                        {ir > 0 ? fmtBRL(ir) : "Isento"}
                      </td>
                      <td className="px-6 py-4 text-center">
                        {!r.alerta_limite ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium kpi-green kpi-green-bg px-3 py-1 rounded-full">
                            <CheckCircle2 size={14} /> {STATUS_DISTRIBUICAO.ISENTA}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium kpi-red kpi-red-bg px-3 py-1 rounded-full">
                            <AlertTriangle size={14} /> {STATUS_DISTRIBUICAO.TRIBUTADA}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default Socios;
