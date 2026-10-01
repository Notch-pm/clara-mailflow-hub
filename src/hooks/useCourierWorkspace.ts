import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { updateCourier, getCourierById } from "@/services/courierService";
import { logEvent } from "@/services/courierEventService";
import { listTags } from "@/services/courierTagService";
import { splitAppliedTags } from "@/lib/courier-tags";
import {
  assignableOrgs,
  assignOrganization,
  listOrgsWithConfig,
} from "@/services/socleOrgConfigService";
import { transferCourier, returnToMailroom } from "@/services/courierRoutingService";
import { fetchMailroomMemberIds } from "@/services/mailroomService";
import { useUserServiceFilter } from "@/hooks/useUserServiceFilter";
import { useCourierDisplayDocuments } from "@/hooks/useCourierDisplayDocuments";
import { addParticipant, updateParticipant } from "@/services/courierParticipantService";
import {
  contactRelationLines,
  findContactByEmail,
  getContact,
  recordCourierConsents,
  type SocleContact,
} from "@/services/socleContactService";
import { formatContactAddressInline } from "@/lib/prefill-mapping";
import { parseConsentRecords } from "@/lib/consents";
import { useAuth } from "@/contexts/AuthContext";
import { canEditCouriers } from "@/lib/permissions";
import { contactDisplay } from "@/components/courier/ContactPicker";
import { listNotes, type CourierNote } from "@/services/courierNoteService";
import { listRepliesForCourier } from "@/services/courierReplyService";
import { listRelationsForCourier } from "@/services/courierRelationService";
import { listTicketsForCourier } from "@/services/actionTicketService";
import type { CourierChannel, CourierParticipant, WorkflowTransition, WorkflowState } from "@/types/courier";

/** Champs d'un participant modifiables depuis les écrans courrier. */
type ParticipantFields = Parameters<typeof updateParticipant>[1];

export const channelLabels: Record<CourierChannel, string> = {
  paper: "Papier",
  email: "Email",
  portal: "Portail",
};

/** Le courrier tel que le manipulent les écrans : la ligne DB + ses relations chargées. */
export interface WorkspaceCourier {
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

interface Options {
  courier: WorkspaceCourier | null;
  organizationId: string;
  /** Les requêtes secondaires ne partent que lorsque l'écran est visible. */
  open: boolean;
  readOnly?: boolean;
  /** Vue pleine page : une transition n'y provoque pas de navigation. */
  fullScreen?: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Toute la mécanique d'un courrier — requêtes, mutations, états locaux —
 * partagée par le panneau latéral de la boîte aux lettres et par l'écran
 * d'instruction plein écran. Les deux vues ne portent plus que du rendu.
 */
export function useCourierWorkspace({
  courier,
  organizationId,
  open,
  readOnly = false,
  fullScreen = false,
  onOpenChange,
}: Options) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { profile, membership } = useAuth();
  // Point de vérité unique : un consultant (lecteur seul) ne peut jamais
  // écrire, quelle que soit la valeur de la prop `readOnly` passée par l'appelant.
  const effectiveReadOnly = readOnly || !canEditCouriers(profile, membership);
  const [replyState, setReplyState] = useState<{ name: string; category: string | null } | null>(null);
  const [transferTargetServiceId, setTransferTargetServiceId] = useState<string>("");
  const [transferConfirmOpen, setTransferConfirmOpen] = useState(false);
  const [closeLinkedOpen, setCloseLinkedOpen] = useState(false);
  const [closeLinkedIds, setCloseLinkedIds] = useState<string[]>([]);
  const [searchParams] = useSearchParams();
  const initialTabParam = searchParams.get("tab");
  const initialReplyIdParam = searchParams.get("replyId");
  const initialEditParam = searchParams.get("edit") === "1";
  const [activeTab, setActiveTab] = useState<string>(initialTabParam || "detail");

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

