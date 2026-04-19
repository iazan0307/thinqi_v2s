import { useState } from "react";
import { Plus, Loader2, Pencil, Trash2, Tags, RefreshCw } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api";
import { toast } from "sonner";

interface PalavraChave {
  id: string;
  palavra: string;
  descricao: string | null;
  ativo: boolean;
  created_at: string;
}

const PalavrasChave = () => {
  const qc = useQueryClient();

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<PalavraChave | null>(null);
  const [palavra, setPalavra] = useState("");
  const [descricao, setDescricao] = useState("");
  const [ativo, setAtivo] = useState(true);

  const [deleteTarget, setDeleteTarget] = useState<PalavraChave | null>(null);
  const [showReprocessConfirm, setShowReprocessConfirm] = useState(false);

  const { data, isLoading } = useQuery<PalavraChave[]>({
    queryKey: ["palavras-chave"],
    queryFn: () => api.get<PalavraChave[]>("/palavras-chave-investimento"),
  });

  const reprocessar = useMutation({
    mutationFn: () =>
      api.post<{ transacoes_desvinculadas: number; empresas_recalculadas: number }>(
        "/palavras-chave-investimento/reprocessar",
      ),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["retiradas-admin"] });
      qc.invalidateQueries({ queryKey: ["admin-arquivos"] });
      setShowReprocessConfirm(false);
      if (r.transacoes_desvinculadas === 0) {
        toast.success("Nada para reprocessar — nenhum lançamento existente bate com as palavras-chave.");
      } else {
        toast.success(
          `${r.transacoes_desvinculadas} lançamento(s) desvinculado(s) em ${r.empresas_recalculadas} empresa(s). Distribuição recalculada.`,
        );
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post("/palavras-chave-investimento", {
        palavra,
        descricao: descricao || undefined,
        ativo,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["palavras-chave"] });
      closeModal();
      toast.success("Palavra-chave cadastrada!");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const update = useMutation({
    mutationFn: () =>
      api.put(`/palavras-chave-investimento/${editing!.id}`, {
        palavra,
        descricao: descricao || undefined,
        ativo,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["palavras-chave"] });
      closeModal();
      toast.success("Palavra-chave atualizada!");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/palavras-chave-investimento/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["palavras-chave"] });
      setDeleteTarget(null);
      toast.success("Palavra-chave removida.");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleAtivo = useMutation({
    mutationFn: ({ id, ativo }: { id: string; ativo: boolean }) =>
      api.put(`/palavras-chave-investimento/${id}`, { ativo }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["palavras-chave"] }),
    onError: (err: Error) => toast.error(err.message),
  });

  const openCreate = () => {
    setEditing(null);
    setPalavra("");
    setDescricao("");
    setAtivo(true);
    setShowModal(true);
  };

  const openEdit = (p: PalavraChave) => {
    setEditing(p);
    setPalavra(p.palavra);
    setDescricao(p.descricao ?? "");
    setAtivo(p.ativo);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditing(null);
    setPalavra("");
    setDescricao("");
    setAtivo(true);
  };

  const palavras = data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Palavras-chave de Investimento</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Cadastre termos que devem ser ignorados pelo motor de conciliação (aplicações, resgates etc.).
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setShowReprocessConfirm(true)}
            disabled={reprocessar.isPending}
            className="gap-2"
          >
            {reprocessar.isPending
              ? <Loader2 size={14} className="animate-spin" />
              : <RefreshCw size={14} />}
            Aplicar aos lançamentos existentes
          </Button>
          <Button onClick={openCreate} className="gap-2">
            <Plus size={16} /> Nova Palavra-chave
          </Button>
        </div>
      </div>

      <Card className="shadow-sm animate-reveal">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Tags size={16} /> Cadastradas
            <span className="text-muted-foreground font-normal text-sm">
              ({palavras.length} termo{palavras.length !== 1 ? "s" : ""})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm py-8 justify-center">
              <Loader2 size={16} className="animate-spin" /> Carregando…
            </div>
          ) : palavras.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              <p>Nenhuma palavra-chave cadastrada.</p>
              <p className="mt-1 text-xs">
                O motor já cobre padrões comuns (APLIC AUT, RESGATE APLIC etc.). Adicione aqui termos específicos do seu cliente.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Palavra</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="text-center">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {palavras.map(p => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-sm">{p.palavra}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {p.descricao ?? <span className="italic">—</span>}
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-2">
                        <Switch
                          checked={p.ativo}
                          onCheckedChange={v => toggleAtivo.mutate({ id: p.id, ativo: v })}
                        />
                        {p.ativo
                          ? <Badge className="bg-[hsl(var(--kpi-green-bg))] text-[hsl(var(--kpi-green))] border-0 text-[10px]">Ativa</Badge>
                          : <Badge variant="outline" className="text-[10px]">Inativa</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(p)}>
                          <Pencil size={12} />
                        </Button>
                        <Button
                          variant="outline" size="sm"
                          className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => setDeleteTarget(p)}
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
        </CardContent>
      </Card>

      <Dialog open={showModal} onOpenChange={v => !v && closeModal()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar Palavra-chave" : "Nova Palavra-chave"}</DialogTitle>
            <DialogDescription>
              Substring que será buscada (case-insensitive) na descrição das transações para excluí-las da conciliação.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Palavra ou expressão</Label>
              <Input
                placeholder="Ex: TESOURO DIRETO"
                value={palavra}
                onChange={e => setPalavra(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Descrição (opcional)</Label>
              <Input
                placeholder="De onde vem esse termo? Banco, motivo…"
                value={descricao}
                onChange={e => setDescricao(e.target.value)}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="pc-ativo" className="cursor-pointer">Ativa</Label>
              <Switch id="pc-ativo" checked={ativo} onCheckedChange={setAtivo} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeModal}>Cancelar</Button>
            <Button
              onClick={() => (editing ? update.mutate() : create.mutate())}
              disabled={create.isPending || update.isPending || palavra.trim().length < 3}
            >
              {(create.isPending || update.isPending) && <Loader2 size={14} className="animate-spin mr-1" />}
              {editing ? "Salvar" : "Cadastrar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showReprocessConfirm} onOpenChange={setShowReprocessConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reprocessar lançamentos existentes?</AlertDialogTitle>
            <AlertDialogDescription>
              Todas as transações já importadas vinculadas a sócios serão reavaliadas. Aquelas cuja descrição bater com alguma palavra-chave (incluindo as recém-cadastradas) serão desvinculadas e removidas da Distribuição de Lucros. A consolidação mensal das empresas afetadas será recalculada.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => reprocessar.mutate()}
              disabled={reprocessar.isPending}
            >
              {reprocessar.isPending && <Loader2 size={14} className="animate-spin mr-1" />}
              Reprocessar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={v => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover palavra-chave?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.palavra}</strong> não será mais usada para filtrar transações. Considere apenas inativá-la se quiser preservar o histórico.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => deleteTarget && remove.mutate(deleteTarget.id)}
              disabled={remove.isPending}
            >
              {remove.isPending && <Loader2 size={14} className="animate-spin mr-1" />}
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default PalavrasChave;
