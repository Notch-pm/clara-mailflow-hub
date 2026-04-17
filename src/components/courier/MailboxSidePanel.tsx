import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { X, ArrowRight, Tag as TagIcon, Check, Briefcase, FileText } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { updateCourier } from "@/services/courierService";
import { listTags, type CourierTag } from "@/services/courierTagService";
import { listServices } from "@/services/orgServiceService";
import { getDocuments } from "@/services/courierDocumentService";
import { addParticipant, updateParticipant } from "@/services/courierParticipantService";
import { cn } from "@/lib/utils";
import { readableTextColor } from "@/lib/tag-color";
import DocumentManager from "./DocumentManager";
import DocumentViewer from "./DocumentViewer";
import InlineEditField from "./InlineEditField";
import CourierNotes from "./CourierNotes";
import ContentIntentsTab from "./ContentIntentsTab";
import type { CourierChannel, CourierParticipant, WorkflowTransition, WorkflowState } from "@/types/courier";

const channelLabels: Record<CourierChannel, string> = {
  paper: "Papier",
  email: "Email",
  portal: "Portail",
};

interface MailboxCourier {
  id: string;
  subject: string | null;
  channel: CourierChannel;
  received_at: string | null;
  metadata: any;
  workflow_state_id: string | null;
  organization_id: string;
  assigned_service: string | null;
  courier_participants?: CourierParticipant[];
}

interface Props {
  courier: MailboxCourier | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  /** When true, displays the body inside tabs (Détail / Actions liées / Réponse). */
  withTabs?: boolean;
}

