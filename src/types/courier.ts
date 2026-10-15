import type { Database } from "@/integrations/supabase/types";

// DB enums
export type CourierDirection = Database["public"]["Enums"]["courier_direction"];
export type CourierChannel = Database["public"]["Enums"]["courier_channel"];
export type WorkflowCategory = Database["public"]["Enums"]["workflow_category"];

// Row types
export type Courier = Database["public"]["Tables"]["couriers"]["Row"];
export type CourierInsert = Database["public"]["Tables"]["couriers"]["Insert"];
export type CourierUpdate = Database["public"]["Tables"]["couriers"]["Update"];

export type CourierParticipant = Database["public"]["Tables"]["courier_participants"]["Row"];
export type CourierParticipantInsert = Database["public"]["Tables"]["courier_participants"]["Insert"];

export type CourierDocument = Database["public"]["Tables"]["courier_documents"]["Row"];

/** Pièce telle que l'aperçu la montre : le corps d'un email y figure en pièce synthétique (id `inline:…`) portant son contenu. */
export type DisplayDocument = CourierDocument & { inline_html?: string | null; inline_text?: string | null };

export type CourierEvent = Database["public"]["Tables"]["courier_events"]["Row"];

export type CourierLink = Database["public"]["Tables"]["courier_links"]["Row"];

export type Workflow = Database["public"]["Tables"]["workflows"]["Row"];
export type WorkflowState = Database["public"]["Tables"]["workflow_states"]["Row"];
export type WorkflowTransition = Database["public"]["Tables"]["workflow_transitions"]["Row"];

export interface CourierWithRelations extends Courier {
  courier_participants?: CourierParticipant[];
  courier_documents?: CourierDocument[];
  courier_events?: CourierEvent[];
  courier_links?: CourierLink[];
  /** Organisation (miroir Socle) d'origine — jointe via socle_organization_id. */
  socle_organization?: { id: string; name: string } | null;
}
