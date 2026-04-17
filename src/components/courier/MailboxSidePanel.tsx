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
  const [newTag, setNewTag] = useState("");

  const participants = courier?.courier_participants ?? [];
  const sender = participants.find((p) => p.role === "sender");
  const recipient = participants.find((p) => p.role === "recipient");
  const tags: string[] = (courier?.metadata as any)?.tags ?? [];

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

  function addTag() {
    const tag = newTag.trim();
    if (!tag || tags.includes(tag)) return;
    tagMutation.mutate([...tags, tag]);
    setNewTag("");
  }

  function removeTag(tag: string) {
    tagMutation.mutate(tags.filter((t) => t !== tag));
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
            <h3 className="text-sm font-medium">Tags</h3>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="gap-1 pr-1">
                  {tag}
                  <button
                    onClick={() => removeTag(tag)}
                    className="ml-0.5 rounded-full p-0.5 hover:bg-destructive/20 transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
              {tags.length === 0 && (
                <span className="text-xs text-muted-foreground">Aucun tag</span>
              )}
            </div>
            <div className="flex gap-2">
              <Input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTag())}
                placeholder="Ajouter un tag…"
                className="h-8 text-sm"
              />
              <Button size="sm" variant="outline" onClick={addTag} disabled={!newTag.trim()}>
                <Plus className="h-4 w-4" />
              </Button>
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
