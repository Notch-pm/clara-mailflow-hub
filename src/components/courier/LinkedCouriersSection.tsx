import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link as RouterLink } from "react-router-dom";
import { ChevronDown, Link2, X } from "lucide-react";
import { toast } from "sonner";
import { useUserServiceFilter } from "@/hooks/useUserServiceFilter";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  computeSimilarCouriers,
  createRelation,
  deleteRelation,
  listRelationsForCourier,
  relationLabel,
  type CourierRelationType,
  type CourierRelationWithCourier,
  type RelatedCourierSummary,
} from "@/services/courierRelationService";

interface Props {
  courierId: string;
  organizationId: string;
  /** Masque complètement la section (lecture seule amont, état non initial…). */
  disabled?: boolean;
  /** Affiche les liens sans permettre de les créer ni de les défaire. */
  readOnly?: boolean;
  /** Bandeau dans une carte hôte (boîte aux lettres) plutôt que carte autonome. */
  embedded?: boolean;
  /**
   * Liste aussi les liens déjà posés. À laisser à `false` là où un onglet
   * « Liens » les porte déjà (écran d'instruction) : la section n'y sert
   * qu'à trancher les suggestions.
   */
  showRelations?: boolean;
}

const DISMISSED_STORAGE_KEY = (courierId: string) =>
  `clara:dismissed-link-suggestions:${courierId}`;

function loadDismissed(courierId: string): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_STORAGE_KEY(courierId));
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}
function saveDismissed(courierId: string, set: Set<string>) {
  try {
    localStorage.setItem(DISMISSED_STORAGE_KEY(courierId), JSON.stringify([...set]));
  } catch {
    /* noop */
  }
}

function senderOf(c: RelatedCourierSummary) {
  return c.courier_participants.find((p) => p.role === "sender")?.name ?? null;
}

