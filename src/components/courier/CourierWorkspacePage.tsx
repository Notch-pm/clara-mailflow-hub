import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getWorkflowStateChain } from "@/services/workflowService";
import { getCourierSlaFacts } from "@/services/courierService";
import { useCourierSla } from "@/hooks/useCourierSla";
import { CourierSlaDetails, SlaHeadline, slaHeadline } from "./SlaStatus";
import { cn } from "@/lib/utils";
import { categoryTone } from "@/lib/workflow-category";
import {
  capitalizeFirst,
  formatLongDate,
  headerDatePhrase,
  originList,
  splitTransitions,
} from "@/lib/courier-workspace";
import { advanceBlockedReason } from "./advance-blocked-reason";
import InlineEditField from "./InlineEditField";
import CourierActivityTab from "./CourierActivityTab";
import FloatingNotesPanel from "./FloatingNotesPanel";
import CourierLinksCard from "./CourierLinksCard";
import { WorkflowTrail } from "./WorkflowTrail";
import LinkedActionsTab from "./LinkedActionsTab";
import ParticipantManager from "./ParticipantManager";
import ReplyComposer from "./ReplyComposer";
import { InitiativeComposer } from "./outbound/InitiativeComposer";
import CloseLinkedCouriersDialog from "./CloseLinkedCouriersDialog";
import ReturnToMailroomDialog from "./ReturnToMailroomDialog";
import { RailCard } from "./workspace/RailParts";
import { WorkspaceClassificationCard } from "./workspace/WorkspaceClassificationCard";
import { WorkspaceDetailTab } from "./workspace/WorkspaceDetailTab";
import { WorkspaceInfoCard } from "./workspace/WorkspaceInfoCard";
import { WorkspacePeopleCard } from "./workspace/WorkspacePeopleCard";
import { WorkspaceTransitionActions } from "./workspace/WorkspaceTransitionActions";
import { inboundChannelPhrase, useCourierWorkspace, type WorkspaceCourier } from "@/hooks/useCourierWorkspace";
import { courierCreationBlockReason } from "../../../supabase/functions/_shared/courierCreationGuard";
import { ConfidentialBadge } from "@/components/courier/ConfidentialBadge";

interface Props {
  courier: WorkspaceCourier;
  organizationId: string;
  /** Retour à la liste d'où vient le courrier (fermeture, transfert). */
  onClose: () => void;
}

/**
 * Écran d'instruction d'un courrier (`/courrier/:id`). L'en-tête dit l'identité
 * et l'urgence (titre, échéance, expéditeur) ; la barre du fil d'Ariane porte
 * la frise du workflow. Quatre onglets de travail — Courrier, Actions liées,
 * Réponse, Activité — et une colonne de contexte : délais, personnes,
 * classement, courriers liés, informations secondaires repliées. Le tri amont,
 * lui, se fait dans le panneau de la boîte aux lettres.
 */
