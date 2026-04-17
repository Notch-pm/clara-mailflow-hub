import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Check, Tag as TagIcon } from "lucide-react";
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
import { supabase } from "@/integrations/supabase/client";
import { createCourier } from "@/services/courierService";
import { addParticipant } from "@/services/courierParticipantService";
import { listServices } from "@/services/orgServiceService";
import { listTags } from "@/services/courierTagService";
import type { CourierChannel } from "@/types/courier";

const channelOptions: { value: CourierChannel; label: string }[] = [
  { value: "paper", label: "Papier" },
  { value: "email", label: "Email" },
  { value: "portal", label: "Portail" },
];

const schema = z.object({
  subject: z.string().trim().min(1, "L'objet est obligatoire").max(255),
  channel: z.enum(["paper", "email", "portal"]),
  received_at: z.string().min(1, "Date obligatoire"),
  sender_name: z.string().trim().max(150).optional(),
  sender_email: z
    .string()
    .trim()
    .email("Email invalide")
    .optional()
    .or(z.literal("")),
  recipient_name: z.string().trim().max(150).optional(),
  service_id: z.string().uuid("Service obligatoire"),
});

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  organizationId: string;
}

export default function NewCourierDialog({ open, onOpenChange, organizationId }: Props) {
  const qc = useQueryClient();

  const [subject, setSubject] = useState("");
  const [channel, setChannel] = useState<CourierChannel>("paper");
  const [receivedAt, setReceivedAt] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [senderName, setSenderName] = useState("");
  const [senderEmail, setSenderEmail] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [serviceId, setServiceId] = useState<string>("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagPopover, setTagPopover] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setSubject("");
    setChannel("paper");
    setReceivedAt(new Date().toISOString().slice(0, 10));
    setSenderName("");
    setSenderEmail("");
    setRecipientName("");
    setServiceId("");
    setSelectedTags([]);
    setErrors({});
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

  const tagByName = useMemo(
    () => new Map((orgTags ?? []).map((t) => [t.name.toLowerCase(), t])),
    [orgTags],
  );

  const createMutation = useMutation({
    mutationFn: async () => {
      const parsed = schema.safeParse({
        subject,
        channel,
        received_at: receivedAt,
        sender_name: senderName,
        sender_email: senderEmail,
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

      // Initial state of the service's workflow
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
        metadata: { tags: selectedTags, service_id: service.id } as any,
        created_by: user?.id ?? null,
      });
      if (cErr) throw cErr;
      if (!courier) throw new Error("Création échouée");

      // Participants (optional sender/recipient)
      if (senderName.trim() || senderEmail.trim()) {
        await addParticipant({
          courier_id: courier.id,
          organization_id: organizationId,
          role: "sender",
          name: senderName.trim() || null,
          email: senderEmail.trim() || null,
        });
      }
      if (recipientName.trim()) {
        await addParticipant({
          courier_id: courier.id,
          organization_id: organizationId,
          role: "recipient",
          name: recipientName.trim(),
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mailbox-couriers"] });
      qc.invalidateQueries({ queryKey: ["mailbox-unassigned"] });
      toast.success("Courrier créé");
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
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
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="nc-subject">Objet *</Label>
            <Textarea
              id="nc-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={255}
              rows={2}
              placeholder="Objet du courrier"
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

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="nc-sender-name">Expéditeur (nom)</Label>
              <Input
                id="nc-sender-name"
                value={senderName}
                onChange={(e) => setSenderName(e.target.value)}
                maxLength={150}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nc-sender-email">Expéditeur (email)</Label>
              <Input
                id="nc-sender-email"
                type="email"
                value={senderEmail}
                onChange={(e) => setSenderEmail(e.target.value)}
              />
              {errors.sender_email && (
                <p className="text-xs text-destructive">{errors.sender_email}</p>
              )}
            </div>
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
                return (
                  <Badge
                    key={name}
                    variant="secondary"
                    style={
                      tag?.color
                        ? { backgroundColor: `${tag.color}20`, color: tag.color }
                        : undefined
                    }
                  >
                    {name}
                  </Badge>
                );
              })}
            </div>
          </div>

          <DialogFooter>
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
