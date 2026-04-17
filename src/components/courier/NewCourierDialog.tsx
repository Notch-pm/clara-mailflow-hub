import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Check, FileUp, Tag as TagIcon, Upload, X } from "lucide-react";
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
import { createCourier } from "@/services/courierService";
import { addParticipant } from "@/services/courierParticipantService";
import { listServices } from "@/services/orgServiceService";
import { listTags } from "@/services/courierTagService";
import { storage } from "@/services/storageService";
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
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} o`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} Ko`;
  return `${(b / (1024 * 1024)).toFixed(1)} Mo`;
}

export default function NewCourierDialog({ open, onOpenChange, organizationId }: Props) {
  const qc = useQueryClient();

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
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
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
  }, [open]);

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

      const { data: courier, error: cErr } = await createCourier({
        organization_id: organizationId,
        direction: "inbound",
        channel,
        subject: subject.trim(),
        received_at: new Date(receivedAt).toISOString(),
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
      return { uploaded: pendingFiles.length - uploadFailures, total: pendingFiles.length };
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
    },
    onError: (err: Error) => {
      if (err.message !== "Veuillez corriger les erreurs du formulaire.") {
        toast.error(err.message);
      }
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nouveau courrier</DialogTitle>
          <DialogDescription>
            Renseignez les informations du courrier reçu.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate();
          }}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Left column — form */}
            <div className="space-y-4">
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

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="nc-channel">Canal *</Label>
                  <Select
                    value={channel}
                    onValueChange={(v) => setChannel(v as CourierChannel)}
                  >
                    <SelectTrigger id="nc-channel">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {channelOptions.map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          {c.label}
                        </SelectItem>
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

              <div className="space-y-2">
                <Label>Expéditeur (usager)</Label>
                <UsagerPicker
                  organizationId={organizationId}
                  value={senderUsager}
                  onChange={setSenderUsager}
                />
                {senderUsager && (
                  <div className="text-xs text-muted-foreground space-y-0.5 pt-1">
                    <div>
                      <span className="font-medium">Nature :</span> {categoryLabels[senderUsager.category]}
                    </div>
                    {senderUsager.email && (
                      <div><span className="font-medium">Email :</span> {senderUsager.email}</div>
                    )}
                    {senderUsager.phone && (
                      <div><span className="font-medium">Téléphone :</span> {senderUsager.phone}</div>
                    )}
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
                          <span className="text-muted-foreground text-xs ml-2">
                            — {s.workflow.name}
                          </span>
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
                              const checked = selectedTags.some(
                                (t) => t.toLowerCase() === tag.name.toLowerCase(),
                              );
                              return (
                                <CommandItem
                                  key={tag.id}
                                  value={tag.name}
                                  onSelect={() => toggleTag(tag.name)}
                                  className="gap-2"
                                >
                                  <span
                                    className="h-2.5 w-2.5 rounded-full shrink-0"
                                    style={{
                                      backgroundColor:
                                        tag.color ?? "hsl(var(--muted-foreground))",
                                    }}
                                  />
                                  <span className="flex-1">{tag.name}</span>
                                  <Check
                                    className={cn(
                                      "h-4 w-4",
                                      checked ? "opacity-100" : "opacity-0",
                                    )}
                                  />
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
                    <span className="text-xs text-muted-foreground self-center">
                      Aucun tag (facultatif)
                    </span>
                  )}
                  {selectedTags.map((name) => {
                    const tag = tagByName.get(name.toLowerCase());
                    const fg = tag?.color ? readableTextColor(tag.color) : undefined;
                    return (
                      <Badge
                        key={name}
                        variant="secondary"
                        className="gap-1.5 pl-2 pr-1 border-transparent"
                        style={
                          tag?.color
                            ? { backgroundColor: tag.color, color: fg }
                            : undefined
                        }
                      >
                        {name}
                        <button
                          type="button"
                          onClick={() => toggleTag(name)}
                          className="ml-0.5 rounded-full p-0.5 hover:bg-black/20 transition-colors"
                          aria-label={`Retirer ${name}`}
                          style={fg ? { color: fg } : undefined}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Right column — body + file upload */}
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="nc-body">Contenu</Label>
                <Textarea
                  id="nc-body"
                  value={bodyText}
                  onChange={(e) => setBodyText(e.target.value)}
                  placeholder="Saisissez le contenu du courrier (facultatif)…"
                  rows={8}
                  className="resize-y min-h-[180px]"
                />
              </div>

              <div className="space-y-3">
                <Label>Documents (facultatif)</Label>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                className={cn(
                  "border-2 border-dashed rounded-lg p-6 text-center transition-colors",
                  dragOver
                    ? "border-primary bg-primary/5"
                    : "border-muted-foreground/25 hover:border-muted-foreground/50",
                )}
              >
                <Upload className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
                <p className="text-sm text-muted-foreground mb-3">
                  Glissez-déposez vos fichiers ici ou
                </p>
                <Button
                  type="button"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <FileUp className="h-4 w-4" /> Parcourir
                </Button>
                <p className="text-xs text-muted-foreground mt-2">
                  Max {(maxFileSize / (1024 * 1024)).toFixed(0)} Mo par fichier
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.length) addFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
              </div>

              {pendingFiles.length > 0 && (
                <div className="border rounded-lg divide-y max-h-[260px] overflow-y-auto">
                  {pendingFiles.map((f, i) => (
                    <div
                      key={`${f.name}-${i}`}
                      className="flex items-center gap-2 px-3 py-2 text-sm"
                    >
                      <span className="flex-1 truncate" title={f.name}>
                        {f.name}
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {formatBytes(f.size)}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => removePendingFile(i)}
                        aria-label={`Retirer ${f.name}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              {pendingFiles.length === 0 && (
                <p className="text-xs text-muted-foreground text-center">
                  Aucun fichier sélectionné
                </p>
              )}
              </div>
            </div>
          </div>

          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Annuler
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Création…" : "Créer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
