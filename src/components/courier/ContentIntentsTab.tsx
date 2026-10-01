import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, FileText, Sparkles, Loader2, RefreshCw, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { getDocuments } from "@/services/courierDocumentService";
import { getCourierById, updateCourier } from "@/services/courierService";
import { COURIER_LIST_QUERY_PREFIXES } from "@/services/courierListService";
import { listTags, TAG_GROUPS } from "@/services/courierTagService";
import { splitAppliedTags } from "@/lib/courier-tags";
import { cn } from "@/lib/utils";
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
  /**
   * Proposition de service instructeur (`ServiceSuggestion`), construite par
   * l'écran qui détient les gestes d'affectation et de transfert.
   */
  serviceSuggestion?: ReactNode;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ContentIntentsTab({
  courierId,
  organizationId,
  readOnly = false,
  isInitialState = true,
  serviceSuggestion,
}: Props) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const { data: documents } = useQuery({
    queryKey: ["courier-documents", courierId],
    queryFn: () => getDocuments(courierId),
    enabled: !!courierId,
  });

  const { data: courierData } = useQuery({
    queryKey: ["courier", courierId, organizationId],
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

  // État local de la sélection d'intents (modifiable avant application)
  const [selectedIntents, setSelectedIntents] = useState<string[]>([]);
  useEffect(() => {
    setSelectedIntents(analysis?.intents ?? []);
  }, [analysis?.intents, courierId]);

  const intentsByGroup = useMemo(
    () => splitAppliedTags(selectedIntents, orgTags ?? []),
    [selectedIntents, orgTags],
  );

  const currentCourierTags = useMemo(
    () => ((courierData?.metadata as Record<string, unknown> | null)?.tags as string[] | undefined) ?? [],
    [courierData?.metadata],
  );

  const appliedSet = useMemo(
    () => new Set(currentCourierTags.map((t) => t.toLowerCase())),
    [currentCourierTags],
  );

  /**
   * Ce que l'application va AJOUTER au courrier.
   *
   * Les tags proposés complètent ceux déjà posés — ils ne les remplacent pas :
   * une seconde analyse, lancée à l'étape « Contenu et intentions », effaçait
   * sinon la qualification faite à la main (ou par le passage précédent), sans
   * rien signaler.
   */
  const tagsToAdd = useMemo(
    () => selectedIntents.filter((t) => !appliedSet.has(t.toLowerCase())),
    [selectedIntents, appliedSet],
  );

  const isDirty = tagsToAdd.length > 0;

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






  const applyTagsMutation = useMutation({
    mutationFn: async () => {
      if (tagsToAdd.length === 0) return 0;
      const currentMeta = (courierData?.metadata as Record<string, unknown> | null) ?? {};
      const { error } = await updateCourier(organizationId, courierId, {
        metadata: { ...currentMeta, tags: [...currentCourierTags, ...tagsToAdd] },
      });
      if (error) throw error;
      return tagsToAdd.length;
    },
    onSuccess: (count) => {
      toast.success(`${count} tag(s) ajouté(s) au courrier`);
      // Clé courte (préfixe) plutôt que la clé complète de la requête locale
      // ci-dessus : `CourierDetail` interroge sous `["courier", courierId,
      // organizationId]`, dans cet ordre précis — une invalidation avec les
      // deux derniers segments inversés ne le retrouve pas, et la page pleine
      // écran (le classement, entre autres) reste figée jusqu'au rechargement.
      qc.invalidateQueries({ queryKey: ["courier", courierId] });
      // Les listes filtrent par tag côté serveur : elles doivent toutes être
      // réinterrogées après une modification des tags.
      COURIER_LIST_QUERY_PREFIXES.forEach((prefix) =>
        qc.invalidateQueries({ queryKey: [prefix] }),
      );
      qc.invalidateQueries({ queryKey: ["courier-instruction"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /**
   * Titre suggéré par l'IA, proposé seulement s'il apporte quelque chose.
   *
   * Enjeu principal : un courrier numérisé arrive avec le titre générique
   * « Courrier numérisé — à qualifier » posé par l'ingestion. Sans ce geste,
   * l'analyse produisait bien un `suggested_subject`, mais il n'était affiché
   * nulle part sur un courrier existant — l'agent devait retaper le titre.
   */
  const suggestedSubject = analysis?.suggested_subject?.trim() || null;
  const canApplySubject =
    !!suggestedSubject && suggestedSubject !== (courierData?.subject ?? "").trim();

  /**
   * L'expéditeur suggéré est stocké en champs séparés (`first_name`,
   * `last_name`, `email`, `phone`) depuis que les identités sont déléguées au
   * Socle. Ce composant lisait encore un `.name` qui n'existe plus : le bloc
   * « Expéditeur détecté » ne s'affichait donc plus du tout, sans erreur.
   *
   * Repli sur l'email, comme le fait `search_couriers` pour `sender_name` :
   * une analyse qui n'a extrait qu'une adresse reste une information utile.
   */
  const suggestedSenderName =
    [analysis?.suggested_sender?.first_name, analysis?.suggested_sender?.last_name]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    analysis?.suggested_sender?.email ||
    null;

  const applySubjectMutation = useMutation({
    mutationFn: async () => {
      if (!suggestedSubject) return;
      const { error } = await updateCourier(organizationId, courierId, {
        subject: suggestedSubject,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Titre appliqué au courrier");
      qc.invalidateQueries({ queryKey: ["courier", courierId] });
      COURIER_LIST_QUERY_PREFIXES.forEach((prefix) =>
        qc.invalidateQueries({ queryKey: [prefix] }),
      );
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
              {extractCount}/{docCount} document(s) extrait(s)
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
                          // `socle:ai-api` depuis la centralisation IA du 2026-08-29 ;
                          // `mistral-ocr-*` sur les extraits antérieurs, qu'on
                          // continue d'afficher — un badge « extrait » à la place
                          // ferait croire à une extraction native sur des documents
                          // qui ont bien coûté un OCR.
                          if (m === "socle-ocr" || m.startsWith("mistral-ocr"))
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
            {(canApplySubject || suggestedSenderName || analysis.suggested_service_name || serviceSuggestion) && (
              <Card className="p-3">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  Champs suggérés
                </h4>
                <div className="space-y-2">
                  {canApplySubject && (
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs text-muted-foreground">Titre</p>
                        <p className="text-sm font-medium break-words">{suggestedSubject}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => applySubjectMutation.mutate()}
                        disabled={readOnly || applySubjectMutation.isPending}
                        className="h-7 text-xs shrink-0"
                      >
                        {applySubjectMutation.isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Check className="h-3 w-3" />
                        )}
                        Appliquer
                      </Button>
                    </div>
                  )}
                  {/* L'expéditeur reste indicatif : le rattacher suppose un
                      rapprochement avec le référentiel du Socle, qui se fait au
                      passage en instruction. */}
                  {suggestedSenderName && (
                    <div>
                      <p className="text-xs text-muted-foreground">Expéditeur détecté</p>
                      <p className="text-sm">{suggestedSenderName}</p>
                    </div>
                  )}
                  {/* Service instructeur : proposé par identifiant, appliqué par
                      l'agent (affectation, ou transfert confirmé). Une analyse
                      antérieure au 2026-10-01 n'a qu'un nom : il reste affiché. */}
                  {serviceSuggestion ??
                    (analysis.suggested_service_name && !analysis.suggested_socle_organization_id && (
                      <div>
                        <p className="text-xs text-muted-foreground">Service suggéré</p>
                        <p className="text-sm">{analysis.suggested_service_name}</p>
                      </div>
                    ))}
                </div>
              </Card>
            )}

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
                  Tags proposés
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
                  Ajouter les tags
                </Button>
              </div>
              {selectedIntents.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">
                  {analysis.intents.length === 0
                    ? "Aucun tag retenu par l'analyse. Vérifiez que des tags sont définis dans Paramètres > Classification."
                    : "Tous les tags proposés ont été écartés."}
                </p>
              ) : (
                // Un groupe par rangée : le thème et le sentiment ne se lisent
                // pas ensemble, et l'agent retire souvent l'un sans l'autre.
                <div className="space-y-2">
                  {TAG_GROUPS.map((group) => {
                    const applied = intentsByGroup[group.value];
                    if (applied.length === 0) return null;
                    return (
                      <div key={group.value} className="space-y-1">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
                          {group.label}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {applied.map(({ name: intent, tag: meta }) => {
                            const fg = meta?.color ? readableTextColor(meta.color) : undefined;
                            const already = appliedSet.has(intent.toLowerCase());
                            return (
                              <Badge
                                key={intent}
                                variant="secondary"
                                className={cn(
                                  "gap-1 pl-2 py-0.5 text-xs border-transparent",
                                  already ? "pr-2" : "pr-1",
                                )}
                                style={meta?.color ? { backgroundColor: meta.color, color: fg } : undefined}
                                title={already ? "Déjà appliqué au courrier" : "Sera ajouté au courrier"}
                              >
                                {already && <Check className="h-3 w-3 shrink-0 opacity-70" />}
                                {meta?.name ?? intent}
                                {/* La croix écarte une PROPOSITION ; sur un tag
                                    déjà posé elle ferait croire à un retrait,
                                    qui se fait dans la zone Tags du courrier. */}
                                {!already && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setSelectedIntents((prev) => prev.filter((t) => t !== intent))
                                    }
                                    className="ml-0.5 rounded-full p-0.5 hover:bg-background/30 transition-colors"
                                    aria-label={`Écarter ${intent}`}
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                )}
                              </Badge>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {selectedIntents.length > 0 && !isDirty && (
                <p className="mt-2 text-[10px] text-muted-foreground/80">
                  ✓ Ces tags sont déjà appliqués au courrier.
                </p>
              )}
            </Card>

            {/* L'ancien encart « État d'esprit » (liste figée dans le code) a
                disparu le 2026-09-10 : le sentiment est devenu un TAG, rangé
                ci-dessus avec les autres — paramétrable, applicable au courrier
                et compté dans les statistiques. */}

            <SuggestedActionsCard courierId={courierId} readOnly={readOnly} />
          </div>
        )}
      </section>
    </div>
  );
}
