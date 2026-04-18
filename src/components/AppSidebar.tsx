import { LayoutDashboard, Users, ShieldAlert, Settings } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import { ThinqiLogo } from "@/components/ThinqiLogo";
import { useAuth } from "@/contexts/AuthContext";
import { useViewAs } from "@/contexts/ViewAsContext";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";

const allItems = [
  { title: "Visão Geral", url: "/dashboard", icon: LayoutDashboard, hideForAdministrativo: false },
  { title: "Sócios", url: "/dashboard/socios", icon: Users, hideForAdministrativo: true },
  { title: "Risco Fiscal", url: "/dashboard/risco-fiscal", icon: ShieldAlert, hideForAdministrativo: false },
  { title: "Configurações", url: "/dashboard/configuracoes", icon: Settings, hideForAdministrativo: false },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { user } = useAuth();
  const { viewAs } = useViewAs();

  const isAdministrativo = user?.role === "CLIENTE" && user.perfil_cliente === "ADMINISTRATIVO" && !viewAs;
  const items = allItems.filter((i) => !(isAdministrativo && i.hideForAdministrativo));

  return (
    <Sidebar collapsible="icon" className="border-r border-border">
      <SidebarHeader className="p-4 border-b border-border">
        {collapsed ? (
          <div className="w-6 h-6 rounded-md bg-primary mx-auto" />
        ) : (
          <ThinqiLogo size="md" />
        )}
      </SidebarHeader>
      <SidebarContent className="pt-4">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end={item.url === "/dashboard"}
                      className="hover:bg-accent transition-colors"
                      activeClassName="bg-accent text-primary font-medium"
                    >
                      <item.icon className="mr-2 h-4 w-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
