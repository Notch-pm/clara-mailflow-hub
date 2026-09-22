import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, MinusCircle, PenLine, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { canEditCouriers } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { consentsSummary, consentViews, parseSocleConsents } from "@/lib/consents";
import type { SocleContact } from "@/services/socleContactService";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import RecordConsentDialog from "./RecordConsentDialog";

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" });
}

/**
 * Consentements RGPD d'une fiche du référentiel — TROIS états, pas deux :
 * accordé, refusé, jamais demandé. C'est la date du dernier recueil qui
 * tranche, jamais le booléen seul : une fiche antérieure au 13/09/2026, ou
 * jamais passée par un dépôt, porte `false` sans qu'on lui ait rien demandé.
 *
 * Ce qui est affiché est l'état du RÉFÉRENTIEL (Socle), propriétaire du
 * consentement d'une personne. Clara ne l'écrit que par un recueil : au
 * rattachement d'un dépôt portail, ou par la consignation manuelle d'un agent
 * (bouton, éditeurs seulement).
 */
export default function ConsentementsCard({
  organizationId,
  contact,
}: {
  organizationId: string;
  contact: SocleContact;
}) {
  const { profile, membership } = useAuth();
  const canRecord = canEditCouriers(profile, membership) && contact.status === "active";
  const [recordOpen, setRecordOpen] = useState(false);

  // Le nom de l'organisation : celui que le serveur interpole dans la phrase
  // (`organizations.name`, miroir du nom de la racine Socle). Le lire ici
  // garantit que l'écran affiche la phrase qui sera consignée.
  const orgQuery = useQuery({
    queryKey: ["organization-name", organizationId],
    queryFn: async () => {
      const { data } = await supabase
        .from("organizations")
        .select("name")
        .eq("id", organizationId)
        .maybeSingle();
      return (data?.name as string | null) ?? null;
    },
    staleTime: 5 * 60_000,
  });
  const organismName = orgQuery.data ?? null;

  const views = consentViews(contact, organismName);
  const history = parseSocleConsents(contact.consents);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div>
            <CardTitle className="text-base">Consentements RGPD</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">{consentsSummary(views)}</p>
          </div>
          {canRecord && (
            <Button variant="outline" size="sm" className="ml-auto" onClick={() => setRecordOpen(true)}>
              <PenLine className="h-4 w-4 mr-2" /> Consigner un recueil
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="space-y-2">
          {views.map((v) => (
            <li key={v.kind} className="rounded-md border px-3.5 py-3 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                {v.neverCollected ? (
                  <MinusCircle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                ) : v.granted ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                ) : (
                  <XCircle className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
                )}
                <span className="text-sm font-semibold">{v.label}</span>
                {v.required && <Badge variant="secondary">Obligatoire au dépôt</Badge>}
                <span
                  className={cn(
                    "ml-auto text-xs font-semibold",
                    v.neverCollected ? "text-muted-foreground" : v.granted ? "text-primary" : "text-destructive",
                  )}
                >
                  {v.neverCollected
                    ? "Jamais demandé"
                    : `${v.granted ? "Accordé" : "Refusé"} le ${formatDateTime(v.at!)}`}
                </span>
              </div>
              {/* La phrase du DERNIER recueil, telle qu'elle a été lue — pas
                  celle d'aujourd'hui : le nom de la collectivité peut avoir
                  changé depuis, ce qui a été accepté non. */}
              <p className="text-[13px] leading-relaxed text-muted-foreground">« {v.statement} »</p>
            </li>
          ))}
        </ul>

        {history.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer font-medium text-muted-foreground">
              Historique des recueils ({history.length})
            </summary>
            <ul className="mt-2 divide-y rounded-md border">
              {history.map((row, i) => (
                <li key={`${row.kind}-${row.at}-${i}`} className="flex flex-wrap items-center gap-2 px-3 py-2 text-[13px]">
                  <span className="min-w-[150px] flex-1 font-medium">{row.label}</span>
                  <span className={cn("font-semibold", row.granted ? "text-primary" : "text-destructive")}>
                    {row.granted ? "Accordé" : "Refusé"}
                  </span>
                  {/* Le code de l'application est celui du référentiel, affiché
                      tel quel : le catalogue des applications de la gamme ne
                      nous appartient pas. */}
                  {row.source && (
                    <span className="rounded-full bg-muted px-2 py-[2px] text-[11px] font-medium text-muted-foreground">
                      {row.source}
                    </span>
                  )}
                  {row.reference && (
                    <span className="text-[11px] text-muted-foreground truncate max-w-[180px]" title={row.reference}>
                      réf. {row.reference}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">{row.at ? formatDateTime(row.at) : "—"}</span>
                </li>
              ))}
            </ul>
          </details>
        )}

        <p className="text-xs text-muted-foreground">
          Recueillis au dépôt d'un courrier ou consignés par un agent, et conservés par le référentiel Socle.
          Un recueil ne se modifie pas : un nouveau recueil le remplace.
        </p>
      </CardContent>

      {canRecord && (
        <RecordConsentDialog
          open={recordOpen}
          onOpenChange={setRecordOpen}
          organizationId={organizationId}
          contact={contact}
          organismName={organismName}
        />
      )}
    </Card>
  );
}
