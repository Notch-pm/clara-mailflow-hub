import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link as RouterLink } from "react-router-dom";
import { Plus, X, ExternalLink, Sparkles, Link2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import LinkCourierDialog from "./LinkCourierDialog";
import SimilarCouriersAlert from "./SimilarCouriersAlert";
import {
  deleteRelation,
  listRelationsForCourier,
  type CourierRelationWithCourier,
} from "@/services/courierRelationService";

interface Props {
  courierId: string;
  organizationId: string;
  readOnly?: boolean;
}

function RelationCard({
  rel,
  onRemove,
  readOnly,
}: {
  rel: CourierRelationWithCourier;
  onRemove: (id: string) => void;
  readOnly?: boolean;
}) {
  const c = rel.related;
  if (!c) return null;
  const sender = c.courier_participants.find((p) => p.role === "sender");
  const date = c.received_at ?? c.sent_at;
  const label =
    rel.relation_type === "relance"
      ? rel.direction === "outgoing"
        ? "Relance émise vers"
        : "Relancé par"
      : "Sujet lié";
  return (
    <div className="rounded-md border bg-card px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground/70">{label}</span>
            {c.chrono && <span className="font-mono">· {c.chrono}</span>}
            {date && (
              <span>
                ·{" "}
                {new Date(date).toLocaleDateString("fr-FR", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                })}
              </span>
            )}
            {rel.created_via === "ai_suggestion" && (
              <Badge variant="outline" className="gap-1 text-[10px]">
                <Sparkles className="h-3 w-3" /> IA
              </Badge>
            )}
          </div>
          <RouterLink
            to={`/courrier/${c.id}`}
            className="block truncate text-sm font-medium hover:underline"
          >
            {c.subject ?? <span className="italic text-muted-foreground">(sans objet)</span>}
          </RouterLink>
          {sender?.name && (
            <div className="truncate text-xs text-muted-foreground">De {sender.name}</div>
          )}
          {rel.note && (
            <p className="text-xs italic text-muted-foreground">« {rel.note} »</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <RouterLink
            to={`/courrier/${c.id}`}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-primary"
            aria-label="Ouvrir le courrier lié"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </RouterLink>
          {!readOnly && (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              onClick={() => onRemove(rel.id)}
              aria-label="Retirer le lien"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CourierLinksTab({ courierId, organizationId, readOnly }: Props) {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: relations = [], isLoading } = useQuery({
    queryKey: ["courier-relations", courierId],
    queryFn: () => listRelationsForCourier(courierId),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => deleteRelation(id),
    onSuccess: () => {
      toast.success("Lien retiré");
      queryClient.invalidateQueries({ queryKey: ["courier-relations", courierId] });
    },
    onError: (e: Error) => toast.error(e.message || "Erreur lors de la suppression"),
  });

  const relances = relations.filter((r) => r.relation_type === "relance");
  const sujetsLies = relations.filter((r) => r.relation_type === "sujet_lie");
  const excludeIds = relations
    .map((r) => r.related?.id)
    .filter((id): id is string => !!id);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Link2 className="h-4 w-4" /> Courriers liés
          </h2>
          <p className="text-sm text-muted-foreground">
            Liez ce courrier à des relances ou à d'autres courriers parlant du même sujet.
          </p>
        </div>
        {!readOnly && (
          <Button onClick={() => setDialogOpen(true)} className="gap-1">
            <Plus className="h-4 w-4" /> Lier un courrier
          </Button>
        )}
      </div>

      <SimilarCouriersAlert
        courierId={courierId}
        organizationId={organizationId}
        disabled={readOnly}
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : (
        <>
          <section className="space-y-2">
            <h3 className="text-sm font-medium">
              Relances{" "}
              <span className="text-muted-foreground">({relances.length})</span>
            </h3>
            {relances.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune relance liée.</p>
            ) : (
              <div className="space-y-2">
                {relances.map((rel) => (
                  <RelationCard
                    key={rel.id}
                    rel={rel}
                    onRemove={(id) => removeMutation.mutate(id)}
                    readOnly={readOnly}
                  />
                ))}
              </div>
            )}
          </section>

          <Separator />

          <section className="space-y-2">
            <h3 className="text-sm font-medium">
              Sujets liés{" "}
              <span className="text-muted-foreground">({sujetsLies.length})</span>
            </h3>
            {sujetsLies.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun courrier lié sur le même sujet.</p>
            ) : (
              <div className="space-y-2">
                {sujetsLies.map((rel) => (
                  <RelationCard
                    key={rel.id}
                    rel={rel}
                    onRemove={(id) => removeMutation.mutate(id)}
                    readOnly={readOnly}
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      <LinkCourierDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        courierId={courierId}
        organizationId={organizationId}
        excludeIds={excludeIds}
      />
    </div>
  );
}
