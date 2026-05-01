import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, Settings2 } from "lucide-react";
import { toast } from "sonner";

interface OrgRow {
  id: string;
  multiple_imap: boolean;
}

export default function GeneralSettings({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient();

  const { data: org, isLoading } = useQuery({
    queryKey: ["org-general", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizations" as never)
        .select("id, multiple_imap")
        .eq("id", orgId)
        .single();
      if (error) throw error;
      return data as unknown as OrgRow;
    },
    enabled: !!orgId,
  });

  const toggleMutation = useMutation({
    mutationFn: async (value: boolean) => {
      const { error } = await supabase
        .from("organizations" as never)
        .update({ multiple_imap: value } as never)
        .eq("id", orgId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-general", orgId] });
      toast.success("Configuration enregistrée");
    },
    onError: (e: Error) => toast.error("Erreur : " + e.message),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <Settings2 className="h-5 w-5 text-primary" />
          <div>
            <CardTitle className="text-base">Configuration générale</CardTitle>
            <CardDescription>Paramètres globaux de l'organisation.</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <Label className="text-sm font-medium">
              Différencier les adresses mail destinataires par service
            </Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Permet de configurer une boîte IMAP différente par service pour la réception des emails.
            </p>
          </div>
          <Switch
            checked={org?.multiple_imap ?? false}
            disabled={toggleMutation.isPending}
            onCheckedChange={(val) => toggleMutation.mutate(val)}
          />
        </div>
      </CardContent>
    </Card>
  );
}