  // Même clé ET même queryFn que LinkedActionsTab : deux queryFn différentes sur
  // une clé partagée s'écrasent mutuellement dans le cache (badge vs. liste).
  const { data: ticketsList = [] } = useQuery({
    queryKey: ["action-tickets", courier?.id],
    queryFn: () => listTicketsForCourier(courier!.id),
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

  // Fiche référentiel de l'expéditeur lié : affiche ses relations sous le nom
  // (ex. « Gérant — Boulangerie du Forum SARL »). Best-effort, jamais bloquant.
  const { data: senderContact } = useQuery({
    queryKey: ["socle-contact", organizationId, sender?.socle_contact_id],
    queryFn: async () => {
      try {
        return await getContact(organizationId, sender!.socle_contact_id!);
      } catch {
        return null;
      }
    },
    enabled: open && !!organizationId && !!sender?.socle_contact_id,
    staleTime: 30_000,
  });
  const senderRelationLines = senderContact ? contactRelationLines(senderContact) : [];

  // Adresse à laquelle répondre : celle portée par le courrier d'abord (c'est
  // l'adresse qui a écrit), sinon celle de la fiche du référentiel. Sans ce
  // repli, un courrier déposé alors que l'usager n'avait pas encore d'email
  // restait à jamais « sans adresse », même après l'ajout de l'email sur sa
  // fiche : le participant n'est qu'un instantané, jamais rafraîchi.
  const senderReplyEmail = sender?.email?.trim() || senderContact?.email?.trim() || null;
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

  // Les tags appliqués se lisent PAR GROUPE : « de quoi ça parle » et « sur
  // quel ton » sont deux questions distinctes, mêlées dans une seule rangée
  // jusqu'au 2026-09-10.
  const appliedByGroup = splitAppliedTags(selectedTags, orgTags ?? []);

  // Organisations (miroir Socle) assignables — remplacent les services.
  const { data: services } = useQuery({
    queryKey: ["socle-orgs-config", organizationId],
    queryFn: () => listOrgsWithConfig(organizationId),
    enabled: !!organizationId && open,
  });

  // Local override for assigned_service so the UI reflects the change immediately
  // after the user picks an organization (the parent prop is a snapshot and only
  // updates after the next mailbox-couriers refetch resolves).
  const [localAssignedService, setLocalAssignedService] = useState<string | null>(
    courier?.assigned_service ?? null,
  );
  // UUID de l'organisation gestionnaire — clé de résolution (le nom n'est qu'affichage).
  const [localSocleOrgId, setLocalSocleOrgId] = useState<string | null>(
    (courier?.socle_organization_id as string | null) ?? null,
  );
  // Same for workflow_state_id — when assigning an organization we land in its
  // initial state, and we need transitions to be queryable straight away (without
  // waiting for the parent's snapshot to refetch and reach this component again).
  const [localWorkflowStateId, setLocalWorkflowStateId] = useState<string | null>(
    courier?.workflow_state_id ?? null,
  );
  useEffect(() => {
    setLocalAssignedService(courier?.assigned_service ?? null);
    setLocalSocleOrgId((courier?.socle_organization_id as string | null) ?? null);
    setLocalWorkflowStateId(courier?.workflow_state_id ?? null);
    setReplyState(null);
  }, [courier?.id, courier?.assigned_service, courier?.socle_organization_id, courier?.workflow_state_id]);

  const userServiceFilter = useUserServiceFilter();

  // Si le courrier vient d'une config IMAP précise, restreindre les organisations proposées.
  const imapSettingsId = (courier?.metadata?.imap_settings_id as string | null) ?? null;
  const availableServices = useMemo(() => {
    if (!services) return [];
    let list = assignableOrgs(services);
    if (imapSettingsId) {
      const linked = list.filter((o) =>
        (o.imap_configs ?? []).some((c) => c.id === imapSettingsId),
      );
      if (linked.length > 0) list = linked;
    }
    if (userServiceFilter !== null) {
      list = list.filter((o) => userServiceFilter.includes(o.id));
    }
    // Always include the currently assigned organization so the Select can display it,
    // even if it was filtered out (e.g. different IMAP box or rights filter).
    const currentId = localSocleOrgId;
    if (currentId) {
      const current = services.find((o) => o.id === currentId);
      if (current && !list.find((o) => o.id === current.id)) {
        list = [current, ...list];
      }
    }
    return list;
  }, [services, imapSettingsId, userServiceFilter, localSocleOrgId]);

  // Resolve courier's current organization by UUID (fallback nom pour l'existant legacy)
  const currentService = useMemo(() => {
    if (!services) return null;
    if (localSocleOrgId) {
      const byId = services.find((o) => o.id === localSocleOrgId);
      if (byId) return byId;
    }
    if (!localAssignedService) return null;
    return (
      services.find(
        (o) => o.name.toLowerCase() === localAssignedService.toLowerCase(),
      ) ?? null
    );
  }, [localSocleOrgId, localAssignedService, services]);

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

  // « Renvoyer au service courrier » : proposé à un service qui détient le
  // courrier, si la collectivité a un service courrier pour le recevoir.
  const { data: mailroomMemberIds = [] } = useQuery({
    queryKey: ["mailroom-members", organizationId],
    queryFn: () => fetchMailroomMemberIds(organizationId),
    enabled: !!organizationId && open,
    staleTime: 5 * 60_000,
  });
  const canReturnToMailroom =
    !effectiveReadOnly && !!localSocleOrgId && !isFinalState && mailroomMemberIds.length > 0;

  const serviceMutation = useMutation({
    mutationFn: async (newOrgId: string) => {
      if (!courier) return null;
      const newOrg = services?.find((o) => o.id === newOrgId);
      if (!newOrg) throw new Error("Organisation introuvable");
      return assignOrganization(organizationId, courier, newOrg);
    },
    onSuccess: (result, newOrgId) => {
      if (result?.name) setLocalAssignedService(result.name);
      setLocalSocleOrgId(newOrgId);
      // Also update the local workflow state so transitions become queryable
      // immediately, without waiting for the parent's snapshot to refetch.
      setLocalWorkflowStateId(result?.initialStateId ?? null);
      queryClient.invalidateQueries({ queryKey: ["mailbox-couriers"] });
      queryClient.invalidateQueries({ queryKey: ["mailbox-unassigned"] });
      queryClient.invalidateQueries({ queryKey: ["mailroom-couriers"] });
      queryClient.invalidateQueries({ queryKey: ["courier-events", courier?.id] });
      toast.success("Organisation gestionnaire mise à jour");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const transferMutation = useMutation({
    mutationFn: async ({ targetServiceId, loseAccess }: { targetServiceId: string; loseAccess: boolean }) => {
      if (!courier) return null;
      const targetOrg = services?.find((o) => o.id === targetServiceId);
      if (!targetOrg) throw new Error("Organisation introuvable");
      const result = await transferCourier(organizationId, courier, targetOrg);
      return { ...result, loseAccess };
    },
    onSuccess: (result) => {
      setTransferConfirmOpen(false);
      setTransferTargetServiceId("");
      queryClient.invalidateQueries({ queryKey: ["mailbox-couriers"] });
      queryClient.invalidateQueries({ queryKey: ["mailbox-unassigned"] });
      queryClient.invalidateQueries({ queryKey: ["mailroom-couriers"] });
      queryClient.invalidateQueries({ queryKey: ["instruction-couriers"] });
      queryClient.invalidateQueries({ queryKey: ["courier", courier?.id] });
      toast.success("Courrier transféré");
      // Plein écran : on reste sur le courrier, comme pour une transition — le
      // panneau de tri, lui, se referme (le courrier quitte la pile à trier).
      // Exception : le transfert qui nous retire l'accès, où la page n'aurait
      // plus rien à afficher.
      if (!fullScreen || result?.loseAccess) {
        onOpenChange(false);
        return;
      }
      if (result?.name) setLocalAssignedService(result.name);
      if (result?.id) setLocalSocleOrgId(result.id);
      setLocalWorkflowStateId(result?.initialStateId ?? null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Renvoi au service courrier (« je ne sais pas à qui le confier ») : le
  // courrier quitte l'organisation et rejoint « À réorienter ».
  const returnMutation = useMutation({
    mutationFn: async (note: { done: string; todo: string }) => {
      if (!courier) return;
      await returnToMailroom(organizationId, courier, note);
    },
    onSuccess: () => {
      setTransferConfirmOpen(false);
      setTransferTargetServiceId("");
      queryClient.invalidateQueries({ queryKey: ["mailbox-couriers"] });
      queryClient.invalidateQueries({ queryKey: ["mailroom-couriers"] });
      queryClient.invalidateQueries({ queryKey: ["instruction-couriers"] });
      queryClient.invalidateQueries({ queryKey: ["courier", courier?.id] });
      queryClient.invalidateQueries({ queryKey: ["courier-events", courier?.id] });
      toast.success("Courrier renvoyé au service courrier");
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

      // First time entering a processing state → instruction_started + contact match.
      if (
        toStateRow?.category === "processing" &&
        fromStateRow?.category !== "processing"
      ) {
        await logEvent(organizationId, courier.id, "instruction_started", {
          state_name: toStateRow.name,
        });

        // Rapprochement automatique de l'expéditeur avec un contact Socle par
        // email (best-effort : un Socle indisponible ne bloque jamais le passage
        // en instruction). Pas d'auto-création : le Socle exige la civilité
        // pour une personne — l'agent crée/associe la fiche via les participants.
        const senderParticipant = courier.courier_participants?.find(
          (p) => p.role === "sender",
        );
        if (senderParticipant && !senderParticipant.socle_contact_id && senderParticipant.email) {
          try {
            const matched = await findContactByEmail(organizationId, senderParticipant.email);
            if (matched) {
              await updateParticipant(senderParticipant.id, { socle_contact_id: matched.id });
              // Dépôt portail : la trace de consentement rejoint la fiche.
              // Silencieux ici — le passage en instruction ne s'arrête pas pour ça.
              await reportCourierConsents(matched.id).catch((e) =>
                console.warn("Consentements du dépôt non transmis au référentiel :", e),
              );
            }
          } catch (e) {
            console.warn("Rapprochement contact Socle impossible :", e);
          }
        }
      }
      return { toStateId, isInitial: toStateRow?.is_initial === true, isFinal: toStateRow?.is_final === true };
    },
    onSuccess: (result) => {
      if (!result) return;
      queryClient.invalidateQueries({ queryKey: ["mailbox-couriers"] });
      queryClient.invalidateQueries({ queryKey: ["mailbox-unassigned"] });
      queryClient.invalidateQueries({ queryKey: ["mailroom-couriers"] });
      queryClient.invalidateQueries({ queryKey: ["instruction-couriers"] });
      queryClient.invalidateQueries({ queryKey: ["courier-events", courier?.id] });
      queryClient.invalidateQueries({ queryKey: ["courier-participants", courier?.id] });
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
      queryClient.invalidateQueries({ queryKey: ["mailroom-couriers"] });
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

  // Documents du courrier, corps d'email en tête (aperçu).
  const { documents, displayDocuments } = useCourierDisplayDocuments(courier, organizationId, open);

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
    queryClient.invalidateQueries({ queryKey: ["mailroom-couriers"] });
    toast.success(successMsg);
  }

  async function upsertParticipant(
    role: "sender" | "recipient",
    fields: ParticipantFields,
    successMsg = "Modifié",
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
          fields.name?.trim() || fields.email?.trim() || fields.socle_contact_id;
        if (!hasContent) return;
        await addParticipant({
          courier_id: courier.id,
          organization_id: organizationId,
          role,
          ...fields,
        });
      }
      queryClient.invalidateQueries({ queryKey: ["mailbox-couriers"] });
      queryClient.invalidateQueries({ queryKey: ["mailbox-unassigned"] });
      queryClient.invalidateQueries({ queryKey: ["mailroom-couriers"] });
      queryClient.invalidateQueries({ queryKey: ["courier", courier.id] });
      queryClient.invalidateQueries({ queryKey: ["courier-participants", courier.id] });
      toast.success(successMsg);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erreur lors de la modification");
      throw err;
    }
  }

  /**
   * Rattache l'expéditeur du courrier à une fiche du référentiel Socle : les
   * champs du participant sont alignés sur la fiche, qui fait foi sur
   * l'identité. `null` dissocie la fiche sans effacer ce que porte le courrier.
   */
  async function linkSenderContact(contact: SocleContact | null) {
    if (!contact) {
      await upsertParticipant("sender", { socle_contact_id: null }, "Expéditeur dissocié");
      return;
    }
    const address = formatContactAddressInline(contact);
    await upsertParticipant(
      "sender",
      {
        socle_contact_id: contact.id,
        name: contactDisplay(contact),
        first_name: contact.first_name,
        last_name: contact.last_name ?? contact.legal_name,
        email: contact.email,
        phone: contact.mobile_phone ?? contact.landline_phone,
        address: address || null,
      },
      "Expéditeur associé au référentiel",
    );
    // Le rattachement est FAIT : un Socle muet ne le défait pas. Avertir, sans plus.
    try {
      await reportCourierConsents(contact.id);
    } catch (e) {
      toast.warning(
        "Expéditeur associé, mais le consentement du dépôt n'a pas pu être consigné au référentiel : "
          + (e instanceof Error ? e.message : "référentiel injoignable"),
      );
    }
  }

  /**
   * Report au Socle de la trace de consentement d'un dépôt portail
   * (`couriers.consents`), sur la fiche que l'agent vient de rattacher.
   * Idempotent côté Socle (référence = id du courrier) : re-rattacher ne
   * duplique rien. Rien à faire pour un courrier sans trace (saisie agent,
   * IMAP) — pas d'appel du tout.
   */
  async function reportCourierConsents(contactId: string) {
    if (!courier || parseConsentRecords(courier.consents).length === 0) return;
    await recordCourierConsents(organizationId, contactId, courier.id);
    queryClient.invalidateQueries({ queryKey: ["socle-contact", organizationId, contactId] });
  }

  return {
    // Lecture seule effective (rôle consultant compris)
    effectiveReadOnly,
    isOutbound,
    // Participants et référentiel
    participants,
    sender,
    recipient,
    senderContact,
    senderRelationLines,
    senderReplyEmail,
    parentCourier,
    parentSender,
    // Onglets et compteurs
    activeTab,
    setActiveTab,
    initialReplyIdParam,
    initialEditParam,
    replyList,
    notesList,
    ticketsList,
    relationsList,
    replyState,
    setReplyState,
    // Tags
    selectedTags,
    orgTags,
    appliedByGroup,
    toggleTag,
    removeTag,
    // Organisation gestionnaire
    services,
    availableServices,
    currentService,
    localAssignedService,
    localSocleOrgId,
    localWorkflowStateId,
    userServiceFilter,
    serviceMutation,
    transferMutation,
    returnMutation,
    canReturnToMailroom,
    transferTargetServiceId,
    setTransferTargetServiceId,
    transferConfirmOpen,
    setTransferConfirmOpen,
    // Workflow
    transitions,
    currentStateInfo,
    isFinalState,
    isInitialState,
    transitionMutation,
    closeLinkedOpen,
    setCloseLinkedOpen,
    closeLinkedIds,
    // Documents
    documents,
    displayDocuments,
    selectedDocId,
    setSelectedDocId,
    // Écritures
    persistCourierUpdate,
    upsertParticipant,
    linkSenderContact,
  };
}

export type CourierWorkspace = ReturnType<typeof useCourierWorkspace>;
