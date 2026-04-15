export type CourierType = "incoming" | "outgoing";
export type CourierStatus = "draft" | "registered" | "in_progress" | "completed" | "archived";

export interface Courier {
  id: string;
  organization_id: string;
  reference: string;
  type: CourierType;
  subject: string;
  status: CourierStatus;
  priority: string | null;
  workflow_id: string | null;
  current_state_id: string | null;
  received_at: string | null;
  sent_at: string | null;
  due_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CourierParticipant {
  id: string;
  courier_id: string;
  role: "sender" | "recipient" | "cc" | "assignee";
  name: string;
  email: string | null;
  organization_name: string | null;
  created_at: string;
}

export interface CourierDocument {
  id: string;
  courier_id: string;
  file_name: string;
  file_path: string;
  file_type: string | null;
  file_size: number | null;
  uploaded_by: string | null;
  created_at: string;
}

export interface CourierEvent {
  id: string;
  courier_id: string;
  event_type: string;
  description: string | null;
  performed_by: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface CourierLink {
  id: string;
  courier_id: string;
  link_type: string;
  external_id: string;
  external_url: string | null;
  label: string | null;
  created_at: string;
}

export interface Workflow {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
}

export interface WorkflowState {
  id: string;
  workflow_id: string;
  name: string;
  state_type: "initial" | "intermediate" | "final";
  position: number;
  color: string | null;
  created_at: string;
}

export interface WorkflowTransition {
  id: string;
  workflow_id: string;
  from_state_id: string;
  to_state_id: string;
  name: string;
  required_role: string | null;
  created_at: string;
}

export interface CourierSequence {
  id: string;
  organization_id: string;
  courier_type: CourierType;
  prefix: string;
  current_number: number;
  year: number;
  created_at: string;
}

export interface CourierWithRelations extends Courier {
  courier_participants?: CourierParticipant[];
  courier_documents?: CourierDocument[];
  courier_events?: CourierEvent[];
  courier_links?: CourierLink[];
}
