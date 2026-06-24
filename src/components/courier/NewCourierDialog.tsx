import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Check, ChevronLeft, ChevronRight, FileText, FileUp, Loader2, Sparkles, Tag as TagIcon, Upload, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { readableTextColor } from "@/lib/tag-color";
import { supabase } from "@/integrations/supabase/client";
import { createUsager } from "@/services/usagerService";
import { createCourier } from "@/services/courierService";
import { addParticipant } from "@/services/courierParticipantService";
import { listServices } from "@/services/orgServiceService";
import { listTags } from "@/services/courierTagService";
import { storage } from "@/services/storageService";
import { extractCourierInfo, runFullAnalysis } from "@/services/courierAnalysisService";
import UsagerPicker from "@/components/courier/UsagerPicker";
import type { Usager, UsagerCategory } from "@/services/usagerService";
import type { CourierChannel } from "@/types/courier";

const categoryLabels: Record<UsagerCategory, string> = {
  citoyen: "Citoyen",
  entreprise: "Entreprise",
  association: "Association",
};

const channelOptions: { value: CourierChannel; label: string }[] = [
  { value: "paper", label: "Papier" },
  { value: "email", label: "Email" },
  { value: "portal", label: "Portail" },
];

const schema = z.object({
  subject: z.string().trim().min(1, "L'objet est obligatoire").max(255),
  channel: z.enum(["paper", "email", "portal"]),
  received_at: z.string().min(1, "Date obligatoire"),
  recipient_name: z.string().trim().max(150).optional(),
  service_id: z.string().uuid("Service obligatoire"),
});

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  organizationId: string;
  onCreated?: (courierId: string) => void;
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} o`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} Ko`;
  return `${(b / (1024 * 1024)).toFixed(1)} Mo`;
}

