import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { FileUp, Loader2, Lock, Mic, Sparkles, Upload } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { canEditCouriers, canSetConfidential, hasConfidentialAccess } from "@/lib/permissions";
import { prefillFromExtraction, type ServiceHint } from "@/lib/new-courier-prefill";
import { COURIER_LIST_QUERY_PREFIXES } from "@/services/courierListService";
import { assignableOrgs, listOrgsWithConfig } from "@/services/socleOrgConfigService";
import { listTags } from "@/services/courierTagService";
import { storage } from "@/services/storageService";
import {
  extractCourierInfo,
  type ExtractCourierInfoResult,
  type SuggestedSender,
} from "@/services/courierAnalysisService";
import { createInboundCourier } from "@/services/inboundCourierCreationService";
import ContactPicker from "@/components/courier/ContactPicker";
import { ContactCategoryBadges } from "@/components/contacts/ContactCategoryBadge";
import { CONTACT_CATEGORIES } from "@/lib/contact-categories";
import SenderMatchNotice from "@/components/courier/SenderMatchNotice";
import DictationRecorder from "@/components/courier/DictationRecorder";
import { PendingFilesPreview } from "@/components/courier/new-courier/PendingFilesPreview";
import { TagGroupPicker } from "@/components/courier/new-courier/TagGroupPicker";
import { ExtractedSenderCard } from "@/components/courier/new-courier/ExtractedSenderCard";
import { useDictationEnabled } from "@/hooks/useDictationEnabled";
import type { SenderMatch } from "../../../supabase/functions/_shared/senderMatchLogic";
import {
  matchSender,
  SOCLE_CONTACT_TYPE_LABELS,
  type SocleContact,
  type SocleContactCivility,
} from "@/services/socleContactService";
import type { CourierChannel } from "@/types/courier";

const channelOptions: { value: CourierChannel; label: string }[] = [
  { value: "paper", label: "Papier" },
  { value: "email", label: "Email" },
  { value: "portal", label: "Portail" },
  { value: "guichet", label: "Guichet" },
  { value: "autre", label: "Autre" },
];

const schema = z.object({
  subject: z.string().trim().min(1, "L'objet est obligatoire").max(255),
  channel: z.enum(["paper", "email", "portal", "guichet", "autre"]),
  received_at: z.string().min(1, "Date obligatoire"),
  recipient_name: z.string().trim().max(150).optional(),
});

/** Valeur du choix « à affecter plus tard » (un SelectItem ne peut valoir ""). */
const NO_SERVICE = "__none__";

const FORM_INVALID = "Veuillez corriger les erreurs du formulaire.";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  organizationId: string;
  onCreated?: (courierId: string) => void;
}