export default function MailboxSidePanel({ courier, open, onOpenChange, organizationId, withTabs = false }: Props) {
  const queryClient = useQueryClient();
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false);

  const participants = courier?.courier_participants ?? [];
  const sender = participants.find((p) => p.role === "sender");
  const recipient = participants.find((p) => p.role === "recipient");

  // Local copy of tags so the UI reflects mutations immediately
  // (the parent's `courier` prop is a snapshot and doesn't refetch on tag change).
  const [selectedTags, setSelectedTags] = useState<string[]>(
    ((courier?.metadata as any)?.tags ?? []) as string[],
  );
  useEffect(() => {
    setSelectedTags(((courier?.metadata as any)?.tags ?? []) as string[]);
  }, [courier?.id, courier?.metadata]);

  // Available tags for the org
  const { data: orgTags } = useQuery({
    queryKey: ["courier-tags", organizationId],
    queryFn: () => listTags(organizationId),
    enabled: !!organizationId && open,
  });

  const tagByName = new Map<string, CourierTag>(
    (orgTags ?? []).map((t) => [t.name.toLowerCase(), t]),
  );

  // Available services for the org
  const { data: services } = useQuery({
    queryKey: ["org-services", organizationId],
    queryFn: () => listServices(organizationId),
    enabled: !!organizationId && open,
  });

  // Resolve courier's current service from its name (assigned_service)
  const currentService = useMemo(() => {
    if (!courier?.assigned_service || !services) return null;
    return (
      services.find(
        (s) => s.name.toLowerCase() === courier.assigned_service?.toLowerCase(),
      ) ?? null
    );
  }, [courier?.assigned_service, services]);

  // Transitions from current state, scoped to the service's workflow
  const { data: transitions } = useQuery({
    queryKey: [
      "mailbox-transitions",
      courier?.workflow_state_id,
      currentService?.workflow_id,
    ],
    queryFn: async () => {
      if (!courier?.workflow_state_id || !currentService?.workflow_id) return [];
      const { data, error } = await supabase
        .from("workflow_transitions")
        .select("*, to_state:workflow_states!workflow_transitions_to_state_id_fkey(id, name, category)")
        .eq("workflow_id", currentService.workflow_id)
        .eq("from_state_id", courier.workflow_state_id);
      if (error) throw error;
      return (data ?? []) as (WorkflowTransition & { to_state: WorkflowState })[];
    },
    enabled: !!courier?.workflow_state_id && !!currentService?.workflow_id,
  });

  // Is the current state a final one? (used to decide if notes can be added)
  const { data: currentStateInfo } = useQuery({
    queryKey: ["workflow-state-info", courier?.workflow_state_id],
    queryFn: async () => {
      if (!courier?.workflow_state_id) return null;
      const { data, error } = await supabase
        .from("workflow_states")
        .select("id, is_final")
        .eq("id", courier.workflow_state_id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!courier?.workflow_state_id && open,
  });
  const isFinalState = currentStateInfo?.is_final === true;

  const serviceMutation = useMutation({
    mutationFn: async (newServiceId: string) => {
      if (!courier) return;
      const newService = services?.find((s) => s.id === newServiceId);
      if (!newService) throw new Error("Service introuvable");

      // Find initial state of the new service's workflow
      const { data: initial, error: stateErr } = await supabase
        .from("workflow_states")
        .select("id")
        .eq("workflow_id", newService.workflow_id)
        .eq("is_initial", true)
        .maybeSingle();
      if (stateErr) throw stateErr;

      const currentMeta = (courier.metadata as any) ?? {};
      const { error } = await updateCourier(organizationId, courier.id, {
        assigned_service: newService.name,
        workflow_state_id: initial?.id ?? null,
        metadata: { ...currentMeta, service_id: newService.id },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mailbox-couriers"] });
      queryClient.invalidateQueries({ queryKey: ["mailbox-unassigned"] });
      toast.success("Service gestionnaire mis à jour");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const transitionMutation = useMutation({
    mutationFn: async (toStateId: string) => {
      if (!courier) return;
      const { error } = await updateCourier(organizationId, courier.id, {
        workflow_state_id: toStateId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mailbox-couriers"] });
      toast.success("Courrier déplacé");
      onOpenChange(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const tagMutation = useMutation({
    mutationFn: async (updatedTags: string[]) => {
      if (!courier) return;
      const currentMeta = (courier.metadata as any) ?? {};
      const { error } = await updateCourier(organizationId, courier.id, {
        metadata: { ...currentMeta, tags: updatedTags },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mailbox-couriers"] });
      queryClient.invalidateQueries({ queryKey: ["mailbox-unassigned"] });
    },
    onError: (err: Error, _vars, ctx: any) => {
      // rollback
      if (ctx?.previous) setSelectedTags(ctx.previous);
      toast.error(err.message);
    },
  });

  function toggleTag(tagName: string) {
    const exists = selectedTags.some((t) => t.toLowerCase() === tagName.toLowerCase());
    const next = exists
      ? selectedTags.filter((t) => t.toLowerCase() !== tagName.toLowerCase())
      : [...selectedTags, tagName];
    const previous = selectedTags;
    setSelectedTags(next);
    tagMutation.mutate(next, { onError: () => setSelectedTags(previous) } as any);
  }

  function removeTag(tagName: string) {
    const previous = selectedTags;
    const next = selectedTags.filter(
      (t) => t.toLowerCase() !== tagName.toLowerCase(),
    );
    setSelectedTags(next);
    tagMutation.mutate(next, { onError: () => setSelectedTags(previous) } as any);
  }

  // Documents for this courier
  const { data: documents = [] } = useQuery({
    queryKey: ["courier-documents", courier?.id],
    queryFn: () => getDocuments(courier!.id),
    enabled: !!courier?.id && open,
  });

  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  useEffect(() => {
    setSelectedDocId(null);
  }, [courier?.id]);

  // ── Inline edit handlers ────────────────────────────────────────────

  async function persistCourierUpdate(patch: Record<string, any>, successMsg = "Modifié") {
    if (!courier) return;
    const { error } = await updateCourier(organizationId, courier.id, patch);
    if (error) {
      toast.error(error.message);
      throw error;
    }
    queryClient.invalidateQueries({ queryKey: ["mailbox-couriers"] });
    queryClient.invalidateQueries({ queryKey: ["mailbox-unassigned"] });
    toast.success(successMsg);
  }

  async function upsertParticipant(
    role: "sender" | "recipient",
    fields: { name?: string | null; email?: string | null },
  ) {
    if (!courier) return;
    const existing = participants.find((p) => p.role === role);
    try {
      if (existing) {
        // If both name and email become empty, leave the row but blank the fields.
        await updateParticipant(existing.id, fields);
      } else {
        // Don't create empty participants
        const hasContent =
          (fields.name && fields.name.trim()) ||
          (fields.email && fields.email.trim());
        if (!hasContent) return;
        await addParticipant({
          courier_id: courier.id,
          organization_id: organizationId,
          role,
          name: fields.name ?? null,
          email: fields.email ?? null,
        });
      }
      queryClient.invalidateQueries({ queryKey: ["mailbox-couriers"] });
      queryClient.invalidateQueries({ queryKey: ["mailbox-unassigned"] });
      toast.success("Modifié");
    } catch (err: any) {
      toast.error(err?.message ?? "Erreur lors de la modification");
      throw err;
    }
  }

  if (!courier) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-[95vw] lg:max-w-[1100px] overflow-hidden p-0 flex flex-col">
        <SheetHeader className="px-6 pt-6 pb-3 border-b shrink-0">
          <div className="flex items-start justify-between gap-4 pr-8">
            <div className="flex-1 min-w-0">
              <SheetTitle className="text-lg sr-only">
                {courier.subject ?? "Sans titre"}
              </SheetTitle>
              <InlineEditField
                label=""
                value={courier.subject ?? ""}
                placeholder="Titre du courrier"
                emptyDisplay="Sans titre"
                maxLength={255}
                displayClassName="text-lg font-semibold"
                onSave={(v) => persistCourierUpdate({ subject: v.trim() || null }, "Titre modifié")}
              />
            </div>
            {transitions && transitions.length > 0 && (
              <div className="flex flex-wrap gap-2 justify-end shrink-0">
                {transitions.map((t) => (
                  <Button
                    key={t.id}
                    size="sm"
                    onClick={() => transitionMutation.mutate((t.to_state as any).id)}
                    disabled={transitionMutation.isPending}
                    className="gap-1.5"
                  >
                    <ArrowRight className="h-4 w-4" />
                    {t.name ?? (t.to_state as any)?.name ?? "Suivant"}
                  </Button>
                ))}
              </div>
            )}
          </div>
        </SheetHeader>

        <Tabs defaultValue="detail" className="flex-1 overflow-hidden flex flex-col mb-px">
          {withTabs && (
            <TabsList className="mx-6 self-start shrink-0 mt-[4px] mb-[4px]">
              <TabsTrigger value="detail">Détail du courrier</TabsTrigger>
              <TabsTrigger value="content">Contenu et intentions</TabsTrigger>
              <TabsTrigger value="actions">Actions liées</TabsTrigger>
              <TabsTrigger value="response">Réponse</TabsTrigger>
            </TabsList>
          )}
          <TabsContent
            value="detail"
            className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-[360px_1fr] mt-0 data-[state=inactive]:hidden"
            forceMount
          >
            {/* Left: metadata + workflow */}
            <aside className="overflow-y-auto px-6 py-5 lg:border-r space-y-5">
              <dl className="space-y-1 text-sm">
                <InlineEditField
                  label="Date de réception"
                type="date"
                value={courier.received_at ? courier.received_at.slice(0, 10) : ""}
                onSave={(v) =>
                  persistCourierUpdate(
                    { received_at: v ? new Date(v).toISOString() : null },
                    "Date modifiée",
                  )
                }
                renderDisplay={(v) =>
                  new Date(v).toLocaleDateString("fr-FR", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                  })
                }
              />

              <div className="flex items-center justify-between gap-2 py-1">
                <span className="text-muted-foreground text-sm">Canal de réception</span>
                <Select
                  value={courier.channel}
                  onValueChange={(v) =>
                    persistCourierUpdate({ channel: v }, "Canal modifié")
                  }
                >
                  <SelectTrigger className="h-7 w-auto text-sm border-0 bg-transparent hover:bg-muted px-2 gap-1.5 [&>span]:font-medium">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="end">
                    {(Object.keys(channelLabels) as CourierChannel[]).map((c) => (
                      <SelectItem key={c} value={c}>
                        {channelLabels[c]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <InlineEditField
                label="Destinataire (nom)"
                value={recipient?.name ?? ""}
                placeholder="Nom du destinataire"
                maxLength={150}
                onSave={(v) =>
                  upsertParticipant("recipient", { name: v.trim() || null })
                }
              />

              <InlineEditField
                label="Expéditeur (nom)"
                value={sender?.name ?? ""}
                placeholder="Nom de l'expéditeur"
                maxLength={150}
                onSave={(v) => upsertParticipant("sender", { name: v.trim() || null })}
              />

              <InlineEditField
                label="Expéditeur (email)"
                type="email"
                value={sender?.email ?? ""}
                placeholder="email@exemple.com"
                onSave={(v) =>
                  upsertParticipant("sender", { email: v.trim() || null })
                }
              />
            </dl>

            <Separator />

            {/* Service gestionnaire */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Briefcase className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-medium">Service gestionnaire</h3>
              </div>
              <Select
                value={currentService?.id ?? ""}
                onValueChange={(v) => serviceMutation.mutate(v)}
                disabled={serviceMutation.isPending}
              >
                <SelectTrigger>
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
              {courier.assigned_service && !currentService && (
                <p className="text-xs text-muted-foreground italic">
                  Service actuel « {courier.assigned_service} » introuvable.
                </p>
              )}
            </div>

            <Separator />
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">Tags</h3>
                <Popover open={tagPopoverOpen} onOpenChange={setTagPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button size="sm" variant="outline" className="h-8">
                      <TagIcon className="h-3.5 w-3.5 mr-1.5" />
                      Gérer
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 p-0" align="end">
                    <Command>
                      <CommandInput placeholder="Rechercher un tag…" />
                      <CommandList>
                        <CommandEmpty>
                          Aucun tag défini. Allez dans Paramètres → Classification.
                        </CommandEmpty>
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
                                  style={{ backgroundColor: tag.color ?? "hsl(var(--muted-foreground))" }}
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
              <div className="flex flex-wrap gap-1.5">
                {selectedTags.map((tagName) => {
                  const tag = tagByName.get(tagName.toLowerCase());
                  const orphan = !tag;
                  const fg = tag?.color ? readableTextColor(tag.color) : undefined;
                  return (
                    <Badge
                      key={tagName}
                      variant="secondary"
                      className={cn(
                        "gap-1.5 pl-2 pr-1 border-transparent",
                        orphan && "opacity-60 italic",
                      )}
                      style={
                        tag?.color
                          ? { backgroundColor: tag.color, color: fg }
                          : undefined
                      }
                    >
                      {tagName}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          removeTag(tagName);
                        }}
                        className="ml-0.5 rounded-full p-0.5 hover:bg-black/20 transition-colors"
                        aria-label={`Retirer ${tagName}`}
                        style={fg ? { color: fg } : undefined}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  );
                })}
                {selectedTags.length === 0 && (
                  <span className="text-xs text-muted-foreground">Aucun tag</span>
                )}
              </div>
            </div>

          </aside>

          {/* Right: viewer + documents */}
          <main className="overflow-y-auto px-6 py-5 space-y-5 bg-muted/10">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-medium">Aperçu</h3>
              </div>
              <div className="h-[70vh] min-h-[500px]">
                <DocumentViewer
                  documents={documents}
                  currentId={selectedDocId}
                  onChange={setSelectedDocId}
                  organizationId={organizationId}
                />
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <h3 className="text-sm font-medium">Documents</h3>
              <DocumentManager
                courierId={courier.id}
                organizationId={organizationId}
                selectedDocId={selectedDocId}
                onSelectDoc={setSelectedDocId}
              />
            </div>

            <Separator />

            <CourierNotes
              courierId={courier.id}
              organizationId={organizationId}
              readOnly={isFinalState}
            />
          </main>
          </TabsContent>

          {withTabs && (
            <>
              <TabsContent
                value="content"
                className="flex-1 overflow-y-auto px-6 py-5 mt-0"
              >
                <ContentIntentsTab courierId={courier.id} organizationId={organizationId} />
              </TabsContent>
              <TabsContent
                value="actions"
                className="flex-1 overflow-y-auto px-6 py-5 mt-0"
              >
                <p className="text-sm text-muted-foreground italic">
                  Description à venir.
                </p>
              </TabsContent>
              <TabsContent
                value="response"
                className="flex-1 overflow-y-auto px-6 py-5 mt-0"
              >
                <p className="text-sm text-muted-foreground italic">
                  Description à prévoir.
                </p>
              </TabsContent>
            </>
          )}
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

