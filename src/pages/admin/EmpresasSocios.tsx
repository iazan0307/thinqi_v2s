import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, ChevronDown, ChevronRight, UserPlus, Loader2, Pencil, Trash2, UserX, CheckCircle2, Mail, Eye, Boxes } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useViewAs } from "@/contexts/ViewAsContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api";
import { toast } from "sonner";

interface Socio {
  id: string;
  nome: string;
  cpf_mascara: string;
  percentual_societario: number;
  tem_prolabore?: boolean;
  valor_prolabore_mensal?: number | string;
  ativo: boolean;
}

interface Empresa {
  id: string;
  razao_social: string;
  cnpj: string;
  regime_tributario: string;
  saldo_inicial?: number | string;
  _count?: { socios: number; usuarios: number };
  socios?: Socio[];
}

interface EmpresasResponse { data: Empresa[] }

const REGIMES = [
  { value: "SIMPLES_NACIONAL", label: "Simples Nacional" },
  { value: "LUCRO_PRESUMIDO",  label: "Lucro Presumido"  },
  { value: "LUCRO_REAL",       label: "Lucro Real"       },
];

const fmtCnpj = (c: string) => {
  const d = c.replace(/\D/g, "");
  return d.length === 14
    ? `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`
    : c;
};

// ─── Subcomponente módulos ─────────────────────────────────────────────────────

interface ModuloEmpresa {
  id: string;
  codigo: string;
  nome: string;
  descricao: string | null;
  habilitado: boolean;
  observacao: string | null;
}

interface ModulosEmpresaResponse { data: ModuloEmpresa[] }

