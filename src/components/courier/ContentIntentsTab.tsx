import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, FileText, Sparkles, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { getDocuments } from "@/services/courierDocumentService";
import {
  getExtracts,
  getAnalysis,
  runOcr,
  runAnalysis,
} from "@/services/courierAnalysisService";

interface Props {
  courierId: string;
  organizationId: string;
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

export default function ContentIntentsTab({ courierId, organizationId }: Props) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const { data: documents } = useQuery({
    queryKey: ["courier-documents", courierId],
    queryFn: () => getDocuments(courierId),
    enabled: !!courierId,
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

  const docCount = documents?.length ?? 0;
  const extractCount = extracts?.length ?? 0;
  const hasExtracts = extractCount > 0;

  if (docCount === 0) {
    return (
      <div className="text-center py-10">
        <FileText className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
        <p className="text-sm text-muted-foreground">Aucun document à analyser.</p>
        <p className="text-xs text-muted-foreground/70 mt-1">
          Joignez un fichier pour activer l'extraction et l'analyse IA.
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
          <Button
            size="sm"
            variant={hasExtracts ? "outline" : "default"}
            onClick={() => ocrMutation.mutate()}
            disabled={ocrMutation.isPending}
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
            onClick={() => analyzeMutation.mutate()}
            disabled={analyzeMutation.isPending || !hasExtracts}
            title={!hasExtracts ? "Extrayez d'abord le texte des documents" : undefined}
          >
            {analyzeMutation.isPending ? (
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
            {hasExtracts
              ? "Cliquez sur \"Analyser\" pour détecter les intentions, l'état d'esprit et les actions à mettre en œuvre."
              : "Extrayez d'abord le texte des documents."}
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
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Intentions
              </h4>
              {analysis.intents.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">Aucune intention détectée</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {analysis.intents.map((intent, i) => (
                    <Badge key={i} variant="secondary" className="text-xs">
                      {intent}
                    </Badge>
                  ))}
                </div>
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

            <SuggestedActionsCard courierId={courierId} />
          </div>
        )}
      </section>
    </div>
  );
}
