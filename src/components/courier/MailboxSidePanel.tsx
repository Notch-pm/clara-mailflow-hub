import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { X, ArrowRight, ArrowLeft, ArrowRightLeft, Tag as TagIcon, Check, Briefcase, FileText, Trash2, Maximize2, ExternalLink, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Link, useNavigate } from "react-router-dom";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { ResponsiveTabsList, type ResponsiveTabItem } from "@/components/courier/ResponsiveTabsList";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
import { updateCourier, getCourierById } from "@/services/courierService";
import { logEvent } from "@/services/courierEventService";
import { listTags, type CourierTag } from "@/services/courierTagService";
import { listServices, assignService } from "@/services/orgServiceService";
import { useUserServiceFilter } from "@/hooks/useUserServiceFilter";
import { getDocuments } from "@/services/courierDocumentService";
import { addParticipant, updateParticipant } from "@/services/courierParticipantService";
import { findMatchingUsager, createUsager } from "@/services/usagerService";
import { cn } from "@/lib/utils";
import { readableTextColor } from "@/lib/tag-color";
import DocumentManager from "./DocumentManager";
import DocumentViewer from "./DocumentViewer";
import InlineEditField from "./InlineEditField";
import CourierNotes from "./CourierNotes";
import FloatingNotesPanel from "./FloatingNotesPanel";
import { listNotes, type CourierNote } from "@/services/courierNoteService";
import ParticipantManager from "./ParticipantManager";
import CourierHistoryTab from "./CourierHistoryTab";
import ContentIntentsTab from "./ContentIntentsTab";
import LinkedActionsTab from "./LinkedActionsTab";
import ReplyComposer from "./ReplyComposer";
import CourierLinksTab from "./CourierLinksTab";
import SimilarCouriersAlert from "./SimilarCouriersAlert";
import CloseLinkedCouriersDialog from "./CloseLinkedCouriersDialog";
import { listRepliesForCourier } from "@/services/courierReplyService";
import { listRelationsForCourier } from "@/services/courierRelationService";
import type { CourierChannel, CourierParticipant, WorkflowTransition, WorkflowState, WorkflowCategory } from "@/types/courier";

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
  [key: string]: any;
}

interface Props {
  courier: MailboxCourier | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  /** When true, displays the body inside tabs (Détail / Actions liées / Réponse). */
  withTabs?: boolean;
  /** When true, the panel is fully read-only: no edits, no transitions, no uploads, no notes. */
  readOnly?: boolean;
  /** When provided, displays a delete button in the header. */
  onDelete?: (courier: MailboxCourier) => void;
  /** When true, the sheet takes the full screen width (used by the detail page). */
  fullScreen?: boolean;
  /** When true, hides the full-screen navigation button. */
  disableFullScreen?: boolean;
}