function EmpresaModulos({ empresaId }: { empresaId: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<ModulosEmpresaResponse>({
    queryKey: ["empresa-modulos", empresaId],
    queryFn: () => api.get<ModulosEmpresaResponse>(`/admin/empresas/${empresaId}/modulos`),
  });

  const toggle = useMutation({
    mutationFn: ({ moduloId, habilitado }: { moduloId: string; habilitado: boolean }) =>
      api.put(`/admin/empresas/${empresaId}/modulos/${moduloId}`, { habilitado }),
    onMutate: async ({ moduloId, habilitado }) => {
      await qc.cancelQueries({ queryKey: ["empresa-modulos", empresaId] });
      const previous = qc.getQueryData<ModulosEmpresaResponse>(["empresa-modulos", empresaId]);
      if (previous) {
        qc.setQueryData<ModulosEmpresaResponse>(["empresa-modulos", empresaId], {
          data: previous.data.map(m => m.id === moduloId ? { ...m, habilitado } : m),
        });
      }
      return { previous };
    },
    onError: (err: Error, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(["empresa-modulos", empresaId], ctx.previous);
      toast.error(err.message);
    },
    onSuccess: (_data, vars) => {
      const m = data?.data.find(x => x.id === vars.moduloId);
      toast.success(`${m?.nome ?? "Módulo"} ${vars.habilitado ? "habilitado" : "desabilitado"}.`);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["empresa-modulos", empresaId] }),
  });

  const modulos = data?.data ?? [];

  return (
    <div className="border-t border-border">
      <div className="p-4 pb-2 flex items-center gap-2">
        <Boxes size={14} className="text-muted-foreground" />
        <p className="text-sm font-medium text-muted-foreground">Módulos Habilitados</p>
      </div>
      <div className="px-4 pb-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm py-2">
            <Loader2 size={14} className="animate-spin" /> Carregando módulos...
          </div>
        ) : modulos.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Nenhum módulo disponível no catálogo.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {modulos.map(m => (
              <div
                key={m.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-tight">{m.nome}</p>
                  {m.descricao && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{m.descricao}</p>
                  )}
                  <code className="text-[10px] text-muted-foreground/70 font-mono">{m.codigo}</code>
                </div>
                <Switch
                  checked={m.habilitado}
                  disabled={toggle.isPending}
                  onCheckedChange={v => toggle.mutate({ moduloId: m.id, habilitado: v })}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Subcomponente sócios ──────────────────────────────────────────────────────

function EmpresaSocios({
  empresaId,
  semCliente,
  onAddSocio,
  onEditSocio,
  onDeleteSocio,
  onConvidarCliente,
}: {
  empresaId: string;
  semCliente: boolean;
  onAddSocio: () => void;
  onEditSocio: (s: Socio) => void;
  onDeleteSocio: (s: Socio) => void;
  onConvidarCliente: () => void;
}) {
  const { data, isLoading } = useQuery<Empresa>({
    queryKey: ["empresa", empresaId],
    queryFn: () => api.get<Empresa>(`/empresas/${empresaId}`),
  });

  if (isLoading) {
    return (
      <div className="p-4 flex items-center gap-2 text-muted-foreground text-sm border-t border-border">
        <Loader2 size={14} className="animate-spin" /> Carregando...
      </div>
    );
  }

  const socios = data?.socios ?? [];

  return (
    <div className="border-t border-border">
      {semCliente && (
        <div className="mx-4 mt-4 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex items-center gap-2 text-amber-800 text-sm">
            <UserX size={15} className="shrink-0" />
            <span>Nenhum usuário cliente cadastrado para esta empresa. O cliente não conseguirá acessar o portal.</span>
          </div>
          <Button size="sm" className="gap-1.5 shrink-0 bg-amber-700 hover:bg-amber-800 text-white border-0" onClick={onConvidarCliente}>
            <Mail size={13} /> Convidar Cliente
          </Button>
        </div>
      )}
      <div className="p-4 pb-2 flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">Sócios Vinculados</p>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={onAddSocio}>
          <UserPlus size={14} /> Adicionar Sócio
        </Button>
      </div>
      <div className="px-4 pb-4">
        {socios.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Nenhum sócio cadastrado.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>CPF</TableHead>
                <TableHead className="text-right">Participação</TableHead>
                <TableHead className="text-center">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {socios.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      {s.nome}
                      {s.tem_prolabore && (
                        <Badge variant="outline" className="text-[10px] font-normal">Pró-labore</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{s.cpf_mascara}</TableCell>
                  <TableCell className="text-right tabular-nums">{Number(s.percentual_societario).toFixed(2)}%</TableCell>
                  <TableCell className="text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <Button
                        variant="outline" size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => onEditSocio(s)}
                      >
                        <Pencil size={12} />
                      </Button>
                      <Button
                        variant="outline" size="sm"
                        className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => onDeleteSocio(s)}
                      >
                        <Trash2 size={12} />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

// ─── Página principal ──────────────────────────────────────────────────────────

const EmpresasSocios = () => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { enterViewAs } = useViewAs();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Modais empresa
  const [showEmpresaModal, setShowEmpresaModal] = useState(false);
  const [empresaModalStep, setEmpresaModalStep] = useState<"form" | "sucesso">("form");
  const [novaEmpresa, setNovaEmpresa] = useState<{ id: string; razao_social: string } | null>(null);
  const [eRazao, setERazao] = useState("");
  const [eCnpj, setECnpj]   = useState("");
  const [eRegime, setERegime] = useState("SIMPLES_NACIONAL");
  const [eSaldo, setESaldo] = useState("0");

  // Modal editar empresa
  const [editEmpresa, setEditEmpresa] = useState<Empresa | null>(null);
  const [editERazao, setEditERazao] = useState("");
  const [editERegime, setEditERegime] = useState("SIMPLES_NACIONAL");
  const [editESaldo, setEditESaldo] = useState("0");

  // Convidar cliente inline (step sucesso do modal empresa)
  const [inviteNome, setInviteNome] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");

  // Fallback quando o e-mail do convite falha
  const [credenciaisManuais, setCredenciaisManuais] = useState<{
    email: string;
    senha: string;
    loginUrl: string;
    erro: string | null;
  } | null>(null);

  interface ConviteResposta {
    usuario: { id: string; nome: string; email: string };
    convite_enviado: boolean;
    erro_envio: string | null;
    senha_temporaria: string;
    login_url: string;
  }

  const copiarTexto = async (t: string) => {
    try {
      await navigator.clipboard.writeText(t);
      toast.success("Copiado!");
    } catch {
      toast.error("Não foi possível copiar");
    }
  };

  // Modal novo sócio
  const [showSocioModal, setShowSocioModal] = useState(false);
  const [socioEmpresaId, setSocioEmpresaId] = useState<string | null>(null);
  const [sNome, setSNome]     = useState("");
  const [sCpf, setSCpf]       = useState("");
  const [sPerc, setSPerc]     = useState("");
  const [sProlabore, setSProlabore] = useState(false);
  const [sProlaboreValor, setSProlaboreValor] = useState("");

  // Modal editar sócio
  const [editSocio, setEditSocio]     = useState<Socio | null>(null);
  const [editNome, setEditNome]       = useState("");
  const [editPerc, setEditPerc]       = useState("");
  const [editProlabore, setEditProlabore] = useState(false);
  const [editProlaboreValor, setEditProlaboreValor] = useState("");

  // Confirmação apagar sócio
  const [deleteSocioTarget, setDeleteSocioTarget] = useState<(Socio & { empresaId: string }) | null>(null);

  // Confirmação apagar empresa
  const [deleteEmpresaTarget, setDeleteEmpresaTarget] = useState<Empresa | null>(null);

  const { data, isLoading } = useQuery<EmpresasResponse>({
    queryKey: ["empresas"],
    queryFn: () => api.get<EmpresasResponse>("/empresas?limit=100"),
  });

  const createEmpresa = useMutation({
    mutationFn: () =>
      api.post<{ id: string; razao_social: string }>("/empresas", {
        razao_social: eRazao,
        cnpj: eCnpj,
        regime_tributario: eRegime,
        saldo_inicial: Number(eSaldo.replace(/\./g, "").replace(",", ".")) || 0,
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["empresas"] });
      setNovaEmpresa({ id: data.id, razao_social: data.razao_social });
      setEmpresaModalStep("sucesso");
      setERazao(""); setECnpj(""); setERegime("SIMPLES_NACIONAL"); setESaldo("0");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateEmpresa = useMutation({
    mutationFn: () =>
      api.put(`/empresas/${editEmpresa!.id}`, {
        razao_social: editERazao,
        regime_tributario: editERegime,
        saldo_inicial: Number(editESaldo.replace(/\./g, "").replace(",", ".")) || 0,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["empresas"] });
      qc.invalidateQueries({ queryKey: ["empresa", editEmpresa?.id] });
      setEditEmpresa(null);
      toast.success("Empresa atualizada!");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const convidarClienteInline = useMutation({
    mutationFn: () =>
      api.post<ConviteResposta>("/admin/clientes/convidar", { nome: inviteNome, email: inviteEmail, empresa_id: novaEmpresa!.id }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["empresas"] });
      qc.invalidateQueries({ queryKey: ["clientes"] });
      const emailUsado = r.usuario.email;
      fecharModalEmpresa();
      if (r.convite_enviado) {
        toast.success("Convite enviado! O cliente receberá as credenciais por e-mail.");
      } else {
        setCredenciaisManuais({
          email: emailUsado,
          senha: r.senha_temporaria,
          loginUrl: r.login_url,
          erro: r.erro_envio,
        });
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const fecharModalEmpresa = () => {
    setShowEmpresaModal(false);
    setEmpresaModalStep("form");
    setNovaEmpresa(null);
    setInviteNome(""); setInviteEmail("");
  };

  const createSocio = useMutation({
    mutationFn: () =>
      api.post(`/empresas/${socioEmpresaId}/socios`, {
        nome: sNome,
        cpf: sCpf.replace(/\D/g, ""),
        percentual_societario: parseFloat(sPerc),
        tem_prolabore: sProlabore,
        valor_prolabore_mensal: sProlabore
          ? Number(sProlaboreValor.replace(/\./g, "").replace(",", ".")) || 0
          : 0,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["empresa", socioEmpresaId] });
      qc.invalidateQueries({ queryKey: ["empresas"] });
      setShowSocioModal(false);
      setSNome(""); setSCpf(""); setSPerc(""); setSProlabore(false); setSProlaboreValor("");
      toast.success("Sócio cadastrado!");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateSocio = useMutation({
    mutationFn: () =>
      api.put(`/socios/${editSocio!.id}`, {
        nome: editNome,
        percentual_societario: parseFloat(editPerc),
        tem_prolabore: editProlabore,
        valor_prolabore_mensal: editProlabore
          ? Number(editProlaboreValor.replace(/\./g, "").replace(",", ".")) || 0
          : 0,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["empresa", expandedId] });
      qc.invalidateQueries({ queryKey: ["empresas"] });
      setEditSocio(null);
      toast.success("Sócio atualizado!");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteSocio = useMutation({
    mutationFn: (id: string) => api.delete(`/socios/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["empresa", deleteSocioTarget?.empresaId] });
      qc.invalidateQueries({ queryKey: ["empresas"] });
      setDeleteSocioTarget(null);
      toast.success("Sócio removido.");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteEmpresa = useMutation({
    mutationFn: (id: string) => api.delete(`/empresas/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["empresas"] });
      if (expandedId === deleteEmpresaTarget?.id) setExpandedId(null);
      setDeleteEmpresaTarget(null);
      toast.success("Empresa excluída com sucesso.");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggle = (id: string) => setExpandedId(prev => prev === id ? null : id);

  const openAddSocio = (id: string) => { setSocioEmpresaId(id); setShowSocioModal(true); };

  const openEditSocio = (s: Socio) => {
    setEditSocio(s);
    setEditNome(s.nome);
    setEditPerc(String(Number(s.percentual_societario)));
    setEditProlabore(!!s.tem_prolabore);
    setEditProlaboreValor(
      s.valor_prolabore_mensal !== undefined && s.valor_prolabore_mensal !== null
        ? String(Number(s.valor_prolabore_mensal)).replace(".", ",")
        : "",
    );
  };

  const empresas = data?.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Empresas & Sócios</h1>
          <p className="text-muted-foreground text-sm mt-1">Parametrize empresas e configure regras de sócios.</p>
        </div>
        <Button onClick={() => setShowEmpresaModal(true)} className="gap-2">
          <Plus size={16} /> Cadastrar Nova Empresa
        </Button>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 size={16} className="animate-spin" /> Carregando empresas...
        </div>
      )}

      {!isLoading && empresas.length === 0 && (
        <p className="text-center py-12 text-muted-foreground text-sm">
          Nenhuma empresa cadastrada. Clique em "Cadastrar Nova Empresa" para começar.
        </p>
      )}

      <div className="space-y-3 animate-reveal">
        {empresas.map((empresa) => {
          const isOpen = expandedId === empresa.id;
          const qtdSocios = empresa._count?.socios ?? 0;
          const qtdClientes = empresa._count?.usuarios ?? 0;
          return (
            <Card key={empresa.id} className="shadow-sm overflow-hidden">
              <button
                onClick={() => toggle(empresa.id)}
                className="w-full flex items-center justify-between p-4 hover:bg-muted/30 transition-colors text-left"
              >
                <div className="flex items-center gap-3">
                  {isOpen ? <ChevronDown size={18} className="text-muted-foreground" /> : <ChevronRight size={18} className="text-muted-foreground" />}
                  <div>
                    <p className="font-medium flex items-center gap-2">
                      {empresa.razao_social}
                      {qtdClientes === 0 && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200">
                          <UserX size={10} /> Sem acesso de cliente
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {fmtCnpj(empresa.cnpj)} · {REGIMES.find(r => r.value === empresa.regime_tributario)?.label ?? empresa.regime_tributario}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{qtdSocios} sócio{qtdSocios !== 1 ? "s" : ""}</Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1.5 text-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      enterViewAs(empresa.id, empresa.razao_social);
                      navigate("/dashboard");
                    }}
                    title="Visualizar portal como este cliente"
                  >
                    <Eye size={12} /> Ver como cliente
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditEmpresa(empresa);
                      setEditERazao(empresa.razao_social);
                      setEditERegime(empresa.regime_tributario);
                      setEditESaldo(String(Number(empresa.saldo_inicial ?? 0)));
                    }}
                    title="Editar empresa"
                  >
                    <Pencil size={14} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    onClick={(e) => { e.stopPropagation(); setDeleteEmpresaTarget(empresa); }}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              </button>

              {isOpen && (
                <>
                  <EmpresaSocios
                    empresaId={empresa.id}
                    semCliente={qtdClientes === 0}
                    onAddSocio={() => openAddSocio(empresa.id)}
                    onEditSocio={openEditSocio}
                    onDeleteSocio={(s) => setDeleteSocioTarget({ ...s, empresaId: empresa.id })}
                    onConvidarCliente={() => {
                      setNovaEmpresa({ id: empresa.id, razao_social: empresa.razao_social });
                      setEmpresaModalStep("sucesso");
                      setShowEmpresaModal(true);
                    }}
                  />
                  <EmpresaModulos empresaId={empresa.id} />
                </>
              )}
            </Card>
          );
        })}
      </div>

      {/* ── Modal novo sócio ── */}
      <Dialog open={showSocioModal} onOpenChange={setShowSocioModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cadastrar Sócio</DialogTitle>
            <DialogDescription>CPF será armazenado criptografado (LGPD). Apenas prefixo/sufixo são usados para detecção.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Nome do Sócio</Label>
              <Input placeholder="Nome completo" value={sNome} onChange={e => setSNome(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>CPF completo</Label>
              <Input placeholder="000.000.000-00" value={sCpf} onChange={e => setSCpf(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Participação (%)</Label>
              <Input type="number" placeholder="50" value={sPerc} onChange={e => setSPerc(e.target.value)} />
            </div>
            <div className="flex items-start gap-3 pt-1">
              <Checkbox id="s-prolabore" checked={sProlabore} onCheckedChange={v => setSProlabore(v === true)} />
              <div className="grid gap-1 leading-none">
                <Label htmlFor="s-prolabore" className="cursor-pointer">Tem Pró-labore?</Label>
                <p className="text-xs text-muted-foreground">
                  Marque se o sócio recebe pró-labore (folha) além de distribuição de lucros.
                </p>
              </div>
            </div>
            {sProlabore && (
              <div className="space-y-2">
                <Label>Valor Pró-labore Mensal (R$)</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={sProlaboreValor}
                  onChange={e => setSProlaboreValor(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Esse valor é descontado do total de retiradas do mês antes de avaliar tributação e calcular o IR.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSocioModal(false)}>Cancelar</Button>
            <Button onClick={() => createSocio.mutate()} disabled={createSocio.isPending || !sNome || !sCpf || !sPerc}>
              {createSocio.isPending && <Loader2 size={14} className="animate-spin mr-1" />}
              Salvar Sócio
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Modal editar sócio ── */}
      <Dialog open={!!editSocio} onOpenChange={v => !v && setEditSocio(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Sócio</DialogTitle>
            <DialogDescription>{editSocio?.cpf_mascara}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input value={editNome} onChange={e => setEditNome(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Participação (%)</Label>
              <Input type="number" value={editPerc} onChange={e => setEditPerc(e.target.value)} />
            </div>
            <div className="flex items-start gap-3 pt-1">
              <Checkbox id="edit-prolabore" checked={editProlabore} onCheckedChange={v => setEditProlabore(v === true)} />
              <div className="grid gap-1 leading-none">
                <Label htmlFor="edit-prolabore" className="cursor-pointer">Tem Pró-labore?</Label>
                <p className="text-xs text-muted-foreground">
                  Marque se o sócio recebe pró-labore (folha) além de distribuição de lucros.
                </p>
              </div>
            </div>
            {editProlabore && (
              <div className="space-y-2">
                <Label>Valor Pró-labore Mensal (R$)</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={editProlaboreValor}
                  onChange={e => setEditProlaboreValor(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Esse valor é descontado do total de retiradas do mês antes de avaliar tributação e calcular o IR.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditSocio(null)}>Cancelar</Button>
            <Button onClick={() => updateSocio.mutate()} disabled={updateSocio.isPending || !editNome}>
              {updateSocio.isPending && <Loader2 size={14} className="animate-spin mr-1" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Confirmação apagar sócio ── */}
      <AlertDialog open={!!deleteSocioTarget} onOpenChange={v => !v && setDeleteSocioTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover sócio?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteSocioTarget?.nome}</strong> ({deleteSocioTarget?.cpf_mascara}) será removido permanentemente da empresa. O histórico de retiradas vinculado também será removido.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => deleteSocioTarget && deleteSocio.mutate(deleteSocioTarget.id)}
              disabled={deleteSocio.isPending}
            >
              {deleteSocio.isPending && <Loader2 size={14} className="animate-spin mr-1" />}
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Confirmação excluir empresa ── */}
      <AlertDialog open={!!deleteEmpresaTarget} onOpenChange={v => !v && setDeleteEmpresaTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir empresa?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação é <strong>irreversível</strong>. Todos os dados de{" "}
              <strong>{deleteEmpresaTarget?.razao_social}</strong> serão permanentemente excluídos:
              extratos, transações, sócios, faturamento, relatórios e usuários clientes vinculados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => deleteEmpresaTarget && deleteEmpresa.mutate(deleteEmpresaTarget.id)}
              disabled={deleteEmpresa.isPending}
            >
              {deleteEmpresa.isPending && <Loader2 size={14} className="animate-spin mr-1" />}
              Excluir empresa
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Modal editar empresa ── */}
      <Dialog open={!!editEmpresa} onOpenChange={v => !v && setEditEmpresa(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Empresa</DialogTitle>
            <DialogDescription>{editEmpresa && fmtCnpj(editEmpresa.cnpj)}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Razão Social</Label>
              <Input value={editERazao} onChange={e => setEditERazao(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Regime Tributário</Label>
              <Select value={editERegime} onValueChange={setEditERegime}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REGIMES.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Saldo Inicial (R$)</Label>
              <Input
                type="text"
                inputMode="decimal"
                value={editESaldo}
                onChange={e => setEditESaldo(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Saldo de caixa no início da primeira importação. Usado no cálculo do caixa livre do portal.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditEmpresa(null)}>Cancelar</Button>
            <Button onClick={() => updateEmpresa.mutate()} disabled={updateEmpresa.isPending || !editERazao}>
              {updateEmpresa.isPending && <Loader2 size={14} className="animate-spin mr-1" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Modal nova empresa (2 steps) ── */}
      <Dialog open={showEmpresaModal} onOpenChange={v => !v && fecharModalEmpresa()}>
        <DialogContent>
          {empresaModalStep === "form" ? (
            <>
              <DialogHeader>
                <DialogTitle>Cadastrar Nova Empresa</DialogTitle>
                <DialogDescription>Informe os dados da empresa cliente.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label>Razão Social</Label>
                  <Input placeholder="Empresa Ltda" value={eRazao} onChange={e => setERazao(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>CNPJ</Label>
                  <Input placeholder="00.000.000/0001-00" value={eCnpj} onChange={e => setECnpj(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Regime Tributário</Label>
                  <Select value={eRegime} onValueChange={setERegime}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {REGIMES.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Saldo Inicial (R$)</Label>
                  <Input
                    type="text"
                    inputMode="decimal"
                    placeholder="0,00"
                    value={eSaldo}
                    onChange={e => setESaldo(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Saldo de caixa no início da primeira importação. Usado no cálculo do caixa livre do portal.
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={fecharModalEmpresa}>Cancelar</Button>
                <Button onClick={() => createEmpresa.mutate()} disabled={createEmpresa.isPending || !eRazao || !eCnpj}>
                  {createEmpresa.isPending && <Loader2 size={14} className="animate-spin mr-1" />}
                  Cadastrar Empresa
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <CheckCircle2 size={18} className="text-green-600" />
                  Empresa cadastrada!
                </DialogTitle>
                <DialogDescription>
                  <strong>{novaEmpresa?.razao_social}</strong> foi criada com sucesso. Deseja convidar um cliente para acessar o portal?
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label>Nome do cliente</Label>
                  <Input placeholder="João Silva" value={inviteNome} onChange={e => setInviteNome(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>E-mail</Label>
                  <Input type="email" placeholder="joao@empresa.com.br" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} />
                </div>
                <p className="text-xs text-muted-foreground">
                  Um e-mail com as credenciais de acesso será enviado automaticamente.
                </p>
              </div>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button variant="ghost" onClick={fecharModalEmpresa}>Agora não</Button>
                <Button
                  onClick={() => convidarClienteInline.mutate()}
                  disabled={!inviteNome || !inviteEmail || convidarClienteInline.isPending}
                  className="gap-2"
                >
                  {convidarClienteInline.isPending
                    ? <Loader2 size={14} className="animate-spin" />
                    : <Mail size={14} />}
                  Enviar Convite
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Fallback de credenciais quando o e-mail do convite falha */}
      <Dialog open={!!credenciaisManuais} onOpenChange={v => !v && setCredenciaisManuais(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cliente criado, mas o e-mail falhou</DialogTitle>
            <DialogDescription>
              O servidor SMTP não respondeu. Envie estas credenciais manualmente ao cliente.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">E-mail</Label>
              <div className="flex gap-2">
                <Input readOnly value={credenciaisManuais?.email ?? ""} />
                <Button variant="outline" size="icon" onClick={() => copiarTexto(credenciaisManuais?.email ?? "")}>
                  <Mail size={14} />
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Senha temporária</Label>
              <Input readOnly className="font-mono" value={credenciaisManuais?.senha ?? ""} onClick={() => copiarTexto(credenciaisManuais?.senha ?? "")} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Link de acesso</Label>
              <Input readOnly value={credenciaisManuais?.loginUrl ?? ""} onClick={() => copiarTexto(credenciaisManuais?.loginUrl ?? "")} />
            </div>
            {credenciaisManuais?.erro && (
              <p className="text-xs text-muted-foreground break-all">
                Detalhe do erro SMTP: {credenciaisManuais.erro}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setCredenciaisManuais(null)}>Entendi</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default EmpresasSocios;
