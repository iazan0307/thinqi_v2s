import { LayoutDashboard, Building2, Upload, FileBarChart, GitCompare, Users, UserCog, TrendingDown, Tags } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import { ThinqiLogo } from "@/components/ThinqiLogo";
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

const items = [
  { title: "Visão Geral", url: "/admin", icon: LayoutDashboard },
  { title: "Empresas & Sócios", url: "/admin/empresas", icon: Building2 },
  { title: "Central de Uploads", url: "/admin/uploads", icon: Upload },
  { title: "Conciliação Fiscal", url: "/admin/conciliacao", icon: GitCompare },
  { title: "Relatórios Gerenciais", url: "/admin/relatorios", icon: FileBarChart },
  { title: "Distribuição de Lucros", url: "/admin/retiradas", icon: TrendingDown },
  { title: "Palavras-chave", url: "/admin/palavras-chave", icon: Tags },
  { title: "Clientes", url: "/admin/clientes", icon: Users },
  { title: "Usuários Internos", url: "/admin/usuarios", icon: UserCog },
];

export function AdminSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  return (
    <Sidebar collapsible="icon" className="border-r border-border">
      <SidebarHeader className="p-4 border-b border-border">
        {collapsed ? (
          <div className="w-6 h-6 rounded-md bg-primary mx-auto" />
        ) : (
          <ThinqiLogo size="sm" />
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
                      end={item.url === "/admin"}
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
