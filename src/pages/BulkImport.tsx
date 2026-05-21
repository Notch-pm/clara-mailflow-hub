import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Check, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";
import { createCourier } from "@/services/courierService";
import { addParticipant } from "@/services/courierParticipantService";
import { listServices } from "@/services/orgServiceService";
import { listTags } from "@/services/courierTagService";
import { storage } from "@/services/storageService";
import BulkStep1Channel from "@/components/courier/bulk/BulkStep1Channel";
import BulkStep2Upload from "@/components/courier/bulk/BulkStep2Upload";
import BulkStep3Assign from "@/components/courier/bulk/BulkStep3Assign";
import BulkStep4Verify from "@/components/courier/bulk/BulkStep4Verify";
import BulkFilePreview from "@/components/courier/bulk/BulkFilePreview";

type BulkStep = 1 | 2 | 3 | 4 | 5;
type CourierChannel = "paper" | "email";

interface BulkFile {
  id: string;
  file: File;
  previewUrl: string;
  groupId: number | null;
  rejected: boolean;
  rejectReason?: string;
}

interface DraftCourier {
  id: string;
  title: string;
  senderName: string;
  senderEmail: string;
  recipientName: string;
  serviceId: string;
  serviceName: string;
  tags: string[];
  bodyText: string;
  fileIds: string[];
  confidence: number;
  flags: Array<"missing-service" | "duplicate">;
}

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
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<BulkStep>(1);
  const [maxReached, setMaxReached] = useState<number>(1);
  const [channel, setChannel] = useState<CourierChannel | null>(null);
  const [files, setFiles] = useState<BulkFile[]>([]);
  const [drafts, setDrafts] = useState<DraftCourier[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [previewFileId, setPreviewFileId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [createdCount, setCreatedCount] = useState(0);

  function goToStep(n: number) {
    setStep(n as BulkStep);
    setMaxReached((prev) => Math.max(prev, n));
  }

  const { data: services = [] } = useQuery({
    queryKey: ["org-services", organizationId],
    queryFn: () => listServices(organizationId!),
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
    setDrafts((prev) => prev.map((d) => ({ ...d, fileIds: d.fileIds.filter((id) => id !== fileId) })));
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
      result.push({
        id: crypto.randomUUID(),
        title: "",
        senderName: "",
        senderEmail: "",
        recipientName: "",
        serviceId: "",
        serviceName: "",
        tags: [],
        bodyText: "",
        fileIds: groupFiles.map((f) => f.id),
        confidence: 0,
        flags: ["missing-service"],
      });
    }
    return result;
  }

  type OcrResult = {
    sender?: { first_name: string | null; last_name: string | null; email: string | null };
    recipient_name?: string | null;
    suggested_service_name?: string | null;
    suggested_tag_names?: string[];
    extracted_text?: string | null;
    subject?: string | null;
    confidence?: number;
  };

  async function encodeFiles(bfList: BulkFile[]) {
    return Promise.all(
      bfList.map(async (bf) => {
        const buf = await bf.file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        return {
          name: bf.file.name,
          mime_type: bf.file.type || "application/octet-stream",
          content_base64: btoa(binary),
        };
      })
    );
  }

  async function analyzeExistingDrafts() {
    if (!organizationId || drafts.length === 0) return;
    setAnalyzing(true);

    for (const draft of [...drafts]) {
      const draftFiles = files.filter((f) => draft.fileIds.includes(f.id));
      if (draftFiles.length === 0) continue;

      try {
        const filePayloads = await encodeFiles(draftFiles);
        const { data, error } = await supabase.functions.invoke("extract-courier-info", {
          body: { files: filePayloads },
        });

        if (error || data?.error) {
          toast.error(`Courrier "${draft.title || "sans titre"}" : analyse échouée`);
          continue;
        }

        const result = data as OcrResult;
        const senderName = [result.sender?.first_name, result.sender?.last_name].filter(Boolean).join(" ");
        const matchedService = services.find(
          (s) => result.suggested_service_name &&
            s.name.toLowerCase() === result.suggested_service_name.toLowerCase()
        );

        setDrafts((prev) =>
          prev.map((d) => {
            if (d.id !== draft.id) return d;
            const updated: DraftCourier = {
              ...d,
              title: result.subject || d.title,
              senderName: senderName || d.senderName,
              senderEmail: result.sender?.email || d.senderEmail,
              recipientName: result.recipient_name || d.recipientName,
              serviceId: matchedService?.id ?? d.serviceId,
              serviceName: matchedService?.name ?? (result.suggested_service_name || d.serviceName),
              tags: result.suggested_tag_names?.length ? result.suggested_tag_names : d.tags,
              bodyText: result.extracted_text || d.bodyText,
              confidence: typeof result.confidence === "number" ? result.confidence : 0.7,
            };
            const flags: Array<"missing-service" | "duplicate"> = [];
            if (!updated.serviceName) flags.push("missing-service");
            return { ...updated, flags };
          })
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erreur inconnue";
        toast.error(`Courrier "${draft.title || "sans titre"}" : ${msg}`);
      }
    }

    setAnalyzing(false);
  }

  async function handleConfirm() {
    if (!organizationId) return;
    setConfirming(true);

    let count = 0;
    const { data: { user } } = await supabase.auth.getUser();

    for (const draft of drafts) {
      try {
        const service = services.find((s) => s.id === draft.serviceId || s.name === draft.serviceName);

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
          channel: channel as "paper" | "email" | "portal",
          subject: draft.title || "Courrier importé",
          received_at: new Date().toISOString(),
          assigned_service: service?.name ?? draft.serviceName ?? null,
          workflow_state_id: workflowStateId,
          metadata: {
            tags: draft.tags,
            service_id: service?.id ?? null,
            ...(draft.bodyText.trim() ? { body_text: draft.bodyText.trim() } : {}),
          } as Record<string, unknown>,
          created_by: user?.id ?? null,
        });

        if (cErr || !courier) {
          toast.error(`Courrier "${draft.title}" : ${cErr?.message ?? "Création échouée"}`);
          continue;
        }

        if (draft.senderName) {
          await addParticipant({
            courier_id: courier.id,
            organization_id: organizationId,
            role: "sender",
            name: draft.senderName,
            last_name: draft.senderName,
            email: draft.senderEmail || null,
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

        for (const fileId of draft.fileIds) {
          const bf = files.find((f) => f.id === fileId);
          if (!bf) continue;
          try {
            await storage.upload(organizationId, courier.id, bf.file, "attachment");
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Erreur upload";
            toast.error(`${bf.file.name} : ${msg}`);
          }
        }

        count++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erreur inconnue";
        toast.error(`Courrier "${draft.title}" : ${msg}`);
      }
    }

    setCreatedCount(count);
    setConfirming(false);
    goToStep(5);

    queryClient.invalidateQueries({ queryKey: ["mailbox-couriers"] });
    queryClient.invalidateQueries({ queryKey: ["mailbox-unassigned"] });

    setTimeout(() => {
      navigate("/boite-aux-lettres");
    }, 3000);
  }

  const hasMissingService = drafts.some((d) => d.flags.includes("missing-service"));
  const canConfirm = drafts.length > 0 && !hasMissingService && !confirming;

  return (
    <div className="space-y-6 pb-32">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Import en masse</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Importez plusieurs courriers simultanément via OCR et analyse IA.
        </p>
      </div>

      <StepStrip current={step} maxReached={maxReached} onNavigate={goToStep} />

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
          />
        )}

        {step === 4 && (
          <>
            <div className="flex items-center justify-between mb-4">
              <div className="flex-1">
                {analyzing && (
                  <div className="flex items-center gap-2 text-sm text-primary">
                    <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                    <span>Analyse OCR en cours…</span>
                  </div>
                )}
                {hasMissingService && !analyzing && (
                  <p className="text-sm text-destructive">
                    Certains courriers n'ont pas de service gestionnaire.
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
                  {analyzing ? "Analyse en cours…" : "Analyser avec l'IA"}
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
                Redirection vers la boîte aux lettres dans 3 secondes…
              </p>
            </div>
            <Button variant="outline" onClick={() => navigate("/boite-aux-lettres")}>
              Aller à la boîte aux lettres
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
              else navigate("/boite-aux-lettres");
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
    </div>
  );
}
