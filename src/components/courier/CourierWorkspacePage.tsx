import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRightLeft,
  Check,
  ChevronDown,
  ExternalLink,
  Lock,
  Tag as TagIcon,
  X,
  Undo2,
  BellRing,
} from "lucide-react";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
import { TAG_GROUPS, type TagGroup } from "@/services/courierTagService";
import { assignableOrgs } from "@/services/socleOrgConfigService";
import { getWorkflowStateChain } from "@/services/workflowService";
import { getCourierSlaFacts } from "@/services/courierService";
import { useCourierSla } from "@/hooks/useCourierSla";
import { CourierSlaDetails, SlaHeadline, slaHeadline } from "./SlaStatus";
import { cn } from "@/lib/utils";
import { readableTextColor } from "@/lib/tag-color";
import { categoryTone } from "@/lib/workflow-category";
import { QuartierBadge } from "@/components/contacts/QuartierBadge";
import AdvanceBlockedButton from "./AdvanceBlockedButton";
import { advanceBlockedReason } from "./advance-blocked-reason";
import ContactPicker from "./ContactPicker";
import ContentIntentsTab from "./ContentIntentsTab";
import CourierRequestSummary from "./CourierRequestSummary";
import ServiceSuggestion from "./ServiceSuggestion";
import CourierActivityTab from "./CourierActivityTab";
import FloatingNotesPanel from "./FloatingNotesPanel";
import CourierLinksCard from "./CourierLinksCard";
import DocumentManager from "./DocumentManager";
import DocumentViewer from "./DocumentViewer";
import InlineEditField from "./InlineEditField";
import RecipientField from "./RecipientField";
import { WorkflowTrail } from "./WorkflowTrail";
import { CONTACT_CATEGORIES } from "@/lib/contact-categories";
import { isOutboundSettled } from "@/lib/outbound-kind";
import { ContactCategoryBadges } from "@/components/contacts/ContactCategoryBadge";
import LinkedActionsTab from "./LinkedActionsTab";
import ParticipantManager from "./ParticipantManager";
import ReplyComposer from "./ReplyComposer";
import { InitiativeComposer } from "./outbound/InitiativeComposer";
import { ReplyVisaSection } from "./ReplyVisaTrail";
import LinkedCouriersSection from "./LinkedCouriersSection";
import CloseLinkedCouriersDialog from "./CloseLinkedCouriersDialog";
import ReturnToMailroomDialog from "./ReturnToMailroomDialog";
import {
  channelLabels,
  inboundChannelPhrase,
  useCourierWorkspace,
  type WorkspaceCourier,
} from "@/hooks/useCourierWorkspace";
import type { CourierChannel } from "@/types/courier";
import { courierCreationBlockReason } from "../../../supabase/functions/_shared/courierCreationGuard";
import { ConfidentialBadge } from "@/components/courier/ConfidentialBadge";
import { ConfidentialToggle } from "@/components/courier/ConfidentialToggle";

interface Props {
  courier: WorkspaceCourier;
  organizationId: string;
  /** Retour à la liste d'où vient le courrier (fermeture, transfert). */
  onClose: () => void;
}

/** Liste d'origine d'un courrier, d'après la catégorie de son état courant. */
function originList(category: string | null | undefined, isOutbound: boolean) {
  if (isOutbound) return { label: "Courriers sortants", href: "/courriers-sortants" };
  switch (category) {
    case "processed":
      return { label: "Traités", href: "/courriers-traites" };
    case "archived":
      return { label: "Archivés", href: "/courriers-archives" };
    case "processing":
      return { label: "En instruction", href: "/courriers-en-instruction" };
    default:
      return { label: "À instruire", href: "/a-instruire" };
  }
}

function formatLongDate(value: string | null | undefined) {
  if (!value) return null;
  return new Date(value).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function initialsOf(name: string | null | undefined) {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  return `${words[0].charAt(0)}${words.length > 1 ? words[words.length - 1].charAt(0) : ""}`.toUpperCase();
}

/** Carte de la colonne latérale : plus compacte, titre seul. */
function RailCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-5 shadow-airbnb-sm">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-base font-semibold leading-tight">{title}</h3>
        <div className="flex-1" />
        {action}
      </div>
      {children}
    </Card>
  );
}

/** Une rubrique de carte latérale : libellé discret, valeur dessous. */
function RailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="text-xs font-semibold text-muted-foreground">{label}</div>
      <div className="min-w-0 [overflow-wrap:anywhere]">{children}</div>
    </div>
  );
}

