import { useState } from "react";
import { UserPlus, Loader2, Users, CheckCircle2, XCircle, Trash2, Copy, AlertTriangle } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Pagination } from "@/components/Pagination";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { api } from "@/lib/api";
import { toast } from "sonner";

interface Empresa { id: string; razao_social: string }
interface EmpresasResponse { data: Empresa[] }

type PerfilCliente = "SOCIO" | "SECRETARIA";

interface Cliente {
  id: string;
  nome: string;
  email: string;
  ativo: boolean;
  perfil_cliente: PerfilCliente;
  ultimo_login: string | null;
  created_at: string;
  empresa: { id: string; razao_social: string; cnpj: string } | null;
}

interface ClientesResponse {
  data: Cliente[];
  meta: { total: number };
}

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR") : "—";

const Clientes = () => {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const LIMIT = 10;
  const [showConvite, setShowConvite] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Cliente | null>(null);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [empresaId, setEmpresaId] = useState("");
  const [perfilCliente, setPerfilCliente] = useState<PerfilCliente>("SOCIO");

  // Fallback quando o e-mail não pôde ser enviado
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

  const copiar = async (texto: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      toast.success("Copiado!");
    } catch {
      toast.error("Não foi possível copiar");
    }
  };

  const { data: empresasData } = useQuery<EmpresasResponse>({
    queryKey: ["empresas"],
    queryFn: () => api.get<EmpresasResponse>("/empresas?limit=100"),
  });
  const empresas = empresasData?.data ?? [];

  const { data, isLoading } = useQuery<ClientesResponse>({
    queryKey: ["clientes", page],
    queryFn: () => api.get<ClientesResponse>(`/admin/clientes?limit=${LIMIT}&page=${page}`),
  });
  const clientes = data?.data ?? [];

  const convidar = useMutation({
    mutationFn: () =>
      api.post<ConviteResposta>("/admin/clientes/convidar", {
        nome,
        email,
        empresa_id: empresaId,
        perfil_cliente: perfilCliente,
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["clientes"] });
      setShowConvite(false);
      const emailUsado = r.usuario.email;
      setNome(""); setEmail(""); setEmpresaId(""); setPerfilCliente("SOCIO");
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

  const atualizarPerfil = useMutation({
    mutationFn: ({ id, perfil_cliente }: { id: string; perfil_cliente: PerfilCliente }) =>
      api.put(`/admin/clientes/${id}/perfil`, { perfil_cliente }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clientes"] });
      toast.success("Perfil atualizado.");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deletar = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/clientes/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clientes"] });
      setDeleteTarget(null);
      toast.success("Cliente removido.");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleAtivo = useMutation({
    mutationFn: ({ id, ativo }: { id: string; ativo: boolean }) =>
      api.put(`/admin/clientes/${id}/ativo`, { ativo }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clientes"] });
      toast.success("Status atualizado.");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clientes</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Gerencie o acesso dos clientes ao portal financeiro.
          </p>
        </div>
        <Button onClick={() => setShowConvite(true)} className="gap-2">
          <UserPlus size={16} /> Convidar Cliente
        </Button>
      </div>

      <Card className="shadow-sm animate-reveal">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Users size={16} />
            Usuários Clientes
            {data && (
              <span className="text-muted-foreground font-normal text-sm">
                ({data.meta.total})
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm py-8 justify-center">
              <Loader2 size={16} className="animate-spin" /> Carregando...
            </div>
          ) : clientes.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              <p>Nenhum cliente cadastrado.</p>
              <p className="mt-1">Clique em "Convidar Cliente" para começar.</p>
            </div>
          ) : (
            <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>E-mail</TableHead>
                    <TableHead>Empresa</TableHead>
                    <TableHead className="w-[180px]">Perfil</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    <TableHead className="text-right">Último Acesso</TableHead>
                    <TableHead className="text-center">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clientes.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.nome}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{c.email}</TableCell>
                      <TableCell className="text-sm">
                        {c.empresa?.razao_social ?? (
                          <span className="text-muted-foreground">Sem empresa</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={c.perfil_cliente}
                          onValueChange={(v) =>
                            atualizarPerfil.mutate({ id: c.id, perfil_cliente: v as PerfilCliente })
                          }
                        >
                          <SelectTrigger className="h-7 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="SOCIO">Sócio</SelectItem>
                            <SelectItem value="SECRETARIA">Secretária</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-center">
                        {c.ativo ? (
                          <Badge className="bg-[hsl(var(--kpi-green-bg))] text-[hsl(var(--kpi-green))] border-0 gap-1">
                            <CheckCircle2 size={11} /> Ativo
                          </Badge>
                        ) : (
                          <Badge className="bg-[hsl(var(--kpi-red-bg))] text-[hsl(var(--kpi-red))] border-0 gap-1">
                            <XCircle size={11} /> Inativo
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {fmtDate(c.ultimo_login)}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs h-7 px-2"
                            onClick={() => toggleAtivo.mutate({ id: c.id, ativo: !c.ativo })}
                            disabled={toggleAtivo.isPending}
                          >
                            {c.ativo ? "Desativar" : "Ativar"}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs h-7 px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => setDeleteTarget(c)}
                          >
                            <Trash2 size={11} />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
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

      {/* Confirmação excluir cliente */}
      <AlertDialog open={!!deleteTarget} onOpenChange={v => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover cliente?</AlertDialogTitle>
            <AlertDialogDescription>
              O acesso de <strong>{deleteTarget?.nome}</strong> ({deleteTarget?.email}) será removido permanentemente. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => deleteTarget && deletar.mutate(deleteTarget.id)}
              disabled={deletar.isPending}
            >
              {deletar.isPending && <Loader2 size={14} className="animate-spin mr-1" />}
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modal convidar */}
      <Dialog open={showConvite} onOpenChange={setShowConvite}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convidar Cliente</DialogTitle>
            <DialogDescription>
              Um e-mail com as credenciais de acesso será enviado automaticamente.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Nome completo</Label>
              <Input placeholder="João Silva" value={nome} onChange={e => setNome(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>E-mail</Label>
              <Input type="email" placeholder="joao@empresa.com.br" value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
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
            <div className="space-y-2">
              <Label>Perfil de acesso</Label>
              <Select value={perfilCliente} onValueChange={(v) => setPerfilCliente(v as PerfilCliente)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SOCIO">Sócio — vê tudo, inclusive distribuição</SelectItem>
                  <SelectItem value="SECRETARIA">Secretária — não vê retiradas de sócios</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConvite(false)}>Cancelar</Button>
            <Button
              onClick={() => convidar.mutate()}
              disabled={!nome || !email || !empresaId || convidar.isPending}
            >
              {convidar.isPending && <Loader2 size={14} className="animate-spin mr-1" />}
              Enviar Convite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Fallback de credenciais quando o e-mail falhou */}
      <Dialog open={!!credenciaisManuais} onOpenChange={v => !v && setCredenciaisManuais(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle size={18} className="text-amber-500" />
              Cliente criado, mas o e-mail falhou
            </DialogTitle>
            <DialogDescription>
              O servidor SMTP não respondeu, mas o cadastro foi concluído.
              Envie estas credenciais manualmente ao cliente.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">E-mail</Label>
              <div className="flex gap-2">
                <Input readOnly value={credenciaisManuais?.email ?? ""} />
                <Button variant="outline" size="icon" onClick={() => copiar(credenciaisManuais?.email ?? "")}>
                  <Copy size={14} />
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Senha temporária</Label>
              <div className="flex gap-2">
                <Input readOnly className="font-mono" value={credenciaisManuais?.senha ?? ""} />
                <Button variant="outline" size="icon" onClick={() => copiar(credenciaisManuais?.senha ?? "")}>
                  <Copy size={14} />
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Link de acesso</Label>
              <div className="flex gap-2">
                <Input readOnly value={credenciaisManuais?.loginUrl ?? ""} />
                <Button variant="outline" size="icon" onClick={() => copiar(credenciaisManuais?.loginUrl ?? "")}>
                  <Copy size={14} />
                </Button>
              </div>
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

export default Clientes;
