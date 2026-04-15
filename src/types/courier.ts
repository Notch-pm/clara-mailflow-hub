import type { Database } from "@/integrations/supabase/types";

// DB enums
export type CourierDirection = Database["public"]["Enums"]["courier_direction"];
export type CourierChannel = Database["public"]["Enums"]["courier_channel"];
export type ParticipantRole = Database["public"]["Enums"]["participant_role"];
export type DocumentType = Database["public"]["Enums"]["document_type"];
export type SyncStatus = Database["public"]["Enums"]["sync_status"];
export type WorkflowCategory = Database["public"]["Enums"]["workflow_category"];

// Row types
export type Courier = Database["public"]["Tables"]["couriers"]["Row"];
export type CourierInsert = Database["public"]["Tables"]["couriers"]["Insert"];
export type CourierUpdate = Database["public"]["Tables"]["couriers"]["Update"];

export type CourierParticipant = Database["public"]["Tables"]["courier_participants"]["Row"];
export type CourierParticipantInsert = Database["public"]["Tables"]["courier_participants"]["Insert"];

export type CourierDocument = Database["public"]["Tables"]["courier_documents"]["Row"];
export type CourierDocumentInsert = Database["public"]["Tables"]["courier_documents"]["Insert"];

export type CourierEvent = Database["public"]["Tables"]["courier_events"]["Row"];
export type CourierEventInsert = Database["public"]["Tables"]["courier_events"]["Insert"];

export type CourierLink = Database["public"]["Tables"]["courier_links"]["Row"];
export type CourierLinkInsert = Database["public"]["Tables"]["courier_links"]["Insert"];

export type Workflow = Database["public"]["Tables"]["workflows"]["Row"];
export type WorkflowState = Database["public"]["Tables"]["workflow_states"]["Row"];
export type WorkflowTransition = Database["public"]["Tables"]["workflow_transitions"]["Row"];
export type CourierSequence = Database["public"]["Tables"]["courier_sequences"]["Row"];

export interface CourierWithRelations extends Courier {
  courier_participants?: CourierParticipant[];
  courier_documents?: CourierDocument[];
  courier_events?: CourierEvent[];
  courier_links?: CourierLink[];
}