/** Ligne de la carte « Informations » : libellé à gauche, valeur à droite. */
function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right font-semibold [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

const EMPTY = <span className="font-normal italic text-muted-foreground">—</span>;

/**
 * Écran d'instruction d'un courrier (`/courrier/:id`). L'en-tête dit l'identité
 * et l'urgence (titre, échéance, expéditeur) ; la barre du fil d'Ariane porte
 * la frise du workflow. Quatre onglets de travail — Courrier, Actions liées,
 * Réponse, Activité — et une colonne de contexte : délais, personnes,
 * classement, courriers liés, informations secondaires repliées. Le tri amont,
 * lui, se fait dans le panneau de la boîte aux lettres.
 */
export default function CourierWorkspacePage({ courier, organizationId, onClose }: Props) {
  const [tagPopoverGroup, setTagPopoverGroup] = useState<TagGroup | null>(null);
  const [servicePopoverOpen, setServicePopoverOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  const ws = useCourierWorkspace({
    courier,
    organizationId,
    open: true,
    fullScreen: true,
    onOpenChange: (next) => {
      if (!next) onClose();
    },
  });

  const {
    effectiveReadOnly,
    isOutbound,
    participants,
    sender,
    senderContact,
    senderRelationLines,
    senderReplyEmail,
    recipient,
    parentCourier,
    parentSender,
    notesList,
    replyList,
    ticketsList,
    replyState,
    setReplyState,
    activeTab,
    setActiveTab,
    initialReplyIdParam,
    initialEditParam,
    selectedTags,
    orgTags,
    appliedByGroup,
    toggleTag,
    removeTag,
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
    remindMutation,
    canRemindService,
    transferTargetServiceId,
    setTransferTargetServiceId,
    transferConfirmOpen,
    setTransferConfirmOpen,
    transitions,
    currentStateInfo,
    isFinalState,
    isInitialState,
    transitionMutation,
    closeLinkedOpen,
    setCloseLinkedOpen,
    closeLinkedIds,
    displayDocuments,
    selectedDocId,
    setSelectedDocId,
    persistCourierUpdate,
    linkSenderContact,
    recipientContact,
    linkInternalContact,
    setRecipientName,
  } = ws;

  // Sortant sans parent : un courrier à l'initiative de la collectivité. Il se
  // rédige et avance dans l'onglet « Rédaction », par le workflow de réponse
  // de son organisation émettrice — pas par les boutons d'en-tête, qui suivent
  // le workflow des courriers reçus.
  const isInitiative = isOutbound && !courier.parent_courier_id;
  // Notes internes : sur un courrier reçu et sur un courrier à l'initiative,
  // qui vit sa propre instruction. Une réponse, elle, se commente sur le
  // courrier reçu auquel elle répond.
  const hasNotes = !isOutbound || isInitiative;
  const notesReadOnly = effectiveReadOnly || isFinalState;

  // Ni action ni réponse tant que le courrier n'est pas orienté et sorti de la
  // boîte aux lettres ; la base tient la même règle (trigger de création).
  const creationBlockedReason = courierCreationBlockReason({
    socleOrganizationId: localSocleOrgId,
    workflowStateId: localWorkflowStateId,
    stateIsInitial: localWorkflowStateId ? currentStateInfo?.is_initial : true,
  });

  // Le défilement vit DANS la colonne de travail : sans ce recalage, l'onglet
  // ouvert hériterait de la hauteur où l'on avait laissé le précédent et
  // s'afficherait en plein milieu de son contenu.
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (panelRef.current) panelRef.current.scrollTop = 0;
  }, [activeTab]);

  // Frise d'avancement : la chaîne nominale du workflow de l'organisation gestionnaire.
  const { data: stateChain = [] } = useQuery({
    queryKey: ["workflow-state-chain", currentService?.workflow_id],
    queryFn: () => getWorkflowStateChain(currentService!.workflow_id!),
    enabled: !!currentService?.workflow_id && !isInitiative,
  });

  // Délais de traitement : relus à chaque transition du courrier ou de ses
  // réponses, puisque c'est le trigger qui date l'accusé et la résolution.
  const replyStatesKey = replyList.map((r) => r.workflow_state_id ?? "").join(",");
  const { data: slaFacts } = useQuery({
    queryKey: ["courier-sla-facts", courier.id, localWorkflowStateId, replyStatesKey],
    queryFn: () => getCourierSlaFacts(organizationId, courier.id),
    enabled: !isOutbound,
  });
  const slaOf = useCourierSla(organizationId);
  const sla = slaFacts ? slaOf({ ...slaFacts, socle_organization_id: localSocleOrgId ?? null }) : null;
  const hasSlaTarget = !!sla && (sla.ack.kind !== "none" || sla.resolution.kind !== "none");

  const replyStateBadge = useMemo(
    () =>
      replyState ? (
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-none",
            categoryTone(replyState.category).pill,
          )}
        >
          {replyState.name}
        </span>
      ) : null,
    [replyState],
  );

  // Quatre onglets : le travail (actions, réponse) et la trace (activité)
  // autour du courrier lui-même. Participants et liens sont passés dans la
  // colonne de contexte, l'historique et les notes fusionnés dans « Activité ».
  const tabItems: ResponsiveTabItem[] = useMemo(() => {
    const items: ResponsiveTabItem[] = [{ value: "detail", label: "Courrier" }];
    if (isInitiative) items.push({ value: "redaction", label: "Rédaction", badge: replyStateBadge });
    if (!isOutbound) {
      items.push({ value: "actions", label: "Actions liées", count: ticketsList.length });
      items.push({
        value: "response",
        label: replyList.length > 1 ? "Réponses" : "Réponse",
        count: replyList.length > 1 ? replyList.length : null,
        badge: replyStateBadge,
      });
    }
    items.push({ value: "activity", label: "Activité", count: hasNotes ? notesList.length : null });
    return items;
  }, [isOutbound, isInitiative, hasNotes, ticketsList.length, replyList.length, replyStateBadge, notesList.length]);

  const origin = originList(currentStateInfo?.category, isOutbound);
  const tone = categoryTone(currentStateInfo?.category);
  // Un sortant est « de » son organisation émettrice : celle du courrier reçu
  // pour une réponse, la sienne pour un courrier à l'initiative.
  const issuerName = isInitiative ? localAssignedService : parentCourier?.assigned_service ?? null;
  const senderLabel = isOutbound ? issuerName : sender?.name ?? null;
  const dateLabel = isOutbound
    ? formatLongDate(courier.sent_at as string | null)
    : formatLongDate(courier.received_at);
  const datePhrase = dateLabel
    ? `${isOutbound ? "envoyé" : inboundChannelPhrase(courier.channel)} le ${dateLabel}`
    : null;

  const nextTransition = transitions?.find((t) => (t as any).kind === "next");
  const prevTransition = transitions?.find((t) => (t as any).kind === "previous");
  const otherTransitions = (transitions ?? []).filter(
    (t) => t.id !== nextTransition?.id && t.id !== prevTransition?.id,
  );
  // Réaffecter : rouvre le choix d'organisation de la colonne de contexte
  // (affectation à l'état initial, transfert confirmé au-delà).
  const canReassign = !effectiveReadOnly && !isOutbound && !!localSocleOrgId && !isFinalState;
  const hasOtherActions = otherTransitions.length > 0 || canRemindService || canReassign;

  function openReassign() {
    // Après la fermeture du menu : sinon il rend le focus à son déclencheur,
    // et le popover, aussitôt ouvert, se referme sur cette interaction.
    setTimeout(() => setServicePopoverOpen(true), 0);
  }

  const inlineDocs = displayDocuments
    .filter((d: { id: string }) => d.id.startsWith("inline:"))
    .map((d: { id: string; file_name: string | null }) => ({ id: d.id, file_name: d.file_name }));

  const isConfidential = !!courier.is_confidential;

  // La hauteur vient du conteneur, pas de `100dvh` : l'en-tête et les onglets
  // restent en place, et seules les deux colonnes défilent, chacune pour son
  // compte.
  return (
    <div className="flex w-full flex-col lg:h-full">
      {/* Barre du fil d'Ariane, pleine largeur : le fil dit où l'on est dans
          l'application, la frise à droite où en est le courrier. */}
      <div className="-mx-4 -mt-4 mb-5 flex min-h-14 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-2.5 md:-mx-6 md:-mt-6 md:px-6 lg:shrink-0">
        <nav aria-label="Fil d'Ariane" className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
          <Button
            size="icon"
            variant="ghost"
            className="-ml-2 h-7 w-7 shrink-0"
            onClick={onClose}
            title="Retour à la liste"
            aria-label="Retour à la liste"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <span>Courriers</span>
          <span aria-hidden>/</span>
          <Link to={origin.href} className="font-semibold text-primary hover:underline">
            {origin.label}
          </Link>
          <span aria-hidden>/</span>
          <span className="font-mono text-xs text-foreground">{courier.chrono ?? "sans référence"}</span>
        </nav>
        <div className="flex-1" />
        {!isInitiative && (
          <WorkflowTrail
            chain={stateChain}
            currentStateId={localWorkflowStateId}
            current={currentStateInfo}
            className="hidden md:flex"
          />
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-start gap-4 lg:shrink-0">
        <div className="flex min-w-0 flex-1 basis-[420px] flex-col gap-1.5">
          <h1 className="min-w-0 max-w-full">
            <InlineEditField
              label=""
              value={courier.subject ?? ""}
              placeholder="Titre du courrier"
              emptyDisplay="Sans titre"
              maxLength={255}
              // Le champ est calibré pour une colonne étroite : `line-clamp` et
              // `max-w-full` amputent la largeur intrinsèque du titre, qui passe
              // alors à la ligne alors qu'il reste de la place. Le rétrécissement
              // flex suffit à contenir un titre long.
              displayClassName="max-w-none text-2xl font-bold leading-tight tracking-tight [&>span]:line-clamp-none [&>span]:whitespace-normal"
              editClassName="text-2xl font-bold leading-tight"
              readOnly={effectiveReadOnly}
              multiline
              onSave={(v) => persistCourierUpdate({ subject: v.trim() || null }, "Titre modifié")}
            />
          </h1>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            {isConfidential && <ConfidentialBadge />}
            {/* La frise vit dans la barre du fil d'Ariane, masquée sur petit
                écran : l'état y reste lisible ici. */}
            {currentStateInfo?.name && !isInitiative && (
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-bold md:hidden",
                  tone.pill,
                )}
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", tone.dot)} />
                {currentStateInfo.name}
              </span>
            )}
            {sla && <SlaHeadline sla={sla} />}
            {sla && slaHeadline(sla) && (senderLabel || datePhrase) && <span aria-hidden>·</span>}
            {(senderLabel || datePhrase) && (
              <span>
                {senderLabel && (
                  <>
                    De <span className="font-semibold text-foreground">{senderLabel}</span>
                    {datePhrase && ", "}
                  </>
                )}
                {datePhrase && (senderLabel ? datePhrase : datePhrase.charAt(0).toUpperCase() + datePhrase.slice(1))}
              </span>
            )}
          </div>
        </div>

        {/* Sous sm les actions s'empilent sur toute la largeur. `shrink-0` sur
            la rangee et `whitespace-nowrap` sur les boutons rendaient un
            libelle de transition long — « Transmettre au service instructeur »
            — irreductible : la page entiere s'elargissait derriere lui. */}
        {!isInitiative && (
          <div className="flex w-full shrink-0 flex-col gap-2.5 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
            {!effectiveReadOnly && prevTransition && (
              <Button
                variant="outline"
                onClick={() => transitionMutation.mutate(prevTransition.to_state.id)}
                disabled={transitionMutation.isPending}
                className="h-10 w-full min-w-0 gap-2 sm:w-auto"
              >
                <ArrowLeft className="h-4 w-4 shrink-0" />
                <span className="truncate">
                  {prevTransition.name ?? prevTransition.to_state?.name ?? "Précédent"}
                </span>
              </Button>
            )}
            {!effectiveReadOnly && hasOtherActions && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    className="h-10 w-full gap-1.5 sm:w-auto"
                    disabled={transitionMutation.isPending}
                  >
                    Autres actions
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {otherTransitions.map((t) => (
                    <DropdownMenuItem key={t.id} onClick={() => transitionMutation.mutate(t.to_state.id)}>
                      <span className="flex items-center gap-2">
                        <span className={cn("h-2 w-2 rounded-full", categoryTone(t.to_state?.category).dot)} />
                        {t.name ?? t.to_state?.name ?? "Transition"}
                      </span>
                    </DropdownMenuItem>
                  ))}
                  {otherTransitions.length > 0 && (canRemindService || canReassign) && <DropdownMenuSeparator />}
                  {canRemindService && (
                    <DropdownMenuItem disabled={remindMutation.isPending} onClick={() => remindMutation.mutate()}>
                      <span className="flex items-center gap-2">
                        <BellRing className="h-4 w-4 text-muted-foreground" />
                        Relancer le service
                      </span>
                    </DropdownMenuItem>
                  )}
                  {canReassign && (
                    <DropdownMenuItem onSelect={openReassign}>
                      <span className="flex items-center gap-2">
                        <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
                        Réaffecter…
                      </span>
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {!effectiveReadOnly && nextTransition && (
              <Button
                onClick={() => transitionMutation.mutate(nextTransition.to_state.id)}
                disabled={transitionMutation.isPending}
                className="h-10 w-full min-w-0 gap-2 font-bold shadow-airbnb sm:w-auto"
              >
                <span
                  className={cn(
                    "h-2 w-2 shrink-0 rounded-full",
                    categoryTone(nextTransition.to_state?.category).dot,
                  )}
                />
                <span className="truncate">
                  {nextTransition.name ?? nextTransition.to_state?.name ?? "Suivant"}
                </span>
              </Button>
            )}
            {/* Sans transition nominale, cet écran n'affichait RIEN : l'agent
                n'avait aucun moyen de savoir s'il manquait un droit, un état, ou
                une transition dans le workflow. Un bouton grisé qui dit pourquoi
                vaut mieux qu'un silence — c'est aussi ce que fait la boîte aux
                lettres, les deux écrans ne doivent pas raconter deux histoires. */}
            {!effectiveReadOnly && !nextTransition && (
              <AdvanceBlockedButton
                reason={advanceBlockedReason({
                  hasOrganization: !!currentService,
                  hasWorkflow: !!currentService?.workflow_id,
                  hasState: !!localWorkflowStateId,
                  isFinalState,
                  transitionCount: transitions?.length ?? 0,
                  stateName: currentStateInfo?.name ?? null,
                })}
                wrapperClassName="w-full min-w-0 sm:w-auto"
                className="h-10 w-full min-w-0 gap-2 font-bold sm:w-auto"
              >
                <span className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground" />
                <span className="truncate">Suivant</span>
              </AdvanceBlockedButton>
            )}
          </div>
        )}
      </div>

      {/* Les onglets coiffent toute la largeur, comme un en-tête de section ;
          la colonne de contexte, dessous, ne change pas d'un onglet à l'autre. */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col lg:min-h-0 lg:flex-1">
        <ResponsiveTabsList activeValue={activeTab} onValueChange={setActiveTab} tabs={tabItems} className="shrink-0" />

        <div className="grid grid-cols-1 gap-5 pt-5 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div ref={panelRef} className="min-w-0 lg:min-h-0 lg:overflow-y-auto lg:pb-2">
            <TabsContent value="detail" className="mt-0 flex flex-col gap-5 focus-visible:outline-none">
              {!isOutbound && (
                <LinkedCouriersSection
                  courierId={courier.id}
                  organizationId={organizationId}
                  disabled={effectiveReadOnly}
                  // Les liens déjà posés sont dans la colonne de contexte : ici
                  // on ne sert que les suggestions restées à trancher.
                  showRelations={false}
                />
              )}

              {!isOutbound && (
                <CourierRequestSummary
                  courierId={courier.id}
                  organizationId={organizationId}
                  onCreateAction={
                    creationBlockedReason || effectiveReadOnly || isFinalState
                      ? undefined
                      : () => setActiveTab("actions")
                  }
                  analysisDetail={
                    <ContentIntentsTab
                      courierId={courier.id}
                      organizationId={organizationId}
                      readOnly={effectiveReadOnly || isFinalState}
                      isInitialState={isInitialState}
                      serviceSuggestion={
                        <ServiceSuggestion
                          courierId={courier.id}
                          currentOrgId={currentService?.id ?? null}
                          isInitialState={isInitialState}
                          readOnly={effectiveReadOnly || isFinalState}
                          orgs={services ?? []}
                          assignableIds={availableServices.map((o) => o.id)}
                          transferableIds={assignableOrgs(services ?? [])
                            .filter((o) => o.id !== currentService?.id)
                            .map((o) => o.id)}
                          onAssign={(id) => serviceMutation.mutate(id)}
                          onTransfer={(id) => {
                            setTransferTargetServiceId(id);
                            setTransferConfirmOpen(true);
                          }}
                          busy={serviceMutation.isPending || transferMutation.isPending}
                        />
                      }
                    />
                  }
                />
              )}

              {isOutbound && (
                // `empty:hidden` : sans visa, la section ne rend rien — pas de carte vide.
                <Card className="p-6 shadow-airbnb-sm empty:hidden">
                  <ReplyVisaSection organizationId={organizationId} replyId={courier.id} stateId={courier.workflow_state_id} />
                </Card>
              )}

              {/* La liste des pièces pilote l'aperçu voisin. */}
              <Card className="grid overflow-hidden shadow-airbnb-sm md:h-[70vh] md:min-h-[480px] md:grid-cols-[220px_minmax(0,1fr)]">
                <div className="overflow-y-auto border-b border-border px-3 py-5 md:border-b-0 md:border-r">
                  <DocumentManager
                    layout="list"
                    courierId={courier.id}
                    organizationId={organizationId}
                    selectedDocId={selectedDocId}
                    onSelectDoc={setSelectedDocId}
                    readOnly={effectiveReadOnly}
                    leadingItems={inlineDocs}
                    ignoredAttachments={
                      (courier.metadata?.ignored_attachments as { name: string; size: number }[] | undefined) ?? []
                    }
                  />
                </div>
                <div className="flex min-h-[420px] min-w-0 flex-col bg-muted p-3">
                  <DocumentViewer
                    documents={displayDocuments as any}
                    currentId={selectedDocId}
                    onChange={setSelectedDocId}
                    organizationId={organizationId}
                  />
                </div>
              </Card>
            </TabsContent>

            {!isOutbound && (
              <TabsContent value="actions" className="mt-0 focus-visible:outline-none">
                <LinkedActionsTab
                  courierId={courier.id}
                  organizationId={organizationId}
                  courierSocleOrganizationId={localSocleOrgId}
                  readOnly={effectiveReadOnly || isFinalState}
                  creationBlockedReason={creationBlockedReason}
                />
              </TabsContent>
            )}

            {!isOutbound && (
              <TabsContent
                value="response"
                className="mt-0 focus-visible:outline-none data-[state=inactive]:hidden"
              >
                <Card className="flex min-h-[60vh] flex-col p-6 shadow-airbnb-sm">
                  <ReplyComposer
                    courierId={courier.id}
                    organizationId={organizationId}
                    parentSubject={courier.subject ?? null}
                    parentReceivedAt={courier.received_at ?? null}
                    assignedService={localAssignedService}
                    socleOrganizationId={localSocleOrgId}
                    sender={sender ?? null}
                    senderReplyEmail={senderReplyEmail}
                    readOnly={effectiveReadOnly}
                    creationBlockedReason={creationBlockedReason}
                    onStateChange={setReplyState}
                    initialReplyId={initialReplyIdParam}
                    initialOpenEditor={initialEditParam}
                  />
                </Card>
              </TabsContent>
            )}

            {isInitiative && (
              <TabsContent
                value="redaction"
                className="mt-0 focus-visible:outline-none data-[state=inactive]:hidden"
              >
                <Card className="flex min-h-[60vh] flex-col p-6 shadow-airbnb-sm">
                  <InitiativeComposer
                    organizationId={organizationId}
                    courier={courier}
                    readOnly={effectiveReadOnly}
                    onStateChange={setReplyState}
                  />
                </Card>
              </TabsContent>
            )}

            <TabsContent value="activity" className="mt-0 focus-visible:outline-none">
              <Card className="p-6 shadow-airbnb-sm">
                <CourierActivityTab
                  courierId={courier.id}
                  organizationId={organizationId}
                  notes={notesList}
                  notesEnabled={hasNotes}
                  readOnly={notesReadOnly}
                />
              </Card>
            </TabsContent>
          </div>

          {/* La borne de hauteur vient du conteneur, pas de `100dvh` : ce gabarit
              retranchait l'en-tête mais pas le pied de page, et le bas de la
              colonne tombait hors d'atteinte du défilement. */}
          <aside
            className="flex min-w-0 flex-col gap-4 lg:min-h-0 lg:overflow-y-auto lg:pb-2"
            aria-label="Contexte du courrier"
          >
            {!isOutbound && hasSlaTarget && sla && (
              <RailCard title="Délais de traitement">
                <CourierSlaDetails sla={sla} />
              </RailCard>
            )}

            <RailCard title="Personnes">
              <div className="flex flex-col gap-3.5">
                <RailField label={isOutbound ? "Émetteur" : "Expéditeur"}>
                  {isOutbound ? (
                    <div className="space-y-1.5">
                      <div className="text-base font-semibold">{issuerName ?? EMPTY}</div>
                      {/* Facultatif : l'agent ou l'élu au nom de qui le courrier
                          part. Figé, comme le destinataire, une fois signé,
                          envoyé ou posté. */}
                      <ContactPicker
                        organizationId={organizationId}
                        value={senderContact ?? null}
                        onChange={(c) => void linkInternalContact("sender", c)}
                        roles={[...CONTACT_CATEGORIES]}
                        disabled={effectiveReadOnly || isOutboundSettled(courier.metadata as Record<string, unknown> | null)}
                        fallbackLabel={sender?.name ?? undefined}
                        placeholder="Au nom de… (interne ou élu, facultatif)"
                        triggerClassName="h-9 w-full justify-between px-2.5"
                      />
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        {/* L'identité vient du référentiel : on choisit une fiche,
                            on ne saisit plus le nom à la main. */}
                        <div className="min-w-0 flex-1">
                          <ContactPicker
                            organizationId={organizationId}
                            value={senderContact ?? null}
                            onChange={linkSenderContact}
                            disabled={effectiveReadOnly}
                            fallbackLabel={sender?.name ?? undefined}
                            triggerClassName="h-9 w-full justify-between px-2.5 [&>span]:font-semibold"
                          />
                        </div>
                        {sender?.socle_contact_id && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Link
                                to={`/contacts/${sender.socle_contact_id}`}
                                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-muted hover:text-primary"
                                aria-label="Voir la fiche contact et ses courriers"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                              </Link>
                            </TooltipTrigger>
                            <TooltipContent>Voir la fiche contact et ses courriers</TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                      <ContactCategoryBadges contact={senderContact} />
                      {senderRelationLines.map((line) => (
                        <div key={line.key} className="truncate text-xs text-muted-foreground">
                          {line.text}
                        </div>
                      ))}
                      {senderContact?.quartier && (
                        <div className="pt-0.5">
                          <QuartierBadge quartier={senderContact.quartier} />
                        </div>
                      )}
                    </div>
                  )}
                </RailField>

                <RailField label="Destinataire">
                  {isOutbound ? (
                    <span className="text-base font-semibold">
                      {(isInitiative ? recipient?.name : parentSender?.name) ?? EMPTY}
                    </span>
                  ) : (
                    <RecipientField
                      key={recipient?.id ?? "none"}
                      organizationId={organizationId}
                      recipientName={recipient?.name}
                      linked={!!recipient?.socle_contact_id}
                      contact={recipientContact}
                      onLink={(c) => linkInternalContact("recipient", c)}
                      onSetName={(name) => setRecipientName(name ?? "")}
                      readOnly={effectiveReadOnly}
                      triggerClassName="h-9 w-full justify-between px-2.5 [&>span]:font-semibold"
                    />
                  )}
                </RailField>

                <RailField label={isInitiative ? "Organisation émettrice" : "Organisation gestionnaire"}>
                  {effectiveReadOnly ? (
                    <div className="text-sm font-semibold">{localAssignedService ?? EMPTY}</div>
                  ) : (
                    <Popover open={servicePopoverOpen} onOpenChange={setServicePopoverOpen}>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="flex h-11 w-full items-center justify-between gap-2 rounded-md border px-3 text-left text-sm font-semibold transition-shadow hover:shadow-airbnb-sm"
                          title={
                            isInitialState
                              ? "Affecter à une organisation"
                              : "Transférer à une autre organisation"
                          }
                        >
                          <span className="min-w-0 truncate">
                            {localAssignedService ?? (
                              <span className="font-normal italic text-muted-foreground">Non assigné</span>
                            )}
                          </span>
                          <ArrowRightLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-72 space-y-2 p-3" align="start">
                        {isInitialState ? (
                          <>
                            <p className="text-xs text-muted-foreground">Affecter à une organisation</p>
                            <Select
                              value={currentService?.id ?? ""}
                              onValueChange={(v) => {
                                serviceMutation.mutate(v);
                                setServicePopoverOpen(false);
                              }}
                              disabled={serviceMutation.isPending}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Sélectionner une organisation" />
                              </SelectTrigger>
                              <SelectContent>
                                {availableServices.map((s) => (
                                  <SelectItem key={s.id} value={s.id}>
                                    {s.name}
                                    {s.workflow?.name && (
                                      <span className="ml-2 text-xs text-muted-foreground">
                                        — {s.workflow.name}
                                      </span>
                                    )}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {localAssignedService && !currentService && (
                              <p className="text-xs italic text-muted-foreground">
                                Organisation actuelle « {localAssignedService} » introuvable.
                              </p>
                            )}
                          </>
                        ) : (
                          <>
                            <p className="text-xs text-muted-foreground">
                              Transférer à une autre organisation. Le courrier sera remis à l'état initial.
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
                                <SelectValue placeholder="Choisir une organisation…" />
                              </SelectTrigger>
                              <SelectContent>
                                {assignableOrgs(services ?? [])
                                  .filter((o) => o.id !== currentService?.id)
                                  .map((o) => (
                                    <SelectItem key={o.id} value={o.id}>
                                      {o.name}
                                    </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                          </>
                        )}
                        {canReturnToMailroom && (
                          <button
                            type="button"
                            className="flex w-full items-center gap-1.5 border-t pt-2 text-left text-xs font-semibold text-primary hover:underline"
                            onClick={() => {
                              setServicePopoverOpen(false);
                              setReturnOpen(true);
                            }}
                          >
                            <Undo2 className="h-3.5 w-3.5 shrink-0" />
                            Je ne sais pas — renvoyer au service courrier
                          </button>
                        )}
                      </PopoverContent>
                    </Popover>
                  )}
                </RailField>

                <div className="flex items-center gap-2 border-t border-border pt-3">
                  {participants.length > 0 && (
                    <span className="flex" aria-hidden>
                      {participants.slice(0, 3).map((p, i) => (
                        <span
                          key={p.id}
                          className={cn(
                            "grid h-7 w-7 place-items-center rounded-full border-2 border-card bg-primary/10 text-[11px] font-bold text-primary",
                            i > 0 && "-ml-2",
                          )}
                        >
                          {initialsOf(p.name)}
                        </span>
                      ))}
                    </span>
                  )}
                  <span className="flex-1 text-sm text-muted-foreground">
                    {participants.length} participant{participants.length > 1 ? "s" : ""}
                  </span>
                  <button
                    type="button"
                    onClick={() => setParticipantsOpen(true)}
                    className="text-sm font-semibold text-primary hover:underline"
                  >
                    {effectiveReadOnly ? "Voir" : "Gérer"}
                  </button>
                </div>

                <div
                  className={cn(
                    "flex items-start gap-2.5 rounded-lg p-3",
                    isConfidential ? "bg-foreground/5" : "bg-muted/60",
                  )}
                >
                  <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">Courrier confidentiel</div>
                    <div className="text-xs leading-snug text-muted-foreground">
                      {isConfidential
                        ? "Lisible des seuls membres habilités, et des viseurs et signataires de ses réponses."
                        : "Restreindre la lecture aux membres habilités."}
                    </div>
                  </div>
                  {/* Poser : habilité ou service courrier ; lever : habilité (la base tranche).
                      Une réponse suit son courrier reçu : la base refuse de la lever seule. */}
                  {!effectiveReadOnly && (
                    <ConfidentialToggle courierId={courier.id} isConfidential={isConfidential} variant="switch" />
                  )}
                </div>
              </div>
            </RailCard>

            <RailCard title="Classement">
              <div className="space-y-3">
                {TAG_GROUPS.map((group) => {
                  const applied = appliedByGroup[group.value];
                  const available = (orgTags ?? []).filter((t) => t.tag_group === group.value);
                  return (
                    <div key={group.value} className="space-y-1.5">
                      <span className="text-xs font-semibold text-muted-foreground">{group.label}</span>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {applied.length === 0 && (
                          <span className="text-xs italic text-muted-foreground">Aucun</span>
                        )}
                        {applied.map(({ name: tagName, tag }) => {
                          // Orphelin : appliqué sur le courrier, retiré du référentiel depuis.
                          const orphan = !tag;
                          const fg = tag?.color ? readableTextColor(tag.color) : undefined;
                          return (
                            <Badge
                              key={tagName}
                              variant="secondary"
                              className={cn(
                                "gap-1 border-transparent pl-2 pr-1 text-xs",
                                orphan && "italic opacity-60",
                                effectiveReadOnly && "pr-2",
                              )}
                              style={tag?.color ? { backgroundColor: tag.color, color: fg } : undefined}
                            >
                              {tagName}
                              {!effectiveReadOnly && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    removeTag(tagName);
                                  }}
                                  className="ml-0.5 rounded-full p-0.5 transition-colors hover:bg-black/20"
                                  aria-label={`Retirer ${tagName}`}
                                  style={fg ? { color: fg } : undefined}
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              )}
                            </Badge>
                          );
                        })}
                        {!effectiveReadOnly && (
                          <Popover
                            open={tagPopoverGroup === group.value}
                            onOpenChange={(o) => setTagPopoverGroup(o ? group.value : null)}
                          >
                            <PopoverTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6 shrink-0"
                                aria-label={`Gérer les tags — ${group.label}`}
                              >
                                <TagIcon className="h-3.5 w-3.5" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-64 p-0" align="start">
                              <Command>
                                <CommandInput placeholder={`Rechercher — ${group.label.toLowerCase()}…`} />
                                <CommandList>
                                  <CommandEmpty>
                                    Aucun tag dans ce groupe. Allez dans Paramètres → Classification.
                                  </CommandEmpty>
                                  <CommandGroup>
                                    {available.map((tag) => {
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
                                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                                            style={{
                                              backgroundColor: tag.color ?? "hsl(var(--muted-foreground))",
                                            }}
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
                  );
                })}
              </div>
            </RailCard>

            {(!isOutbound || isInitiative) && (
              <CourierLinksCard
                courierId={courier.id}
                organizationId={organizationId}
                readOnly={effectiveReadOnly}
                initiative={isInitiative ? { chrono: courier.chrono ?? null, subject: courier.subject ?? null } : null}
              />
            )}

            {/* Métadonnées secondaires, repliées : la confidentialité n'apparaît
                en en-tête que lorsqu'elle est active. */}
            <Collapsible open={infoOpen} onOpenChange={setInfoOpen} asChild>
              <Card className="p-5 shadow-airbnb-sm">
                <CollapsibleTrigger className="flex w-full items-center gap-2 text-left">
                  <h3 className="flex-1 text-base font-semibold leading-tight">Informations</h3>
                  {!infoOpen && (
                    <span className="text-xs text-muted-foreground">
                      {isOutbound ? "Référence, date…" : "Référence, canal…"}
                    </span>
                  )}
                  <ChevronDown
                    className={cn("h-4 w-4 text-muted-foreground transition-transform", infoOpen && "rotate-180")}
                  />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <dl className="mt-3 flex flex-col gap-2.5">
                    <InfoRow label="Référence">
                      <span className="font-mono text-xs font-normal">{courier.chrono ?? EMPTY}</span>
                    </InfoRow>
                    <InfoRow label={isOutbound ? "Date d'envoi" : "Date de réception"}>
                      <InlineEditField
                        label=""
                        type="date"
                        value={
                          isOutbound
                            ? (courier.sent_at as string | null)?.slice(0, 10) ?? ""
                            : courier.received_at?.slice(0, 10) ?? ""
                        }
                        // La date d'envoi d'un courrier à l'initiative est posée par
                        // l'envoi lui-même : elle ne se saisit pas.
                        readOnly={effectiveReadOnly || isInitiative}
                        displayClassName="text-sm font-semibold"
                        onSave={(v) =>
                          persistCourierUpdate(
                            isOutbound
                              ? { sent_at: v ? new Date(v).toISOString() : null }
                              : { received_at: v ? new Date(v).toISOString() : null },
                            "Date modifiée",
                          )
                        }
                        renderDisplay={(v) => formatLongDate(v)}
                      />
                    </InfoRow>
                    {!isOutbound && (
                      <InfoRow label="Canal">
                        {effectiveReadOnly ? (
                          channelLabels[courier.channel]
                        ) : (
                          <Select
                            value={courier.channel}
                            onValueChange={(v) => persistCourierUpdate({ channel: v }, "Canal modifié")}
                          >
                            <SelectTrigger className="-mr-2 h-8 w-auto gap-1.5 border-0 bg-transparent px-2 text-sm font-semibold shadow-none hover:bg-muted">
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
                      </InfoRow>
                    )}
                    <InfoRow label="Confidentialité">{isConfidential ? "Oui" : "Non"}</InfoRow>
                    {courier.socle_organization?.name && (
                      <InfoRow label="Organisation d'origine">{courier.socle_organization.name}</InfoRow>
                    )}
                    {isOutbound && courier.parent_courier_id && (
                      <InfoRow label="Courrier lié">
                        <Link
                          to={`/courrier/${courier.parent_courier_id}`}
                          className="inline-flex items-center gap-1.5 text-primary hover:underline"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Courrier entrant
                        </Link>
                      </InfoRow>
                    )}
                  </dl>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          </aside>
        </div>
      </Tabs>

      <Dialog open={participantsOpen} onOpenChange={setParticipantsOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Participants</DialogTitle>
          </DialogHeader>
          <ParticipantManager courierId={courier.id} organizationId={organizationId} readOnly={effectiveReadOnly} />
        </DialogContent>
      </Dialog>

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
              <strong>{services?.find((o) => o.id === transferTargetServiceId)?.name ?? ""}</strong>. Elle
              sera alors remise à l'état initial. En fonction de la configuration des droits, elle pourrait
              vous être rendue inaccessible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              disabled={transferMutation.isPending}
              onClick={() => {
                const loseAccess =
                  userServiceFilter !== null && !userServiceFilter.includes(transferTargetServiceId);
                transferMutation.mutate({ targetServiceId: transferTargetServiceId, loseAccess });
              }}
            >
              Valider
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ReturnToMailroomDialog
        open={returnOpen}
        onOpenChange={setReturnOpen}
        pending={returnMutation.isPending}
        onConfirm={(note) => returnMutation.mutate(note, { onSuccess: () => setReturnOpen(false) })}
      />

      <CloseLinkedCouriersDialog
        open={closeLinkedOpen}
        onOpenChange={setCloseLinkedOpen}
        organizationId={organizationId}
        linkedCourierIds={closeLinkedIds}
        sourceTitle={courier.subject ?? courier.chrono ?? "ce courrier"}
      />

      {/* Languette des notes, accessible depuis tous les onglets ; « Activité »
          les reprend dans la frise, avec l'historique. */}
      {hasNotes && (
        <FloatingNotesPanel
          courierId={courier.id}
          organizationId={organizationId}
          notes={notesList}
          readOnly={notesReadOnly}
        />
      )}
    </div>
  );
}
