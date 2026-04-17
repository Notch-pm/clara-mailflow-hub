import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

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

const TABLE = "usagers" as any;

function normalizeEmail(e?: string | null) {
  return e?.trim().toLowerCase() || null;
}
function normalizePhone(p?: string | null) {
  return p?.replace(/[\s.\-()]/g, "").trim() || null;
}

export async function listUsagers(organizationId: string, search?: string) {
  let q = supabase.from(TABLE).select("*").eq("organization_id", organizationId);
  if (search?.trim()) {
    const s = `%${search.trim()}%`;
    q = q.or(`last_name.ilike.${s},first_name.ilike.${s},email.ilike.${s},phone.ilike.${s}`);
  }
  const { data, error } = await q.order("last_name", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as unknown as Usager[];
}

export async function getUsager(id: string) {
  const { data, error } = await supabase.from(TABLE).select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as unknown as Usager | null;
}

export async function createUsager(organizationId: string, input: UsagerInput) {
  const payload: any = {
    organization_id: organizationId,
    category: input.category,
    civilite: input.category === "citoyen" ? input.civilite ?? null : null,
    first_name: input.category === "citoyen" ? (input.first_name?.trim() || null) : null,
    last_name: input.last_name?.trim() || null,
    email: normalizeEmail(input.email),
    phone: input.phone?.trim() || null,
  };
  const { data, error } = await supabase.from(TABLE).insert(payload).select("*").single();
  if (error) throw error;
  return data as unknown as Usager;
}

export async function updateUsager(id: string, input: UsagerInput) {
  const payload: any = {
    category: input.category,
    civilite: input.category === "citoyen" ? input.civilite ?? null : null,
    first_name: input.category === "citoyen" ? (input.first_name?.trim() || null) : null,
    last_name: input.last_name?.trim() || null,
    email: normalizeEmail(input.email),
    phone: input.phone?.trim() || null,
  };
  const { data, error } = await supabase.from(TABLE).update(payload).eq("id", id).select("*").single();
  if (error) throw error;
  return data as unknown as Usager;
}

export async function deleteUsager(id: string) {
  const { error } = await supabase.from(TABLE).delete().eq("id", id);
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
      .from(TABLE)
      .select("*")
      .eq("organization_id", organizationId)
      .ilike("email", email)
      .limit(1)
      .maybeSingle();
    if (data) return data as unknown as Usager;
  }

  if (phone) {
    const { data } = await supabase
      .from(TABLE)
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
export async function listUsagerCouriers(usagerId: string) {
  const { data, error } = await supabase
    .from("courier_participants")
    .select("courier_id, role, courier:couriers(id, subject, received_at, sent_at, direction, channel, chrono, created_at)")
    .eq("usager_id" as any, usagerId);
  if (error) throw error;
  const couriers = (data ?? [])
    .map((r: any) => r.courier)
    .filter(Boolean);
  // dédoublonnage
  const seen = new Set<string>();
  const out: any[] = [];
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