export default function CourierWorkspacePage({ courier, organizationId, onClose }: Props) {
  const [servicePopoverOpen, setServicePopoverOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [participantsOpen, setParticipantsOpen] = useState(false);

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
    sender,
    senderReplyEmail,
    parentCourier,
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
    currentService,
    localAssignedService,
    localSocleOrgId,
    localWorkflowStateId,
    userServiceFilter,
    transferMutation,
    returnMutation,
    remindMutation,
    canRemindService,
    transferTargetServiceId,
    setTransferTargetServiceId,
    transferConfirmOpen,
    setTransferConfirmOpen,
    transitions,
    currentStateInfo,
    isFinalState,
    transitionMutation,
    closeLinkedOpen,
    setCloseLinkedOpen,
    closeLinkedIds,
    persistCourierUpdate,
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
  const datePhrase = headerDatePhrase(isOutbound ? "envoyé" : inboundChannelPhrase(courier.channel), dateLabel);

  const { next: nextTransition, previous: prevTransition, others: otherTransitions } = splitTransitions(
    transitions,
  );
  // Réaffecter : rouvre le choix d'organisation de la colonne de contexte
  // (affectation à l'état initial, transfert confirmé au-delà).
  const canReassign = !effectiveReadOnly && !isOutbound && !!localSocleOrgId && !isFinalState;

  function openReassign() {
    // Après la fermeture du menu : sinon il rend le focus à son déclencheur,
    // et le popover, aussitôt ouvert, se referme sur cette interaction.
    setTimeout(() => setServicePopoverOpen(true), 0);
  }

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
                {datePhrase && (senderLabel ? datePhrase : capitalizeFirst(datePhrase))}
              </span>
            )}
          </div>
        </div>

        {!isInitiative && !effectiveReadOnly && (
          <WorkspaceTransitionActions
            previous={prevTransition}
            next={nextTransition}
            others={otherTransitions}
            pending={transitionMutation.isPending}
            onTransition={(toStateId) => transitionMutation.mutate(toStateId)}
            canRemindService={canRemindService}
            remindPending={remindMutation.isPending}
            onRemind={() => remindMutation.mutate()}
            canReassign={canReassign}
            onReassign={openReassign}
            blockedReason={advanceBlockedReason({
              hasOrganization: !!currentService,
              hasWorkflow: !!currentService?.workflow_id,
              hasState: !!localWorkflowStateId,
              isFinalState,
              transitionCount: transitions?.length ?? 0,
              stateName: currentStateInfo?.name ?? null,
            })}
          />
        )}
      </div>

      {/* Les onglets coiffent toute la largeur, comme un en-tête de section ;
          la colonne de contexte, dessous, ne change pas d'un onglet à l'autre. */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col lg:min-h-0 lg:flex-1">
        <ResponsiveTabsList activeValue={activeTab} onValueChange={setActiveTab} tabs={tabItems} className="shrink-0" />

        <div className="grid grid-cols-1 gap-5 pt-5 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div ref={panelRef} className="min-w-0 lg:min-h-0 lg:overflow-y-auto lg:pb-2">
            <TabsContent value="detail" className="mt-0 flex flex-col gap-5 focus-visible:outline-none">
              <WorkspaceDetailTab
                ws={ws}
                courier={courier}
                organizationId={organizationId}
                creationBlockedReason={creationBlockedReason}
                onCreateAction={() => setActiveTab("actions")}
              />
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
              <TabsContent value="response" className="mt-0 focus-visible:outline-none data-[state=inactive]:hidden">
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
              <TabsContent value="redaction" className="mt-0 focus-visible:outline-none data-[state=inactive]:hidden">
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

            <WorkspacePeopleCard
              ws={ws}
              courier={courier}
              organizationId={organizationId}
              isInitiative={isInitiative}
              issuerName={issuerName}
              servicePopoverOpen={servicePopoverOpen}
              onServicePopoverOpenChange={setServicePopoverOpen}
              onReturnToMailroom={() => setReturnOpen(true)}
              onManageParticipants={() => setParticipantsOpen(true)}
            />

            <WorkspaceClassificationCard
              appliedByGroup={appliedByGroup}
              orgTags={orgTags}
              selectedTags={selectedTags}
              readOnly={effectiveReadOnly}
              onToggle={toggleTag}
              onRemove={removeTag}
            />

            {(!isOutbound || isInitiative) && (
              <CourierLinksCard
                courierId={courier.id}
                organizationId={organizationId}
                readOnly={effectiveReadOnly}
                initiative={isInitiative ? { chrono: courier.chrono ?? null, subject: courier.subject ?? null } : null}
              />
            )}

            <WorkspaceInfoCard
              courier={courier}
              isOutbound={isOutbound}
              isInitiative={isInitiative}
              readOnly={effectiveReadOnly}
              persistCourierUpdate={persistCourierUpdate}
            />
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
