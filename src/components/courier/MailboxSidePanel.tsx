import { useState } from "react";
import { X, ArrowLeft, ArrowRightLeft, Tag as TagIcon, Check, FileText, Trash2, ExternalLink, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Link, useNavigate } from "react-router-dom";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
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
import { TAG_GROUPS, type TagGroup } from "@/services/courierTagService";
import { assignableOrgs } from "@/services/socleOrgConfigService";
import { cn } from "@/lib/utils";
import { readableTextColor } from "@/lib/tag-color";
import { categoryTone } from "@/lib/workflow-category";
import DocumentManager from "./DocumentManager";
import DocumentViewer from "./DocumentViewer";
import InlineEditField from "./InlineEditField";
import ContactPicker from "./ContactPicker";
import { QuartierBadge } from "@/components/contacts/QuartierBadge";
import CourierNotes from "./CourierNotes";
import SimilarCouriersAlert from "./SimilarCouriersAlert";
import CloseLinkedCouriersDialog from "./CloseLinkedCouriersDialog";
import {
  channelLabels,
  useCourierWorkspace,
  type WorkspaceCourier,
} from "@/hooks/useCourierWorkspace";
import type { CourierChannel } from "@/types/courier";

interface Props {
  courier: WorkspaceCourier | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  /** When true, the panel is fully read-only: no edits, no transitions, no uploads, no notes. */
  readOnly?: boolean;
  /** When provided, displays a delete button in the header. */
  onDelete?: (courier: WorkspaceCourier) => void;
}

/**
 * Panneau de tri de la boîte aux lettres : on qualifie le courrier (expéditeur,
 * tags, organisation gestionnaire) puis on le passe en instruction. L'écran
 * d'instruction lui-même vit dans `CourierWorkspacePage`.
 */
