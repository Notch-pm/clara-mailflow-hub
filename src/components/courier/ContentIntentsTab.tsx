import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, FileText, Sparkles, Loader2, RefreshCw, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { getDocuments } from "@/services/courierDocumentService";
import { getCourierById, updateCourier } from "@/services/courierService";
import { listTags } from "@/services/courierTagService";
import { readableTextColor } from "@/lib/tag-color";
import {
  getExtracts,
  getAnalysis,
  runOcr,
  runAnalysis,
  runFullAnalysis,
} from "@/services/courierAnalysisService";
import SuggestedActionsCard from "./SuggestedActionsCard";

interface Props {
  courierId: string;
  organizationId: string;
  /** When true, disables OCR/analysis buttons and tag application. */
  readOnly?: boolean;
  /** Service gestionnaire modifiable uniquement à l'état initial du workflow. */
  isInitialState?: boolean;
}

const SENTIMENT_VARIANT: Record<string, { label: string; className: string }> = {
  neutre: { label: "Neutre", className: "bg-muted text-foreground" },
  courtois: { label: "Courtois", className: "bg-primary/15 text-primary" },
  urgent: { label: "Urgent", className: "bg-orange-500/15 text-orange-700 dark:text-orange-400" },
  mécontent: { label: "Mécontent", className: "bg-destructive/15 text-destructive" },
  agressif: { label: "Agressif", className: "bg-destructive/25 text-destructive" },
  satisfait: { label: "Satisfait", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  inquiet: { label: "Inquiet", className: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ContentIntentsTab({ courierId, organizationId, readOnly = false, isInitialState = true }: Props) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const { data: documents } = useQuery({
    queryKey: ["courier-documents", courierId],
    queryFn: () => getDocuments(courierId),
    enabled: !!courierId,
  });

  const { data: courierData } = useQuery({
    queryKey: ["courier", organizationId, courierId],
    queryFn: async () => {
      const { data, error } = await getCourierById(organizationId, courierId);
      if (error) throw error;
      return data;
    },
    enabled: !!courierId && !!organizationId,
  });

  const { data: extracts, isLoading: extractsLoading } = useQuery({
    queryKey: ["courier-extracts", courierId],
    queryFn: () => getExtracts(courierId),
    enabled: !!courierId,
  });

  const { data: analysis, isLoading: analysisLoading } = useQuery({
    queryKey: ["courier-analysis", courierId],
    queryFn: () => getAnalysis(courierId),
    enabled: !!courierId,
  });

  const { data: orgTags } = useQuery({
    queryKey: ["courier-tags", organizationId],
    queryFn: () => listTags(organizationId),
    enabled: !!organizationId,
  });

  const tagByLowerName = useMemo(() => {
    const m = new Map<string, { name: string; color: string | null }>();
    (orgTags ?? []).forEach((t) => m.set(t.name.toLowerCase(), { name: t.name, color: t.color }));
    return m;
  }, [orgTags]);

  // État local de la sélection d'intents (modifiable avant application)
  const [selectedIntents, setSelectedIntents] = useState<string[]>([]);
  useEffect(() => {
    setSelectedIntents(analysis?.intents ?? []);
  }, [analysis?.intents, courierId]);

  const currentCourierTags = useMemo(
    () => ((courierData?.metadata as Record<string, unknown> | null)?.tags as string[] | undefined) ?? [],
    [courierData?.metadata],
  );

  const isDirty = useMemo(() => {
    const a = [...selectedIntents].sort();
    const b = [...currentCourierTags].sort();
    return a.length !== b.length || a.some((v, i) => v !== b[i]);
  }, [selectedIntents, currentCourierTags]);

  const ocrMutation = useMutation({
    mutationFn: () => runOcr(courierId),
    onSuccess: (data) => {
      const failed = data.results.filter((r) => !r.ok);
      if (failed.length > 0) {
        toast.warning(`${data.results.length - failed.length}/${data.results.length} documents extraits`, {
          description: failed[0]?.error,
        });
      } else {
        toast.success(`${data.results.length} document(s) extrait(s)`);
      }
      qc.invalidateQueries({ queryKey: ["courier-extracts", courierId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const analyzeMutation = useMutation({
    mutationFn: () => runAnalysis(courierId),
    onSuccess: () => {
      toast.success("Analyse mise à jour");
      qc.invalidateQueries({ queryKey: ["courier-analysis", courierId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Bouton unique "Analyser" pour le premier lancement (OCR + LLM en une action) :
  // une fois qu'une analyse existe, les boutons distincts ci-dessus reprennent la main.
  const runFullAnalysisMutation = useMutation({
    mutationFn: () => runFullAnalysis(courierId),
    onSuccess: () => {
      toast.success("Analyse terminée");
      qc.invalidateQueries({ queryKey: ["courier-extracts", courierId] });
      qc.invalidateQueries({ queryKey: ["courier-analysis", courierId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { data: orgServices } = useQuery({
    queryKey: ["org-services", organizationId],
    queryFn: () => listServices(organizationId),
    enabled: !!organizationId,
  });

  const participants =
    (courierData as { courier_participants?: Array<{
      id: string;
      role: string;
      name: string | null;
      email: string | null;
      phone: string | null;
      usager_id: string | null;
    }> } | null)?.courier_participants ?? [];
  const senderParticipant = participants.find((p) => p.role === "sender");
  const recipientParticipant = participants.find((p) => p.role === "recipient");



  const applyTagsMutation = useMutation({
    mutationFn: async () => {
      const currentMeta = (courierData?.metadata as Record<string, unknown> | null) ?? {};
      const { error } = await updateCourier(organizationId, courierId, {
        metadata: { ...currentMeta, tags: selectedIntents },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Tags appliqués au courrier");
      qc.invalidateQueries({ queryKey: ["courier", organizationId, courierId] });
      qc.invalidateQueries({ queryKey: ["couriers"] });
      qc.invalidateQueries({ queryKey: ["courier-instruction"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const docCount = documents?.length ?? 0;
  const extractCount = extracts?.length ?? 0;
  const hasExtracts = extractCount > 0;
  const meta = (courierData?.metadata ?? {}) as Record<string, unknown>;
  const hasEmailBody =
    (typeof meta.body_text === "string" && meta.body_text.trim().length > 0) ||
    (typeof meta.body_html === "string" && meta.body_html.trim().length > 0);
  const canAnalyze = hasExtracts || hasEmailBody;

  if (docCount === 0 && !hasEmailBody) {
    return (
      <div className="text-center py-10">
        <FileText className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
        <p className="text-sm text-muted-foreground">Aucun contenu à analyser.</p>
        <p className="text-xs text-muted-foreground/70 mt-1">
          Joignez un fichier ou réceptionnez un email pour activer l'analyse IA.
        </p>
      </div>
    );
  }

  const extractByDocId = new Map((extracts ?? []).map((e) => [e.document_id, e]));

  return (
    <div className="space-y-6">
      {/* === Section : Contenu des documents === */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold">Contenu des documents</h3>
            <p className="text-xs text-muted-foreground">
              {extractCount}/{docCount} document(s) extrait(s) via OCR Mistral
            </p>
          </div>
          {/* Avant la première analyse, le bouton unique "Analyser" de la section
              ci-dessous se charge de l'extraction — ce bouton dédié ne réapparaît
              qu'une fois une analyse déjà disponible, pour le diagnostic fin. */}
          {!!analysis && (
            <Button
              size="sm"
              variant={hasExtracts ? "outline" : "default"}
              onClick={() => ocrMutation.mutate()}
              disabled={readOnly || ocrMutation.isPending || docCount === 0}
              title={readOnly ? "Courrier archivé — actions désactivées" : docCount === 0 ? "Aucun document à extraire" : undefined}
            >
              {ocrMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : hasExtracts ? (
                <RefreshCw className="h-4 w-4" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {hasExtracts ? "Ré-extraire" : "Extraire le texte"}
            </Button>
          )}
        </div>

        {extractsLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : (
          <div className="space-y-2">
            {(documents ?? []).map((doc) => {
              const extract = extractByDocId.get(doc.id);
              const isOpen = !!expanded[doc.id];
              return (
                <Card key={doc.id} className="overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setExpanded((prev) => ({ ...prev, [doc.id]: !prev[doc.id] }))}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent/40 transition-colors"
                  >
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="text-sm font-medium truncate flex-1">
                      {doc.file_name ?? "Document"}
                    </span>
                    {extract ? (
                      <Badge variant="secondary" className="text-[10px]">
                        {(() => {
                          const m = extract.model ?? "";
                          if (m === "direct-text") return "texte";
                          if (m === "native-docx") return "Word";
                          if (m === "native-odt") return "ODT";
                          if (m === "native-rtf") return "RTF";
                          if (m === "native-pdf")
                            return extract.page_count ? `PDF · ${extract.page_count} p.` : "PDF";
                          if (m.startsWith("mistral-ocr"))
                            return extract.page_count ? `OCR · ${extract.page_count} p.` : "OCR";
                          return extract.page_count ? `${extract.page_count} p.` : "extrait";
                        })()}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">
                        non extrait
                      </Badge>
                    )}
                  </button>
                  {isOpen && (
                    <div className="border-t px-3 py-3 bg-muted/30">
                      {extract ? (
                        <pre className="text-xs whitespace-pre-wrap break-words font-sans text-foreground max-h-96 overflow-y-auto">
                          {extract.text || "(texte vide)"}
                        </pre>
                      ) : (
                        <p className="text-xs text-muted-foreground italic">
                          Pas encore extrait. Cliquez sur "Extraire le texte" ci-dessus.
                        </p>
                      )}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <Separator />

      {/* === Section : Analyse IA === */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold">Analyse</h3>
            <p className="text-xs text-muted-foreground">
              {analysis
                ? `Mise à jour ${formatDate(analysis.updated_at)}`
                : "Aucune analyse pour ce courrier"}
            </p>
          </div>
          <Button
            size="sm"
            variant={analysis ? "outline" : "default"}
            onClick={() => (analysis ? analyzeMutation.mutate() : runFullAnalysisMutation.mutate())}
            disabled={
              readOnly ||
              (analysis ? analyzeMutation.isPending || !canAnalyze : runFullAnalysisMutation.isPending)
            }
            title={
              readOnly
                ? "Courrier archivé — actions désactivées"
                : analysis && !canAnalyze
                  ? "Extrayez d'abord le texte des documents ou réceptionnez un email"
                  : undefined
            }
          >
            {(analysis ? analyzeMutation.isPending : runFullAnalysisMutation.isPending) ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : analysis ? (
              <RefreshCw className="h-4 w-4" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {analysis ? "Relancer l'analyse" : "Analyser"}
          </Button>
        </div>

        {analysisLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : !analysis ? (
          <Card className="p-4 text-center text-sm text-muted-foreground">
            Cliquez sur "Analyser" pour détecter les intentions, l'état d'esprit, les champs
            suggérés (titre, expéditeur, destinataire, service) et les actions à mettre en œuvre.
          </Card>
        ) : (
          <div className="space-y-3">
            {analysis.summary && (
              <Card className="p-3">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                  Résumé
                </h4>
                <p className="text-sm leading-relaxed">{analysis.summary}</p>
              </Card>
            )}

            <Card className="p-3">
              <div className="flex items-center justify-between mb-2 gap-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Intentions (tags)
                </h4>
                <Button
                  size="sm"
                  variant={isDirty ? "default" : "outline"}
                  onClick={() => applyTagsMutation.mutate()}
                  disabled={readOnly || !isDirty || applyTagsMutation.isPending}
                  className="h-7 text-xs"
                >
                  {applyTagsMutation.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Check className="h-3 w-3" />
                  )}
                  Appliquer les tags
                </Button>
              </div>
              {selectedIntents.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">
                  {analysis.intents.length === 0
                    ? "Aucun tag retenu par l'analyse. Vérifiez que des tags sont définis dans Paramètres > Classification."
                    : "Tous les tags ont été retirés. Cliquez sur 'Appliquer' pour valider."}
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {selectedIntents.map((intent) => {
                    const meta = tagByLowerName.get(intent.toLowerCase());
                    const fg = meta?.color ? readableTextColor(meta.color) : undefined;
                    return (
                      <Badge
                        key={intent}
                        variant="secondary"
                        className="gap-1 pl-2 pr-1 py-0.5 text-xs border-transparent"
                        style={meta?.color ? { backgroundColor: meta.color, color: fg } : undefined}
                      >
                        {meta?.name ?? intent}
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedIntents((prev) => prev.filter((t) => t !== intent))
                          }
                          className="ml-0.5 rounded-full p-0.5 hover:bg-background/30 transition-colors"
                          aria-label={`Retirer ${intent}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    );
                  })}
                </div>
              )}
              {currentCourierTags.length > 0 && !isDirty && (
                <p className="mt-2 text-[10px] text-muted-foreground/80">
                  ✓ Ces tags sont appliqués au courrier.
                </p>
              )}
            </Card>

            {analysis.sentiment && (
              <Card className="p-3">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  État d'esprit
                </h4>
                <Badge
                  className={
                    SENTIMENT_VARIANT[analysis.sentiment]?.className ?? "bg-muted text-foreground"
                  }
                >
                  {SENTIMENT_VARIANT[analysis.sentiment]?.label ?? analysis.sentiment}
                </Badge>
              </Card>
            )}


            <SuggestedActionsCard courierId={courierId} readOnly={readOnly} />
          </div>
        )}
      </section>
    </div>
  );
}