export default function NewCourierDialog({ open, onOpenChange, organizationId, onCreated }: Props) {
  const qc = useQueryClient();
  const { profile, membership } = useAuth();
  // Un consultant (lecteur seul) ne peut pas créer de courrier, même si ce
  // dialog était ouvert par un autre chemin que le bouton (défense en profondeur).
  const canEdit = canEditCouriers(profile, membership);

  const [step, setStep] = useState<"import" | "review">("import");
  const [importMode, setImportMode] = useState<"files" | "paste" | "dictation">("files");
  const [pastedText, setPastedText] = useState("");
  /** Transcription de la dictée vocale, relue et corrigée par l'agent. */
  const [dictatedText, setDictatedText] = useState("");

  const [subject, setSubject] = useState("");
  const [channel, setChannel] = useState<CourierChannel>("paper");
  const [receivedAt, setReceivedAt] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [senderContact, setSenderContact] = useState<SocleContact | null>(null);
  const [extractedCivility, setExtractedCivility] = useState<SocleContactCivility | "">("");
  const [recipientName, setRecipientName] = useState("");
  // Destinataire choisi parmi les contacts Interne / Élus ; le nom libre reste le repli.
  const [recipientContact, setRecipientContact] = useState<SocleContact | null>(null);
  const [serviceId, setServiceId] = useState<string>("");
  // Ce que l'analyse a dit de l'organisation gestionnaire : sa proposition et
  // pourquoi, ou pourquoi elle n'en fait pas.
  const [serviceHint, setServiceHint] = useState<ServiceHint | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [confidential, setConfidential] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [bodyText, setBodyText] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  // Expéditeur lu par l'analyse : sert à créer sa fiche quand le référentiel
  // ne le connaît pas (ou quand l'agent écarte le contact reconnu).
  const [extractedSender, setExtractedSender] = useState<SuggestedSender | null>(null);
  const [senderMatch, setSenderMatch] = useState<SenderMatch<SocleContact> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Analyse faite dans cet écran : enregistrée telle quelle sur le courrier créé.
  // Les pièces analysées sont gardées avec elle : si l'agent en ajoute ou en
  // retire ensuite, l'analyse ne couvre plus le courrier et se refait en file.
  const preCreationAnalysisRef = useRef<{ result: ExtractCourierInfoResult; files: File[] } | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep("import");
    setImportMode("files");
    setPastedText("");
    setDictatedText("");
    setSubject("");
    setChannel("paper");
    setReceivedAt(new Date().toISOString().slice(0, 10));
    setSenderContact(null);
    setExtractedCivility("");
    setRecipientName("");
    setRecipientContact(null);
    setServiceId("");
    setServiceHint(null);
    setSelectedTags([]);
    setConfidential(false);
    setErrors({});
    setBodyText("");
    setPendingFiles([]);
    setPreviewIndex(0);
    setExtractedSender(null);
    setSenderMatch(null);
    preCreationAnalysisRef.current = null;
  }, [open]);

  // Maintain previewIndex in bounds when files are removed
  useEffect(() => {
    if (pendingFiles.length > 0 && previewIndex >= pendingFiles.length) {
      setPreviewIndex(pendingFiles.length - 1);
    }
  }, [pendingFiles.length]);

  const { data: services } = useQuery({
    queryKey: ["socle-orgs-config", organizationId],
    queryFn: () => listOrgsWithConfig(organizationId),
    select: assignableOrgs,
    enabled: !!organizationId && open,
  });

  const dictationEnabled = useDictationEnabled(organizationId, open);

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
      });
      // Expéditeur inconnu du référentiel : sa fiche est créée avec le
      // courrier, et le Socle exige la civilité d'une personne.
      const senderToCreate = !senderContact && extractedSender ? extractedSender : null;
      const fe: Record<string, string> = {};
      if (!parsed.success) {
        parsed.error.issues.forEach((i) => {
          if (i.path[0]) fe[i.path[0] as string] = i.message;
        });
      }
      if (senderToCreate && !extractedCivility) {
        fe.sender_civility = "Civilité requise pour créer l'expéditeur dans le référentiel";
      }
      if (Object.keys(fe).length > 0) {
        setErrors(fe);
        throw new Error(FORM_INVALID);
      }
      setErrors({});

      // Facultative : sans organisation, le courrier attend dans la boîte aux
      // lettres qu'on l'affecte (pas d'état de workflow avant).
      const service = serviceId ? services?.find((s) => s.id === serviceId) : null;
      if (serviceId && !service) throw new Error("Organisation introuvable");

      const created = await createInboundCourier({
        organizationId,
        subject,
        channel,
        receivedOn: receivedAt,
        bodyText,
        tags: selectedTags,
        service: service ?? null,
        senderContact,
        senderToCreate: senderToCreate && extractedCivility ? { sender: senderToCreate, civility: extractedCivility } : null,
        recipientContact,
        recipientName,
        files: pendingFiles,
        preAnalysis: preCreationAnalysisRef.current,
        confidential,
      });
      created.uploadFailures.forEach((f) => toast.error(`${f.name} : ${f.message}`));
      return { ...created, confidential };
    },
    onSuccess: (res) => {
      // Toutes les listes, « Courrier entrant » comprise : n'invalider que la
      // boîte laissait l'écran du service courrier sur un instantané périmé.
      COURIER_LIST_QUERY_PREFIXES.forEach((prefix) => qc.invalidateQueries({ queryKey: [prefix] }));
      qc.invalidateQueries({ queryKey: ["mailbox-unassigned"] });
      if (res.total > 0) {
        toast.success(`Courrier créé — ${res.uploaded}/${res.total} fichier(s) ajouté(s)`);
      } else {
        toast.success("Courrier créé");
      }
      onOpenChange(false);
      // Confidentiel et je ne suis pas habilité : la fiche me serait fermée.
      if (onCreated && !(res.confidential && !hasConfidentialAccess(membership))) onCreated(res.courierId);
    },
    onError: (err: Error) => {
      if (err.message !== FORM_INVALID) toast.error(err.message);
    },
  });

  const extractMutation = useMutation({
    mutationFn: async () => {
      const result = await extractCourierInfo(
        importMode === "dictation"
          ? { pastedText: dictatedText, source: "dictation" }
          : {
            files: importMode === "files" ? pendingFiles : undefined,
            pastedText: importMode === "paste" ? pastedText : undefined,
          },
      );
      // Une edge function antérieure au rapprochement par `match` ne renvoie
      // pas `sender_match` (et son `matched_contact` repose sur le seul nom de
      // famille) : on refait alors le rapprochement d'ici, même règle.
      const s = result.sender;
      if (!result.sender_match && (s.first_name || s.last_name || s.email || s.phone)) {
        const match = await matchSender(organizationId, s).catch(() => null);
        return { ...result, sender_match: match ?? undefined };
      }
      return result;
    },
    onSuccess: (result) => {
      // Gardée telle quelle : elle deviendra l'analyse du courrier à sa création.
      preCreationAnalysisRef.current = { result, files: [...pendingFiles] };
      const patch = prefillFromExtraction(
        result,
        { subject, bodyText, recipientName, serviceId, selectedTags },
        services ?? [],
      );
      if (patch.subject !== undefined) setSubject(patch.subject);
      if (patch.bodyText !== undefined) setBodyText(patch.bodyText);
      if (patch.recipientName !== undefined) setRecipientName(patch.recipientName);
      if (patch.serviceId !== undefined) setServiceId(patch.serviceId);
      setServiceHint(patch.serviceHint);
      setSenderMatch(patch.senderMatch);
      setExtractedSender(patch.extractedSender);
      if (patch.civility) setExtractedCivility(patch.civility);
      if (patch.senderContact !== undefined) setSenderContact(patch.senderContact);
      if (patch.addTags.length) setSelectedTags((curr) => [...curr, ...patch.addTags]);

      // Échec partiel : le lot est passé, mais pas toutes les pièces. Le taire
      // laisserait croire que tout a été lu.
      if (result.ocr_failures?.length) {
        toast.warning("Pièces non lues", { description: result.ocr_failures.join(" ; ") });
      }

      if (patch.filled.length) {
        toast.success(`Analyse : ${patch.filled.join(", ")} pré-rempli(s)`);
      } else {
        toast.info("Analyse terminée — aucune information extraite");
      }
      setStep("review");
    },
    onError: (err: Error) => {
      // Le message vient de l'edge function — nom du fichier et motif compris.
      toast.error("Analyse impossible", { description: err.message });
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
      (importMode === "paste" && pastedText.trim().length > 0) ||
      (importMode === "dictation" && dictatedText.trim().length > 0);
    if (hasContent) {
      extractMutation.mutate();
    } else {
      setStep("review");
    }
  }

  return (
    <Dialog open={open && canEdit} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nouveau courrier</DialogTitle>
          <DialogDescription>
            {step === "import"
              ? dictationEnabled
                ? "Étape 1/2 — Importez un fichier, collez le contenu du courrier ou dictez la demande."
                : "Étape 1/2 — Importez un fichier ou collez le contenu du courrier."
              : "Étape 2/2 — Vérifiez et complétez les informations du courrier."}
          </DialogDescription>
        </DialogHeader>

        {step === "import" ? (
          <div className="space-y-4">
            <Tabs value={importMode} onValueChange={(v) => setImportMode(v as "files" | "paste" | "dictation")}>
              <TabsList className={cn("grid w-full", dictationEnabled ? "grid-cols-3" : "grid-cols-2")}>
                <TabsTrigger value="files">Importer des fichiers</TabsTrigger>
                <TabsTrigger value="paste">Coller un texte</TabsTrigger>
                {dictationEnabled && (
                  <TabsTrigger value="dictation" className="gap-1.5">
                    <Mic className="h-4 w-4" /> Dicter
                  </TabsTrigger>
                )}
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

                <PendingFilesPreview
                  files={pendingFiles}
                  index={previewIndex}
                  onIndexChange={setPreviewIndex}
                  onRemove={removePendingFile}
                />
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

              {dictationEnabled && (
                <TabsContent value="dictation" className="mt-3">
                  <DictationRecorder value={dictatedText} onChange={setDictatedText} />
                </TabsContent>
              )}
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
                    <PendingFilesPreview
                      files={pendingFiles}
                      index={previewIndex}
                      onIndexChange={setPreviewIndex}
                      onRemove={removePendingFile}
                      compact
                    />
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
                {extractedSender && !senderContact && (
                  <ExtractedSenderCard
                    organizationId={organizationId}
                    sender={extractedSender}
                    match={senderMatch}
                    civility={extractedCivility}
                    onCivilityChange={setExtractedCivility}
                    civilityError={errors.sender_civility}
                    onContactChosen={setSenderContact}
                    onDismiss={() => setExtractedSender(null)}
                  />
                )}

                <div className="space-y-2">
                  <Label>Expéditeur (contact du référentiel)</Label>
                  <ContactPicker
                    organizationId={organizationId}
                    value={senderContact}
                    onChange={setSenderContact}
                  />
                  {senderContact && senderMatch?.contact?.id === senderContact.id && (
                    <SenderMatchNotice
                      match={senderMatch}
                      selected
                      onCreateInstead={extractedSender ? () => setSenderContact(null) : undefined}
                    />
                  )}
                  {senderContact && (
                    <div className="text-xs text-muted-foreground space-y-0.5 pt-1">
                      <ContactCategoryBadges contact={senderContact} />
                      <div><span className="font-medium">Type :</span> {SOCLE_CONTACT_TYPE_LABELS[senderContact.contact_type]}</div>
                      {senderContact.email && <div><span className="font-medium">Email :</span> {senderContact.email}</div>}
                      {(senderContact.mobile_phone || senderContact.landline_phone) && (
                        <div><span className="font-medium">Téléphone :</span> {senderContact.mobile_phone ?? senderContact.landline_phone}</div>
                      )}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="nc-recipient">Destinataire</Label>
                  <ContactPicker
                    organizationId={organizationId}
                    value={recipientContact}
                    onChange={setRecipientContact}
                    roles={[...CONTACT_CATEGORIES]}
                    placeholder="Interne ou élu…"
                  />
                  {!recipientContact && (
                    <Input
                      id="nc-recipient"
                      value={recipientName}
                      onChange={(e) => setRecipientName(e.target.value)}
                      maxLength={150}
                      placeholder="… ou nom libre du destinataire"
                    />
                  )}
                </div>

                <TagGroupPicker selected={selectedTags} orgTags={orgTags ?? []} onToggle={toggleTag} />

                {canSetConfidential(profile, membership) && (
                  <label className="flex cursor-pointer items-start gap-2.5 rounded-md border p-3 text-sm">
                    <Checkbox
                      checked={confidential}
                      onCheckedChange={(v) => setConfidential(v === true)}
                      className="mt-0.5"
                    />
                    <span className="flex flex-col gap-0.5">
                      <span className="flex items-center gap-1.5 font-semibold">
                        <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                        Courrier confidentiel
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Lisible par les seuls membres habilités, et par les viseurs et signataires désignés
                        sur ses réponses.
                      </span>
                    </span>
                  </label>
                )}

                {/* Organisation gestionnaire — en bas de la colonne droite */}
                <div className="space-y-2">
                  <Label htmlFor="nc-service">Organisation gestionnaire</Label>
                  <Select
                    value={serviceId || NO_SERVICE}
                    onValueChange={(v) => setServiceId(v === NO_SERVICE ? "" : v)}
                  >
                    <SelectTrigger id="nc-service">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_SERVICE}>
                        <span className="text-muted-foreground">À affecter plus tard</span>
                      </SelectItem>
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
                  {/* La raison de l'IA ne vaut que pour SA proposition, pas pour un autre choix. */}
                  {serviceHint && (!serviceHint.orgId || serviceHint.orgId === serviceId) && (
                    <p className="flex gap-1.5 text-xs text-muted-foreground">
                      <Sparkles className="h-3.5 w-3.5 shrink-0 mt-px text-primary" />
                      <span>{serviceHint.text}</span>
                    </p>
                  )}
                  {!serviceId && (
                    <p className="text-xs text-muted-foreground">
                      Facultatif : le courrier pourra être affecté depuis « À instruire ».
                    </p>
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
