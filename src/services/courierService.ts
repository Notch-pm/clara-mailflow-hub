import { supabase } from "@/integrations/supabase/client";
import type { CourierDirection, CourierChannel, CourierInsert, CourierUpdate, CourierWithRelations } from "@/types/courier";

const LIST_SELECT =
  "id, subject, direction, channel, received_at, sent_at, workflow_state_id, assigned_service, metadata, chrono, created_at, updated_at, courier_participants(id, role, name, email, usager_id)";

/** Taille de page utilisée pour récupérer l'intégralité des résultats filtrés (export). */
const EXPORT_PAGE_SIZE = 500;

interface CourierFilters {
  direction?: CourierDirection;
  channel?: CourierChannel;
  search?: string;
  limit?: number;
  offset?: number;
}

export async function getCouriers(organizationId: string, filters?: CourierFilters) {
  const limit = filters?.limit ?? 200;
  const offset = filters?.offset ?? 0;

  let query = supabase
    .from("couriers")
    .select(LIST_SELECT, { count: "exact" })
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (filters?.direction) query = query.eq("direction", filters.direction);
  if (filters?.channel) query = query.eq("channel", filters.channel);
  if (filters?.search) query = query.ilike("subject", `%${filters.search}%`);

  return query;
}

/**
 * Récupère la totalité des courriers correspondant à direction/recherche (pages
 * Entrants/Sortants), sans le plafond de 200 lignes utilisé à l'écran — pagine
 * par blocs de EXPORT_PAGE_SIZE via .range(). Destiné à l'export.
 */
export async function fetchAllCouriersForExport(
  organizationId: string,
  opts: { direction: CourierDirection; search?: string },
): Promise<CourierWithRelations[]> {
  const all: CourierWithRelations[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await getCouriers(organizationId, {
      direction: opts.direction,
      search: opts.search,
      limit: EXPORT_PAGE_SIZE,
      offset,
    });
    if (error) throw error;
    const page = (data ?? []) as unknown as CourierWithRelations[];
    all.push(...page);
    if (page.length < EXPORT_PAGE_SIZE) break;
    offset += EXPORT_PAGE_SIZE;
  }
  return all;
}

/**
 * Récupère la totalité des courriers entrants dont l'état figure dans
 * `stateIds` (pages En instruction/Traités/Archivés), sans plafond — pagine
 * par blocs de EXPORT_PAGE_SIZE via .range(). Destiné à l'export ; les
 * filtres service/tag (appliqués côté client sur ces pages) doivent être
 * réappliqués par l'appelant sur le résultat.
 */
export async function fetchAllCouriersByStatesForExport(
  organizationId: string,
  opts: { stateIds: string[]; search?: string },
): Promise<CourierWithRelations[]> {
  if (!opts.stateIds.length) return [];
  const all: CourierWithRelations[] = [];
  let offset = 0;
  while (true) {
    let q = supabase
      .from("couriers")
      .select(LIST_SELECT)
      .eq("organization_id", organizationId)
      .eq("direction", "inbound")
      .in("workflow_state_id", opts.stateIds)
      .order("updated_at", { ascending: false })
      .range(offset, offset + EXPORT_PAGE_SIZE - 1);
    if (opts.search) q = q.ilike("subject", `%${opts.search}%`);
    const { data, error } = await q;
    if (error) throw error;
    const page = (data ?? []) as unknown as CourierWithRelations[];
    all.push(...page);
    if (page.length < EXPORT_PAGE_SIZE) break;
    offset += EXPORT_PAGE_SIZE;
  }
  return all;
}

export async function getCourierById(organizationId: string, courierId: string) {
  return supabase
    .from("couriers")
    .select("*, courier_participants(*), courier_documents(*), courier_events(*), courier_links(*)")
    .eq("organization_id", organizationId)
    .eq("id", courierId)
    .single();
}

export async function createCourier(data: CourierInsert) {
  return supabase
    .from("couriers")
    .insert(data)
    .select()
    .single();
}

export async function updateCourier(organizationId: string, courierId: string, data: CourierUpdate) {
  return supabase
    .from("couriers")
    .update(data)
    .eq("organization_id", organizationId)
    .eq("id", courierId)
    .select()
    .single();
}

export async function deleteCourier(organizationId: string, courierId: string) {
  return supabase
    .from("couriers")
    .delete()
    .eq("organization_id", organizationId)
    .eq("id", courierId);
}
