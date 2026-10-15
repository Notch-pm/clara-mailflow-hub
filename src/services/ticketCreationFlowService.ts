import { createTicket, createArpegeTicket } from "@/services/actionTicketService";
import { pushIrisRequest } from "@/services/irisRequestService";
import { logEvent } from "@/services/courierEventService";
import type { TicketCreationResult } from "@/lib/ticket-creation-result";

interface Base {
  organizationId: string;
  courierId: string;
  procedureId: string;
  socleOrganizationId: string | null;
}

/** Demande Arpège : ticket + événement d'historique. */
export async function createArpegeTicketFlow(
  p: Base & {
    demandeur: Record<string, string>;
    formValues: Array<{ id: string; valeur: unknown }>;
    pieceJointes: Record<string, string[]>;
  },
): Promise<TicketCreationResult> {
  const created = await createArpegeTicket({
    organizationId: p.organizationId,
    courierId: p.courierId,
    procedureId: p.procedureId,
    demandeur: p.demandeur,
    formValues: p.formValues,
    pieceJointes: p.pieceJointes,
    socleOrganizationId: p.socleOrganizationId,
  });
  await logEvent(p.organizationId, p.courierId, "ticket_created", {
    ticket_id: created.id,
    procedure_id: p.procedureId,
    arpege_ref: created.arpege_demande_ref,
    socle_organization_id: p.socleOrganizationId,
  });
  return {};
}

/**
 * Demande libre ou démarche du référentiel. Pour une démarche du référentiel
 * (`pushToIris`) la demande appartient à Iris : le ticket est créé d'abord — son
 * id EST l'external_id côté Iris —, puis déposé. Un échec de dépôt ne détruit
 * rien et se rejoue à l'identique (clé d'idempotence portée par le ticket).
 */
export async function createSocleTicketFlow(
  p: Base & { socleData: unknown; pushToIris: boolean },
): Promise<TicketCreationResult> {
  const created = await createTicket({
    organizationId: p.organizationId,
    courierId: p.courierId,
    procedureId: p.procedureId,
    socleData: p.socleData,
    socleOrganizationId: p.socleOrganizationId,
  });
  await logEvent(p.organizationId, p.courierId, "ticket_created", {
    ticket_id: created.id,
    procedure_id: p.procedureId,
    socle_organization_id: p.socleOrganizationId,
  });

  if (!p.pushToIris) return {};
  try {
    const pushed = await pushIrisRequest(created.id);
    // Organisation qui ne dépose pas dans Iris : rien à annoncer.
    if (pushed.skipped) return {};
    return {
      irisReference: pushed.reference,
      attachmentsRefused: pushed.attachments_refused ?? null,
    };
  } catch (e) {
    return { irisError: e instanceof Error ? e.message : String(e) };
  }
}
