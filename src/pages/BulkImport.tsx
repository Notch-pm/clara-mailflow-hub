import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { Check, Loader2, Sparkles, Lock } from "lucide-react";
import { toast } from "sonner";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useAuth } from "@/contexts/AuthContext";
import { canEditCouriers } from "@/lib/permissions";
import { supabase } from "@/integrations/supabase/client";
import { createCourier } from "@/services/courierService";
import { addParticipant } from "@/services/courierParticipantService";
import { assignableOrgs, listOrgsWithConfig } from "@/services/socleOrgConfigService";
import { listTags } from "@/services/courierTagService";
import { storage } from "@/services/storageService";
import { extractCourierInfo, recordPreCreationAnalysis } from "@/services/courierAnalysisService";
import { enqueueCourierAnalyses } from "@/services/courierAnalysisJobService";
import { findSuggestedOrg } from "@/lib/service-suggestion";
import BulkStep1Channel from "@/components/courier/bulk/BulkStep1Channel";
import BulkStep2Upload from "@/components/courier/bulk/BulkStep2Upload";
import BulkStep3Assign from "@/components/courier/bulk/BulkStep3Assign";
import BulkStep4Verify from "@/components/courier/bulk/BulkStep4Verify";
import BulkFilePreview from "@/components/courier/bulk/BulkFilePreview";
import BulkPdfSplitDialog, { type PdfSplitResult } from "@/components/courier/bulk/BulkPdfSplitDialog";
import {
  draftSender,
  emptyDraft,
  hasSender,
  nextGroupId,
  refreshFlags,
  withoutAnalysis,
  type BulkFile,
  type DraftCourier,
} from "@/components/courier/bulk/types";
import { resolveSenderContact, type CreatedSender } from "@/components/courier/bulk/senderResolution";
import { matchSender, type SocleContact } from "@/services/socleContactService";
import type { SenderMatch } from "../../supabase/functions/_shared/senderMatchLogic";

type BulkStep = 1 | 2 | 3 | 4 | 5;
type CourierChannel = "paper" | "email" | "guichet" | "autre";

const STEPS = [
  { n: 1, label: "Canal" },
  { n: 2, label: "Documents" },
  { n: 3, label: "Association" },
  { n: 4, label: "Vérification" },
  { n: 5, label: "Confirmation" },
];

