import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { X, ArrowRight, Tag as TagIcon, Check } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
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
import { supabase } from "@/integrations/supabase/client";
import { updateCourier } from "@/services/courierService";
import { listTags, type CourierTag } from "@/services/courierTagService";
import { cn } from "@/lib/utils";
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
  courier_participants?: CourierParticipant[];
}

interface Props {
  courier: MailboxCourier | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
}

export default function MailboxSidePanel({ courier, open, onOpenChange, organizationId }: Props) {
  const queryClient = useQueryClient();
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false);

  const participants = courier?.courier_participants ?? [];
  const sender = participants.find((p) => p.role === "sender");
  const recipient = participants.find((p) => p.role === "recipient");
  const selectedTags: string[] = (courier?.metadata as any)?.tags ?? [];

  // Available tags for the org
  const { data: orgTags } = useQuery({
    queryKey: ["courier-tags", organizationId],
    queryFn: () => listTags(organizationId),
    enabled: !!organizationId && open,
  });

  const tagByName = new Map<string, CourierTag>(
    (orgTags ?? []).map((t) => [t.name.toLowerCase(), t]),
  );

  // Fetch transitions from current state
  const { data: transitions } = useQuery({
    queryKey: ["mailbox-transitions", courier?.workflow_state_id],
    queryFn: async () => {
      if (!courier?.workflow_state_id) return [];
      const { data, error } = await supabase
        .from("workflow_transitions")
        .select("*, to_state:workflow_states!workflow_transitions_to_state_id_fkey(id, name, category)")
        .eq("from_state_id", courier.workflow_state_id);
      if (error) throw error;
      return (data ?? []) as (WorkflowTransition & { to_state: WorkflowState })[];
    },
    enabled: !!courier?.workflow_state_id,
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
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function toggleTag(tagName: string) {
    const exists = selectedTags.some((t) => t.toLowerCase() === tagName.toLowerCase());
    const next = exists
      ? selectedTags.filter((t) => t.toLowerCase() !== tagName.toLowerCase())
      : [...selectedTags, tagName];
    tagMutation.mutate(next);
  }

  function removeTag(tagName: string) {
    tagMutation.mutate(selectedTags.filter((t) => t !== tagName));
  }

  if (!courier) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-lg">{courier.subject ?? "Sans objet"}</SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-5">
          {/* Info fields */}
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Date de réception</dt>
              <dd className="font-medium">
                {courier.received_at
                  ? new Date(courier.received_at).toLocaleDateString("fr-FR", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                    })
                  : "—"}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Canal de réception</dt>
              <dd>
                <Badge variant="outline">
                  {channelLabels[courier.channel] ?? courier.channel}
                </Badge>
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Destinataire</dt>
              <dd className="font-medium">{recipient?.name ?? recipient?.email ?? "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Expéditeur</dt>
              <dd className="font-medium">{sender?.name ?? sender?.email ?? "—"}</dd>
            </div>
          </dl>

          <Separator />

          {/* Tags */}
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
                return (
                  <Badge
                    key={tagName}
                    variant="secondary"
                    className={cn("gap-1.5 pl-2 pr-1", orphan && "opacity-60 italic")}
                    style={
                      tag?.color
                        ? { backgroundColor: `${tag.color}20`, color: tag.color }
                        : undefined
                    }
                  >
                    {tag?.color && (
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: tag.color }}
                        aria-hidden
                      />
                    )}
                    {tagName}
                    <button
                      onClick={() => removeTag(tagName)}
                      className="ml-0.5 rounded-full p-0.5 hover:bg-destructive/20 transition-colors"
                      aria-label={`Retirer ${tagName}`}
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

          <Separator />

          {/* Workflow transition buttons */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium">Actions</h3>
            {transitions && transitions.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {transitions.map((t) => (
                  <Button
                    key={t.id}
                    onClick={() => transitionMutation.mutate((t.to_state as any).id)}
                    disabled={transitionMutation.isPending}
                    className="gap-1.5"
                  >
                    <ArrowRight className="h-4 w-4" />
                    {t.name ?? (t.to_state as any)?.name ?? "Suivant"}
                  </Button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Aucune transition disponible.</p>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
