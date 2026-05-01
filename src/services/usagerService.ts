import { supabase } from "@/integrations/supabase/client";

export type UsagerCategory = "citoyen" | "entreprise" | "association";
export type UsagerCivilite = "madame" | "monsieur";

export interface Usager {
  id: string;
  organization_id: string;
  category: UsagerCategory;
  civilite: UsagerCivilite | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface UsagerInput {
  category: UsagerCategory;
  civilite?: UsagerCivilite | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface UsagerCourier {
  id: string;
  subject: string | null;
  received_at: string | null;
  sent_at: string | null;
  direction: string;
  channel: string | null;
  chrono: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
  workflow_state: { name: string; category: string } | null;
}

function normalizeEmail(e?: string | null) {
  return e?.trim().toLowerCase() || null;
}
function normalizePhone(p?: string | null) {
  return p?.replace(/[\s.\-()]/g, "").trim() || null;
}

export async function listUsagers(organizationId: string, search?: string) {
  let q = supabase.from("usagers").select("*").eq("organization_id", organizationId);
  if (search?.trim()) {
    const s = `%${search.trim()}%`;
    q = q.or(`last_name.ilike.${s},first_name.ilike.${s},email.ilike.${s},phone.ilike.${s}`);
  }
  const { data, error } = await q.order("last_name", { ascending: true, nullsFirst: false }).limit(200);
  if (error) throw error;
  return (data ?? []) as unknown as Usager[];
}

export async function getUsager(id: string) {
  const { data, error } = await supabase.from("usagers").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as unknown as Usager | null;
}

export async function getUsagersByIds(ids: string[]): Promise<Record<string, Usager>> {
  if (!ids.length) return {};
  const { data, error } = await supabase.from("usagers").select("*").in("id", ids);
  if (error) throw error;
  const result: Record<string, Usager> = {};
  for (const u of data ?? []) result[(u as unknown as Usager).id] = u as unknown as Usager;
  return result;
}

export async function createUsager(organizationId: string, input: UsagerInput) {
  const { data, error } = await supabase
    .from("usagers")
    .insert({
      organization_id: organizationId,
      category: input.category,
      civilite: input.category === "citoyen" ? (input.civilite ?? null) : null,
      first_name: input.category === "citoyen" ? (input.first_name?.trim() || null) : null,
      last_name: input.last_name?.trim() || null,
      email: normalizeEmail(input.email),
      phone: input.phone?.trim() || null,
    } as never)
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as Usager;
}

export async function updateUsager(id: string, input: UsagerInput) {
  const { data, error } = await supabase
    .from("usagers")
    .update({
      category: input.category,
      civilite: input.category === "citoyen" ? (input.civilite ?? null) : null,
      first_name: input.category === "citoyen" ? (input.first_name?.trim() || null) : null,
      last_name: input.last_name?.trim() || null,
      email: normalizeEmail(input.email),
      phone: input.phone?.trim() || null,
    } as never)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as Usager;
}

export async function deleteUsager(id: string) {
  const { error } = await supabase.from("usagers").delete().eq("id", id);
  if (error) throw error;
}

/**
 * Recherche un usager existant à matcher selon les règles métier :
 *  - email identique → match
 *  - sinon, téléphone identique ET email manquant côté usager → match (citoyen uniquement)
 *  - sinon → null
 */
export async function findMatchingUsager(
  organizationId: string,
  contact: { email?: string | null; phone?: string | null }
): Promise<Usager | null> {
  const email = normalizeEmail(contact.email);
  const phone = normalizePhone(contact.phone);

  if (email) {
    const { data } = await supabase
      .from("usagers")
      .select("*")
      .eq("organization_id", organizationId)
      .ilike("email", email)
      .limit(1)
      .maybeSingle();
    if (data) return data as unknown as Usager;
  }

  if (phone) {
    const { data } = await supabase
      .from("usagers")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("phone", phone)
      .is("email", null)
      .limit(1)
      .maybeSingle();
    if (data) return data as unknown as Usager;
  }

  return null;
}

/**
 * Liste des courriers envoyés par un usager (via courier_participants role=sender).
 */
export async function listUsagerCouriers(usagerId: string): Promise<UsagerCourier[]> {
  const { data, error } = await supabase
    .from("courier_participants")
    .select("courier_id, role, courier:couriers(id, subject, received_at, sent_at, direction, channel, chrono, created_at, metadata, workflow_state:workflow_states(name, category))")
    .eq("usager_id", usagerId);
  if (error) throw error;

  interface ParticipantRow {
    courier: UsagerCourier | null;
  }
  const couriers = ((data ?? []) as unknown as ParticipantRow[])
    .map((r) => r.courier)
    .filter((c): c is UsagerCourier => c !== null);

  const seen = new Set<string>();
  const out: UsagerCourier[] = [];
  for (const c of couriers) {
    if (!seen.has(c.id)) {
      seen.add(c.id);
      out.push(c);
    }
  }
  out.sort((a, b) => {
    const da = a.received_at ?? a.sent_at ?? a.created_at;
    const db = b.received_at ?? b.sent_at ?? b.created_at;
    return new Date(db).getTime() - new Date(da).getTime();
  });
  return out;
}
