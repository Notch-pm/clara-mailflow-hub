import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { listSocleOrganizations } from "@/services/socleSyncService";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Landmark } from "lucide-react";
import { toast } from "sonner";

const NONE_VALUE = "__none__";

/**
 * Mapping org Clara ↔ org Socle (superadmin uniquement).
 * Le Socle est la source de vérité des démarches : la sync nocturne ne traite
 * que les organisations dont socle_org_id est renseigné.
 */
export default function SocleIntegrationSettings({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string>(NONE_VALUE);
  const [manualId, setManualId] = useState("");

  const { data: org } = useQuery({
    queryKey: ["organization-socle-mapping", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizations")
        .select("id, socle_org_id")
        .eq("id", orgId)
        .single();
      if (error) throw error;
      return data as { id: string; socle_org_id: string | null };
    },
    enabled: !!orgId,
  });

  // Liste des orgs Socle via l'edge function (échoue tant que la fonction
  // n'est pas déployée / la clé absente → repli sur la saisie manuelle).
  const { data: socleOrgs, isError: socleListError } = useQuery({
    queryKey: ["socle-organizations"],
    queryFn: listSocleOrganizations,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    setSelected(org?.socle_org_id ?? NONE_VALUE);
    setManualId(org?.socle_org_id ?? "");
  }, [org?.socle_org_id]);

  const saveMutation = useMutation({
    mutationFn: async (socleOrgId: string | null) => {
      const { error } = await supabase
        .from("organizations")
        .update({ socle_org_id: socleOrgId } as never)
        .eq("id", orgId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Rattachement au référentiel enregistré");
      queryClient.invalidateQueries({ queryKey: ["organization-socle-mapping", orgId] });
    },
    onError: (e: Error) => toast.error("Erreur : " + e.message),
  });

  const currentValue = socleListError ? manualId.trim() || null : selected === NONE_VALUE ? null : selected;
  const isDirty = (org?.socle_org_id ?? null) !== currentValue;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Landmark className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle className="text-base">Intégration au référentiel</CardTitle>
            <CardDescription>
              Organisation du référentiel dont les démarches activées sont synchronisées chaque nuit.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {socleListError ? (
          <div className="space-y-2">
            <Label htmlFor="socle-org-id">
              Identifiant de l'organisation dans le référentiel (UUID)
            </Label>
            <Input
              id="socle-org-id"
              placeholder="ex. d5227d25-f327-493a-a9a2-278397531e33"
              value={manualId}
              onChange={(e) => setManualId(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              La liste des organisations du référentiel n'a pas pu être chargée (fonction non déployée
              ou clé API absente) — saisissez l'identifiant manuellement.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <Label>Organisation du référentiel</Label>
            <Select value={selected} onValueChange={setSelected}>
              <SelectTrigger className="w-full sm:w-96">
                <SelectValue placeholder="Choisir une organisation" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>— Aucune (sync désactivée) —</SelectItem>
                {(socleOrgs ?? []).map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.name}
                    {o.slug ? ` (${o.slug})` : ""}
                    {o.status === "obsolete" ? " — obsolète" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <Button
          onClick={() => saveMutation.mutate(currentValue)}
          disabled={!isDirty || saveMutation.isPending}
        >
          {saveMutation.isPending ? "Enregistrement…" : "Enregistrer"}
        </Button>
      </CardContent>
    </Card>
  );
}