export default function NewCourierDialog({ open, onOpenChange, organizationId, onCreated }: Props) {
  const qc = useQueryClient();

  const [step, setStep] = useState<"import" | "review">("import");
  const [importMode, setImportMode] = useState<"files" | "paste">("files");
  const [pastedText, setPastedText] = useState("");

  const [subject, setSubject] = useState("");
  const [channel, setChannel] = useState<CourierChannel>("paper");
  const [receivedAt, setReceivedAt] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [senderUsager, setSenderUsager] = useState<Usager | null>(null);
  const [recipientName, setRecipientName] = useState("");
  const [serviceId, setServiceId] = useState<string>("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagPopover, setTagPopover] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [bodyText, setBodyText] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [extractedSender, setExtractedSender] = useState<{
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone: string | null;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const analyzedPreCreationRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    setStep("import");
    setImportMode("files");
    setPastedText("");
    setSubject("");
    setChannel("paper");
    setReceivedAt(new Date().toISOString().slice(0, 10));
    setSenderUsager(null);
    setRecipientName("");
    setServiceId("");
    setSelectedTags([]);
    setErrors({});
    setBodyText("");
    setPendingFiles([]);
    setPreviewIndex(0);
    setExtractedSender(null);
    analyzedPreCreationRef.current = false;
  }, [open]);

  // Maintain previewIndex in bounds when files are removed
  useEffect(() => {
    if (pendingFiles.length > 0 && previewIndex >= pendingFiles.length) {
      setPreviewIndex(pendingFiles.length - 1);
    }
  }, [pendingFiles.length]);

  // Create and revoke object URLs for local file preview
  useEffect(() => {
    const urls = pendingFiles.map((f) => URL.createObjectURL(f));
    setPreviewUrls(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [pendingFiles]);

  const { data: services } = useQuery({
    queryKey: ["org-services", organizationId],
    queryFn: () => listServices(organizationId),
    enabled: !!organizationId && open,
  });

  const { data: orgTags } = useQuery({
    queryKey: ["courier-tags", organizationId],
    queryFn: () => listTags(organizationId),
    enabled: !!organizationId && open,
  });

  const { data: maxFileSize = 10 * 1024 * 1024 } = useQuery({
    queryKey: ["max-file-size", organizationId],
    queryFn: () => storage.getMaxFileSize(organizationId),
    enabled: !!organizationId && open,
    staleTime: 5 * 60 * 1000,
  });

  const tagByName = useMemo(
    () => new Map((orgTags ?? []).map((t) => [t.name.toLowerCase(), t])),
    [orgTags],
  );

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const arr = Array.from(files);
      const oversized = arr.filter((f) => f.size > maxFileSize);
      if (oversized.length) {
        const maxMB = (maxFileSize / (1024 * 1024)).toFixed(1);
        toast.error(
          `${oversized.length} fichier(s) dépasse(nt) ${maxMB} Mo : ${oversized.map((f) => f.name).join(", ")}`,
        );
      }
      const ok = arr.filter((f) => f.size <= maxFileSize);
      setPendingFiles((curr) => [...curr, ...ok]);
    },
    [maxFileSize],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
    },
    [addFiles],
  );

  const createMutation = useMutation({
    mutationFn: async () => {
      const parsed = schema.safeParse({
        subject,
        channel,
        received_at: receivedAt,
        recipient_name: recipientName,
        service_id: serviceId,
      });
      if (!parsed.success) {
        const fe: Record<string, string> = {};
        parsed.error.issues.forEach((i) => {
          if (i.path[0]) fe[i.path[0] as string] = i.message;
        });
        setErrors(fe);
        throw new Error("Veuillez corriger les erreurs du formulaire.");
      }
      setErrors({});

      const service = services?.find((s) => s.id === serviceId);
      if (!service) throw new Error("Service introuvable");

      const { data: initialState, error: stateErr } = await supabase
        .from("workflow_states")
        .select("id")
        .eq("workflow_id", service.workflow_id)
        .eq("is_initial", true)
        .maybeSingle();
      if (stateErr) throw stateErr;

      const {
        data: { user },
      } = await supabase.auth.getUser();

      // Build received_at: if the chosen date is today, use the current time
      // so manually created couriers are sorted alongside other recent items.
      // Otherwise, anchor to noon local time to avoid timezone-induced day shifts.
      const today = new Date().toISOString().slice(0, 10);
      const receivedAtIso =
        receivedAt === today
          ? new Date().toISOString()
          : new Date(`${receivedAt}T12:00:00`).toISOString();

      const { data: courier, error: cErr } = await createCourier({
        organization_id: organizationId,
        direction: "inbound",
        channel,
        subject: subject.trim(),
        received_at: receivedAtIso,
        assigned_service: service.name,
        workflow_state_id: initialState?.id ?? null,
        metadata: {
          tags: selectedTags,
          service_id: service.id,
          ...(bodyText.trim() ? { body_text: bodyText.trim() } : {}),
        } as any,
        created_by: user?.id ?? null,
      });
      if (cErr) throw cErr;
      if (!courier) throw new Error("Création échouée");

      if (senderUsager) {
        await addParticipant({
          courier_id: courier.id,
          organization_id: organizationId,
          role: "sender",
          name: [senderUsager.first_name, senderUsager.last_name].filter(Boolean).join(" ").trim() || null,
          first_name: senderUsager.first_name,
          last_name: senderUsager.last_name,
          email: senderUsager.email,
          phone: senderUsager.phone,
          usager_id: senderUsager.id,
        });
      }
      if (recipientName.trim()) {
        await addParticipant({
          courier_id: courier.id,
          organization_id: organizationId,
          role: "recipient",
          name: recipientName.trim(),
          last_name: recipientName.trim(),
        });
      }

      // Upload pending files (best-effort: report partial errors)
      let uploadFailures = 0;
      for (const file of pendingFiles) {
        try {
          await storage.upload(organizationId, courier.id, file, "attachment");
        } catch (err) {
          uploadFailures++;
          const msg = err instanceof Error ? err.message : "Erreur upload";
          toast.error(`${file.name} : ${msg}`);
        }
      }
      return { courierId: courier.id, uploaded: pendingFiles.length - uploadFailures, total: pendingFiles.length };
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["mailbox-couriers"] });
      qc.invalidateQueries({ queryKey: ["mailbox-unassigned"] });
      if (res && res.total > 0) {
        toast.success(`Courrier créé — ${res.uploaded}/${res.total} fichier(s) ajouté(s)`);
      } else {
        toast.success("Courrier créé");
      }
      onOpenChange(false);
      if (onCreated) onCreated(res.courierId);

      // Si l'utilisateur a lancé l'analyse OCR en pré-création, on relance
      // une analyse complète côté serveur pour persister les extraits OCR
      // dans `courier_document_extracts` et générer l'analyse IA dès maintenant.
      if (analyzedPreCreationRef.current && res.uploaded > 0 && res.courierId) {
        const courierId = res.courierId;
        runFullAnalysis(courierId)
          .then(() => {
            qc.invalidateQueries({ queryKey: ["courier-extracts", courierId] });
            qc.invalidateQueries({ queryKey: ["courier-analysis", courierId] });
            qc.invalidateQueries({ queryKey: ["courier", organizationId, courierId] });
          })
          .catch((e) => {
            console.error("Analyse automatique post-création échouée:", e);
          });
      }
    },
    onError: (err: Error) => {
      if (err.message !== "Veuillez corriger les erreurs du formulaire.") {
        toast.error(err.message);
      }
    },
  });

  const extractMutation = useMutation({
    mutationFn: async () => {
      return extractCourierInfo({
        files: importMode === "files" ? pendingFiles : undefined,
        pastedText: importMode === "paste" ? pastedText : undefined,
      });
    },
    onSuccess: (result) => {
      const filled: string[] = [];

      // Pre-fill subject
      if (result.suggested_subject?.trim() && !subject.trim()) {
        setSubject(result.suggested_subject.trim());
        filled.push("titre");
      }

      // Pre-fill body text from OCR / texte collé
      if (result.extracted_text?.trim() && !bodyText.trim()) {
        setBodyText(result.extracted_text.trim());
        filled.push("contenu");
      }

      // Pre-fill sender
      if (result.matched_usager) {
        setSenderUsager(result.matched_usager as any);
        setExtractedSender(null);
        filled.push("expéditeur reconnu");
      } else if (result.sender.first_name || result.sender.last_name) {
        setExtractedSender(result.sender);
        filled.push("expéditeur extrait");
      }

      // Pre-fill recipient
      if (result.recipient_name && !recipientName.trim()) {
        setRecipientName(result.recipient_name);
        filled.push("destinataire");
      }

      // Pre-fill service
      if (result.suggested_service_name) {
        const match = services?.find(
          (s) => s.name.toLowerCase() === result.suggested_service_name!.toLowerCase(),
        );
        if (match && !serviceId) {
          setServiceId(match.id);
          filled.push("service gestionnaire");
        }
      }

      // Pre-fill tags (compute toAdd outside the state updater to track filled)
      if (result.suggested_tag_names.length) {
        const existing = new Set(selectedTags.map((t) => t.toLowerCase()));
        const toAdd = result.suggested_tag_names.filter((t) => !existing.has(t.toLowerCase()));
        if (toAdd.length) {
          setSelectedTags((curr) => [...curr, ...toAdd]);
          filled.push(`${toAdd.length} tag(s)`);
        }
      }

      if (filled.length) {
        toast.success(`Analyse : ${filled.join(", ")} pré-rempli(s)`);
      } else {
        toast.info("Analyse terminée — aucune information extraite");
      }
      setStep("review");
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  function toggleTag(name: string) {
    setSelectedTags((curr) =>
      curr.some((t) => t.toLowerCase() === name.toLowerCase())
        ? curr.filter((t) => t.toLowerCase() !== name.toLowerCase())
        : [...curr, name],
    );
  }

  function removePendingFile(idx: number) {
    setPendingFiles((curr) => curr.filter((_, i) => i !== idx));
  }

  function handleContinue() {
    const hasContent =
      (importMode === "files" && pendingFiles.length > 0) ||
      (importMode === "paste" && pastedText.trim().length > 0);
    if (hasContent) {
      extractMutation.mutate();
    } else {
      setStep("review");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nouveau courrier</DialogTitle>
          <DialogDescription>
            {step === "import"
              ? "Étape 1/2 — Importez un fichier ou collez le contenu du courrier."
              : "Étape 2/2 — Vérifiez et complétez les informations du courrier."}
          </DialogDescription>
        </DialogHeader>

        {step === "import" ? (
          <div className="space-y-4">
            <Tabs value={importMode} onValueChange={(v) => setImportMode(v as "files" | "paste")}>
              <TabsList className="grid grid-cols-2 w-full">
                <TabsTrigger value="files">Importer des fichiers</TabsTrigger>
                <TabsTrigger value="paste">Coller un texte</TabsTrigger>
              </TabsList>

              <TabsContent value="files" className="mt-3 space-y-3">
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={onDrop}
                  className={cn(
                    "border-2 border-dashed rounded-lg text-center transition-colors",
                    pendingFiles.length > 0 ? "py-3 px-4" : "p-10",
                    dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-muted-foreground/50",
                  )}
                >
                  {pendingFiles.length === 0 && (
                    <Upload className="h-10 w-10 mx-auto text-muted-foreground/50 mb-2" />
                  )}
                  <p className="text-sm text-muted-foreground mb-2">
                    {pendingFiles.length > 0 ? "Ajouter d'autres fichiers ou" : "Glissez-déposez vos fichiers ici ou"}
                  </p>
                  <Button type="button" size="sm" className="gap-1.5" onClick={() => fileInputRef.current?.click()}>
                    <FileUp className="h-4 w-4" /> Parcourir
                  </Button>
                  <p className="text-xs text-muted-foreground mt-2">
                    Max {(maxFileSize / (1024 * 1024)).toFixed(0)} Mo par fichier
                  </p>
                  <input ref={fileInputRef} type="file" multiple className="hidden"
                    onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ""; }}
                  />
                </div>

                {pendingFiles.length > 0 && (
                  <div className="rounded-lg border overflow-hidden">
                    <div className="relative bg-muted/30 h-[260px] flex items-center justify-center">
                      {(() => {
                        const file = pendingFiles[previewIndex];
                        const url = previewUrls[previewIndex];
                        if (!file || !url) return null;
                        if (file.type.startsWith("image/")) {
                          return <img src={url} alt={file.name} className="max-h-full max-w-full object-contain p-2" />;
                        }
                        if (file.type === "application/pdf") {
                          return <iframe src={url} className="w-full h-full border-0" title={file.name} />;
                        }
                        return (
                          <div className="text-center text-muted-foreground px-4">
                            <FileText className="h-10 w-10 mx-auto mb-2 opacity-40" />
                            <p className="text-sm font-medium truncate">{file.name}</p>
                            <p className="text-xs mt-1">Aperçu non disponible</p>
                          </div>
                        );
                      })()}

                      {pendingFiles.length > 1 && (
                        <>
                          <button
                            type="button"
                            onClick={() => setPreviewIndex((i) => Math.max(0, i - 1))}
                            disabled={previewIndex === 0}
                            className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-background/90 p-1.5 shadow hover:bg-background disabled:opacity-30 transition-opacity"
                          >
                            <ChevronLeft className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setPreviewIndex((i) => Math.min(pendingFiles.length - 1, i + 1))}
                            disabled={previewIndex === pendingFiles.length - 1}
                            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-background/90 p-1.5 shadow hover:bg-background disabled:opacity-30 transition-opacity"
                          >
                            <ChevronRight className="h-4 w-4" />
                          </button>
                        </>
                      )}

                      {pendingFiles.length > 1 && (
                        <span className="absolute bottom-2 right-3 text-[10px] text-muted-foreground bg-background/80 rounded px-1.5 py-0.5">
                          {previewIndex + 1} / {pendingFiles.length}
                        </span>
                      )}
                    </div>

                    <div className="border-t divide-y max-h-[160px] overflow-y-auto">
                      {pendingFiles.map((f, i) => (
                        <div
                          key={`${f.name}-${i}`}
                          onClick={() => setPreviewIndex(i)}
                          className={cn(
                            "flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer transition-colors",
                            i === previewIndex ? "bg-muted font-medium" : "hover:bg-muted/50",
                          )}
                        >
                          <span className="flex-1 truncate" title={f.name}>{f.name}</span>
                          <span className="text-xs text-muted-foreground shrink-0">{formatBytes(f.size)}</span>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); removePendingFile(i); }}
                            className="p-0.5 rounded hover:text-destructive transition-colors ml-1"
                            aria-label={`Retirer ${f.name}`}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="paste" className="mt-3">
                <Textarea
                  value={pastedText}
                  onChange={(e) => setPastedText(e.target.value)}
                  placeholder="Collez ici le contenu du courrier…"
                  rows={12}
                  className="resize-y min-h-[280px]"
                />
              </TabsContent>
            </Tabs>

            <DialogFooter className="mt-2 sm:justify-between">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Annuler
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" onClick={() => setStep("review")}>
                  Saisir manuellement
                </Button>
                <Button type="button" onClick={handleContinue} disabled={extractMutation.isPending} className="gap-2">
                  {extractMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  {extractMutation.isPending ? "Analyse en cours…" : "Continuer"}
                </Button>
              </div>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Ligne 1 — Titre (pleine largeur) */}
            <div className="space-y-2">
              <Label htmlFor="nc-subject">Titre *</Label>
              <Input
                id="nc-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={255}
                placeholder="Titre du courrier"
              />
              {errors.subject && (
                <p className="text-xs text-destructive">{errors.subject}</p>
              )}
            </div>

            {/* Ligne 2 — Canal + Date (même ligne) */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="nc-channel">Canal *</Label>
                <Select value={channel} onValueChange={(v) => setChannel(v as CourierChannel)}>
                  <SelectTrigger id="nc-channel"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {channelOptions.map((c) => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="nc-date">Date de réception *</Label>
                <Input
                  id="nc-date"
                  type="date"
                  value={receivedAt}
                  onChange={(e) => setReceivedAt(e.target.value)}
                />
                {errors.received_at && (
                  <p className="text-xs text-destructive">{errors.received_at}</p>
                )}
              </div>
            </div>

            {/* Deux colonnes */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">

              {/* Colonne gauche — Aperçu des fichiers importés (compact) puis Contenu */}
              <div className="space-y-4">
                {pendingFiles.length > 0 && (
                  <div className="space-y-2">
                    <Label>Documents importés</Label>
                    <div className="rounded-lg border overflow-hidden">
                      <div className="relative bg-muted/30 h-[160px] flex items-center justify-center">
                        {(() => {
                          const file = pendingFiles[previewIndex];
                          const url = previewUrls[previewIndex];
                          if (!file || !url) return null;
                          if (file.type.startsWith("image/")) {
                            return <img src={url} alt={file.name} className="max-h-full max-w-full object-contain p-2" />;
                          }
                          if (file.type === "application/pdf") {
                            return <iframe src={url} className="w-full h-full border-0" title={file.name} />;
                          }
                          return (
                            <div className="text-center text-muted-foreground px-4">
                              <FileText className="h-8 w-8 mx-auto mb-1 opacity-40" />
                              <p className="text-xs font-medium truncate">{file.name}</p>
                            </div>
                          );
                        })()}
                        {pendingFiles.length > 1 && (
                          <>
                            <button
                              type="button"
                              onClick={() => setPreviewIndex((i) => Math.max(0, i - 1))}
                              disabled={previewIndex === 0}
                              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-background/90 p-1 shadow hover:bg-background disabled:opacity-30 transition-opacity"
                            >
                              <ChevronLeft className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setPreviewIndex((i) => Math.min(pendingFiles.length - 1, i + 1))}
                              disabled={previewIndex === pendingFiles.length - 1}
                              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-background/90 p-1 shadow hover:bg-background disabled:opacity-30 transition-opacity"
                            >
                              <ChevronRight className="h-3.5 w-3.5" />
                            </button>
                            <span className="absolute bottom-1.5 right-2 text-[10px] text-muted-foreground bg-background/80 rounded px-1.5 py-0.5">
                              {previewIndex + 1} / {pendingFiles.length}
                            </span>
                          </>
                        )}
                      </div>
                      <div className="border-t divide-y max-h-[90px] overflow-y-auto">
                        {pendingFiles.map((f, i) => (
                          <div
                            key={`${f.name}-${i}`}
                            onClick={() => setPreviewIndex(i)}
                            className={cn(
                              "flex items-center gap-2 px-3 py-1 text-xs cursor-pointer transition-colors",
                              i === previewIndex ? "bg-muted font-medium" : "hover:bg-muted/50",
                            )}
                          >
                            <span className="flex-1 truncate" title={f.name}>{f.name}</span>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); removePendingFile(i); }}
                              className="p-0.5 rounded hover:text-destructive transition-colors ml-1"
                              aria-label={`Retirer ${f.name}`}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="nc-body">Contenu</Label>
                  <Textarea
                    id="nc-body"
                    value={bodyText}
                    onChange={(e) => setBodyText(e.target.value)}
                    placeholder="Saisissez le contenu du courrier (facultatif)…"
                    rows={6}
                    className="resize-y min-h-[140px]"
                  />
                </div>
              </div>

              {/* Colonne droite — Expéditeur, Destinataire, Tags */}
              <div className="space-y-4">
                {/* Extracted sender banner (OCR result not matched to an existing usager) */}
                {extractedSender && !senderUsager && (
                  <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
                    <p className="text-xs font-medium text-primary">Expéditeur extrait par l'analyse</p>
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      {(extractedSender.first_name || extractedSender.last_name) && (
                        <div>{[extractedSender.first_name, extractedSender.last_name].filter(Boolean).join(" ")}</div>
                      )}
                      {extractedSender.email && <div>{extractedSender.email}</div>}
                      {extractedSender.phone && <div>{extractedSender.phone}</div>}
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="w-full h-7 text-xs"
                      onClick={async () => {
                        try {
                          const created = await createUsager(organizationId, {
                            category: "citoyen",
                            first_name: extractedSender.first_name,
                            last_name: extractedSender.last_name,
                            email: extractedSender.email,
                            phone: extractedSender.phone,
                          });
                          setSenderUsager(created as any);
                          setExtractedSender(null);
                          toast.success("Usager créé et sélectionné");
                        } catch (e) {
                          toast.error((e as Error).message);
                        }
                      }}
                    >
                      Créer et sélectionner cet usager
                    </Button>
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-center"
                      onClick={() => setExtractedSender(null)}
                    >
                      Ignorer
                    </button>
                  </div>
                )}

                <div className="space-y-2">
                  <Label>Expéditeur (usager)</Label>
                  <UsagerPicker
                    organizationId={organizationId}
                    value={senderUsager}
                    onChange={setSenderUsager}
                  />
                  {senderUsager && (
                    <div className="text-xs text-muted-foreground space-y-0.5 pt-1">
                      <div><span className="font-medium">Nature :</span> {categoryLabels[senderUsager.category]}</div>
                      {senderUsager.email && <div><span className="font-medium">Email :</span> {senderUsager.email}</div>}
                      {senderUsager.phone && <div><span className="font-medium">Téléphone :</span> {senderUsager.phone}</div>}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="nc-recipient">Destinataire</Label>
                  <Input
                    id="nc-recipient"
                    value={recipientName}
                    onChange={(e) => setRecipientName(e.target.value)}
                    maxLength={150}
                    placeholder="Nom du destinataire"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Tags</Label>
                    <Popover open={tagPopover} onOpenChange={setTagPopover}>
                      <PopoverTrigger asChild>
                        <Button type="button" size="sm" variant="outline" className="h-8">
                          <TagIcon className="h-3.5 w-3.5 mr-1.5" />
                          Choisir
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-64 p-0" align="end">
                        <Command>
                          <CommandInput placeholder="Rechercher un tag…" />
                          <CommandList>
                            <CommandEmpty>Aucun tag défini.</CommandEmpty>
                            <CommandGroup>
                              {(orgTags ?? []).map((tag) => {
                                const checked = selectedTags.some((t) => t.toLowerCase() === tag.name.toLowerCase());
                                return (
                                  <CommandItem key={tag.id} value={tag.name} onSelect={() => toggleTag(tag.name)} className="gap-2">
                                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: tag.color ?? "hsl(var(--muted-foreground))" }} />
                                    <span className="flex-1">{tag.name}</span>
                                    <Check className={cn("h-4 w-4", checked ? "opacity-100" : "opacity-0")} />
                                  </CommandItem>
                                );
                              })}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="flex flex-wrap gap-1.5 min-h-[28px]">
                    {selectedTags.length === 0 && (
                      <span className="text-xs text-muted-foreground self-center">Aucun tag (facultatif)</span>
                    )}
                    {selectedTags.map((name) => {
                      const tag = tagByName.get(name.toLowerCase());
                      const fg = tag?.color ? readableTextColor(tag.color) : undefined;
                      return (
                        <Badge
                          key={name} variant="secondary"
                          className="gap-1.5 pl-2 pr-1 border-transparent"
                          style={tag?.color ? { backgroundColor: tag.color, color: fg } : undefined}
                        >
                          {name}
                          <button
                            type="button" onClick={() => toggleTag(name)}
                            className="ml-0.5 rounded-full p-0.5 hover:bg-black/20 transition-colors"
                            aria-label={`Retirer ${name}`} style={fg ? { color: fg } : undefined}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      );
                    })}
                  </div>
                </div>

                {/* Service gestionnaire — en bas de la colonne droite */}
                <div className="space-y-2">
                  <Label htmlFor="nc-service">Service gestionnaire *</Label>
                  <Select value={serviceId} onValueChange={setServiceId}>
                    <SelectTrigger id="nc-service">
                      <SelectValue placeholder="Sélectionner un service" />
                    </SelectTrigger>
                    <SelectContent>
                      {(services ?? []).map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                          {s.workflow?.name && (
                            <span className="text-muted-foreground text-xs ml-2">— {s.workflow.name}</span>
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!services?.length && (
                    <p className="text-xs text-muted-foreground">
                      Aucun service défini. Créez-en un dans Paramètres → Services.
                    </p>
                  )}
                  {errors.service_id && (
                    <p className="text-xs text-destructive">{errors.service_id}</p>
                  )}
                </div>
              </div>
            </div>

            <DialogFooter className="mt-2 sm:justify-between">
              <Button type="button" variant="outline" onClick={() => setStep("import")}>
                Retour
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Annuler
                </Button>
                <Button type="button" onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
                  {createMutation.isPending ? "Création…" : "Créer"}
                </Button>
              </div>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