export default function MailboxSidePanel({ courier, open, onOpenChange, organizationId, withTabs = false, readOnly = false, onDelete, fullScreen = false, disableFullScreen = false }: Props) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false);
  const [servicePopoverOpen, setServicePopoverOpen] = useState(false);
  const [replyState, setReplyState] = useState<{ name: string; category: string | null } | null>(null);
  const [transferTargetServiceId, setTransferTargetServiceId] = useState<string>("");
  const [transferConfirmOpen, setTransferConfirmOpen] = useState(false);
  const [closeLinkedOpen, setCloseLinkedOpen] = useState(false);
  const [closeLinkedIds, setCloseLinkedIds] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<string>("detail");

  const { data: replyList = [] } = useQuery({
    queryKey: ["courier-replies", courier?.id],
    queryFn: () => listRepliesForCourier(organizationId, courier!.id),
    enabled: !!courier?.id && !!organizationId,
  });

  const { data: notesList = [] } = useQuery<CourierNote[]>({
    queryKey: ["courier-notes", courier?.id],
    queryFn: () => listNotes(courier!.id),
    enabled: !!courier?.id,
  });

  const { data: ticketsList = [] } = useQuery({
    queryKey: ["action-tickets", courier?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("action_tickets")
        .select("id")
        .eq("courier_id", courier!.id);
      return data ?? [];
    },
    enabled: !!courier?.id,
  });

  const { data: relationsList = [] } = useQuery({
    queryKey: ["courier-relations", courier?.id],
    queryFn: () => listRelationsForCourier(courier!.id),
    enabled: !!courier?.id,
  });

  const isOutbound = courier?.direction === "outbound";

  const participants = courier?.courier_participants ?? [];
  const sender = participants.find((p) => p.role === "sender");
  const recipient = participants.find((p) => p.role === "recipient");

  const countBadge = (n: number) => (
    <span className="inline-flex items-center justify-center rounded-full bg-primary/15 text-primary px-1.5 text-[10px] font-medium leading-none min-w-[18px] h-[18px]">
      {n}
    </span>
  );

  const tabItems: ResponsiveTabItem[] = useMemo(() => {
    const items: ResponsiveTabItem[] = [{ value: "detail", label: "Détail du courrier" }];
    if (!isOutbound) {
      items.push({ value: "content", label: "Contenu et intentions" });
      items.push({
        value: "actions",
        label: "Actions liées",
        badge: ticketsList.length > 0 ? countBadge(ticketsList.length) : null,
      });
      items.push({
        value: "response",
        label: replyList.length > 1 ? "Réponses" : "Réponse",
        badge: (
          <>
            {replyList.length > 0 && countBadge(replyList.length)}
            {replyState && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none",
                  replyState.category === "processed"
                    ? "bg-green-500/15 text-green-700"
                    : replyState.category === "processing"
                    ? "bg-blue-500/15 text-blue-700"
                    : "bg-yellow-500/15 text-yellow-700",
                )}
              >
                {replyState.name}
              </span>
            )}
          </>
        ),
      });
    }
    items.push({
      value: "participants",
      label: "Participants",
      badge: participants.length > 0 ? countBadge(participants.length) : null,
    });
    if (!isOutbound) {
      items.push({
        value: "links",
        label: "Liens",
        badge: relationsList.length > 0 ? countBadge(relationsList.length) : null,
      });
    }
    items.push({ value: "history", label: "Historique" });
    return items;
  }, [isOutbound, ticketsList.length, replyList.length, replyState, participants.length, relationsList.length]);

  // For outbound couriers, fetch the linked parent inbound courier
  const { data: parentCourier } = useQuery({
    queryKey: ["courier", courier?.parent_courier_id, organizationId],
    queryFn: async () => {
      const { data, error } = await getCourierById(organizationId, courier!.parent_courier_id!);
      if (error) throw error;
      return data;
    },
    enabled: isOutbound && !!courier?.parent_courier_id && !!organizationId,
  });
  const parentSender = parentCourier?.courier_participants?.find((p: CourierParticipant) => p.role === "sender");

  // Local copy of tags so the UI reflects mutations immediately
  // (the parent's `courier` prop is a snapshot and doesn't refetch on tag change).
  const [selectedTags, setSelectedTags] = useState<string[]>(
    (courier?.metadata?.tags as string[] | undefined) ?? [],
  );
  useEffect(() => {
    setSelectedTags((courier?.metadata?.tags as string[] | undefined) ?? []);
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

  // Local override for assigned_service so the UI reflects the change immediately
  // after the user picks a service (the parent prop is a snapshot and only updates
  // after the next mailbox-couriers refetch resolves).
  const [localAssignedService, setLocalAssignedService] = useState<string | null>(
    courier?.assigned_service ?? null,
  );
  // Same for workflow_state_id — when assigning a service we land in its initial
  // state, and we need transitions to be queryable straight away (without waiting
  // for the parent's snapshot to refetch and reach this component again).
  const [localWorkflowStateId, setLocalWorkflowStateId] = useState<string | null>(
    courier?.workflow_state_id ?? null,
  );
  useEffect(() => {
    setLocalAssignedService(courier?.assigned_service ?? null);
    setLocalWorkflowStateId(courier?.workflow_state_id ?? null);
    setReplyState(null);
  }, [courier?.id, courier?.assigned_service, courier?.workflow_state_id]);

  const userServiceFilter = useUserServiceFilter();

  // Si le courrier vient d'une config IMAP précise, restreindre les services proposés.
  const imapSettingsId = (courier?.metadata?.imap_settings_id as string | null) ?? null;
  const availableServices = useMemo(() => {
    if (!services) return [];
    let list = services;
    if (imapSettingsId) {
      const linked = list.filter((s) => s.imap_settings_id === imapSettingsId);
      if (linked.length > 0) list = linked;
    }
    if (userServiceFilter !== null) {
      list = list.filter((s) => userServiceFilter.includes(s.name));
    }
    // Always include the currently assigned service so the Select can display it,
    // even if it was filtered out (e.g. different IMAP or service filter).
    if (localAssignedService) {
      const current = services.find(
        (s) => s.name.toLowerCase() === localAssignedService.toLowerCase(),
      );
      if (current && !list.find((s) => s.id === current.id)) {
        list = [current, ...list];
      }
    }
    return list;
  }, [services, imapSettingsId, userServiceFilter, localAssignedService]);

  // Resolve courier's current service from its name (assigned_service)
  const currentService = useMemo(() => {
    if (!localAssignedService || !services) return null;
    return (
      services.find(
        (s) => s.name.toLowerCase() === localAssignedService.toLowerCase(),
      ) ?? null
    );
  }, [localAssignedService, services]);

  // Transitions from current state, scoped to the service's workflow
  const { data: transitions } = useQuery({
    queryKey: [
      "mailbox-transitions",
      localWorkflowStateId,
      currentService?.workflow_id,
    ],
    queryFn: async () => {
      if (!localWorkflowStateId || !currentService?.workflow_id) return [];
      const { data, error } = await supabase
        .from("workflow_transitions")
        .select("*, to_state:workflow_states!workflow_transitions_to_state_id_fkey(id, name, category)")
        .eq("workflow_id", currentService.workflow_id)
        .eq("from_state_id", localWorkflowStateId);
      if (error) throw error;
      return (data ?? []) as (WorkflowTransition & { to_state: WorkflowState })[];
    },
    enabled: !!localWorkflowStateId && !!currentService?.workflow_id,
  });

  // Is the current state a final one? (used to decide if notes can be added)
  const { data: currentStateInfo } = useQuery({
    queryKey: ["workflow-state-info", localWorkflowStateId],
    queryFn: async () => {
      if (!localWorkflowStateId) return null;
      const { data, error } = await supabase
        .from("workflow_states")
        .select("id, name, category, is_final, is_initial")
        .eq("id", localWorkflowStateId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!localWorkflowStateId && open,
  });
  const isFinalState = currentStateInfo?.is_final === true;
  const isInitialState = !localWorkflowStateId || currentStateInfo?.is_initial === true;

  const serviceMutation = useMutation({
    mutationFn: async (newServiceId: string) => {
      if (!courier) return null;
      const newService = services?.find((s) => s.id === newServiceId);
      if (!newService) throw new Error("Service introuvable");
      return assignService(organizationId, courier, newService);
    },
    onSuccess: (result) => {
      if (result?.name) setLocalAssignedService(result.name);
      // Also update the local workflow state so transitions become queryable
      // immediately, without waiting for the parent's snapshot to refetch.
      setLocalWorkflowStateId(result?.initialStateId ?? null);
      queryClient.invalidateQueries({ queryKey: ["mailbox-couriers"] });
      queryClient.invalidateQueries({ queryKey: ["mailbox-unassigned"] });
      queryClient.invalidateQueries({ queryKey: ["courier-events", courier?.id] });
      toast.success("Service gestionnaire mis à jour");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const transferMutation = useMutation({
    mutationFn: async ({ targetServiceId, loseAccess }: { targetServiceId: string; loseAccess: boolean }) => {
      if (!courier) return null;
      const targetService = services?.find((s) => s.id === targetServiceId);
      if (!targetService) throw new Error("Service introuvable");

      // Fetch initial state of target service's workflow
      const { data: initial, error: stateErr } = await supabase
        .from("workflow_states")
        .select("id, name, category")
        .eq("workflow_id", targetService.workflow_id)
        .eq("is_initial", true)
        .maybeSingle();
      if (stateErr) throw stateErr;

      const previousService = courier.assigned_service ?? null;
      const currentMeta = courier.metadata ?? {};
      const { error: updateErr } = await updateCourier(organizationId, courier.id, {
        assigned_service: targetService.name,
        workflow_state_id: initial?.id ?? null,
        metadata: { ...currentMeta, service_id: targetService.id },
      });
      if (updateErr) throw updateErr;

      await logEvent(organizationId, courier.id, "service_transferred", {
        from: previousService,
        to: targetService.name,
      });

      // Notify all members of the target service
      const { data: members } = await supabase
        .from("service_members" as never)
        .select("user_id")
        .eq("service_id", targetService.id);
      if (members && (members as { user_id: string }[]).length > 0) {
        const subject = (courier as any).subject ?? "(sans objet)";
        const notifs = (members as { user_id: string }[]).map((m) => ({
          organization_id: organizationId,
          user_id: m.user_id,
          type: "courier_transferred",
          title: `Transféré : ${subject}`,
          resource_id: courier.id,
        }));
        await (supabase.from("notifications" as never) as any).insert(notifs);
      }

      return { name: targetService.name, initialStateId: initial?.id ?? null, loseAccess };
    },
    onSuccess: (result) => {
      setTransferConfirmOpen(false);
      setTransferTargetServiceId("");
      queryClient.invalidateQueries({ queryKey: ["mailbox-couriers"] });
      queryClient.invalidateQueries({ queryKey: ["mailbox-unassigned"] });
      queryClient.invalidateQueries({ queryKey: ["instruction-couriers"] });
      toast.success("Courrier transféré");
      onOpenChange(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const transitionMutation = useMutation({
    mutationFn: async (toStateId: string) => {
      if (!courier) return;

      // Look up current and target state metadata for the event payload.
      const fromState = transitions?.find(
        (t) => (t.to_state as any)?.id === toStateId,
      );
      const { data: toStateRow } = await supabase
        .from("workflow_states")
        .select("id, name, category, is_initial, is_final")
        .eq("id", toStateId)
        .maybeSingle();
      const fromStateRow = courier.workflow_state_id
        ? (await supabase
            .from("workflow_states")
            .select("id, name, category")
            .eq("id", courier.workflow_state_id)
            .maybeSingle()).data
        : null;

      const { error } = await updateCourier(organizationId, courier.id, {
        workflow_state_id: toStateId,
      });
      if (error) throw error;

      await logEvent(organizationId, courier.id, "state_changed", {
        from_id: fromStateRow?.id ?? null,
        from_name: fromStateRow?.name ?? null,
        to_id: toStateRow?.id ?? null,
        to_name: toStateRow?.name ?? fromState?.name ?? null,
      });

      // First time entering a processing state → instruction_started + usager creation.
      if (
        toStateRow?.category === "processing" &&
        fromStateRow?.category !== "processing"
      ) {
        await logEvent(organizationId, courier.id, "instruction_started", {
          state_name: toStateRow.name,
        });

        // Créer/lier l'usager expéditeur s'il n'est pas encore rattaché.
        const senderParticipant = courier.courier_participants?.find(
          (p) => p.role === "sender",
        );
        if (senderParticipant && !senderParticipant.usager_id) {
          const matched = await findMatchingUsager(organizationId, {
            email: senderParticipant.email,
            phone: senderParticipant.phone,
          });
          let usagerId: string | null = matched?.id ?? null;
          if (!usagerId && (senderParticipant.last_name || senderParticipant.email)) {
            const created = await createUsager(organizationId, {
              category: "citoyen",
              first_name: senderParticipant.first_name ?? null,
              last_name: senderParticipant.last_name || senderParticipant.email || "",
              email: senderParticipant.email ?? null,
              phone: senderParticipant.phone ?? null,
            });
            usagerId = created.id;
          }
          if (usagerId) {
            await updateParticipant(senderParticipant.id, { usager_id: usagerId });
          }
        }
      }
      return { toStateId, isInitial: toStateRow?.is_initial === true, isFinal: toStateRow?.is_final === true };
    },
    onSuccess: (result) => {
      if (!result) return;
      queryClient.invalidateQueries({ queryKey: ["mailbox-couriers"] });
      queryClient.invalidateQueries({ queryKey: ["mailbox-unassigned"] });
      queryClient.invalidateQueries({ queryKey: ["instruction-couriers"] });
      queryClient.invalidateQueries({ queryKey: ["courier-events", courier?.id] });
      queryClient.invalidateQueries({ queryKey: ["usagers"] });
      toast.success("Courrier déplacé");

      // If we just closed this courier and it has linked couriers that are
      // not yet closed, propose to close them too.
      if (result.isFinal && courier) {
        const siblingIds = (relationsList ?? [])
          .map((r) => r.related?.id)
          .filter((id): id is string => !!id && id !== courier.id);
        if (siblingIds.length > 0) {
          setCloseLinkedIds(siblingIds);
          setCloseLinkedOpen(true);
          setLocalWorkflowStateId(result.toStateId);
          return;
        }
      }

      if (!fullScreen && !result.isInitial) {
        navigate(`/courrier/${courier?.id}`);
      } else {
        setLocalWorkflowStateId(result.toStateId);
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const tagMutation = useMutation({
    mutationFn: async (updatedTags: string[]) => {
      if (!courier) return;
      const currentMeta = courier.metadata ?? {};
      const { error } = await updateCourier(organizationId, courier.id, {
        metadata: { ...currentMeta, tags: updatedTags },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mailbox-couriers"] });
      queryClient.invalidateQueries({ queryKey: ["mailbox-unassigned"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function toggleTag(tagName: string) {
    const exists = selectedTags.some((t) => t.toLowerCase() === tagName.toLowerCase());
    const next = exists
      ? selectedTags.filter((t) => t.toLowerCase() !== tagName.toLowerCase())
      : [...selectedTags, tagName];
    const previous = selectedTags;
    setSelectedTags(next);
    tagMutation.mutate(next, { onError: () => setSelectedTags(previous) });
  }

  function removeTag(tagName: string) {
    const previous = selectedTags;
    const next = selectedTags.filter(
      (t) => t.toLowerCase() !== tagName.toLowerCase(),
    );
    setSelectedTags(next);
    tagMutation.mutate(next, { onError: () => setSelectedTags(previous) });
  }

  // Documents for this courier
  const { data: documents = [] } = useQuery({
    queryKey: ["courier-documents", courier?.id],
    queryFn: () => getDocuments(courier!.id),
    enabled: !!courier?.id && open,
  });

  // If the courier metadata holds an email body (body_html / body_text), inject it as
  // a synthetic "first document" so it appears in the Aperçu just like an attachment.
  const displayDocuments = useMemo(() => {
    const meta = courier?.metadata ?? {};
    const html = (meta.body_html as string | undefined) ?? null;
    const text = (meta.body_text as string | undefined) ?? null;
    if (!html && !text) return documents;
    const inlineDoc = {
      id: `inline:email-body:${courier?.id}`,
      courier_id: courier?.id,
      organization_id: organizationId,
      file_name: "Corps de l'email",
      mime_type: html ? "text/html" : "text/plain",
      file_size: null,
      document_type: "original",
      storage_key: "",
      checksum: null,
      created_at: new Date().toISOString(),
      inline_html: html,
      inline_text: text,
    };
    return [inlineDoc, ...documents];
  }, [documents, courier?.id, courier?.metadata, organizationId]);

  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  useEffect(() => {
    setSelectedDocId(null);
  }, [courier?.id]);

  // ── Inline edit handlers ────────────────────────────────────────────

  async function persistCourierUpdate(patch: Record<string, unknown>, successMsg = "Modifié") {
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
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erreur lors de la modification");
      throw err;
    }
  }

  if (!courier) return null;

  const body = (
    <>
      <div className="flex flex-col text-center sm:text-left border-b shrink-0">
          <div className={cn("flex items-center justify-between gap-4 px-4", fullScreen ? "py-2 pr-4" : "py-3 pr-8")}>
            <div className="flex-1 min-w-0 flex items-center gap-3">

              {fullScreen && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 -ml-1 text-muted-foreground hover:text-foreground shrink-0"
                  onClick={() => navigate(-1)}
                  title="Retour"
                  aria-label="Retour à la liste"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              )}
              <div className="min-w-0 flex-1">
                {!fullScreen && (
                  <SheetTitle className="text-lg sr-only">
                    {courier.subject ?? "Sans titre"}
                  </SheetTitle>
                )}
                <InlineEditField
                  label=""
                  value={courier.subject ?? ""}
                  placeholder="Titre du courrier"
                  emptyDisplay="Sans titre"
                  maxLength={255}
                  displayClassName="max-w-full text-lg font-semibold leading-snug"
                  editClassName="text-lg md:text-lg font-semibold leading-snug"
                  readOnly={readOnly}
                  multiline
                  onSave={(v) => persistCourierUpdate({ subject: v.trim() || null }, "Titre modifié")}
                />
              </div>
              {currentStateInfo?.name && (
                <Badge variant="secondary" className="gap-1.5 font-medium shrink-0">
                  <span
                    className={cn(
                      "h-2 w-2 rounded-full",
                      currentStateInfo.category === "pending" && "bg-amber-500",
                      currentStateInfo.category === "processing" && "bg-blue-500",
                      currentStateInfo.category === "processed" && "bg-emerald-500",
                      currentStateInfo.category === "archived" && "bg-slate-400",
                      !currentStateInfo.category && "bg-gray-300",
                    )}
                  />
                  {currentStateInfo.name}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 justify-end shrink-0">
              {!readOnly && transitions && transitions.length > 0 && (
                <>
                  {(() => {
                    const nextT = transitions.find((t) => (t as any).kind === "next");
                    const prevT = transitions.find((t) => (t as any).kind === "previous");
                    const nominalIds = new Set([nextT?.id, prevT?.id].filter(Boolean));
                    const others = transitions.filter((t) => !nominalIds.has(t.id));
                    const dot = (category?: string | null) => (
                      <span
                        className={cn(
                          "h-2 w-2 rounded-full shrink-0",
                          category === "pending" && "bg-amber-500",
                          category === "processing" && "bg-blue-500",
                          category === "processed" && "bg-emerald-500",
                          category === "archived" && "bg-slate-400",
                          !category && "bg-gray-300",
                        )}
                      />
                    );
                    return (
                      <>
                        {prevT && (
                          <Button
                            key={prevT.id}
                            size="sm"
                            variant="outline"
                            onClick={() => transitionMutation.mutate(prevT.to_state.id)}
                            disabled={transitionMutation.isPending}
                            className="gap-1.5"
                          >
                            <ArrowLeft className="h-3.5 w-3.5" />
                            {prevT.name ?? prevT.to_state?.name ?? "Précédent"}
                          </Button>
                        )}
                        {nextT && (
                          <Button
                            key={nextT.id}
                            size="sm"
                            onClick={() => transitionMutation.mutate(nextT.to_state.id)}
                            disabled={transitionMutation.isPending}
                            className="gap-1.5"
                          >
                            {dot(nextT.to_state?.category)}
                            {nextT.name ?? nextT.to_state?.name ?? "Suivant"}
                          </Button>
                        )}
                        {others.length > 0 && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="sm" variant="outline" className="gap-1.5" disabled={transitionMutation.isPending}>
                                Autres actions
                                <ChevronDown className="h-3.5 w-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {others.map((t) => (
                                <DropdownMenuItem
                                  key={t.id}
                                  onClick={() => transitionMutation.mutate(t.to_state.id)}
                                >
                                  <div className="flex items-center gap-2">
                                    {dot(t.to_state?.category)}
                                    <span>{t.name ?? t.to_state?.name ?? "Transition"}</span>
                                  </div>
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                        {!nextT && !prevT && others.length === 0 && null}
                      </>
                    );
                  })()}

                </>
              )}
              {!fullScreen && !disableFullScreen && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
                  onClick={() => {
                    onOpenChange(false);
                    navigate(`/courrier/${courier.id}`);
                  }}
                  title="Ouvrir en plein écran"
                  aria-label="Ouvrir en plein écran"
                >
                  <Maximize2 className="h-4 w-4" />
                </Button>
              )}
              {fullScreen && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
                  onClick={() => onOpenChange(false)}
                  title="Fermer"
                  aria-label="Fermer le courrier"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
              {!readOnly && onDelete && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() => onDelete(courier)}
                  title="Supprimer le courrier"
                  aria-label="Supprimer le courrier"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          <aside
            className={cn(
              "shrink-0 border-r overflow-y-auto bg-muted/10 px-4 py-4 space-y-4",
              "w-64 xl:w-72",
            )}
            aria-label="Informations courrier"
          >
            {/* Column 1: Dates / Canal / Lien courrier parent */}
            <div className="space-y-0.5 min-w-0">
              {isOutbound ? (
                <InlineEditField
                  label="Date d'envoi"
                  type="date"
                  value={courier.sent_at ? courier.sent_at.slice(0, 10) : ""}
                  readOnly={readOnly}
                  onSave={(v) =>
                    persistCourierUpdate(
                      { sent_at: v ? new Date(v).toISOString() : null },
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
              ) : (
                <InlineEditField
                  label="Date de réception"
                  type="date"
                  value={courier.received_at ? courier.received_at.slice(0, 10) : ""}
                  readOnly={readOnly}
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
              )}
              {!isOutbound && (
                <div className="flex items-center justify-between gap-2 py-0.5">
                  <span className="text-muted-foreground text-sm shrink-0">Canal</span>
                  {readOnly ? (
                    <span className="text-sm font-medium px-2">{channelLabels[courier.channel]}</span>
                  ) : (
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
                  )}
                </div>
              )}
              {isOutbound && courier.parent_courier_id && (
                <div className="flex items-center justify-between gap-2 py-0.5">
                  <span className="text-muted-foreground text-sm shrink-0">Courrier lié</span>
                  <Link
                    to={`/courrier/${courier.parent_courier_id}`}
                    className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                  >
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                    Voir
                  </Link>
                </div>
              )}
            </div>

            <Separator />

            {/* Column 2: Expéditeur / Destinataire */}
            <div className="space-y-3 min-w-0">
              <div className="space-y-1 min-w-0">
                <span className="text-muted-foreground text-sm block">Expéditeur</span>
                {isOutbound ? (
                  <span className="text-sm font-semibold block truncate">
                    {parentCourier?.assigned_service ?? (
                      <span className="text-muted-foreground italic font-normal">—</span>
                    )}
                  </span>
                ) : (
                  <div className="relative pr-7">
                    <InlineEditField
                      label=""
                      value={sender?.name ?? ""}
                      placeholder="Nom de l'expéditeur"
                      maxLength={150}
                      readOnly={readOnly}
                      onSave={(v) => upsertParticipant("sender", { name: v.trim() || null })}
                      displayClassName="font-semibold"
                    />
                    {sender?.usager_id && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Link
                            to={`/usagers/${sender.usager_id}`}
                            onClick={() => onOpenChange(false)}
                            className="absolute right-0 top-0 inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-primary hover:bg-muted transition-colors bg-background"
                            aria-label="Voir tous les courriers de cet expéditeur"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Link>
                        </TooltipTrigger>
                        <TooltipContent>Voir tous les courriers de cet expéditeur</TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                )}
              </div>
              <div className="space-y-1 min-w-0">
                <span className="text-muted-foreground text-sm block">Destinataire</span>
                {isOutbound ? (
                  <span className="text-sm font-semibold block truncate">
                    {parentSender?.name ?? (
                      <span className="text-muted-foreground italic font-normal">—</span>
                    )}
                  </span>
                ) : (
                  <InlineEditField
                    label=""
                    value={recipient?.name ?? ""}
                    placeholder="Nom du destinataire"
                    maxLength={150}
                    readOnly={readOnly}
                    onSave={(v) => upsertParticipant("recipient", { name: v.trim() || null })}
                    displayClassName="font-semibold"
                  />
                )}
              </div>
            </div>

            <Separator />

            {/* Column 3: Tags + Service gestionnaire */}
            <div className="space-y-2 min-w-0">
              <div className="space-y-1.5">
                <span className="text-muted-foreground text-sm">Tags</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {selectedTags.length === 0 && (
                    <span className="text-xs text-muted-foreground italic">Aucun tag</span>
                  )}
                  {selectedTags.map((tagName) => {
                    const tag = tagByName.get(tagName.toLowerCase());
                    const orphan = !tag;
                    const fg = tag?.color ? readableTextColor(tag.color) : undefined;
                    return (
                      <Badge
                        key={tagName}
                        variant="secondary"
                        className={cn(
                          "gap-1 pl-2 pr-1 border-transparent text-xs",
                          orphan && "opacity-60 italic",
                          readOnly && "pr-2",
                        )}
                        style={tag?.color ? { backgroundColor: tag.color, color: fg } : undefined}
                      >
                        {tagName}
                        {!readOnly && (
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
                        )}
                      </Badge>
                    );
                  })}
                  {!readOnly && (
                    <Popover open={tagPopoverOpen} onOpenChange={setTagPopoverOpen}>
                      <PopoverTrigger asChild>
                        <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" aria-label="Gérer les tags">
                          <TagIcon className="h-3.5 w-3.5" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-64 p-0" align="start">
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
                                    {checked && <Check className="h-4 w-4" />}
                                  </CommandItem>
                                );
                              })}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <span className="text-muted-foreground text-sm">Service gestionnaire</span>
                <div className="min-w-0">
                  {readOnly ? (
                    <span className="text-sm font-medium truncate px-2 block">
                      {courier.assigned_service ?? (
                        <span className="text-muted-foreground italic font-normal">—</span>
                      )}
                    </span>
                  ) : (
                    <Popover open={servicePopoverOpen} onOpenChange={setServicePopoverOpen}>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex w-full items-center justify-between gap-1.5 rounded px-1.5 py-0.5 text-sm font-medium hover:bg-muted transition-colors"
                          title={isInitialState ? "Affecter un service" : "Transférer à un autre service"}
                        >
                          <span className="truncate">
                            {courier.assigned_service ?? (
                              <span className="text-muted-foreground italic font-normal">Non assigné</span>
                            )}
                          </span>
                          <ArrowRightLeft className="h-3 w-3 text-muted-foreground shrink-0" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-72 p-3 space-y-2" align="start">
                        {isInitialState ? (
                          <>
                            <p className="text-xs text-muted-foreground">Affecter à un service</p>
                            <Select
                              value={currentService?.id ?? ""}
                              onValueChange={(v) => {
                                serviceMutation.mutate(v);
                                setServicePopoverOpen(false);
                              }}
                              disabled={serviceMutation.isPending}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Sélectionner un service" />
                              </SelectTrigger>
                              <SelectContent>
                                {availableServices.map((s) => (
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
                          </>
                        ) : (
                          <>
                            <p className="text-xs text-muted-foreground">
                              Transférer à un autre service. Le courrier sera remis à l'état initial.
                            </p>
                            <Select
                              value=""
                              onValueChange={(serviceId) => {
                                setTransferTargetServiceId(serviceId);
                                setTransferConfirmOpen(true);
                                setServicePopoverOpen(false);
                              }}
                              disabled={transferMutation.isPending}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Choisir un service…" />
                              </SelectTrigger>
                              <SelectContent>
                                {(services ?? [])
                                  .filter((s) => s.name !== localAssignedService)
                                  .map((s) => (
                                    <SelectItem key={s.id} value={s.id}>
                                      {s.name}
                                    </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                          </>
                        )}
                      </PopoverContent>
                    </Popover>
                  )}
                </div>
              </div>
            </div>
          </aside>

          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className="flex flex-col mb-px flex-1 min-h-0 overflow-hidden relative"
          >
          {withTabs && (
            <div className={cn("shrink-0", fullScreen ? "mx-4 mt-1 mb-1" : "mx-6 mt-[4px] mb-[4px]")}>
              <ResponsiveTabsList activeValue={activeTab} tabs={tabItems} />
            </div>
          )}
          <TabsContent
            value="detail"
            className="mt-0 data-[state=inactive]:hidden flex-1 min-h-0 overflow-hidden"
            forceMount
          >
            <section
              aria-label="Aperçu du courrier"
              className="h-full px-6 py-5 space-y-5 bg-muted/10 overflow-y-auto"
            >
              {!isOutbound && isInitialState && (
                <SimilarCouriersAlert
                  courierId={courier.id}
                  organizationId={organizationId}
                  disabled={readOnly}
                />
              )}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-medium">Aperçu</h3>
                </div>
                <div className="h-[60vh] min-h-[400px]">
                  <DocumentViewer
                    documents={displayDocuments as any}
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
                  readOnly={readOnly}
                  ignoredAttachments={(courier.metadata?.ignored_attachments as { name: string; size: number }[] | undefined) ?? []}
                />
              </div>

              {!withTabs && (
                <>
                  <Separator />
                  <CourierNotes
                    courierId={courier.id}
                    organizationId={organizationId}
                    readOnly={readOnly || isFinalState}
                  />
                </>
              )}
            </section>
          </TabsContent>

          {/* Always-mounted dialogs (service transfer + close linked couriers) */}
          <AlertDialog
            open={transferConfirmOpen}
            onOpenChange={(o) => {
              setTransferConfirmOpen(o);
              if (!o) setTransferTargetServiceId("");
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Transférer la demande</AlertDialogTitle>
                <AlertDialogDescription>
                  Vous allez transférer ce courrier à :{" "}
                  <strong>
                    {services?.find((s) => s.id === transferTargetServiceId)?.name ?? ""}
                  </strong>
                  . Elle sera alors remise à l'état initial. En fonction de la configuration des droits, elle pourrait vous être rendue inaccessible.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Annuler</AlertDialogCancel>
                <AlertDialogAction
                  disabled={transferMutation.isPending}
                  onClick={() => {
                    const targetName = services?.find((s) => s.id === transferTargetServiceId)?.name ?? "";
                    const loseAccess = userServiceFilter !== null && !userServiceFilter.includes(targetName);
                    transferMutation.mutate({ targetServiceId: transferTargetServiceId, loseAccess });
                  }}
                >
                  Valider
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <CloseLinkedCouriersDialog
            open={closeLinkedOpen}
            onOpenChange={setCloseLinkedOpen}
            organizationId={organizationId}
            linkedCourierIds={closeLinkedIds}
            sourceTitle={courier?.subject ?? courier?.chrono ?? "ce courrier"}
          />



          {withTabs && (
            <>
              {!isOutbound && (
                <TabsContent
                  value="content"
                  className="flex-1 overflow-y-auto px-6 py-5 mt-0"
                >
                  <ContentIntentsTab
                    courierId={courier.id}
                    organizationId={organizationId}
                    readOnly={readOnly || isFinalState}
                    isInitialState={isInitialState}
                  />
                </TabsContent>
              )}
              {!isOutbound && (
                <TabsContent
                  value="actions"
                  className="flex-1 overflow-y-auto px-6 py-5 mt-0"
                >
                  <LinkedActionsTab
                    courierId={courier.id}
                    organizationId={organizationId}
                    readOnly={readOnly || isFinalState}
                  />
                </TabsContent>
              )}
              {!isOutbound && (
                <TabsContent
                  value="response"
                  className="flex-1 min-h-0 overflow-hidden px-6 py-5 mt-0 flex flex-col data-[state=inactive]:hidden"
                >
                  <ReplyComposer
                    courierId={courier.id}
                    organizationId={organizationId}
                    parentSubject={courier.subject ?? null}
                    assignedService={localAssignedService}
                    sender={sender ?? null}
                    readOnly={readOnly}
                    onStateChange={setReplyState}
                  />
                </TabsContent>
              )}
              <TabsContent
                value="participants"
                className="flex-1 overflow-y-auto px-6 py-5 mt-0"
              >
                <ParticipantManager
                  courierId={courier.id}
                  organizationId={organizationId}
                />
              </TabsContent>
              {!isOutbound && (
                <TabsContent
                  value="links"
                  className="flex-1 overflow-y-auto px-6 py-5 mt-0"
                >
                  <CourierLinksTab
                    courierId={courier.id}
                    organizationId={organizationId}
                    readOnly={readOnly}
                  />
                </TabsContent>
              )}
              <TabsContent
                value="history"
                className="flex-1 overflow-y-auto px-6 py-5 mt-0"
              >
                <CourierHistoryTab
                  courierId={courier.id}
                  organizationId={organizationId}
                />
              </TabsContent>
            </>
          )}

          {/* Floating retractable notes panel — accessible from any tab */}
          {withTabs && !isOutbound && (
            <FloatingNotesPanel
              courierId={courier.id}
              organizationId={organizationId}
              notes={notesList}
              readOnly={readOnly || isFinalState}
            />
          )}
        </Tabs>
        </div>
    </>

  );

  if (fullScreen) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        {body}
      </div>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-[95vw] lg:max-w-[1100px] overflow-hidden p-0 flex flex-col">
        {body}
      </SheetContent>
    </Sheet>
  );
}

