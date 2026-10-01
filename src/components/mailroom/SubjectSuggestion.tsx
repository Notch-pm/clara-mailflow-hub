import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getAnalysis } from "@/services/courierAnalysisService";
import { COURIER_LIST_QUERY_PREFIXES } from "@/services/courierListService";
import { updateCourier } from "@/services/courierService";

interface Props {
  organizationId: string;
  courierId: string;
  currentSubject: string | null;
  canEdit: boolean;
}

/**
 * Objet proposé par l'analyse IA, applicable d'un clic depuis le panneau du
 * Courrier entrant. Enjeu : un courrier numérisé arrive titré « Courrier
 * numérisé — à qualifier » ; sans ce geste, l'agent devait ouvrir la fiche
 * (onglet Contenu) pour reprendre le titre proposé.
 *
 * Lit l'analyse sous la même clé que la fiche (cache partagé). Rien ne
 * s'affiche si la proposition est déjà l'objet du courrier.
 */
export default function SubjectSuggestion({ organizationId, courierId, currentSubject, canEdit }: Props) {
  const qc = useQueryClient();
  const { data: analysis } = useQuery({
    queryKey: ["courier-analysis", courierId],
    queryFn: () => getAnalysis(courierId),
  });

  const suggested = analysis?.suggested_subject?.trim() || null;

  const apply = useMutation({
    mutationFn: async () => {
      if (!suggested) return;
      const { error } = await updateCourier(organizationId, courierId, { subject: suggested });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Objet appliqué au courrier");
      qc.invalidateQueries({ queryKey: ["courier", courierId] });
      qc.invalidateQueries({ queryKey: ["mailroom-courier", courierId] });
      COURIER_LIST_QUERY_PREFIXES.forEach((prefix) => qc.invalidateQueries({ queryKey: [prefix] }));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!suggested || suggested === (currentSubject ?? "").trim()) return null;

  return (
    <div className="flex items-start gap-2.5 rounded-lg border bg-primary/5 px-3.5 py-3">
      <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">Objet proposé par Clara</p>
        <p className="text-sm font-medium break-words">{suggested}</p>
      </div>
      {canEdit && (
        <Button
          size="sm"
          className="h-7 shrink-0 gap-1 text-xs"
          disabled={apply.isPending}
          onClick={() => apply.mutate()}
        >
          {apply.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          Appliquer
        </Button>
      )}
    </div>
  );
}
