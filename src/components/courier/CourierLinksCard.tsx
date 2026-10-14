import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link as RouterLink } from "react-router-dom";
import { Plus, X, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import LinkCourierDialog from "./LinkCourierDialog";
import { unlinkOutboundFromInbound } from "@/services/outboundCourierService";
import {
  deleteRelation,
  listRelationsForCourier,
  type CourierRelationWithCourier,
} from "@/services/courierRelationService";

interface Props {
  courierId: string;
  organizationId: string;
  readOnly?: boolean;
  /** Courrier à l'initiative : liens vers des courriers reçus seulement, tracés des deux côtés. */
  initiative?: { chrono: string | null; subject: string | null } | null;
}

function relationLabel(rel: CourierRelationWithCourier) {
  if (rel.relation_type !== "relance") return "Sujet lié";
  return rel.direction === "outgoing" ? "Relance émise vers" : "Relancé par";
}

function RelationRow({
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
  const meta = [relationLabel(rel), sender?.name].filter(Boolean).join(" · ");
  return (
    <li className="group -mx-2 flex items-start gap-1 rounded-lg p-2 transition-colors hover:bg-muted">
      <RouterLink to={`/courrier/${c.id}`} className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-semibold">
          {c.subject ?? <span className="italic text-muted-foreground">(sans objet)</span>}
        </span>
        <span className="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
          {c.chrono && <span className="font-mono">{c.chrono}</span>}
          {c.chrono && meta && <span aria-hidden>·</span>}
          <span>{meta}</span>
          {rel.created_via === "ai_suggestion" && (
            <Sparkles className="h-3 w-3" aria-label="Lien suggéré par l'analyse" />
          )}
        </span>
        {rel.note && <span className="text-xs italic text-muted-foreground">« {rel.note} »</span>}
      </RouterLink>
      {!readOnly && (
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
          onClick={() => onRemove(rel.id)}
          aria-label="Retirer le lien"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
    </li>
  );
}

/**
 * Carte « Courriers liés » de la colonne de contexte : relances et sujets
 * liés, déjà posés. Les suggestions à trancher, elles, sont en tête de
 * l'onglet « Courrier » (`LinkedCouriersSection`).
 */
export default function CourierLinksCard({ courierId, organizationId, readOnly, initiative = null }: Props) {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: relations = [], isLoading } = useQuery({
    queryKey: ["courier-relations", courierId],
    queryFn: () => listRelationsForCourier(courierId),
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const rel = relations.find((r) => r.id === id);
      // Un lien entre un courrier à l'initiative et un courrier reçu se retire
      // en laissant une trace des deux côtés, comme il s'est posé.
      const outboundSide = initiative
        ? { id: courierId, chrono: initiative.chrono, subject: initiative.subject }
        : rel?.related?.direction === "outbound"
          ? { id: rel.related.id, chrono: rel.related.chrono, subject: rel.related.subject }
          : null;
      if (rel?.related && outboundSide) {
        const inboundSide = initiative
          ? { id: rel.related.id, chrono: rel.related.chrono, subject: rel.related.subject }
          : { id: courierId, chrono: null, subject: null };
        await unlinkOutboundFromInbound({ organizationId, relationId: id, outbound: outboundSide, inbound: inboundSide });
        return;
      }
      await deleteRelation(id);
    },
    onSuccess: () => {
      toast.success("Lien retiré");
      queryClient.invalidateQueries({ queryKey: ["courier-relations", courierId] });
      queryClient.invalidateQueries({ queryKey: ["courier-events"] });
    },
    onError: (e: Error) => toast.error(e.message || "Erreur lors de la suppression"),
  });

  // Les relances d'abord : ce sont elles qui pressent.
  const sorted = [
    ...relations.filter((r) => r.relation_type === "relance"),
    ...relations.filter((r) => r.relation_type !== "relance"),
  ];
  const excludeIds = relations.map((r) => r.related?.id).filter((id): id is string => !!id);

  return (
    <Card className="p-5 shadow-airbnb-sm">
      <div className="mb-2.5 flex items-center gap-2">
        <h3 className="flex-1 text-base font-semibold leading-tight">Courriers liés</h3>
        {!readOnly && (
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-primary"
            onClick={() => setDialogOpen(true)}
            aria-label="Lier un courrier"
            title={
              initiative
                ? "Lier ce courrier à un courrier reçu"
                : "Lier ce courrier à une relance ou à un courrier du même sujet"
            }
          >
            <Plus className="h-4 w-4" />
          </Button>
        )}
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun courrier lié.</p>
      ) : (
        <ul className="flex flex-col">
          {sorted.map((rel) => (
            <RelationRow key={rel.id} rel={rel} onRemove={(id) => removeMutation.mutate(id)} readOnly={readOnly} />
          ))}
        </ul>
      )}

      <LinkCourierDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        courierId={courierId}
        organizationId={organizationId}
        excludeIds={excludeIds}
        initiative={initiative}
      />
    </Card>
  );
}
