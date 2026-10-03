// Une action de courrier EST une demande fondée sur une démarche, déposée chez
// qui l'instruit (Iris ou partenaire). Clara n'en pilote rien : ni intitulé, ni
// affectation, ni descriptif — d'où un service réduit à créer, lister, supprimer.
// Les colonnes `title` / `description` / `assignee_id` ne servent plus qu'à
// afficher les tickets d'avant le 2026-09-11.
import { edgeError } from "@/lib/edge-error";
import { supabase } from "@/integrations/supabase/client";

export async function createArpegeTicket(payload: {
  organizationId: string;
  courierId: string;
  procedureId: string;
  demandeur: Record<string, string>;
  formValues?: Array<{ id: string; valeur: unknown }>;
  pieceJointes?: Record<string, string[]>;
  /** Organisation destinataire (miroir Socle) — exigée pour une démarche du référentiel. */
  socleOrganizationId?: string | null;
}): Promise<ActionTicket> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Non authentifié");

  const res = await supabase.functions.invoke("create-arpege-demande", {
    body: {
      organization_id: payload.organizationId,
      courier_id: payload.courierId,
      procedure_id: payload.procedureId,
      demandeur: payload.demandeur,
      form_values: payload.formValues ?? [],
      pieces_jointes: payload.pieceJointes ?? {},
      socle_organization_id: payload.socleOrganizationId ?? null,
    },
  });

  if (res.error) throw await edgeError(res.error, "Création de la demande Arpège impossible");
  const data = res.data as { ticket: ActionTicket; arpege_ref: string };
  if (!data?.ticket) throw new Error("Réponse invalide de l'edge function");
  return data.ticket;
}

export interface ActionTicket {
  id: string;
  organization_id: string;
  courier_id: string;
  procedure_id: string | null;
  title: string | null;
  description: string | null;
  status: string;
  assignee_id: string | null;
  arpege_demande_ref: string | null;
  arpege_demande_status: string | null;
  socle_data: unknown;
  /** Organisation destinataire choisie (miroir Socle). Null = celle du courrier. */
  socle_organization_id: string | null;
  /** Suivi de la demande déposée dans Iris — écrit par le serveur uniquement. */
  iris_request_id: string | null;
  iris_reference: string | null;
  /** Liste fermée servie par Iris ; libellés d'affichage dans `src/lib/iris.ts`. */
  iris_status: string | null;
  iris_url: string | null;
  /** Dernier échec de dépôt, en français. Non nul = demande à renvoyer. */
  iris_last_error: string | null;
  /**
   * Pièces réclamées par la démarche qui ne sont pas arrivées chez Iris. Non
   * nul = demande déposée mais incomplète. Null ne prouve rien pour les
   * demandes d'avant le dépôt des pièces (elles sont toutes parties sans).
   */
  iris_attachments_error: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ActionTicketAssignee {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  avatar_url: string | null;
}

export interface ActionTicketWithProcedure extends ActionTicket {
  procedure?: {
    id: string;
    name: string;
    color: string | null;
    icon: string | null;
  } | null;
  assignee?: ActionTicketAssignee | null;
}

export async function listTicketsForCourier(
  courierId: string,
): Promise<ActionTicketWithProcedure[]> {
  const { data, error } = await supabase
    .from("action_tickets" as any)
    .select(
      "*, procedure:procedures!action_tickets_procedure_id_fkey(id, name, color, icon), assignee:users!action_tickets_assignee_id_fkey(id, first_name, last_name, email, avatar_url)",
    )
    .eq("courier_id", courierId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as ActionTicketWithProcedure[];
}

export async function createTicket(payload: {
  organizationId: string;
  courierId: string;
  /** Obligatoire : sans démarche, personne n'instruirait la demande. */
  procedureId: string;
  /** Valeurs saisies pour une démarche Socle (demandeur + formulaire), voir socle-form.ts. */
  socleData?: unknown;
  /**
   * Organisation destinataire (id du miroir `socle_organizations`). À null,
   * l'organisme transmis à Iris reste celui du courrier.
   */
  socleOrganizationId?: string | null;
}): Promise<ActionTicket> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("action_tickets" as any)
    .insert({
      organization_id: payload.organizationId,
      courier_id: payload.courierId,
      procedure_id: payload.procedureId,
      socle_data: payload.socleData ?? null,
      socle_organization_id: payload.socleOrganizationId ?? null,
      created_by: user?.id ?? null,
    } as any)
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as ActionTicket;
}

export async function deleteTicket(id: string): Promise<void> {
  const { error } = await supabase.from("action_tickets" as any).delete().eq("id", id);
  if (error) throw error;
}
