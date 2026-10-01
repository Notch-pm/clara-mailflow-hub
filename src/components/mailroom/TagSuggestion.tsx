import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { splitAppliedTags } from "@/lib/courier-tags";
import { readableTextColor } from "@/lib/tag-color";
import { getAnalysis } from "@/services/courierAnalysisService";
import { COURIER_LIST_QUERY_PREFIXES } from "@/services/courierListService";
import { updateCourier } from "@/services/courierService";
import { listTags, TAG_GROUPS } from "@/services/courierTagService";

interface Props {
  organizationId: string;
  courierId: string;
  /** Métadonnées à jour du courrier (`mailroom-courier`) : les tags y vivent. */
  metadata: Record<string, unknown> | null;
  canEdit: boolean;
}

/**
 * Tags proposés par l'analyse IA, ajoutables depuis le panneau du Courrier
 * entrant — même geste que l'onglet Contenu de la fiche : l'agent écarte ce
 * qui ne convient pas, puis ajoute le reste. Les tags proposés COMPLÈTENT ceux
 * déjà posés, ils ne les remplacent jamais.
 *
 * N'affiche que les propositions pas encore appliquées : rien à faire, rien à
 * montrer.
 */
export default function TagSuggestion({ organizationId, courierId, metadata, canEdit }: Props) {
  const qc = useQueryClient();
  const { data: analysis } = useQuery({
    queryKey: ["courier-analysis", courierId],
    queryFn: () => getAnalysis(courierId),
  });
  const { data: orgTags } = useQuery({
    queryKey: ["courier-tags", organizationId],
    queryFn: () => listTags(organizationId),
  });

  const currentTags = useMemo(() => (metadata?.tags as string[] | undefined) ?? [], [metadata]);
  const appliedSet = useMemo(() => new Set(currentTags.map((t) => t.toLowerCase())), [currentTags]);

  // Propositions retenues par l'agent (il peut en écarter avant d'ajouter).
  const [selected, setSelected] = useState<string[]>([]);
  useEffect(() => {
    setSelected((analysis?.intents ?? []).filter((t) => !appliedSet.has(t.toLowerCase())));
  }, [analysis?.intents, appliedSet, courierId]);

  const byGroup = useMemo(() => splitAppliedTags(selected, orgTags ?? []), [selected, orgTags]);

  const apply = useMutation({
    mutationFn: async () => {
      const toAdd = selected.filter((t) => !appliedSet.has(t.toLowerCase()));
      if (toAdd.length === 0) return 0;
      const { error } = await updateCourier(organizationId, courierId, {
        metadata: { ...(metadata ?? {}), tags: [...currentTags, ...toAdd] },
      });
      if (error) throw error;
      return toAdd.length;
    },
    onSuccess: (count) => {
      toast.success(`${count} tag(s) ajouté(s) au courrier`);
      qc.invalidateQueries({ queryKey: ["courier", courierId] });
      qc.invalidateQueries({ queryKey: ["mailroom-courier", courierId] });
      // Les listes filtrent par tag côté serveur.
      COURIER_LIST_QUERY_PREFIXES.forEach((prefix) => qc.invalidateQueries({ queryKey: [prefix] }));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (selected.length === 0) return null;

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border bg-primary/5 px-3.5 py-3">
      <div className="flex items-center gap-2.5">
        <Sparkles className="h-4 w-4 shrink-0 text-primary" />
        <p className="flex-1 text-xs text-muted-foreground">Tags proposés par Clara</p>
        {canEdit && (
          <Button size="sm" className="h-7 shrink-0 gap-1 text-xs" disabled={apply.isPending} onClick={() => apply.mutate()}>
            {apply.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            Ajouter les tags
          </Button>
        )}
      </div>
      {TAG_GROUPS.map((group) => {
        const items = byGroup[group.value];
        if (items.length === 0) return null;
        return (
          <div key={group.value} className="flex flex-wrap items-center gap-1.5 pl-6">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">{group.label}</span>
            {items.map(({ name, tag }) => (
              <Badge
                key={name}
                variant="secondary"
                className="gap-1 border-transparent py-0.5 pl-2 pr-1 text-xs"
                style={tag?.color ? { backgroundColor: tag.color, color: readableTextColor(tag.color) } : undefined}
              >
                {tag?.name ?? name}
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => setSelected((prev) => prev.filter((t) => t !== name))}
                    className="ml-0.5 rounded-full p-0.5 transition-colors hover:bg-background/30"
                    aria-label={`Écarter ${name}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </Badge>
            ))}
          </div>
        );
      })}
    </div>
  );
}
