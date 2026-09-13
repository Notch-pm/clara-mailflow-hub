import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRightLeft,
  Check,
  ChevronDown,
  ExternalLink,
  Tag as TagIcon,
  X,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { cn } from "@/lib/utils";
import { readableTextColor } from "@/lib/tag-color";
import { categoryTone } from "@/lib/workflow-category";
import { QuartierBadge } from "@/components/contacts/QuartierBadge";
import AdvanceBlockedButton from "./AdvanceBlockedButton";
import { advanceBlockedReason } from "./advance-blocked-reason";
import ContactPicker from "./ContactPicker";
import ContentIntentsTab from "./ContentIntentsTab";
import CourierHistoryTab from "./CourierHistoryTab";
import CourierLinksTab from "./CourierLinksTab";
import DocumentManager from "./DocumentManager";
import DocumentViewer from "./DocumentViewer";
import FloatingNotesPanel from "./FloatingNotesPanel";
import InlineEditField from "./InlineEditField";
import LinkedActionsTab from "./LinkedActionsTab";
import ParticipantManager from "./ParticipantManager";
import ReplyComposer from "./ReplyComposer";
import LinkedCouriersSection from "./LinkedCouriersSection";
import CloseLinkedCouriersDialog from "./CloseLinkedCouriersDialog";
import {
  channelLabels,
  useCourierWorkspace,
  type WorkspaceCourier,
} from "@/hooks/useCourierWorkspace";
import type { CourierChannel } from "@/types/courier";

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
      return { label: "Boîte aux lettres", href: "/boite-aux-lettres" };
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

/** Carte de contenu : titre à gauche, actions à droite, corps en dessous. */
function Section({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("p-6 shadow-airbnb-sm", className)}>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold leading-tight">{title}</h2>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        <div className="flex-1" />
        {action}
      </div>
      {children}
    </Card>
  );
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
      <div className="mb-3.5 flex items-center gap-2">
        <h3 className="text-base font-semibold leading-tight">{title}</h3>
        <div className="flex-1" />
        {action}
      </div>
      {children}
    </Card>
  );
}

/** Champ en lecture/écriture de la grille « Informations du courrier ». */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 border-b border-border pb-2.5">
      <div className="mb-1 text-xs font-semibold text-muted-foreground">{label}</div>
      <div className="text-base font-semibold [overflow-wrap:anywhere]">{children}</div>
    </div>
  );
}

const EMPTY = <span className="font-normal italic text-muted-foreground">—</span>;

/**
 * Écran d'instruction d'un courrier (`/courrier/:id`) : en-tête d'identité,
 * onglets de travail et colonne latérale de contexte. Le tri amont, lui, se
 * fait dans le panneau de la boîte aux lettres.
 */
