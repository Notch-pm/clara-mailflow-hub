import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRightLeft,
  Check,
  ChevronDown,
  ExternalLink,
  FileText,
  Maximize2,
  Paperclip,
  Plus,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { cn } from "@/lib/utils";
import { readableTextColor } from "@/lib/tag-color";
import { categoryTone } from "@/lib/workflow-category";
import { SOCLE_CONTACT_TYPE_LABELS } from "@/services/socleContactService";
import { QuartierBadge } from "@/components/contacts/QuartierBadge";
import ContactPicker from "./ContactPicker";
import CourierNotes from "./CourierNotes";
import DocumentManager from "./DocumentManager";
import DocumentViewer from "./DocumentViewer";
import InlineEditField from "./InlineEditField";
import LinkedCouriersSection from "./LinkedCouriersSection";
import CloseLinkedCouriersDialog from "./CloseLinkedCouriersDialog";
import {
  channelLabels,
  useCourierWorkspace,
  type WorkspaceCourier,
} from "@/hooks/useCourierWorkspace";
import type { CourierChannel } from "@/types/courier";

interface Props {
  courier: WorkspaceCourier | null;
  organizationId: string;
  /** Appelé quand le courrier quitte la boîte (transfert) : la sélection tombe. */
  onClose: () => void;
  /** When true, the panel is fully read-only: no edits, no transitions, no uploads, no notes. */
  readOnly?: boolean;
  /** When provided, displays a delete button in the header. */
  onDelete?: (courier: WorkspaceCourier) => void;
}

/** Cellule libellé + valeur de la grille d'identité. */
function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="mb-1 text-xs font-semibold text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

/**
 * Bandeau repliable du panneau. Le tri se fait sur l'identité du courrier et
 * son aperçu : tout le reste s'ouvre à la demande, sinon le panneau devient
 * plus haut que l'écran et la liste se retrouve seule à gauche.
 */
function Band({
  icon: Icon,
  title,
  hint,
  children,
}: {
  icon: typeof FileText;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="border-t">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-5 py-3.5 text-left transition-colors hover:bg-muted/60"
      >
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold">{title}</span>
          {hint && <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>}
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && <div className="px-5 pb-5">{children}</div>}
    </section>
  );
}

const EMPTY = <span className="font-normal italic text-muted-foreground">—</span>;

/**
 * Panneau de tri de la boîte aux lettres : le courrier sélectionné s'affiche à
 * côté de la liste — on le qualifie (expéditeur, tags, organisation
 * gestionnaire), on tranche ses rapprochements, puis on le passe en
 * instruction. L'écran d'instruction lui-même vit dans `CourierWorkspacePage`.
 */
