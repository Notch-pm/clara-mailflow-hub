import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Info, MailOpen, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { listEmailTemplates, type EmailTemplate } from "@/services/emailTemplateService";
import { getLastSyncRun, listSocleOrganizationTree, triggerSocleSync } from "@/services/socleSyncService";
import { organizationNamesFor } from "@/lib/email-templates";
import { cn } from "@/lib/utils";

interface Props {
  organizationId: string;
}

function formatSyncDate(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("fr-FR", { dateStyle: "long" })} à ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
}

/**
 * Paramètres › Modèles de courriels : les modèles du Socle cochés pour Clara, et les
 * organisations où chacun est proposé. Lecture seule — le texte et l'activation par
 * organisme se règlent dans le Socle, une fois pour toute la gamme.
 */
export default function EmailTemplatesSettings({ organizationId }: Props) {
  const queryClient = useQueryClient();

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["email-templates", organizationId],
    queryFn: () => listEmailTemplates(organizationId),
  });
  const { data: organizations = [] } = useQuery({
    queryKey: ["socle-organizations", organizationId],
    queryFn: () => listSocleOrganizationTree(organizationId),
  });
  const { data: lastSync } = useQuery({
    queryKey: ["socle-last-sync", organizationId],
    queryFn: () => getLastSyncRun(organizationId),
  });

  const syncMutation = useMutation({
    mutationFn: () => triggerSocleSync(organizationId),
    onSuccess: (result) => {
      const orgResult = result.results?.[0];
      if (orgResult?.status === "error") {
        toast.error("Échec de la synchronisation : " + (orgResult.error ?? "erreur inconnue"));
        return;
      }
      const warning = orgResult?.warnings?.find((w) => w.startsWith("modèles de courriels"));
      if (warning) toast.warning(warning);
      else toast.success("Modèles de courriels synchronisés");
      for (const key of ["email-templates", "socle-organizations", "socle-last-sync"]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: (e: Error) => toast.error("Échec de la synchronisation : " + e.message),
  });

  const rows = useMemo(
    () => templates.map((t) => ({ template: t, offeredIn: organizationNamesFor(t, organizations) })),
    [templates, organizations],
  );
  const offeredCount = rows.filter((r) => r.offeredIn.length > 0).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Modèles de courriels</h2>
          <p className="text-sm text-muted-foreground">
            Bases de rédaction proposées aux agents pour leurs réponses et leurs courriers sortants.
            {lastSync?.finished_at && lastSync.status === "success" && (
              <> Dernière synchronisation : {formatSyncDate(lastSync.finished_at)}.</>
            )}
          </p>
        </div>
        <Button
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending}
          variant="outline"
          className="shrink-0 gap-2"
        >
          <RefreshCw className={cn("h-4 w-4", syncMutation.isPending && "animate-spin")} />
          {syncMutation.isPending ? "Synchronisation…" : "Synchroniser maintenant"}
        </Button>
      </div>

      <div className="flex gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <div className="space-y-1">
          <p>
            Les modèles se rédigent dans le <strong>référentiel (Socle)</strong> : <em>Paramètres de
            l'organisation principale › Modèles de courriels</em>. Un modèle y apparaît ici quand
            l'application <strong>Clara</strong> est cochée.
          </p>
          <p>
            L'activation se fait au même endroit, dans <em>« Organismes où il est proposé »</em> (boutons{" "}
            <em>Tous</em> / <em>Aucun</em>). Un organisme se coche nommément : cocher l'organisation
            principale n'ouvre pas ses services. Les changements arrivent dans Clara à la
            synchronisation suivante (chaque nuit, ou avec le bouton ci-dessus).
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">
            Modèles destinés à Clara
            {templates.length > 0 && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({offeredCount} proposé{offeredCount > 1 ? "s" : ""} sur {templates.length})
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : templates.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
              <MailOpen className="h-8 w-8" aria-hidden="true" />
              <p>Aucun modèle de courriel coché pour Clara dans le référentiel.</p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map(({ template, offeredIn }) => (
                <TemplateRow key={template.id} template={template} offeredIn={offeredIn} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TemplateRow({ template, offeredIn }: { template: EmailTemplate; offeredIn: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="py-3">
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <p className="font-medium">{template.name}</p>
            {template.description && (
              <p className="text-xs text-muted-foreground">{template.description}</p>
            )}
            <p className="text-xs text-muted-foreground">
              Objet : <span className="text-foreground">{template.subject}</span>
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
            {offeredIn.length === 0 ? (
              <Badge variant="outline" className="text-muted-foreground">Proposé nulle part</Badge>
            ) : (
              <div className="flex max-w-md flex-wrap gap-1 sm:justify-end">
                {offeredIn.map((name) => (
                  <Badge key={name} variant="secondary" className="font-normal">{name}</Badge>
                ))}
              </div>
            )}
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs">
                {open ? "Masquer le texte" : "Voir le texte"}
                <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
              </Button>
            </CollapsibleTrigger>
          </div>
        </div>
        <CollapsibleContent>
          <pre className="mt-2 whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-3 font-sans text-sm">
            {template.body}
          </pre>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}
