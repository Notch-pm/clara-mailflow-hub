import { useMemo, useState } from "react";
import { isOutboundSettled } from "@/lib/outbound-kind";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ContactPicker from "@/components/courier/ContactPicker";
import { assignableOrgs, listOrgsWithConfig } from "@/services/socleOrgConfigService";
import { getReplyWorkflow, type ReplyRecord } from "@/services/courierReplyService";
import { getContact, type SocleContact } from "@/services/socleContactService";
import {
  assignShellOrganization,
  changeOutboundOrganization,
  setOutboundRecipient,
} from "@/services/outboundCourierService";
import { useUserServiceFilter } from "@/hooks/useUserServiceFilter";
import type { WorkspaceCourier } from "@/hooks/useCourierWorkspace";
import type { CourierParticipant } from "@/types/courier";
import {
  ISSUER_NOT_AT_INITIAL_REASON,
  LOCKED_ISSUER_REASON,
  issuerBlockReason,
} from "../../../../supabase/functions/_shared/outboundInitiativeGuard";
import { OutboundEditor } from "./OutboundEditor";

interface Props {
  organizationId: string;
  /** Le sortant, tel que la fiche le charge (participants compris). */
  courier: WorkspaceCourier;
  readOnly?: boolean;
  onStateChange?: (state: { name: string; category: string | null } | null) => void;
}

/**
 * Rédaction d'un courrier à l'initiative de la collectivité : l'organisation
 * qui l'émet, son destinataire, puis l'éditeur partagé des sortants. Le circuit
 * (visa, signature, envoi) est celui du workflow de réponse de l'émettrice.
 */