function metaLine(c: RelatedCourierSummary) {
  const date = c.received_at ?? c.sent_at;
  return [
    date ? new Date(date).toLocaleDateString("fr-FR") : null,
    senderOf(c),
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Ce qu'un courrier a autour de lui : les liens déjà posés et les courriers
 * que le rapprochement propose. Les deux vivent dans la même liste — un lien
 * n'est que le devenir d'une suggestion, et se défait du même endroit.
 */
export default function LinkedCouriersSection({
  courierId,
  organizationId,
  disabled,
  readOnly = false,
  embedded = false,
  showRelations = true,
}: Props) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(true);
  const [dismissed, setDismissed] = useState<Set<string>>(() => loadDismissed(courierId));

  const { data: relations = [] } = useQuery({
    queryKey: ["courier-relations", courierId],
    queryFn: () => listRelationsForCourier(courierId),
    enabled: !disabled,
  });
  const linkedIds = useMemo(
    () => relations.map((r) => r.related?.id).filter((x): x is string => !!x),
    [relations],
  );

  // Périmètre de l'utilisateur : sans lui, la suggestion montrait l'objet d'un
  // courrier d'une organisation dont l'agent n'est pas membre (E2E
  // droits-membre, 2026-10-01).
  const scope = useUserServiceFilter();
  const { data: suggestions = [] } = useQuery({
    queryKey: ["link-suggestions-bal", organizationId, courierId, linkedIds.join(","), scope === null ? "all" : scope.join(",")],
    queryFn: () =>
      computeSimilarCouriers(organizationId, courierId, {
        excludeIds: linkedIds,
        limit: 5,
        visibleSocleOrganizationIds: scope,
      }),
    enabled: !disabled,
  });

  const pending = suggestions.filter((s) => !dismissed.has(s.courier.id));
  const ignored = suggestions.filter((s) => dismissed.has(s.courier.id));

  const linkMutation = useMutation({
    mutationFn: async (input: {
      targetId: string;
      type: CourierRelationType;
      relanceMaster?: boolean;
    }) => {
      // Une relance pointe du courrier le plus ancien vers celui qui le relance :
      // c'est le courrier suggéré qui porte la source.
      const relanceMaster = input.type === "relance" && input.relanceMaster;
      return createRelation({
        organizationId,
        sourceCourierId: relanceMaster ? input.targetId : courierId,
        targetCourierId: relanceMaster ? courierId : input.targetId,
        relationType: input.type,
        createdVia: "ai_suggestion",
      });
    },
    onSuccess: () => {
      toast.success("Lien créé");
      queryClient.invalidateQueries({ queryKey: ["courier-relations", courierId] });
    },
    onError: (e: Error) => {
      if (e.message.includes("duplicate")) toast.error("Ce lien existe déjà");
      else toast.error(e.message || "Erreur");
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: (relationId: string) => deleteRelation(relationId),
    onSuccess: () => {
      toast.success("Lien retiré");
      queryClient.invalidateQueries({ queryKey: ["courier-relations", courierId] });
    },
    onError: (e: Error) => toast.error(e.message || "Erreur"),
  });

  if (disabled) return null;
  const shownRelations = showRelations ? relations : [];
  if (shownRelations.length === 0 && suggestions.length === 0) return null;

  function setIgnored(id: string, value: boolean) {
    const next = new Set(dismissed);
    if (value) next.add(id);
    else next.delete(id);
    setDismissed(next);
    saveDismissed(courierId, next);
  }

  function ignoreAll() {
    const next = new Set(dismissed);
    pending.forEach((s) => next.add(s.courier.id));
    setDismissed(next);
    saveDismissed(courierId, next);
  }

  const hint =
    pending.length > 0
      ? "Objet, mots-clés ou expéditeur en commun"
      : shownRelations.length > 0
      ? `${shownRelations.length} lien${shownRelations.length > 1 ? "s" : ""} posé${shownRelations.length > 1 ? "s" : ""}`
      : "Toutes les suggestions sont traitées";

  /** Ligne commune aux liens posés et aux suggestions. */
  function Row({
    courier,
    reasons,
    actions,
    faded,
    last,
  }: {
    courier: RelatedCourierSummary;
    reasons?: string[];
    actions: React.ReactNode;
    faded?: boolean;
    last: boolean;
  }) {
    return (
      <li
        className={cn(
          "px-3.5 py-3",
          !last && "border-b border-border",
          faded && "opacity-60",
        )}
      >
        <div className="mb-1 flex items-baseline gap-2 text-xs">
          {courier.chrono && <span className="font-mono font-semibold">{courier.chrono}</span>}
          <span className="min-w-0 truncate text-muted-foreground">{metaLine(courier)}</span>
        </div>
        <div className="flex items-center gap-2">
          <RouterLink
            to={`/courrier/${courier.id}`}
            className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground hover:underline"
          >
            {courier.subject ?? <span className="italic text-muted-foreground">(sans objet)</span>}
          </RouterLink>
          {reasons?.slice(0, 1).map((r) => (
            <span
              key={r}
              className="shrink-0 whitespace-nowrap rounded-full bg-secondary/45 px-2 py-0.5 text-[11px] font-bold text-secondary-foreground"
            >
              {r}
            </span>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2">{actions}</div>
      </li>
    );
  }

  const rows: React.ReactNode[] = [];
  const total = shownRelations.length + pending.length + ignored.length;
  let index = 0;

  shownRelations.forEach((rel: CourierRelationWithCourier) => {
    if (!rel.related) return;
    const { title } = relationLabel(rel);
    rows.push(
      <Row
        key={`rel-${rel.id}`}
        courier={rel.related}
        last={++index === total}
        actions={
          <>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary">
              <Link2 className="h-3 w-3" />
              {title}
            </span>
            <div className="flex-1" />
            {!readOnly && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2.5 text-xs font-semibold text-muted-foreground"
                disabled={unlinkMutation.isPending}
                onClick={() => unlinkMutation.mutate(rel.id)}
              >
                Annuler
              </Button>
            )}
          </>
        }
      />,
    );
  });

  pending.forEach((s) => {
    rows.push(
      <Row
        key={`sug-${s.courier.id}`}
        courier={s.courier}
        reasons={s.reasons}
        last={++index === total}
        actions={
          readOnly ? (
            <span className="text-xs text-muted-foreground">Suggestion de rapprochement</span>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 border-primary/35 px-3 text-xs font-bold text-primary hover:bg-primary/10"
                disabled={linkMutation.isPending}
                onClick={() =>
                  linkMutation.mutate({ targetId: s.courier.id, type: "relance", relanceMaster: true })
                }
              >
                <Link2 className="h-3 w-3" />
                Lier comme relance
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-3 text-xs font-semibold"
                disabled={linkMutation.isPending}
                onClick={() => linkMutation.mutate({ targetId: s.courier.id, type: "sujet_lie" })}
              >
                Même sujet
              </Button>
              <div className="flex-1" />
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground"
                aria-label="Ignorer la suggestion"
                title="Ignorer la suggestion"
                onClick={() => setIgnored(s.courier.id, true)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </>
          )
        }
      />,
    );
  });

  ignored.forEach((s) => {
    rows.push(
      <Row
        key={`ign-${s.courier.id}`}
        courier={s.courier}
        faded
        last={++index === total}
        actions={
          <>
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-bold text-muted-foreground">
              Suggestion ignorée
            </span>
            <div className="flex-1" />
            {!readOnly && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2.5 text-xs font-semibold text-muted-foreground"
                onClick={() => setIgnored(s.courier.id, false)}
              >
                Annuler
              </Button>
            )}
          </>
        }
      />,
    );
  });

  return (
    <section
      className={cn(
        embedded ? "border-b border-border" : "rounded-lg border bg-card shadow-airbnb-sm",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-5 py-3.5 text-left transition-colors hover:bg-muted/60"
      >
        <Link2 className="h-4 w-4 shrink-0 text-warning" />
        <span className="min-w-0 flex-1">
          {/* Là où les liens posés ont leur propre liste, la section ne porte
              que les rapprochements : son titre le dit, sinon deux « Courriers
              liés » se superposent. */}
          <span className="block text-sm font-bold">
            {showRelations ? "Courriers liés" : "Rapprochements suggérés"}
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>
        </span>
        {pending.length > 0 && (
          <span className="inline-grid h-[22px] min-w-[22px] shrink-0 place-items-center rounded-full bg-secondary/45 px-1.5 text-[11px] font-bold text-secondary-foreground">
            {pending.length}
          </span>
        )}
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="px-5 pb-4">
          <ul className="max-h-[268px] overflow-auto rounded-md border border-border">{rows}</ul>
          <div className="mt-2.5 flex items-center gap-2.5">
            <span className="text-xs text-muted-foreground">
              {pending.length === 0
                ? "Toutes les suggestions sont traitées."
                : `${pending.length} suggestion${pending.length > 1 ? "s" : ""} à trancher`}
            </span>
            <div className="flex-1" />
            {!readOnly && pending.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-3 text-xs font-semibold text-muted-foreground"
                onClick={ignoreAll}
              >
                Tout ignorer
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
