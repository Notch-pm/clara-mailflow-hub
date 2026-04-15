import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Building2, Users, Mail } from "lucide-react";

export default function SuperAdminDashboard() {
  const { data: orgCount } = useQuery({
    queryKey: ["superadmin-org-count"],
    queryFn: async () => {
      const { count, error } = await supabase.from("organizations").select("*", { count: "exact", head: true });
      if (error) throw error;
      return count ?? 0;
    },
  });

  const { data: userCount } = useQuery({
    queryKey: ["superadmin-user-count"],
    queryFn: async () => {
      const { count, error } = await supabase.from("users").select("*", { count: "exact", head: true });
      if (error) throw error;
      return count ?? 0;
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Administration</h1>
        <p className="text-muted-foreground">Vue d'ensemble de la plateforme Clara</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Building2 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">Organisations</CardTitle>
              <p className="text-2xl font-bold">{orgCount ?? "—"}</p>
            </div>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Users className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">Utilisateurs</CardTitle>
              <p className="text-2xl font-bold">{userCount ?? "—"}</p>
            </div>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
}