export function InitiativeComposer({ organizationId, courier, readOnly, onStateChange }: Props) {
  const queryClient = useQueryClient();
  // L'éditeur partagé lit le sortant sous la forme d'une réponse.
  const record = useMemo<ReplyRecord>(
    () => ({
      id: courier.id,
      parent_courier_id: null,
      organization_id: courier.organization_id,
      channel: courier.channel,
      subject: courier.subject,
      workflow_state_id: courier.workflow_state_id,
      metadata: (courier.metadata ?? null) as Record<string, unknown> | null,
      assigned_service: courier.assigned_service,
      created_at: courier.created_at as string | undefined,
    }),
    [courier],
  );
  const userServiceFilter = useUserServiceFilter();

  const { data: services } = useQuery({
    queryKey: ["socle-orgs-config", organizationId],
    queryFn: () => listOrgsWithConfig(organizationId),
    enabled: !!organizationId,
  });
  const issuer = useMemo(
    () => services?.find((o) => o.id === courier.socle_organization_id) ?? null,
    [services, courier.socle_organization_id],
  );
  const issuers = useMemo(
    () =>
      assignableOrgs(services ?? [])
        .filter((o) => !userServiceFilter || userServiceFilter.includes(o.id) || o.id === issuer?.id)
        .map((o) => ({ org: o, blocked: issuerBlockReason(o) })),
    [services, userServiceFilter, issuer?.id],
  );

  const { data: workflow } = useQuery({
    queryKey: ["reply-workflow", issuer?.reply_workflow_id],
    queryFn: () => getReplyWorkflow(issuer!.reply_workflow_id!),
    enabled: !!issuer?.reply_workflow_id,
  });

  const recipient: CourierParticipant | null =
    (courier.courier_participants ?? []).find((p) => p.role === "recipient") ?? null;
  // L'adresse électronique de l'instantané, sinon celle de la fiche du référentiel.
  const { data: recipientContact } = useQuery({
    queryKey: ["socle-contact", organizationId, recipient?.socle_contact_id],
    queryFn: () => getContact(organizationId, recipient!.socle_contact_id!),
    enabled: !!recipient?.socle_contact_id,
    staleTime: 60_000,
  });
  const recipientEmail = recipient?.email?.trim() || recipientContact?.email?.trim() || null;
  // Adresse postale : la fiche du référentiel si elle répond, sinon
  // l'instantané pris à la création (`courier_participants.metadata`).
  const snapshot = ((recipient as { metadata?: Record<string, string | null> | null } | null)?.metadata ?? {}) as Record<
    string,
    string | null
  >;
  const recipientPostal = recipientContact ?? {
    address_line1: snapshot.address_line1 ?? null,
    postal_code: snapshot.postal_code ?? null,
    city: snapshot.city ?? null,
  };

  const meta = record.metadata ?? {};
  const state = workflow?.states.find((s) => s.id === courier.workflow_state_id) ?? null;
  const settled = isOutboundSettled(meta);
  const issuerLockReason = settled
    ? LOCKED_ISSUER_REASON
    : state && !state.is_initial
      ? ISSUER_NOT_AT_INITIAL_REASON
      : null;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["courier", courier.id] });
    queryClient.invalidateQueries({ queryKey: ["courier-events", courier.id] });
    queryClient.invalidateQueries({ queryKey: ["couriers-outbound"] });
  };

  const changeIssuer = useMutation({
    mutationFn: async (socleOrgId: string) => {
      const target = services?.find((o) => o.id === socleOrgId);
      if (!target?.reply_workflow_id) throw new Error(issuerBlockReason(target) ?? "Organisation introuvable.");
      const wf = await getReplyWorkflow(target.reply_workflow_id);
      if (!wf.initialState) throw new Error("Le workflow de réponse de cette organisation n'a pas d'état initial.");
      const args = {
        organizationId,
        outboundId: courier.id,
        socleOrganization: { id: target.id, name: target.name },
        initialStateId: wf.initialState.id,
      };
      if (!courier.workflow_state_id) await assignShellOrganization(args);
      else await changeOutboundOrganization({ ...args, metadata: record.metadata });
    },
    onSuccess: () => { refresh(); toast.success("Organisation émettrice mise à jour"); },
    onError: (err: Error) => toast.error(err.message),
  });

  const [pickedRecipient, setPickedRecipient] = useState<SocleContact | null>(null);
  const changeRecipient = useMutation({
    mutationFn: (contact: SocleContact) => setOutboundRecipient(organizationId, courier.id, contact),
    onSuccess: () => { refresh(); toast.success("Destinataire mis à jour"); },
    onError: (err: Error) => { setPickedRecipient(null); toast.error(err.message); },
  });

  const issuerSelect = (
    <Select
      value={issuer?.id ?? ""}
      onValueChange={(v) => changeIssuer.mutate(v)}
      disabled={readOnly || !!issuerLockReason || changeIssuer.isPending}
    >
      <SelectTrigger id="initiative-issuer" className="h-9">
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
  );

  // Sortant créé avant les courriers à l'initiative : ni organisation, ni état.
  if (!courier.workflow_state_id || !issuer) {
    return (
      <div className="max-w-md space-y-3">
        <p className="text-sm text-muted-foreground">
          Ce courrier a été enregistré sans organisation émettrice ni circuit de validation. Affectez-lui son
          organisation : il entrera dans le workflow de réponse de celle-ci, à son premier état.
        </p>
        {!readOnly && (
          <div className="space-y-2">
            <Label htmlFor="initiative-issuer">Organisation émettrice</Label>
            {issuerSelect}
          </div>
        )}
      </div>
    );
  }

  if (!issuer.reply_workflow_id) {
    return <p className="text-sm italic text-muted-foreground">{issuerBlockReason(issuer)}</p>;
  }

  const recipientLocked = readOnly || settled;
  const recipientValue: SocleContact | null =
    pickedRecipient ?? (recipientContact && recipientContact.id === recipient?.socle_contact_id ? recipientContact : null);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="grid shrink-0 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="initiative-issuer" className="text-xs uppercase tracking-wide text-muted-foreground">
            Organisation émettrice
          </Label>
          {issuerSelect}
          {issuerLockReason && !readOnly && <p className="text-xs text-muted-foreground">{issuerLockReason}</p>}
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Destinataire</Label>
          <ContactPicker
            organizationId={organizationId}
            value={recipientValue}
            onChange={(c) => {
              if (!c) return;
              setPickedRecipient(c);
              changeRecipient.mutate(c);
            }}
            disabled={recipientLocked || changeRecipient.isPending}
            fallbackLabel={recipient?.name ?? undefined}
            triggerClassName="h-9"
            withAddress
          />
          {recipient?.address && <p className="text-xs text-muted-foreground">{recipient.address}</p>}
        </div>
      </div>

      <OutboundEditor
        organizationId={organizationId}
        reply={record}
        parentCourierId={null}
        kind="initiative"
        service={issuer}
        workflow={workflow}
        recipient={recipient}
        recipientEmail={recipientEmail}
        defaultSubject={courier.subject ?? ""}
        title="Rédaction du courrier"
        readOnly={readOnly}
        onChanged={refresh}
        onStateChange={onStateChange}
        recipientPostal={recipientPostal}
      />
    </div>
  );
}

