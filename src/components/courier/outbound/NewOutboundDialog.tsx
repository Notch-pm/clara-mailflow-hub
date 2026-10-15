import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Lock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ContactPicker from "@/components/courier/ContactPicker";
import { CONTACT_CATEGORIES } from "@/lib/contact-categories";
import { assignableOrgs, type SocleOrgWithConfig } from "@/services/socleOrgConfigService";
import type { SocleContact } from "@/services/socleContactService";
import { createOutboundCourier } from "@/services/outboundCourierService";
import { defaultChannel, emailBlocker, postalBlocker, type OutboundChannel } from "@/lib/outbound-channel";
import { consentViews } from "@/lib/consents";
import { issuerBlockReason } from "../../../../supabase/functions/_shared/outboundInitiativeGuard";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { canSetConfidential } from "@/lib/permissions";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  /** Organisations du tenant (miroir Socle) avec leur configuration Clara. */
  services: SocleOrgWithConfig[] | undefined;
  /** Périmètre de l'utilisateur ; `null` : toutes (administrateur). */
  userServiceFilter: string[] | null;
}

/**
 * Créer un courrier à l'initiative de la collectivité : qui l'émet, à qui,
 * comment, à quel sujet. La rédaction vient ensuite, sur la fiche du courrier.
 */
