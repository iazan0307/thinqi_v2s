import { Bell, User, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";

export function AppHeader() {
  const { user, logout } = useAuth();

  return (
    <header className="h-14 border-b border-border bg-card flex items-center justify-between px-4 gap-4">
      <div className="flex items-center gap-3">
        <SidebarTrigger />
        <span className="text-sm text-muted-foreground hidden sm:block">
          Olá, <span className="font-medium text-foreground">{user?.nome ?? "Cliente"}</span>
        </span>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="relative">
          <Bell size={18} />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-2">
              <User size={16} />
              <span className="hidden sm:inline text-sm">Área do Cliente</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <div className="px-2 py-1.5 text-xs text-muted-foreground">{user?.email}</div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={logout} className="gap-2 text-destructive focus:text-destructive">
              <LogOut size={14} />
              Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
