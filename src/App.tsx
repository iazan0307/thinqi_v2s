import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ViewAsProvider, useViewAs } from "@/contexts/ViewAsContext";
import Login from "./pages/Login";
import DashboardLayout from "./layouts/DashboardLayout";
import Dashboard from "./pages/Dashboard";
import Socios from "./pages/Socios";
import RiscoFiscal from "./pages/RiscoFiscal";
import Configuracoes from "./pages/Configuracoes";
import AdminLayout from "./layouts/AdminLayout";
import AdminDashboard from "./pages/admin/AdminDashboard";
import EmpresasSocios from "./pages/admin/EmpresasSocios";
import CentralUploads from "./pages/admin/CentralUploads";
import UploadLote from "./pages/admin/UploadLote";
import Conciliacao from "./pages/admin/Conciliacao";
import RelatoriosGerenciais from "./pages/admin/RelatoriosGerenciais";
import Usuarios from "./pages/admin/Usuarios";
import Retiradas from "./pages/admin/Retiradas";
import Clientes from "./pages/admin/Clientes";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
})

function RequireAuth({ children, roles, allowViewAs }: { children: React.ReactNode; roles?: string[]; allowViewAs?: boolean }) {
  const { user, isLoading } = useAuth()
  const { viewAs } = useViewAs()
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm">
        Carregando...
      </div>
    )
  }
  if (!user) return <Navigate to="/" replace />
  if (roles && !roles.includes(user.role)) {
    // Admin/Contador com view-as ativo pode acessar rotas CLIENTE para "ver como cliente"
    if (allowViewAs && viewAs && (user.role === "ADMIN" || user.role === "CONTADOR")) return <>{children}</>
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <ViewAsProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Login />} />
            <Route
              path="/dashboard"
              element={
                <RequireAuth roles={["CLIENTE"]} allowViewAs>
                  <DashboardLayout />
                </RequireAuth>
              }
            >
              <Route index element={<Dashboard />} />
              <Route path="socios" element={<Socios />} />
              <Route path="risco-fiscal" element={<RiscoFiscal />} />
              <Route path="configuracoes" element={<Configuracoes />} />
            </Route>
            <Route
              path="/admin"
              element={
                <RequireAuth roles={["ADMIN", "CONTADOR"]}>
                  <AdminLayout />
                </RequireAuth>
              }
            >
              <Route index element={<AdminDashboard />} />
              <Route path="empresas" element={<EmpresasSocios />} />
              <Route path="uploads" element={<CentralUploads />} />
              <Route path="upload-lote" element={<UploadLote />} />
              <Route path="conciliacao" element={<Conciliacao />} />
              <Route path="relatorios" element={<RelatoriosGerenciais />} />
              <Route path="clientes" element={<Clientes />} />
              <Route path="usuarios" element={<Usuarios />} />
              <Route path="retiradas" element={<Retiradas />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
      </ViewAsProvider>
    </AuthProvider>
  </QueryClientProvider>
)

export default App;