export function NewOutboundDialog({ open, onOpenChange, organizationId, services, userServiceFilter }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Les organisations de mon périmètre ; celles qui ne peuvent pas émettre
  // restent visibles, grisées, avec la raison — sinon l'agent ne saurait pas
  // qu'il manque un réglage.
  const issuers = useMemo(
    () =>
      assignableOrgs(services ?? [])
        .filter((o) => !userServiceFilter || userServiceFilter.includes(o.id))
        .map((o) => ({ org: o, blocked: issuerBlockReason(o) })),
    [services, userServiceFilter],
  );
  const usable = issuers.filter((i) => !i.blocked);

  const [issuerId, setIssuerId] = useState<string>("");
  const [recipient, setRecipient] = useState<SocleContact | null>(null);
  // Facultatif : contact Interne ou Élu au nom de qui le courrier part.
  const [sender, setSender] = useState<SocleContact | null>(null);
  const [channel, setChannel] = useState<OutboundChannel>("paper");
  const [subject, setSubject] = useState("");
  const [confidential, setConfidential] = useState(false);
  const { profile, membership } = useAuth();
  const mayMarkConfidential = canSetConfidential(profile, membership);

  useEffect(() => {
    if (!open) return;
    setIssuerId("");
    setRecipient(null);
    setSender(null);
    setChannel("paper");
    setSubject("");
    setConfidential(false);
    // Réinitialisé à chaque ouverture seulement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Une seule organisation possible : on la choisit d'office. Effet distinct de
  // la remise à zéro — le périmètre de l'utilisateur arrive parfois après
  // l'ouverture.
  const onlyIssuerId = usable.length === 1 ? usable[0].org.id : null;
  useEffect(() => {
    if (open && !issuerId && onlyIssuerId) setIssuerId(onlyIssuerId);
  }, [open, issuerId, onlyIssuerId]);

  const noEmail = emailBlocker(recipient);
  const noAddress = recipient ? postalBlocker(recipient) : null;
  // Trois états : la date tranche, jamais le booléen seul (règle d'or n° 8).
  const traitement = recipient ? consentViews(recipient).find((v) => v.kind === "traitement") : null;
  const traitementRefused = !!traitement && !traitement.neverCollected && !traitement.granted;

  function pickRecipient(c: SocleContact | null) {
    setRecipient(c);
    if (c) setChannel(defaultChannel(c));
  }

  const create = useMutation({
    mutationFn: () =>
      createOutboundCourier({
        organizationId,
        socleOrganizationId: issuerId,
        channel,
        subject: subject.trim(),
        recipient: recipient!,
        confidential,
        sender,
      }),
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: ["couriers-outbound"] });
      toast.success("Courrier créé : rédigez-le maintenant");
      onOpenChange(false);
      navigate(`/courrier/${id}?tab=redaction`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const missing = !issuerId
    ? "Choisissez l'organisation émettrice."
    : !recipient
      ? "Choisissez le destinataire."
      : !subject.trim()
        ? "Saisissez l'objet."
        : channel === "email" && noEmail
          ? noEmail
          : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nouveau courrier sortant</DialogTitle>
          <DialogDescription>
            Le courrier suivra le circuit de réponse de l'organisation qui l'émet : rédaction, visa, signature, envoi.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="outbound-issuer">Organisation émettrice</Label>
            <Select value={issuerId} onValueChange={setIssuerId}>
              <SelectTrigger id="outbound-issuer">
                <SelectValue placeholder="Choisir l'organisation…" />
              </SelectTrigger>
              <SelectContent>
                {issuers.map(({ org, blocked }) => (
                  <SelectItem key={org.id} value={org.id} disabled={!!blocked}>
                    <span className="flex flex-col">
                      <span>{org.name}</span>
                      {blocked && <span className="text-xs text-muted-foreground">{blocked}</span>}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {issuers.length > 0 && usable.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Aucune de vos organisations n'a de workflow de réponse : un administrateur doit en rattacher un.
              </p>
            )}
            {issuers.length === 0 && (
              <p className="text-xs text-muted-foreground">Vous n'êtes membre d'aucune organisation active.</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Destinataire</Label>
            <ContactPicker
              organizationId={organizationId}
              value={recipient}
              onChange={pickRecipient}
              withAddress
              createWith="full"
            />
            {traitementRefused && (
              <p className="flex items-start gap-1.5 text-xs text-warning">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Cet usager a refusé le traitement de ses données. Vous pouvez lui écrire, mais vérifiez que ce courrier
                le justifie.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>
              Expéditeur <span className="font-normal text-muted-foreground">(facultatif)</span>
            </Label>
            <ContactPicker
              organizationId={organizationId}
              value={sender}
              onChange={setSender}
              roles={[...CONTACT_CATEGORIES]}
              placeholder="Interne ou élu au nom de qui le courrier part…"
            />
            <p className="text-xs text-muted-foreground">
              Le courrier part de l'organisation émettrice ; l'expéditeur nomme en plus l'agent ou l'élu qui l'adresse.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Mode d'envoi</Label>
            <RadioGroup
              value={channel}
              onValueChange={(v) => setChannel(v as OutboundChannel)}
              className="flex flex-col gap-2"
            >
              <div className="flex items-start gap-2">
                <RadioGroupItem id="outbound-paper" value="paper" className="mt-0.5" />
                <Label htmlFor="outbound-paper" className="cursor-pointer font-normal">
                  Courrier postal
                  {recipient && noAddress && (
                    <span className="block text-xs text-muted-foreground">
                      {noAddress} À compléter avant l'impression finale.
                    </span>
                  )}
                </Label>
              </div>
              <div className="flex items-start gap-2">
                <RadioGroupItem id="outbound-email" value="email" disabled={!recipient || !!noEmail} className="mt-0.5" />
                <Label
                  htmlFor="outbound-email"
                  className={cn("cursor-pointer font-normal", (!recipient || noEmail) && "text-muted-foreground")}
                >
                  Courriel
                  {recipient && noEmail && <span className="block text-xs">{noEmail}</span>}
                  {recipient?.email && !noEmail && (
                    <span className="block text-xs text-muted-foreground">{recipient.email}</span>
                  )}
                </Label>
              </div>
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <Label htmlFor="outbound-subject">Objet</Label>
            <Input
              id="outbound-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Ex. : Convocation à la réunion de quartier"
              maxLength={200}
            />
          </div>

          {mayMarkConfidential && (
            <label className="flex cursor-pointer items-start gap-2.5 rounded-md border p-3 text-sm">
              <Checkbox
                checked={confidential}
                onCheckedChange={(v) => setConfidential(v === true)}
                className="mt-0.5"
              />
              <span className="flex flex-col gap-0.5">
                <span className="flex items-center gap-1.5 font-semibold">
                  <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                  Courrier confidentiel
                </span>
                <span className="text-xs text-muted-foreground">
                  Lisible par les seuls membres habilités, et par les viseurs et signataires désignés.
                </span>
              </span>
            </label>
          )}

          <Button className="w-full" disabled={!!missing || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? "Création…" : "Créer et rédiger"}
          </Button>
          {missing && <p className="text-center text-xs text-muted-foreground">{missing}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
