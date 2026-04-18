import { useState } from "react";
import { UserPlus, Loader2, Users, CheckCircle2, XCircle, ShieldCheck, Calculator, KeyRound, Pencil } from "lucide-react";
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
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

interface Usuario {
  id: string;
  nome: string;
  email: string;
  role: "ADMIN" | "CONTADOR";
  ativo: boolean;
  ultimo_login: string | null;
  created_at: string;
}

interface UsuariosResponse {
  data: Usuario[];
  meta: { total: number };
}

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR") : "—";

function RoleBadge({ role }: { role: "ADMIN" | "CONTADOR" }) {
  if (role === "ADMIN")
    return (
      <Badge className="bg-purple-100 text-purple-700 border-0 gap-1 dark:bg-purple-900/30 dark:text-purple-400">
        <ShieldCheck size={11} /> Admin
      </Badge>
    );
  return (
    <Badge className="bg-blue-100 text-blue-700 border-0 gap-1 dark:bg-blue-900/30 dark:text-blue-400">
      <Calculator size={11} /> Contador
    </Badge>
  );
}

const Usuarios = () => {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const LIMIT = 10;

  // Modal novo usuário
  const [showNovo, setShowNovo] = useState(false);
  const [nome, setNome]         = useState("");
  const [email, setEmail]       = useState("");
  const [role, setRole]         = useState<"ADMIN" | "CONTADOR">("CONTADOR");

  // Modal editar
  const [editTarget, setEditTarget] = useState<Usuario | null>(null);
  const [editNome, setEditNome]     = useState("");
  const [editRole, setEditRole]     = useState<"ADMIN" | "CONTADOR">("CONTADOR");

  // Confirmação de reset de senha
  const [resetTarget, setResetTarget] = useState<Usuario | null>(null);

  const { data, isLoading } = useQuery<UsuariosResponse>({
    queryKey: ["usuarios-internos", page],
    queryFn: () => api.get<UsuariosResponse>(`/admin/usuarios?limit=${LIMIT}&page=${page}`),
  });
  const usuarios = data?.data ?? [];

  const criar = useMutation({
    mutationFn: () => api.post("/admin/usuarios", { nome, email, role }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["usuarios-internos"] });
      setShowNovo(false);
      setNome(""); setEmail(""); setRole("CONTADOR");
      toast.success("Usuário criado! As credenciais foram enviadas por e-mail.");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const atualizar = useMutation({
    mutationFn: () =>
      api.put(`/admin/usuarios/${editTarget!.id}`, { nome: editNome, role: editRole }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["usuarios-internos"] });
      setEditTarget(null);
      toast.success("Usuário atualizado.");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleAtivo = useMutation({
    mutationFn: ({ id, ativo }: { id: string; ativo: boolean }) =>
      api.put(`/admin/usuarios/${id}/ativo`, { ativo }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["usuarios-internos"] });
      toast.success("Status atualizado.");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const resetSenha = useMutation({
    mutationFn: (id: string) => api.post(`/admin/usuarios/${id}/resetar-senha`, {}),
    onSuccess: () => {
      setResetTarget(null);
      toast.success("Nova senha enviada por e-mail.");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const openEdit = (u: Usuario) => {
    setEditTarget(u);
    setEditNome(u.nome);
    setEditRole(u.role);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Usuários Internos</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Gerencie o acesso dos funcionários ao painel administrativo.
          </p>
        </div>
        <Button onClick={() => setShowNovo(true)} className="gap-2">
          <UserPlus size={16} /> Novo Usuário
        </Button>
      </div>

      <Card className="shadow-sm animate-reveal">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Users size={16} /> Equipe ThinQi
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
          ) : usuarios.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              Nenhum usuário interno cadastrado.
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead>E-mail</TableHead>
                      <TableHead className="text-center">Perfil</TableHead>
                      <TableHead className="text-center">Status</TableHead>
                      <TableHead className="text-right">Último Acesso</TableHead>
                      <TableHead className="text-center">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {usuarios.map((u) => (
                      <TableRow key={u.id}>
                        <TableCell className="font-medium">
                          {u.nome}
                          {u.id === me?.id && (
                            <span className="ml-2 text-xs text-muted-foreground">(você)</span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">{u.email}</TableCell>
                        <TableCell className="text-center">
                          <RoleBadge role={u.role} />
                        </TableCell>
                        <TableCell className="text-center">
                          {u.ativo ? (
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
                          {fmtDate(u.ultimo_login)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-center gap-1.5">
                            <Button
                              variant="outline" size="sm"
                              className="text-xs h-7 px-2 gap-1"
                              onClick={() => openEdit(u)}
                            >
                              <Pencil size={11} /> Editar
                            </Button>
                            <Button
                              variant="outline" size="sm"
                              className="text-xs h-7 px-2 gap-1"
                              onClick={() => setResetTarget(u)}
                            >
                              <KeyRound size={11} /> Senha
                            </Button>
                            {u.id !== me?.id && (
                              <Button
                                variant="outline" size="sm"
                                className="text-xs h-7 px-2"
                                onClick={() => toggleAtivo.mutate({ id: u.id, ativo: !u.ativo })}
                                disabled={toggleAtivo.isPending}
                              >
                                {u.ativo ? "Desativar" : "Ativar"}
                              </Button>
                            )}
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

      {/* ── Modal novo usuário ── */}
      <Dialog open={showNovo} onOpenChange={setShowNovo}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo Usuário Interno</DialogTitle>
            <DialogDescription>
              As credenciais de acesso serão enviadas automaticamente por e-mail.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Nome completo</Label>
              <Input placeholder="Maria Santos" value={nome} onChange={e => setNome(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>E-mail</Label>
              <Input type="email" placeholder="maria@iazan.com.br" value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Perfil de acesso</Label>
              <Select value={role} onValueChange={v => setRole(v as "ADMIN" | "CONTADOR")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CONTADOR">
                    <span className="flex items-center gap-2"><Calculator size={14} /> Contador — acesso operacional</span>
                  </SelectItem>
                  <SelectItem value="ADMIN">
                    <span className="flex items-center gap-2"><ShieldCheck size={14} /> Admin — acesso total</span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNovo(false)}>Cancelar</Button>
            <Button
              onClick={() => criar.mutate()}
              disabled={!nome || !email || criar.isPending}
            >
              {criar.isPending && <Loader2 size={14} className="animate-spin mr-1" />}
              Criar Usuário
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Modal editar ── */}
      <Dialog open={!!editTarget} onOpenChange={v => !v && setEditTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Usuário</DialogTitle>
            <DialogDescription>{editTarget?.email}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Nome completo</Label>
              <Input value={editNome} onChange={e => setEditNome(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Perfil de acesso</Label>
              <Select
                value={editRole}
                onValueChange={v => setEditRole(v as "ADMIN" | "CONTADOR")}
                disabled={editTarget?.id === me?.id}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CONTADOR">
                    <span className="flex items-center gap-2"><Calculator size={14} /> Contador</span>
                  </SelectItem>
                  <SelectItem value="ADMIN">
                    <span className="flex items-center gap-2"><ShieldCheck size={14} /> Admin</span>
                  </SelectItem>
                </SelectContent>
              </Select>
              {editTarget?.id === me?.id && (
                <p className="text-xs text-muted-foreground">Você não pode alterar seu próprio perfil.</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>Cancelar</Button>
            <Button onClick={() => atualizar.mutate()} disabled={!editNome || atualizar.isPending}>
              {atualizar.isPending && <Loader2 size={14} className="animate-spin mr-1" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Confirmação reset senha ── */}
      <AlertDialog open={!!resetTarget} onOpenChange={v => !v && setResetTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Redefinir senha?</AlertDialogTitle>
            <AlertDialogDescription>
              Uma nova senha temporária será gerada e enviada para{" "}
              <strong>{resetTarget?.email}</strong>. O usuário precisará alterá-la no próximo acesso.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => resetTarget && resetSenha.mutate(resetTarget.id)}
              disabled={resetSenha.isPending}
            >
              {resetSenha.isPending && <Loader2 size={14} className="animate-spin mr-1" />}
              Redefinir e enviar e-mail
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Usuarios;
