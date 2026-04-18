import { useState } from "react";
import { Settings as SettingsIcon, Lock, Loader2, Eye, EyeOff } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { toast } from "sonner";

interface Perfil {
  id: string;
  nome: string;
  email: string;
  role: string;
  empresa: { razao_social: string; cnpj: string; regime_tributario: string } | null;
}

const REGIME_LABEL: Record<string, string> = {
  SIMPLES_NACIONAL: "Simples Nacional",
  LUCRO_PRESUMIDO: "Lucro Presumido",
  LUCRO_REAL: "Lucro Real",
};

const Configuracoes = () => {
  const [senhaAtual, setSenhaAtual] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [showAtual, setShowAtual] = useState(false);
  const [showNova, setShowNova] = useState(false);

  const { data: perfil } = useQuery<Perfil>({
    queryKey: ["perfil"],
    queryFn: () => api.get<Perfil>("/portal/perfil"),
  });

  const alterarSenha = useMutation({
    mutationFn: () =>
      api.put("/portal/perfil/senha", { senha_atual: senhaAtual, nova_senha: novaSenha }),
    onSuccess: () => {
      toast.success("Senha alterada com sucesso!");
      setSenhaAtual("");
      setNovaSenha("");
      setConfirmar("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleSenha = (e: React.FormEvent) => {
    e.preventDefault();
    if (novaSenha !== confirmar) {
      toast.error("As senhas não coincidem");
      return;
    }
    if (novaSenha.length < 6) {
      toast.error("Nova senha deve ter ao menos 6 caracteres");
      return;
    }
    alterarSenha.mutate();
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold tracking-tight animate-reveal">Configurações</h1>

      {/* Perfil */}
      {perfil && (
        <Card className="shadow-sm animate-reveal">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <SettingsIcon size={16} className="text-muted-foreground" />
              <CardTitle className="text-base">Meu Perfil</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between py-2 border-b border-border">
              <span className="text-sm text-muted-foreground">Nome</span>
              <span className="text-sm font-medium">{perfil.nome}</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-border">
              <span className="text-sm text-muted-foreground">E-mail</span>
              <span className="text-sm font-medium">{perfil.email}</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-border">
              <span className="text-sm text-muted-foreground">Perfil</span>
              <Badge variant="secondary">{perfil.role}</Badge>
            </div>
            {perfil.empresa && (
              <>
                <div className="flex items-center justify-between py-2 border-b border-border">
                  <span className="text-sm text-muted-foreground">Empresa</span>
                  <span className="text-sm font-medium">{perfil.empresa.razao_social}</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-border">
                  <span className="text-sm text-muted-foreground">CNPJ</span>
                  <span className="text-sm font-mono">{perfil.empresa.cnpj}</span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-muted-foreground">Regime Tributário</span>
                  <span className="text-sm font-medium">
                    {REGIME_LABEL[perfil.empresa.regime_tributario] ?? perfil.empresa.regime_tributario}
                  </span>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Alterar senha */}
      <Card className="shadow-sm animate-reveal" style={{ animationDelay: "80ms" }}>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Lock size={16} className="text-muted-foreground" />
            <CardTitle className="text-base">Alterar Senha</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSenha} className="space-y-4">
            <div className="space-y-2">
              <Label>Senha Atual</Label>
              <div className="relative">
                <Input
                  type={showAtual ? "text" : "password"}
                  value={senhaAtual}
                  onChange={e => setSenhaAtual(e.target.value)}
                  placeholder="••••••••"
                  className="pr-10"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowAtual(p => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showAtual ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Nova Senha</Label>
              <div className="relative">
                <Input
                  type={showNova ? "text" : "password"}
                  value={novaSenha}
                  onChange={e => setNovaSenha(e.target.value)}
                  placeholder="Mínimo 6 caracteres"
                  className="pr-10"
                  required
                  minLength={6}
                />
                <button
                  type="button"
                  onClick={() => setShowNova(p => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showNova ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Confirmar Nova Senha</Label>
              <Input
                type="password"
                value={confirmar}
                onChange={e => setConfirmar(e.target.value)}
                placeholder="Repita a nova senha"
                required
              />
            </div>

            <Button
              type="submit"
              disabled={!senhaAtual || !novaSenha || !confirmar || alterarSenha.isPending}
            >
              {alterarSenha.isPending && <Loader2 size={14} className="animate-spin mr-1.5" />}
              Salvar Nova Senha
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default Configuracoes;
