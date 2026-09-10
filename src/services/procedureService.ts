import { supabase } from "@/integrations/supabase/client";
import type { ProcedureActivation } from "@/lib/procedure-activation";

export type { ProcedureActivation };

export interface ArpegeConfigField {
  Code: string;
  Intitule: string;
  Etat: string;
  Obligatoire: boolean;
  AuMoinsUne: boolean;
  Systeme: boolean;
}

export interface ArpegeFormComponent {
  DataId: string;
  Order: number;
  Code: string;
  Type: string;
  Libelle: string;
  LibelleAide: string;
  Value: unknown[];
  Components: ArpegeFormComponent[];
}

export interface ArpegeConfigFields {
  CodeQualificationMetier: string | null;
  ConfigInfoUsagerObligs: ArpegeConfigField[];
  FormComponents: ArpegeFormComponent[] | null;
}

// Les démarches sont synchronisées depuis le Socle (référentiel central) :
// Clara ne les crée/modifie plus, à l'exception du toggle de visibilité local.
export interface Procedure {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  external_reference_id: string | null;
  external_source: string | null;
  is_displayed: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  arpege_config_fields: ArpegeConfigFields | null;
  // Champs Socle
  socle_id: string | null;
  type: string | null;
  keywords: string[] | null;
  user_description: string | null;
  agent_description: string | null;
  input_duration_minutes: number | null;
  socle_category_id: string | null;
  requester_config: unknown;
  form_schema: unknown;
  knowledge_base: unknown;
  translations: unknown;
  synced_at: string | null;
  obsoleted_at: string | null;
}

export async function listProcedures(orgId: string): Promise<Procedure[]> {
  const { data, error } = await supabase
    .from("procedures")
    .select("*")
    .eq("organization_id", orgId)
    .order("display_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as Procedure[];
}

/**
 * Miroir « quelle organisation propose quelle démarche » (`procedure_organizations`,
 * alimenté par la sync depuis le référentiel). Lecture seule : rien ne s'active
 * depuis Clara. Volume d'un référentiel — on charge tout le tenant et on filtre
 * en mémoire (`src/lib/procedure-activation.ts`).
 */
export async function listProcedureActivations(orgId: string): Promise<ProcedureActivation[]> {
  const { data, error } = await supabase
    .from("procedure_organizations")
    .select("procedure_id, socle_organization_id")
    .eq("organization_id", orgId)
    .is("obsoleted_at", null);
  if (error) throw error;
  return (data ?? []) as ProcedureActivation[];
}

/**
 * Seule écriture autorisée côté Clara : le masquage local d'une démarche.
 * Tous les autres champs appartiennent au Socle et sont réécrasés par la sync nocturne.
 */
export async function updateProcedureVisibility(id: string, isDisplayed: boolean): Promise<Procedure> {
  const { data, error } = await supabase
    .from("procedures")
    .update({ is_displayed: isDisplayed })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as Procedure;
}
