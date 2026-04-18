import { Outlet, useNavigate } from "react-router-dom";
import { Eye, X } from "lucide-react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { AppHeader } from "@/components/AppHeader";
import { useViewAs } from "@/contexts/ViewAsContext";
import { useAuth } from "@/contexts/AuthContext";

const DashboardLayout = () => {
  const { viewAs, exitViewAs } = useViewAs();
  const { user } = useAuth();
  const navigate = useNavigate();
  const isImpersonating = viewAs && user && user.role !== "CLIENTE";

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          {isImpersonating && (
            <div className="bg-amber-100 border-b border-amber-300 px-4 py-2 flex items-center justify-between text-sm text-amber-900">
              <div className="flex items-center gap-2">
                <Eye size={14} />
                <span>
                  Visualizando como cliente: <strong>{viewAs.razaoSocial}</strong> — este modo exibe o portal com os dados dessa empresa.
                </span>
              </div>
              <button
                onClick={() => { exitViewAs(); navigate("/admin/empresas"); }}
                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-200 hover:bg-amber-300 transition-colors text-xs font-medium"
              >
                <X size={12} /> Sair do modo cliente
              </button>
            </div>
          )}
          <AppHeader />
          <main className="flex-1 p-4 md:p-6 lg:p-8 overflow-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default DashboardLayout;