function StepStrip({
  current,
  maxReached,
  onNavigate,
}: {
  current: number;
  maxReached: number;
  onNavigate: (step: number) => void;
}) {
  return (
    <div className="flex items-center gap-0 mb-6">
      {STEPS.map((s, i) => {
        const done = s.n < current;
        const active = s.n === current;
        const accessible = s.n <= maxReached && s.n !== current;
        return (
          <React.Fragment key={s.n}>
            <button
              type="button"
              disabled={!accessible && !active}
              onClick={() => accessible && onNavigate(s.n)}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : accessible
                  ? "text-primary hover:bg-primary/10 cursor-pointer"
                  : "text-muted-foreground cursor-default"
              )}
            >
              <span
                className={cn(
                  "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
                  active
                    ? "bg-primary-foreground text-primary"
                    : accessible
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {accessible ? <Check className="h-3 w-3" /> : s.n}
              </span>
              {s.label}
            </button>
            {i < STEPS.length - 1 && (
              <div className={cn("flex-1 h-px", s.n < maxReached ? "bg-primary" : "bg-border")} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}


export default function BulkImport() {
  const { organizationId } = useOrganization();
  const { profile, membership } = useAuth();
  const canEdit = canEditCouriers(profile, membership);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<BulkStep>(1);
  const [maxReached, setMaxReached] = useState<number>(1);
  const [channel, setChannel] = useState<CourierChannel | null>(null);
  const [files, setFiles] = useState<BulkFile[]>([]);
  const [drafts, setDrafts] = useState<DraftCourier[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  /** Avancement du passage d'analyse en cours (courriers traités / à traiter). */
  const [analysisProgress, setAnalysisProgress] = useState<{ done: number; total: number } | null>(null);
  const [previewFileId, setPreviewFileId] = useState<string | null>(null);
  const [splitFileId, setSplitFileId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [createdCount, setCreatedCount] = useState(0);

  function goToStep(n: number) {
    setStep(n as BulkStep);
    setMaxReached((prev) => Math.max(prev, n));
  }

  const { data: services = [] } = useQuery({
    queryKey: ["socle-orgs-config", organizationId],
    queryFn: () => listOrgsWithConfig(organizationId!),
    select: assignableOrgs,
    enabled: !!organizationId,
  });

  const { data: orgTags = [] } = useQuery({
    queryKey: ["courier-tags", organizationId],
    queryFn: () => listTags(organizationId!),
    enabled: !!organizationId,
  });

  const { data: maxFileSize = 10 * 1024 * 1024 } = useQuery({
    queryKey: ["max-file-size", organizationId],
    queryFn: () => storage.getMaxFileSize(organizationId!),
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
  });

  const validFiles = files.filter((f) => !f.rejected);

  function rejectFile(fileId: string) {
    setFiles((prev) => prev.map((f) => f.id === fileId ? { ...f, rejected: true } : f));
    setDrafts((prev) =>
      prev.map((d) =>
        d.fileIds.includes(fileId) ? withoutAnalysis({ ...d, fileIds: d.fileIds.filter((id) => id !== fileId) }) : d,
      ),
    );
  }

  function handleSplitConfirm({ originalId, segments, rest }: PdfSplitResult) {
    const original = files.find((f) => f.id === originalId);
    if (!original) return;
    let gid = nextGroupId(files);
    const toBulk = (f: File, groupId: number | null): BulkFile => ({
      id: crypto.randomUUID(),
      file: f,
      previewUrl: URL.createObjectURL(f),
      groupId,
      rejected: false,
    });
    // Le reste retourne dans « non associés » ; chaque segment devient un courrier.
    const replacements = [
      ...(rest ? [toBulk(rest, null)] : []),
      ...segments.map((f) => toBulk(f, gid++)),
    ];
    const idx = files.findIndex((f) => f.id === originalId);
    const next = [...files];
    next.splice(idx, 1, ...replacements);
    URL.revokeObjectURL(original.previewUrl);
    setFiles(next);
    setSplitFileId(null);
    toast.success(
      `« ${original.file.name} » séparé en ${segments.length} courrier${segments.length > 1 ? "s" : ""}${rest ? " + un reste" : ""}`,
    );
  }

  function buildDraftsFromGroups(): DraftCourier[] {
    const result: DraftCourier[] = [];
    const grouped = new Map<number, BulkFile[]>();
    for (const f of files) {
      if (f.rejected || f.groupId === null) continue;
      const arr = grouped.get(f.groupId) ?? [];
      arr.push(f);
      grouped.set(f.groupId, arr);
    }
    for (const groupFiles of grouped.values()) {
      result.push(emptyDraft(groupFiles.map((f) => f.id)));
    }
    return result;
  }

  /** Statut d'analyse d'un courrier du lot (voir `DraftCourier.analysisStatus`). */
  function setAnalysisStatus(id: string, patch: Pick<DraftCourier, "analysisStatus" | "analysisError">) {
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }

  async function analyzeExistingDrafts() {
    if (!organizationId || drafts.length === 0) return;
    // Seulement les courriers pas encore analysés : relancer le lot entier
    // repayait l'analyse de ceux qui l'avaient déjà. Tout est analysé : le
    // bouton devient « Relancer l'analyse » et reprend tout le lot.
    const withFiles = drafts.filter((d) => d.fileIds.length > 0);
    const pending = withFiles.filter((d) => !d.analysis);
    const targets = pending.length > 0 ? pending : withFiles;
    if (targets.length === 0) return;
    const targetIds = new Set(targets.map((d) => d.id));

    setAnalyzing(true);
    setAnalysisProgress({ done: 0, total: targets.length });
    setDrafts((prev) =>
      prev.map((d) =>
        targetIds.has(d.id) ? { ...d, analysisStatus: "queued" as const, analysisError: undefined } : d,
      ),
    );

    for (const draft of targets) {
      const draftFiles = files.filter((f) => draft.fileIds.includes(f.id));
      setAnalysisStatus(draft.id, { analysisStatus: "running", analysisError: undefined });

      try {
        const result = await extractCourierInfo({ files: draftFiles.map((bf) => bf.file) });

        if (result.quota_exceeded) {
          toast.error(
            `Courrier "${draft.title || "sans titre"}" : quota IA atteint pour ce mois, extraction partielle`,
          );
        }
        if (result.ocr_failures?.length) {
          toast.warning(`Courrier "${draft.title || "sans titre"}" : pièces non lues`, {
            description: result.ocr_failures.join(" ; "),
          });
        }
        const s = result.sender;
        const senderFound = !!(s?.first_name || s?.last_name || s?.email || s?.phone);
        // Rapprochement fait par l'edge function ; une version antérieure ne
        // le renvoie pas — on le fait alors d'ici, avec la même règle.
        let senderMatch: SenderMatch<SocleContact> | null = null;
        if (senderFound) {
          senderMatch =
            result.sender_match ??
            (await matchSender(organizationId, s).catch(() => null));
        }
        const matchedService = findSuggestedOrg(result, services);
        const serviceHint = matchedService
          ? result.suggested_service_reason ?? undefined
          : `L'IA ne propose pas d'organisation. ${
              result.service_suggestion_note ?? "Le contenu ne relève clairement d'aucune organisation."
            }`;

        // Proportion des champs clés que CETTE analyse a effectivement trouvés —
        // pas une constante : un courrier qui ne nomme aucun service doit se voir
        // moins bien noté que celui qui aura fourni titre, expéditeur, service et tags.
        const signals = [
          !!result.suggested_subject?.trim(),
          senderFound,
          !!matchedService,
          (result.suggested_tag_names?.length ?? 0) > 0,
        ];
        const confidence = signals.filter(Boolean).length / signals.length;

        setDrafts((prev) =>
          refreshFlags(prev.map((d) => {
            if (d.id !== draft.id) return d;
            // L'expéditeur est remplacé d'un bloc : mêler les champs extraits à
            // une saisie antérieure fabriquerait une identité que le
            // rapprochement n'a pas vue.
            const sender: Partial<DraftCourier> = senderFound
              ? {
                  senderCivility: s.civility ?? d.senderCivility,
                  senderFirstName: s.first_name ?? "",
                  senderLastName: s.last_name ?? "",
                  senderEmail: s.email ?? "",
                  senderPhone: s.phone ?? "",
                  senderMatch,
                  senderDecision: "auto",
                }
              : {};
            return {
              ...d,
              ...sender,
              title: result.suggested_subject || d.title,
              recipientName: result.recipient_name || d.recipientName,
              // Jamais un nom sans identifiant : il créerait un courrier « affecté »
              // à une organisation que rien ne désigne.
              serviceId: matchedService?.id ?? d.serviceId,
              serviceName: matchedService?.name ?? d.serviceName,
              serviceHint,
              // Les tags proposés s'ajoutent à ceux déjà posés sur le brouillon,
              // ils ne les remplacent pas — relancer l'analyse ne doit rien effacer.
              tags: [
                ...d.tags,
                ...(result.suggested_tag_names ?? []).filter(
                  (t) => !d.tags.some((x) => x.toLowerCase() === t.toLowerCase()),
                ),
              ],
              bodyText: result.extracted_text || d.bodyText,
              confidence,
              analysis: result,
              analysisStatus: undefined,
              analysisError: undefined,
            };
          }))
        );
      } catch (err) {
        const status = (err as Error & { status?: number }).status;
        const label = `Courrier "${draft.title || "sans titre"}"`;
        const msg =
          status === 429
            ? "quota IA atteint pour ce mois, contactez votre administrateur"
            : err instanceof Error
              ? err.message
              : "Erreur inconnue";
        toast.error(`${label} : ${msg}`);
        setAnalysisStatus(draft.id, { analysisStatus: "failed", analysisError: msg });
      }
      setAnalysisProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
    }

    setAnalyzing(false);
    setAnalysisProgress(null);
  }

  async function handleConfirm() {
    if (!organizationId) return;
    setConfirming(true);

    let count = 0;
    // Courriers ayant au moins une pièce jointe réellement uploadée : eux seuls
    // ont de quoi être océrisés.
    const analysableCourierIds: string[] = [];
    const { data: { user } } = await supabase.auth.getUser();
    // Fiches créées pendant cette confirmation : plusieurs courriers d'une même
    // personne inconnue ne doivent produire qu'UNE fiche.
    const createdContacts: CreatedSender[] = [];

    for (const draft of drafts) {
      try {
        // Facultative : sans organisation, le courrier attend dans la boîte aux
        // lettres qu'on l'affecte.
        const service = draft.serviceId ? services.find((s) => s.id === draft.serviceId) : undefined;

        let workflowStateId: string | null = null;
        if (service?.workflow_id) {
          const { data: initialState } = await supabase
            .from("workflow_states")
            .select("id")
            .eq("workflow_id", service.workflow_id)
            .eq("is_initial", true)
            .maybeSingle();
          workflowStateId = initialState?.id ?? null;
        }

        const { data: courier, error: cErr } = await createCourier({
          organization_id: organizationId,
          direction: "inbound",
          channel,
          subject: draft.title || "Courrier importé",
          received_at: new Date().toISOString(),
          assigned_service: service?.name ?? null,
          socle_organization_id: service?.id ?? null,
          workflow_state_id: workflowStateId,
          metadata: {
            tags: draft.tags,
            socle_organization_id: service?.id ?? null,
            ...(draft.bodyText.trim() ? { body_text: draft.bodyText.trim() } : {}),
          } as any,
          created_by: user?.id ?? null,
        });

        if (cErr || !courier) {
          toast.error(`Courrier "${draft.title}" : ${cErr?.message ?? "Création échouée"}`);
          continue;
        }

        if (hasSender(draft)) {
          const sender = draftSender(draft);
          let contact: SocleContact | null = null;
          try {
            contact = await resolveSenderContact(organizationId, draft, sender, createdContacts);
          } catch (err) {
            // Le courrier ne doit pas être perdu pour autant : l'expéditeur est
            // gardé en participant libre, à rattacher depuis la fiche courrier.
            const msg = err instanceof Error ? err.message : "Erreur inconnue";
            toast.warning(`Courrier "${draft.title}" : expéditeur non rattaché au référentiel`, {
              description: msg,
            });
          }
          const fullName = [sender.first_name, sender.last_name].filter(Boolean).join(" ");
          await addParticipant({
            courier_id: courier.id,
            organization_id: organizationId,
            role: "sender",
            name: contact?.display_name ?? (fullName || sender.email),
            first_name: contact ? contact.first_name : sender.first_name,
            last_name: contact ? (contact.last_name ?? contact.legal_name) : sender.last_name,
            email: contact ? contact.email : sender.email,
            phone: contact ? (contact.mobile_phone ?? contact.landline_phone) : sender.phone,
            socle_contact_id: contact?.id ?? null,
          });
        }

        if (draft.recipientName) {
          await addParticipant({
            courier_id: courier.id,
            organization_id: organizationId,
            role: "recipient",
            name: draft.recipientName,
            last_name: draft.recipientName,
          });
        }

        let uploaded = 0;
        for (const fileId of draft.fileIds) {
          const bf = files.find((f) => f.id === fileId);
          if (!bf) continue;
          try {
            await storage.upload(organizationId, courier.id, bf.file, "attachment");
            uploaded++;
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Erreur upload";
            toast.error(`${bf.file.name} : ${msg}`);
          }
        }
        // Analysé dans cet écran : cette analyse devient celle du courrier, on
        // ne la refait pas. Sinon (ou si l'enregistrer échoue), analyse en file.
        let analysisRecorded = false;
        if (draft.analysis) {
          try {
            await recordPreCreationAnalysis(organizationId, courier.id, draft.analysis);
            analysisRecorded = true;
          } catch (err) {
            console.error("Analyse d'import non enregistrée, analyse complète en file :", err);
          }
        }
        if (!analysisRecorded && uploaded > 0) analysableCourierIds.push(courier.id);

        count++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erreur inconnue";
        toast.error(`Courrier "${draft.title}" : ${msg}`);
      }
    }

    setCreatedCount(count);
    setConfirming(false);
    goToStep(5);

    // Courriers NON analysés dans cet écran : OCR + analyse délégués à la file
    // serveur — l'utilisateur n'attend pas et quitter la page n'interrompt rien.
    void enqueueCourierAnalyses(analysableCourierIds);

    queryClient.invalidateQueries({ queryKey: ["mailbox-couriers"] });
    queryClient.invalidateQueries({ queryKey: ["mailbox-unassigned"] });

    setTimeout(() => {
      navigate("/a-instruire");
    }, 3000);
  }

  const hasMissingCivility = drafts.some((d) => d.flags.includes("missing-civility"));
  // Bilan de l'analyse du lot, hors passage en cours.
  const analysableCount = drafts.filter((d) => d.fileIds.length > 0).length;
  const analysedCount = drafts.filter((d) => d.analysis).length;
  const failedCount = drafts.filter((d) => d.analysisStatus === "failed").length;
  const notAnalysedCount = analysableCount - analysedCount;
  const analysisSummary =
    analysableCount === 0 || analysedCount + failedCount === 0
      ? null
      : [
          `${analysedCount} courrier${analysedCount > 1 ? "s" : ""} analysé${analysedCount > 1 ? "s" : ""} sur ${analysableCount}`,
          failedCount > 0 ? `${failedCount} en échec` : null,
          notAnalysedCount - failedCount > 0 ? `${notAnalysedCount - failedCount} non analysé${notAnalysedCount - failedCount > 1 ? "s" : ""}` : null,
        ]
          .filter(Boolean)
          .join(" · ");
  const canConfirm = drafts.length > 0 && !hasMissingCivility && !confirming;

  // Un consultant (lecteur seul) ne peut pas créer de courrier : la page ne
  // sert à rien pour lui, on l'informe plutôt que de le laisser dérouler un
  // assistant dont la confirmation finale échouerait côté serveur (RLS).
  if (!canEdit) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
        <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center">
          <Lock className="h-7 w-7 text-muted-foreground" />
        </div>
        <div className="space-y-1">
          <p className="text-lg font-semibold">Accès en lecture seule</p>
          <p className="text-sm text-muted-foreground max-w-sm">
            Votre rôle de consultant ne permet pas de créer de courriers. Contactez un
            administrateur si vous avez besoin d'importer des courriers en masse.
          </p>
        </div>
        <Button variant="outline" onClick={() => navigate("/a-instruire")}>
          Retour à « À instruire »
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-32">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Import en masse</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Importez plusieurs courriers simultanément via OCR et analyse IA.
        </p>
      </div>

      <StepStrip
        current={step}
        maxReached={Math.max(
          maxReached,
          channel ? 2 : 1,
          channel && validFiles.length > 0 ? 3 : 1,
          channel && validFiles.length > 0 && step >= 3 ? 4 : 1,
        )}
        onNavigate={(n) => {
          if (n === 4 && step === 3) {
            setDrafts(buildDraftsFromGroups());
          }
          goToStep(n);
        }}
      />

      <div>
        {step === 1 && (
          <BulkStep1Channel
            value={channel}
            onChange={setChannel}
            done={false}
            onEdit={undefined}
          />
        )}

        {step === 2 && (
          <BulkStep2Upload
            files={files}
            onChange={setFiles}
            onPreview={setPreviewFileId}
            maxFileSize={maxFileSize}
          />
        )}

        {step === 3 && (
          <BulkStep3Assign
            files={files}
            onChange={setFiles}
            onPreview={setPreviewFileId}
            onSplit={setSplitFileId}
          />
        )}

        {step === 4 && (
          <>
            <div className="flex items-center justify-between mb-4">
              <div className="flex-1">
                {analyzing && analysisProgress ? (
                  <div className="flex max-w-md flex-col gap-1.5">
                    <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                      <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                      <span>
                        Analyse en cours : courrier {Math.min(analysisProgress.done + 1, analysisProgress.total)} sur{" "}
                        {analysisProgress.total}
                      </span>
                    </div>
                    <Progress value={(analysisProgress.done / analysisProgress.total) * 100} className="h-1.5 bg-muted" />
                    <p className="text-xs text-muted-foreground">
                      Lecture des pièces et analyse, un courrier après l'autre — environ 30 secondes chacun.
                    </p>
                  </div>
                ) : (
                  analysisSummary && <p className="text-sm text-muted-foreground">{analysisSummary}</p>
                )}
                {hasMissingCivility && !analyzing && (
                  <p className="text-sm text-destructive">
                    Certains expéditeurs sont à créer dans le référentiel : indiquez leur civilité.
                  </p>
                )}
              </div>
              {drafts.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={analyzing}
                  onClick={analyzeExistingDrafts}
                  className="gap-1.5 shrink-0"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {analyzing
                    ? "Analyse en cours…"
                    : notAnalysedCount > 0
                      ? notAnalysedCount === analysableCount
                        ? "Analyser avec l'IA"
                        : `Analyser les ${notAnalysedCount} restant${notAnalysedCount > 1 ? "s" : ""}`
                      : "Relancer l'analyse"}
                </Button>
              )}
            </div>
            <BulkStep4Verify
              drafts={drafts}
              files={files}
              services={services}
              orgTags={orgTags}
              onChange={setDrafts}
              onPreview={setPreviewFileId}
              onFileReject={rejectFile}
            />
          </>
        )}

        {step === 5 && (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
              <Check className="h-7 w-7 text-primary" />
            </div>
            <div className="text-center">
              <p className="text-xl font-semibold">
                ✓ {createdCount} courrier{createdCount > 1 ? "s" : ""} créé{createdCount > 1 ? "s" : ""}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Redirection vers « À instruire » dans 3 secondes…
              </p>
            </div>
            <Button variant="outline" onClick={() => navigate("/a-instruire")}>
              Aller à « À instruire »
            </Button>
          </div>
        )}
      </div>

      {step < 5 && (
        <div className="fixed bottom-0 left-0 md:left-[52px] right-0 z-40 bg-background/95 backdrop-blur border-t px-6 py-3 flex items-center justify-between gap-3">
          <Button
            variant="ghost"
            onClick={() => {
              if (step > 1) goToStep(step - 1);
              else navigate("/a-instruire");
            }}
          >
            {step === 1 ? "Annuler" : "Retour"}
          </Button>

          <div className="flex items-center gap-3">
            {step === 1 && (
              <Button disabled={!channel} onClick={() => goToStep(2)}>
                Suivant : Documents
              </Button>
            )}

            {step === 2 && (
              <Button disabled={validFiles.length === 0} onClick={() => goToStep(3)}>
                Suivant : Association
              </Button>
            )}

            {step === 3 && (
              <Button
                disabled={validFiles.length === 0}
                onClick={() => { setDrafts(buildDraftsFromGroups()); goToStep(4); }}
              >
                Passer à la vérification
              </Button>
            )}

            {step === 4 && (
              <Button
                disabled={!canConfirm || analyzing}
                onClick={handleConfirm}
                className="gap-2"
              >
                {confirming && <Loader2 className="h-4 w-4 animate-spin" />}
                {confirming
                  ? "Création en cours…"
                  : `Confirmer ${drafts.length} courrier${drafts.length > 1 ? "s" : ""}`}
              </Button>
            )}
          </div>
        </div>
      )}

      <BulkFilePreview
        fileId={previewFileId}
        files={files}
        onClose={() => setPreviewFileId(null)}
      />

      {/* `key` : un état neuf à chaque ouverture — sinon les vignettes de la
          précédente, déjà libérées, s'affichaient le temps d'un rendu. */}
      <BulkPdfSplitDialog
        key={splitFileId ?? "none"}
        file={files.find((f) => f.id === splitFileId) ?? null}
        maxFileSize={maxFileSize}
        onClose={() => setSplitFileId(null)}
        onConfirm={handleSplitConfirm}
      />
    </div>
  );
}