export default function CourierWorkspacePage({ courier, organizationId, onClose }: Props) {
  const [tagPopoverGroup, setTagPopoverGroup] = useState<TagGroup | null>(null);
  const [servicePopoverOpen, setServicePopoverOpen] = useState(false);
  const [rail, setRail] = useState<"courrier" | "workflow">("courrier");

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
    relationsList,
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
    upsertParticipant,
    linkSenderContact,
  } = ws;

  // Le défilement vit désormais DANS la colonne de travail : sans ce recalage,
  // l'onglet ouvert hériterait de la hauteur où l'on avait laissé le précédent
  // et s'afficherait en plein milieu de son contenu.
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (panelRef.current) panelRef.current.scrollTop = 0;
  }, [activeTab]);

  // Frise d'avancement : la chaîne nominale du workflow de l'organisation gestionnaire.
  const { data: stateChain = [] } = useQuery({
    queryKey: ["workflow-state-chain", currentService?.workflow_id],
    queryFn: () => getWorkflowStateChain(currentService!.workflow_id!),
    enabled: !!currentService?.workflow_id,
  });

  const tabItems: ResponsiveTabItem[] = useMemo(() => {
    const items: ResponsiveTabItem[] = [{ value: "detail", label: "Détail du courrier" }];
    if (!isOutbound) {
      items.push({ value: "content", label: "Contenu et intentions" });
      items.push({ value: "actions", label: "Actions liées", count: ticketsList.length });
      items.push({
        value: "response",
        label: replyList.length > 1 ? "Réponses" : "Réponse",
        count: replyList.length,
        badge: replyState ? (
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-none",
              categoryTone(replyState.category).pill,
            )}
          >
            {replyState.name}
          </span>
        ) : null,
      });
    }
    items.push({ value: "participants", label: "Participants", count: participants.length });
    if (!isOutbound) {
      items.push({ value: "links", label: "Liens", count: relationsList.length });
    }
    items.push({ value: "history", label: "Historique" });
    return items;
  }, [isOutbound, ticketsList.length, replyList.length, replyState, participants.length, relationsList.length]);

  const origin = originList(currentStateInfo?.category, isOutbound);
  const tone = categoryTone(currentStateInfo?.category);
  const senderLabel = isOutbound
    ? parentCourier?.assigned_service ?? null
    : sender?.name ?? null;
  const dateLabel = isOutbound
    ? formatLongDate(courier.sent_at as string | null)
    : formatLongDate(courier.received_at);

  // Sous-titre d'en-tête : qui, comment, pour qui — la phrase d'identité du courrier.
  const subtitle = [
    senderLabel,
    dateLabel
      ? `${isOutbound ? "envoyé" : `reçu par ${channelLabels[courier.channel].toLowerCase()}`} le ${dateLabel}`
      : null,
    localAssignedService ? `organisation gestionnaire ${localAssignedService}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const nextTransition = transitions?.find((t) => (t as any).kind === "next");
  const prevTransition = transitions?.find((t) => (t as any).kind === "previous");
  const otherTransitions = (transitions ?? []).filter(
    (t) => t.id !== nextTransition?.id && t.id !== prevTransition?.id,
  );

  // Position dans la frise. -1 : l'état courant a été atteint par une transition
  // secondaire, il ne figure pas dans la chaîne nominale.
  const chainIndex = stateChain.findIndex((s) => s.id === localWorkflowStateId);

  const segmentClass = (on: boolean) =>
    cn(
      "flex-1 rounded-full px-3 py-1.5 text-sm font-bold transition-colors",
      on ? "bg-card text-foreground shadow-airbnb-sm" : "text-muted-foreground hover:text-foreground",
    );

  // La hauteur vient du conteneur, pas de `100dvh` : l'en-tête et les onglets
  // restent en place, et seules les deux colonnes défilent, chacune pour son
  // compte.
  return (
    <div className="flex w-full flex-col lg:h-full">
      <nav
        aria-label="Fil d'Ariane"
        className="mb-2.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground lg:shrink-0"
      >
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

      <div className="mb-4 flex flex-wrap items-start gap-4 lg:shrink-0">
        <div className="min-w-0 flex-1 basis-[420px]">
          <div className="flex flex-wrap items-center gap-3">
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
            {currentStateInfo?.name && (
              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1 text-sm font-semibold",
                  tone.pill,
                )}
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", tone.dot)} />
                {currentStateInfo.name}
              </span>
            )}
          </div>
          {subtitle && <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>}
        </div>

        {/* Sous sm les actions s'empilent sur toute la largeur. `shrink-0` sur
            la rangee et `whitespace-nowrap` sur les boutons rendaient un
            libelle de transition long — « Transmettre au service instructeur »
            — irreductible : la page entiere s'elargissait derriere lui. */}
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
          {!effectiveReadOnly && otherTransitions.length > 0 && (
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
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-5 lg:min-h-0 lg:flex-1 lg:flex-nowrap lg:items-stretch">
        {/* Les onglets ne coiffent que la colonne de travail : la colonne de
            contexte, à droite, leur est étrangère et défile pour son compte. */}
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex min-w-0 flex-1 basis-[560px] flex-col lg:min-h-0"
        >
          <ResponsiveTabsList
            activeValue={activeTab}
            onValueChange={setActiveTab}
            tabs={tabItems}
            className="mb-5 shrink-0"
          />

          <div ref={panelRef} className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pb-2">
            <TabsContent value="detail" className="mt-0 flex flex-col gap-5 focus-visible:outline-none">
              {!isOutbound && isInitialState && (
                <LinkedCouriersSection
                  courierId={courier.id}
                  organizationId={organizationId}
                  disabled={effectiveReadOnly}
                  // Les liens déjà posés ont leur onglet « Liens » : ici on ne
                  // sert que les suggestions restées à trancher.
                  showRelations={false}
                />
              )}

              <Section
                title="Informations du courrier"
                action={
                  <span className="rounded-md border px-2.5 py-1 font-mono text-xs text-muted-foreground">
                    {isOutbound ? "sortant" : channelLabels[courier.channel].toLowerCase()}
                  </span>
                }
              >
                <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-x-6 gap-y-5">
                  <Field label="Référence">
                    <span className="font-mono text-sm">{courier.chrono ?? EMPTY}</span>
                  </Field>
                  <Field label={isOutbound ? "Date d'envoi" : "Date de réception"}>
                    <InlineEditField
                      label=""
                      type="date"
                      value={
                        isOutbound
                          ? (courier.sent_at as string | null)?.slice(0, 10) ?? ""
                          : courier.received_at?.slice(0, 10) ?? ""
                      }
                      readOnly={effectiveReadOnly}
                      displayClassName="text-base font-semibold"
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
                  </Field>
                  {!isOutbound && (
                    <Field label="Canal">
                      {effectiveReadOnly ? (
                        channelLabels[courier.channel]
                      ) : (
                        <Select
                          value={courier.channel}
                          onValueChange={(v) => persistCourierUpdate({ channel: v }, "Canal modifié")}
                        >
                          <SelectTrigger className="-ml-2 h-8 w-auto gap-1.5 border-0 bg-transparent px-2 text-base font-semibold shadow-none hover:bg-muted">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent align="start">
                            {(Object.keys(channelLabels) as CourierChannel[]).map((c) => (
                              <SelectItem key={c} value={c}>
                                {channelLabels[c]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </Field>
                  )}
                  <Field label="Destinataire">
                    {isOutbound ? (
                      parentSender?.name ?? EMPTY
                    ) : (
                      <InlineEditField
                        label=""
                        value={recipient?.name ?? ""}
                        placeholder="Nom du destinataire"
                        maxLength={150}
                        readOnly={effectiveReadOnly}
                        displayClassName="text-base font-semibold"
                        onSave={(v) => upsertParticipant("recipient", { name: v.trim() || null })}
                      />
                    )}
                  </Field>
                  {courier.socle_organization?.name && (
                    <Field label="Organisation d'origine">{courier.socle_organization.name}</Field>
                  )}
                  {isOutbound && courier.parent_courier_id && (
                    <Field label="Courrier lié">
                      <Link
                        to={`/courrier/${courier.parent_courier_id}`}
                        className="inline-flex items-center gap-1.5 text-primary hover:underline"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Voir le courrier entrant
                      </Link>
                    </Field>
                  )}
                </div>
              </Section>

              <Section title="Aperçu du document">
                <div className="h-[60vh] min-h-[400px]">
                  <DocumentViewer
                    documents={displayDocuments as any}
                    currentId={selectedDocId}
                    onChange={setSelectedDocId}
                    organizationId={organizationId}
                  />
                </div>
              </Section>

              <Section title="Documents">
                <DocumentManager
                  courierId={courier.id}
                  organizationId={organizationId}
                  selectedDocId={selectedDocId}
                  onSelectDoc={setSelectedDocId}
                  readOnly={effectiveReadOnly}
                  ignoredAttachments={
                    (courier.metadata?.ignored_attachments as { name: string; size: number }[] | undefined) ?? []
                  }
                />
              </Section>
            </TabsContent>

            {!isOutbound && (
              <TabsContent value="content" className="mt-0 focus-visible:outline-none">
                <ContentIntentsTab
                  courierId={courier.id}
                  organizationId={organizationId}
                  readOnly={effectiveReadOnly || isFinalState}
                  isInitialState={isInitialState}
                />
              </TabsContent>
            )}

            {!isOutbound && (
              <TabsContent value="actions" className="mt-0 focus-visible:outline-none">
                <LinkedActionsTab
                  courierId={courier.id}
                  organizationId={organizationId}
                  courierSocleOrganizationId={localSocleOrgId}
                  readOnly={effectiveReadOnly || isFinalState}
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
                    assignedService={localAssignedService}
                    socleOrganizationId={localSocleOrgId}
                    sender={sender ?? null}
                    senderReplyEmail={senderReplyEmail}
                    readOnly={effectiveReadOnly}
                    onStateChange={setReplyState}
                    initialReplyId={initialReplyIdParam}
                    initialOpenEditor={initialEditParam}
                  />
                </Card>
              </TabsContent>
            )}

            <TabsContent value="participants" className="mt-0 focus-visible:outline-none">
              <Card className="p-6 shadow-airbnb-sm">
                <ParticipantManager
                  courierId={courier.id}
                  organizationId={organizationId}
                  readOnly={effectiveReadOnly}
                />
              </Card>
            </TabsContent>

            {!isOutbound && (
              <TabsContent value="links" className="mt-0 focus-visible:outline-none">
                <Card className="p-6 shadow-airbnb-sm">
                  <CourierLinksTab
                    courierId={courier.id}
                    organizationId={organizationId}
                    readOnly={effectiveReadOnly}
                  />
                </Card>
              </TabsContent>
            )}

            <TabsContent value="history" className="mt-0 focus-visible:outline-none">
              <Card className="p-6 shadow-airbnb-sm">
                <CourierHistoryTab courierId={courier.id} organizationId={organizationId} />
              </Card>
            </TabsContent>
          </div>
        </Tabs>

        {/* La borne de hauteur vient du conteneur, pas de `100dvh` : ce gabarit
            retranchait l'en-tête mais pas le pied de page, et le bas de la
            colonne tombait hors d'atteinte du défilement. */}
        <aside
          className="flex w-full min-w-0 flex-1 basis-[340px] flex-col gap-4 lg:min-h-0 lg:max-w-[400px] lg:overflow-y-auto lg:pb-2"
          aria-label="Contexte du courrier"
        >
          <div className="flex rounded-full bg-muted p-1" role="tablist" aria-label="Contexte affiché">
            <button
              type="button"
              role="tab"
              aria-selected={rail === "courrier"}
              className={segmentClass(rail === "courrier")}
              onClick={() => setRail("courrier")}
            >
              Courrier
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={rail === "workflow"}
              className={segmentClass(rail === "workflow")}
              onClick={() => setRail("workflow")}
            >
              Workflow
            </button>
          </div>

          {rail === "courrier" ? (
            <>
              <RailCard
                title="Expéditeur"
                action={
                  sender?.socle_contact_id ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Link
                          to={`/contacts/${sender.socle_contact_id}`}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-muted hover:text-primary"
                          aria-label="Voir la fiche contact et ses courriers"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Link>
                      </TooltipTrigger>
                      <TooltipContent>Voir la fiche contact et ses courriers</TooltipContent>
                    </Tooltip>
                  ) : null
                }
              >
                {isOutbound ? (
                  <div className="text-sm font-semibold">
                    {parentCourier?.assigned_service ?? EMPTY}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {/* L'identité vient du référentiel : on choisit une fiche,
                        on ne saisit plus le nom à la main. */}
                    <ContactPicker
                      organizationId={organizationId}
                      value={senderContact ?? null}
                      onChange={linkSenderContact}
                      disabled={effectiveReadOnly}
                      fallbackLabel={sender?.name ?? undefined}
                      triggerClassName="h-9 w-full justify-between px-2.5 [&>span]:font-semibold"
                    />
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

                {/* L'organisation gestionnaire a sa propre carte juste dessous,
                    d'où on la change : la répéter ici en lecture seule ferait
                    deux fois la même ligne. */}
                <dl className="mt-3.5 space-y-2 border-t pt-3">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <dt className="text-muted-foreground">Participants</dt>
                    <dd className="font-semibold">{participants.length}</dd>
                  </div>
                </dl>
              </RailCard>

              <RailCard title="Organisation gestionnaire">
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
                    </PopoverContent>
                  </Popover>
                )}
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
            </>
          ) : (
            <>
              <RailCard
                title="Avancement"
                action={
                  <span className="font-mono text-xs text-muted-foreground">
                    {courier.chrono ?? ""}
                  </span>
                }
              >
                {stateChain.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Aucun workflow n'est rattaché à l'organisation gestionnaire.
                  </p>
                ) : (
                  <ol className="flex flex-col">
                    {chainIndex === -1 && currentStateInfo?.name && (
                      <li className="mb-3 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                        État courant «&nbsp;{currentStateInfo.name}&nbsp;» : atteint par une transition
                        secondaire, hors de la suite nominale ci-dessous.
                      </li>
                    )}
                    {stateChain.map((state, i) => {
                      const done = chainIndex >= 0 && i < chainIndex;
                      const current = i === chainIndex;
                      const reached = done || current;
                      return (
                        <li key={state.id} className="flex gap-3">
                          <div className="flex flex-[0_0_14px] flex-col items-center">
                            <span
                              className={cn(
                                "rounded-full",
                                current ? "mt-[3px] h-3.5 w-3.5 ring-4 ring-primary/15" : "mt-[5px] h-2.5 w-2.5",
                                reached ? "bg-primary" : "bg-border",
                              )}
                            />
                            {i < stateChain.length - 1 && (
                              <span
                                className={cn(
                                  "my-1 w-0.5 flex-1",
                                  done ? "bg-primary/35" : "bg-border",
                                )}
                              />
                            )}
                          </div>
                          <div className="min-w-0 pb-3.5">
                            <div
                              className={cn(
                                "text-sm",
                                current ? "font-bold" : "font-semibold",
                                reached ? "text-foreground" : "text-muted-foreground",
                              )}
                            >
                              {state.name}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {state.is_initial
                                ? "état initial"
                                : state.is_final
                                ? "état final"
                                : current
                                ? "étape en cours"
                                : done
                                ? "étape franchie"
                                : "à venir"}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </RailCard>
            </>
          )}
        </aside>
      </div>

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

      <CloseLinkedCouriersDialog
        open={closeLinkedOpen}
        onOpenChange={setCloseLinkedOpen}
        organizationId={organizationId}
        linkedCourierIds={closeLinkedIds}
        sourceTitle={courier.subject ?? courier.chrono ?? "ce courrier"}
      />

      {!isOutbound && (
        <FloatingNotesPanel
          courierId={courier.id}
          organizationId={organizationId}
          notes={notesList}
          readOnly={effectiveReadOnly || isFinalState}
        />
      )}
    </div>
  );
}