export default function MailboxSidePanel({ courier, open, onOpenChange, organizationId, readOnly = false, onDelete }: Props) {
  const navigate = useNavigate();
  // Un sélecteur par groupe : l'état porte le groupe ouvert, pas un booléen.
  const [tagPopoverGroup, setTagPopoverGroup] = useState<TagGroup | null>(null);
  const [servicePopoverOpen, setServicePopoverOpen] = useState(false);

  const {
    effectiveReadOnly,
    isOutbound,
    sender,
    senderContact,
    senderRelationLines,
    recipient,
    parentCourier,
    parentSender,
    selectedTags,
    orgTags,
    appliedByGroup,
    toggleTag,
    removeTag,
    services,
    availableServices,
    currentService,
    localAssignedService,
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
  } = useCourierWorkspace({ courier, organizationId, open, readOnly, onOpenChange });

  if (!courier) return null;

  const body = (
    <>
      <div className="flex flex-col text-center sm:text-left border-b shrink-0">
          <div className="flex items-center justify-between gap-4 px-4 py-3 pr-8">
            <div className="flex-1 min-w-0 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <SheetTitle className="text-lg sr-only">
                  {courier.subject ?? "Sans titre"}
                </SheetTitle>
                <InlineEditField
                  label=""
                  value={courier.subject ?? ""}
                  placeholder="Titre du courrier"
                  emptyDisplay="Sans titre"
                  maxLength={255}
                  displayClassName="max-w-full text-lg font-semibold leading-snug"
                  editClassName="text-lg md:text-lg font-semibold leading-snug"
                  readOnly={effectiveReadOnly}
                  multiline
                  onSave={(v) => persistCourierUpdate({ subject: v.trim() || null }, "Titre modifié")}
                />
              </div>
              {currentStateInfo?.name && (
                <Badge variant="secondary" className="gap-1.5 font-medium shrink-0">
                  <span className={cn("h-2 w-2 rounded-full", categoryTone(currentStateInfo.category).dot)} />
                  {currentStateInfo.name}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 justify-end shrink-0">
              {!effectiveReadOnly && transitions && transitions.length > 0 && (
                <>
                  {(() => {
                    const nextT = transitions.find((t) => (t as any).kind === "next");
                    const prevT = transitions.find((t) => (t as any).kind === "previous");
                    const nominalIds = new Set([nextT?.id, prevT?.id].filter(Boolean));
                    const others = transitions.filter((t) => !nominalIds.has(t.id));
                    const dot = (category?: string | null) => (
                      <span className={cn("h-2 w-2 shrink-0 rounded-full", categoryTone(category).dot)} />
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
              {!effectiveReadOnly && onDelete && (
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
                  readOnly={effectiveReadOnly}
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
                  readOnly={effectiveReadOnly}
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
                  {effectiveReadOnly ? (
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
              {courier.socle_organization?.name && (
                <div className="flex items-center justify-between gap-2 py-0.5">
                  <span className="text-muted-foreground text-sm shrink-0">Organisation</span>
                  <span className="text-sm font-medium px-2 truncate">
                    {courier.socle_organization.name}
                  </span>
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
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-1 min-w-0">
                      <div className="min-w-0 flex-1">
                        {/* L'identité vient du référentiel : on choisit une fiche,
                            on ne saisit plus le nom à la main. */}
                        <ContactPicker
                          organizationId={organizationId}
                          value={senderContact ?? null}
                          onChange={linkSenderContact}
                          disabled={effectiveReadOnly}
                          fallbackLabel={sender?.name ?? undefined}
                          triggerClassName="h-8 px-2 border-0 bg-transparent shadow-none hover:bg-muted hover:shadow-none [&>span]:font-semibold"
                        />
                      </div>
                      {/* Pas de onOpenChange(false) sur ce lien : sur /courrier/:id la
                          fermeture déclenche un navigate(-1) qui, résolu via popstate,
                          annulerait la navigation vers la fiche. Le changement de route
                          démonte le panneau de toute façon. */}
                      {sender?.socle_contact_id && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Link
                              to={`/contacts/${sender.socle_contact_id}`}
                              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-primary hover:bg-muted transition-colors"
                              aria-label="Voir la fiche contact et ses courriers"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </Link>
                          </TooltipTrigger>
                          <TooltipContent>Voir la fiche contact et ses courriers</TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                    {senderRelationLines.map((line) => (
                      <div key={line.key} className="text-xs text-muted-foreground truncate">
                        {line.text}
                      </div>
                    ))}
                    {/* Quartier de l'expéditeur : utile pour router le courrier
                        vers le bon secteur sans ouvrir la fiche. */}
                    {senderContact?.quartier && (
                      <div className="pt-0.5">
                        <QuartierBadge quartier={senderContact.quartier} />
                      </div>
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
                    readOnly={effectiveReadOnly}
                    onSave={(v) => upsertParticipant("recipient", { name: v.trim() || null })}
                    displayClassName="font-semibold"
                  />
                )}
              </div>
            </div>

            <Separator />

            {/* Column 3: Tags + Service gestionnaire */}
            <div className="space-y-2 min-w-0">
              {TAG_GROUPS.map((group) => {
                const applied = appliedByGroup[group.value];
                const available = (orgTags ?? []).filter((t) => t.tag_group === group.value);
                return (
                  <div key={group.value} className="space-y-1.5">
                    <span className="text-muted-foreground text-sm">{group.label}</span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {applied.length === 0 && (
                        <span className="text-xs text-muted-foreground italic">Aucun</span>
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
                              "gap-1 pl-2 pr-1 border-transparent text-xs",
                              orphan && "opacity-60 italic",
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
                );
              })}

              <div className="space-y-1">
                <span className="text-muted-foreground text-sm">Organisation gestionnaire</span>
                <div className="min-w-0">
                  {effectiveReadOnly ? (
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
                          title={isInitialState ? "Affecter à une organisation" : "Transférer à une autre organisation"}
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
                                Organisation actuelle « {courier.assigned_service} » introuvable.
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
                </div>
              </div>
            </div>
          </aside>

          <div className="flex flex-col mb-px flex-1 min-h-0 overflow-hidden relative">
            <section
              aria-label="Aperçu du courrier"
              className="h-full px-6 py-5 space-y-5 bg-muted/10 overflow-y-auto"
            >
              {!isOutbound && isInitialState && (
                <SimilarCouriersAlert
                  courierId={courier.id}
                  organizationId={organizationId}
                  disabled={effectiveReadOnly}
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
                  readOnly={effectiveReadOnly}
                  ignoredAttachments={(courier.metadata?.ignored_attachments as { name: string; size: number }[] | undefined) ?? []}
                />
              </div>

              <Separator />
              <CourierNotes
                courierId={courier.id}
                organizationId={organizationId}
                readOnly={effectiveReadOnly || isFinalState}
              />
            </section>

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
                    {services?.find((o) => o.id === transferTargetServiceId)?.name ?? ""}
                  </strong>
                  . Elle sera alors remise à l'état initial. En fonction de la configuration des droits, elle pourrait vous être rendue inaccessible.
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
            sourceTitle={courier?.subject ?? courier?.chrono ?? "ce courrier"}
          />

          </div>
        </div>
    </>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-[95vw] lg:max-w-[1100px] overflow-hidden p-0 flex flex-col">
        {body}
      </SheetContent>
    </Sheet>
  );
}
