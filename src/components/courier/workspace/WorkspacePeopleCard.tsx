import { Link } from "react-router-dom";
import { ArrowRightLeft, ExternalLink, Lock, Undo2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { assignableOrgs } from "@/services/socleOrgConfigService";
import { cn } from "@/lib/utils";
import { initialsOf } from "@/lib/courier-workspace";
import { CONTACT_CATEGORIES } from "@/lib/contact-categories";
import { isOutboundSettled } from "@/lib/outbound-kind";
import { QuartierBadge } from "@/components/contacts/QuartierBadge";
import { ContactCategoryBadges } from "@/components/contacts/ContactCategoryBadge";
import { ConfidentialToggle } from "@/components/courier/ConfidentialToggle";
import type { useCourierWorkspace, WorkspaceCourier } from "@/hooks/useCourierWorkspace";
import ContactPicker from "../ContactPicker";
import RecipientField from "../RecipientField";
import { EmptyValue, RailCard, RailField } from "./RailParts";

type Workspace = ReturnType<typeof useCourierWorkspace>;

interface Props {
  ws: Workspace;
  courier: WorkspaceCourier;
  organizationId: string;
  isInitiative: boolean;
  /** Organisation émettrice d'un sortant. */
  issuerName: string | null;
  servicePopoverOpen: boolean;
  onServicePopoverOpenChange: (open: boolean) => void;
  onReturnToMailroom: () => void;
  onManageParticipants: () => void;
}

/** Carte « Personnes » : expéditeur, destinataire, organisation gestionnaire, participants, confidentialité. */
export function WorkspacePeopleCard({
  ws,
  courier,
  organizationId,
  isInitiative,
  issuerName,
  servicePopoverOpen,
  onServicePopoverOpenChange,
  onReturnToMailroom,
  onManageParticipants,
}: Props) {
  const {
    effectiveReadOnly,
    isOutbound,
    participants,
    sender,
    senderContact,
    senderRelationLines,
    recipient,
    parentSender,
    recipientContact,
    services,
    availableServices,
    currentService,
    localAssignedService,
    isInitialState,
    serviceMutation,
    transferMutation,
    canReturnToMailroom,
    setTransferTargetServiceId,
    setTransferConfirmOpen,
    linkSenderContact,
    linkInternalContact,
    setRecipientName,
  } = ws;
  const isConfidential = !!courier.is_confidential;

  return (
    <RailCard title="Personnes">
      <div className="flex flex-col gap-3.5">
        <RailField label={isOutbound ? "Émetteur" : "Expéditeur"}>
          {isOutbound ? (
            <div className="space-y-1.5">
              <div className="text-base font-semibold">{issuerName ?? <EmptyValue />}</div>
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
              {(isInitiative ? recipient?.name : parentSender?.name) ?? <EmptyValue />}
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
            <div className="text-sm font-semibold">{localAssignedService ?? <EmptyValue />}</div>
          ) : (
            <Popover open={servicePopoverOpen} onOpenChange={onServicePopoverOpenChange}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="flex h-11 w-full items-center justify-between gap-2 rounded-md border px-3 text-left text-sm font-semibold transition-shadow hover:shadow-airbnb-sm"
                  title={isInitialState ? "Affecter à une organisation" : "Transférer à une autre organisation"}
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
                        onServicePopoverOpenChange(false);
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
                              <span className="ml-2 text-xs text-muted-foreground">— {s.workflow.name}</span>
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
                        onServicePopoverOpenChange(false);
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
                      onServicePopoverOpenChange(false);
                      onReturnToMailroom();
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
            onClick={onManageParticipants}
            className="text-sm font-semibold text-primary hover:underline"
          >
            {effectiveReadOnly ? "Voir" : "Gérer"}
          </button>
        </div>

        <div
          className={cn("flex items-start gap-2.5 rounded-lg p-3", isConfidential ? "bg-foreground/5" : "bg-muted/60")}
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
  );
}
