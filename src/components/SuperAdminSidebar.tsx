import {
  LayoutDashboard,
  Building2,
  ChevronLeft,
  LogOut,
  ChevronsUpDown,
  Mail,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { Separator } from "@/components/ui/separator";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const mainItems = [
  { title: "Tableau de bord", url: "/superadmin", icon: LayoutDashboard },
  { title: "Organisations", url: "/superadmin/organisations", icon: Building2 },
];

export function SuperAdminSidebar() {
  const { state, toggleSidebar } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { profile, signOut } = useAuth();

  const displayName = profile
    ? [profile.first_name, profile.last_name].filter(Boolean).join(" ") || "Super Admin"
    : "";

  const initials = profile
    ? [profile.first_name, profile.last_name]
        .filter(Boolean)
        .map((n) => (n as string).charAt(0).toUpperCase())
        .join("")
    : "SA";

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="p-4">
        <div className="flex flex-col gap-2">
          <div className="h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground font-bold text-lg flex flex-row">
            <Mail className="h-5 w-5" />
          </div>
          {!collapsed && (
            <div className="flex flex-col">
              <span className="text-sm font-bold text-sidebar-accent-foreground tracking-tight">
                Clara
              </span>
              <span className="text-xs text-sidebar-foreground/60">
                Administration SaaS
              </span>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Plateforme</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={
                      item.url === "/superadmin"
                        ? location.pathname === "/superadmin"
                        : location.pathname.startsWith(item.url)
                    }
                    tooltip={item.title}
                  >
                    <NavLink
                      to={item.url}
                      end={item.url === "/superadmin"}
                      className="touch-target flex items-center gap-3"
                      activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-semibold"
                    >
                      <item.icon className="h-5 w-5 shrink-0" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-2 space-y-1">
        <Separator className="w-auto" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="w-full flex items-center gap-3 rounded-md px-2 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent transition-colors focus:outline-none">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-sidebar-primary-foreground text-xs font-semibold">
                {initials}
              </div>
              {!collapsed && (
                <div className="flex flex-col items-start truncate">
                  <span className="text-sm font-medium text-sidebar-accent-foreground truncate">
                    {displayName}
                  </span>
                  <span className="text-xs text-sidebar-foreground/60 truncate">
                    Super Admin
                  </span>
                </div>
              )}
              {!collapsed && (
                <ChevronsUpDown className="ml-auto h-3.5 w-3.5 shrink-0 text-sidebar-foreground/60" />
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-48">
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={signOut}
              className="gap-2 cursor-pointer text-destructive focus:text-destructive"
            >
              <LogOut className="h-4 w-4" />
              Déconnexion
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex justify-center">
          <button
            onClick={toggleSidebar}
            className="flex items-center justify-center h-9 w-full rounded-md text-sidebar-foreground/60 hover:text-sidebar-accent-foreground hover:bg-sidebar-accent transition-colors"
          >
            <ChevronLeft
              className={`h-4 w-4 transition-transform ${collapsed ? "rotate-180" : ""}`}
            />
          </button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