export default function MailboxSidePanel({
  courier,
  organizationId,
  onClose,
  readOnly = false,
  onDelete,
}: Props) {
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
  } = useCourierWorkspace({
    courier,
    organizationId,
    open: !!courier,
    readOnly,
    onOpenChange: (next) => {
      if (!next) onClose();
    },
  });

  if (!courier) {
    return (
      <Card className="p-8 text-center shadow-airbnb-sm">
        <p className="text-sm text-muted-foreground">
          Sélectionnez un courrier dans la liste pour l'afficher ici.
        </p>
      </Card>
    );
  }

  const tone = categoryTone(currentStateInfo?.category);
  const nextTransition = transitions?.find((t) => (t as any).kind === "next");
  const otherTransitions = (transitions ?? []).filter((t) => t.id !== nextTransition?.id);
  const receivedAt = courier.received_at
    ? new Date(courier.received_at).toLocaleDateString("fr-FR")
    : null;
  const subtitle = [
    channelLabels[courier.channel],
    receivedAt ? `reçu le ${receivedAt}` : null,
    localAssignedService,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <Card className="overflow-hidden p-0 shadow-airbnb">
        <div className="border-b p-5">
          <div className="mb-2 flex items-center gap-2">
            {currentStateInfo?.name && (
              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold",
                  tone.pill,
                )}
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", tone.dot)} />
                {currentStateInfo.name}
              </span>
            )}
            {courier.chrono && (
              <span className="font-mono text-xs text-muted-foreground">{courier.chrono}</span>
            )}
            <div className="flex-1" />
            <Button
              size="icon"
              variant="outline"
              className="h-8 w-8 text-muted-foreground"
              onClick={() => navigate(`/courrier/${courier.id}`)}
              title="Ouvrir en plein écran"
              aria-label="Ouvrir en plein écran"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
          </div>

          <h2 className="text-lg font-bold leading-snug">
            <InlineEditField
              label=""
              value={courier.subject ?? ""}
              placeholder="Titre du courrier"
              emptyDisplay="Sans titre"
              maxLength={255}
              // Voir CourierWorkspacePage : `line-clamp` ampute la largeur
              // intrinsèque du titre, `max-w-full` l'empêche de tenir sa ligne.
              displayClassName="max-w-none text-lg font-bold leading-snug [&>span]:line-clamp-none [&>span]:whitespace-normal"
              editClassName="text-lg font-bold leading-snug"
              readOnly={effectiveReadOnly}
              multiline
              onSave={(v) => persistCourierUpdate({ subject: v.trim() || null }, "Titre modifié")}
            />
          </h2>
          <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>

          {!effectiveReadOnly && (
            <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
              {nextTransition ? (
                <Button
                  className="h-10 flex-1 gap-2 font-bold"
                  disabled={transitionMutation.isPending}
                  onClick={() => transitionMutation.mutate(nextTransition.to_state.id)}
                >
                  <FileText className="h-4 w-4" />
                  {nextTransition.name ?? nextTransition.to_state?.name ?? "Instruire"}
                </Button>
              ) : (
                <Button
                  className="h-10 flex-1 gap-2 font-bold"
                  disabled
                  title="Affectez d'abord une organisation gestionnaire"
                >
                  <FileText className="h-4 w-4" />
                  Instruire
                </Button>
              )}
              {otherTransitions.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      className="h-10 gap-1.5"
                      disabled={transitionMutation.isPending}
                    >
                      Autres actions
                      <ChevronDown className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {otherTransitions.map((t) => (
                      <DropdownMenuItem
                        key={t.id}
                        onClick={() => transitionMutation.mutate(t.to_state.id)}
                      >
                        <span className="flex items-center gap-2">
                          <span
                            className={cn(
                              "h-2 w-2 rounded-full",
                              categoryTone(t.to_state?.category).dot,
                            )}
                          />
                          {t.name ?? t.to_state?.name ?? "Transition"}
                        </span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {onDelete && (
                <Button
                  size="icon"
                  variant="outline"
                  className="h-10 w-10 text-muted-foreground hover:border-destructive/35 hover:bg-destructive/5 hover:text-destructive"
                  onClick={() => onDelete(courier)}
                  title="Supprimer le courrier"
                  aria-label="Supprimer le courrier"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-x-[18px] gap-y-3.5 border-b p-5">
          <Field label={isOutbound ? "Date d'envoi" : "Date de réception"}>
            <InlineEditField
              label=""
              type="date"
              value={
                isOutbound
                  ? ((courier.sent_at as string | null) ?? "").slice(0, 10)
                  : (courier.received_at ?? "").slice(0, 10)
              }
              readOnly={effectiveReadOnly}
              displayClassName="text-sm font-semibold"
              onSave={(v) =>
                persistCourierUpdate(
                  isOutbound
                    ? { sent_at: v ? new Date(v).toISOString() : null }
                    : { received_at: v ? new Date(v).toISOString() : null },
                  "Date modifiée",
                )
              }
              renderDisplay={(v) => new Date(v).toLocaleDateString("fr-FR")}
            />
          </Field>

          <Field label="Canal">
            {effectiveReadOnly ? (
              <span className="text-sm font-semibold">{channelLabels[courier.channel]}</span>
            ) : (
              <Select
                value={courier.channel}
                onValueChange={(v) => persistCourierUpdate({ channel: v }, "Canal modifié")}
              >
                <SelectTrigger className="-ml-2 h-7 w-auto gap-1.5 border-0 bg-transparent px-2 text-sm font-semibold shadow-none hover:bg-muted">
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

          <Field label="Expéditeur">
            <div className="flex min-w-0 items-center gap-1">
              <div className="min-w-0 flex-1">
                {/* L'identité vient du référentiel : on choisit une fiche,
                    on ne saisit plus le nom à la main. */}
                <ContactPicker
                  organizationId={organizationId}
                  value={senderContact ?? null}
                  onChange={linkSenderContact}
                  disabled={effectiveReadOnly}
                  fallbackLabel={sender?.name ?? undefined}
                  triggerClassName="-ml-2 h-7 border-0 bg-transparent px-2 shadow-none hover:bg-muted hover:shadow-none [&>span]:font-semibold"
                  showTypeBadge={false}
                />
              </div>
              {sender?.socle_contact_id && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link
                      to={`/contacts/${sender.socle_contact_id}`}
                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-primary"
                      aria-label="Voir la fiche contact et ses courriers"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent>Voir la fiche contact et ses courriers</TooltipContent>
                </Tooltip>
              )}
            </div>
            {/* Le nom tient la première ligne ; le type et le quartier, qui ne
                servent qu'à situer l'expéditeur, se rangent dessous. Le type
                reste du texte (deux cartouches côte à côte se disputeraient
                l'œil), le quartier garde la sienne, couleur du référentiel. */}
            {senderContact && (
              <div className="flex min-w-0 flex-wrap items-center gap-1.5 pt-0.5">
                {/* `pr-0.5` : l'encre de l'italique depasse la chasse du
                    dernier caractere (1,6 px pour « Personne »), que
                    `truncate` — donc `overflow: hidden` — rognait. */}
                <span className="truncate pr-0.5 text-xs italic text-muted-foreground">
                  {SOCLE_CONTACT_TYPE_LABELS[senderContact.contact_type]}
                </span>
                {senderContact.quartier && (
                  <>
                    <span className="text-xs text-muted-foreground">-</span>
                    <QuartierBadge quartier={senderContact.quartier} />
                  </>
                )}
              </div>
            )}
            {senderRelationLines.map((line) => (
              <div key={line.key} className="truncate text-xs text-muted-foreground">
                {line.text}
              </div>
            ))}
          </Field>

          <Field label="Destinataire">
            <InlineEditField
              label=""
              value={recipient?.name ?? ""}
              placeholder="Nom du destinataire"
              maxLength={150}
              readOnly={effectiveReadOnly}
              displayClassName="text-sm font-semibold"
              onSave={(v) => upsertParticipant("recipient", { name: v.trim() || null })}
            />
          </Field>

          {/* L'organisation tient la ligne entiere : theme et sentiment se
              rangent dessous, cote a cote, au lieu d'etre separes par le
              retour a la ligne de la grille. */}
          <Field label="Organisation gestionnaire" className="col-span-full">
            {effectiveReadOnly ? (
              <span className="text-sm font-semibold">{localAssignedService ?? EMPTY}</span>
            ) : (
              <Popover open={servicePopoverOpen} onOpenChange={setServicePopoverOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="-ml-2 flex min-w-0 items-center gap-1.5 rounded px-2 py-0.5 text-sm font-semibold transition-colors hover:bg-muted"
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
                    <ArrowRightLeft className="h-3 w-3 shrink-0 text-muted-foreground" />
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
          </Field>

          {TAG_GROUPS.map((group) => {
            const applied = appliedByGroup[group.value];
            const available = (orgTags ?? []).filter((t) => t.tag_group === group.value);
            return (
              <Field key={group.value} label={group.label}>
                <div className="flex flex-wrap items-center gap-1.5">
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
                  {effectiveReadOnly ? (
                    applied.length === 0 && (
                      <span className="text-xs italic text-muted-foreground">Aucun</span>
                    )
                  ) : (
                    <Popover
                      open={tagPopoverGroup === group.value}
                      onOpenChange={(o) => setTagPopoverGroup(o ? group.value : null)}
                    >
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex h-[26px] items-center gap-1.5 rounded-full border border-dashed px-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                          aria-label={`Gérer les tags — ${group.label}`}
                        >
                          <Plus className="h-3 w-3" />
                          Ajouter
                        </button>
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
              </Field>
            );
          })}
        </div>

        <LinkedCouriersSection
          courierId={courier.id}
          organizationId={organizationId}
          readOnly={effectiveReadOnly}
          embedded
        />

        <div className="p-5">
          <div className="mb-2.5 flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-base font-semibold leading-tight">Aperçu</h3>
            <div className="flex-1" />
            <span className="text-xs text-muted-foreground">
              {displayDocuments.length} document{displayDocuments.length > 1 ? "s" : ""}
            </span>
          </div>
          {displayDocuments.length === 0 ? (
            <p className="rounded-md bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
              Aucun document à prévisualiser.
            </p>
          ) : (
            <div className="h-[320px]">
              <DocumentViewer
                documents={displayDocuments as any}
                currentId={selectedDocId}
                onChange={setSelectedDocId}
                organizationId={organizationId}
              />
            </div>
          )}
        </div>

        <Band icon={Paperclip} title="Documents" hint="Ajouter ou retirer une pièce">
          <DocumentManager
            courierId={courier.id}
            organizationId={organizationId}
            selectedDocId={selectedDocId}
            onSelectDoc={setSelectedDocId}
            readOnly={effectiveReadOnly}
            ignoredAttachments={
              (courier.metadata?.ignored_attachments as { name: string; size: number }[] | undefined) ??
              []
            }
          />
        </Band>

        <Band icon={StickyNote} title="Notes internes" hint="Visibles des seuls agents">
          <CourierNotes
            courierId={courier.id}
            organizationId={organizationId}
            readOnly={effectiveReadOnly || isFinalState}
          />
        </Band>
      </Card>

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
              <strong>{services?.find((o) => o.id === transferTargetServiceId)?.name ?? ""}</strong>.
              Elle sera alors remise à l'état initial. En fonction de la configuration des droits,
              elle pourrait vous être rendue inaccessible.
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
    </>
  );
}
