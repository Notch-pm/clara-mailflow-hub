export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      action_tickets: {
        Row: {
          arpege_demande_ref: string | null
          arpege_demande_status: string | null
          assignee_id: string | null
          courier_id: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          iris_idempotency_key: string
          iris_last_attempt_at: string | null
          iris_last_error: string | null
          iris_reference: string | null
          iris_request_id: string | null
          iris_status: string | null
          iris_synced_at: string | null
          iris_url: string | null
          iris_version: number | null
          organization_id: string
          procedure_id: string | null
          socle_data: Json | null
          socle_organization_id: string | null
          status: string
          title: string | null
          updated_at: string
        }
        Insert: {
          arpege_demande_ref?: string | null
          arpege_demande_status?: string | null
          assignee_id?: string | null
          courier_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          iris_idempotency_key?: string
          iris_last_attempt_at?: string | null
          iris_last_error?: string | null
          iris_reference?: string | null
          iris_request_id?: string | null
          iris_status?: string | null
          iris_synced_at?: string | null
          iris_url?: string | null
          iris_version?: number | null
          organization_id: string
          procedure_id?: string | null
          socle_data?: Json | null
          socle_organization_id?: string | null
          status?: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          arpege_demande_ref?: string | null
          arpege_demande_status?: string | null
          assignee_id?: string | null
          courier_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          iris_idempotency_key?: string
          iris_last_attempt_at?: string | null
          iris_last_error?: string | null
          iris_reference?: string | null
          iris_request_id?: string | null
          iris_status?: string | null
          iris_synced_at?: string | null
          iris_url?: string | null
          iris_version?: number | null
          organization_id?: string
          procedure_id?: string | null
          socle_data?: Json | null
          socle_organization_id?: string | null
          status?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "action_tickets_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_tickets_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "couriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_tickets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_tickets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_tickets_procedure_id_fkey"
            columns: ["procedure_id"]
            isOneToOne: false
            referencedRelation: "procedures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_tickets_socle_organization_id_fkey"
            columns: ["socle_organization_id"]
            isOneToOne: false
            referencedRelation: "socle_organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      courier_analyses: {
        Row: {
          courier_id: string
          created_at: string
          id: string
          intents: Json
          model: string | null
          organization_id: string
          sentiment: string | null
          suggested_actions: Json
          suggested_recipient_name: string | null
          suggested_sender: Json | null
          suggested_service_name: string | null
          suggested_subject: string | null
          summary: string | null
          tokens_used: number | null
          updated_at: string
        }
        Insert: {
          courier_id: string
          created_at?: string
          id?: string
          intents?: Json
          model?: string | null
          organization_id: string
          sentiment?: string | null
          suggested_actions?: Json
          suggested_recipient_name?: string | null
          suggested_sender?: Json | null
          suggested_service_name?: string | null
          suggested_subject?: string | null
          summary?: string | null
          tokens_used?: number | null
          updated_at?: string
        }
        Update: {
          courier_id?: string
          created_at?: string
          id?: string
          intents?: Json
          model?: string | null
          organization_id?: string
          sentiment?: string | null
          suggested_actions?: Json
          suggested_recipient_name?: string | null
          suggested_sender?: Json | null
          suggested_service_name?: string | null
          suggested_subject?: string | null
          summary?: string | null
          tokens_used?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "courier_analyses_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: true
            referencedRelation: "couriers"
            referencedColumns: ["id"]
          },
        ]
      }
      courier_analysis_jobs: {
        Row: {
          attempts: number
          courier_id: string
          created_at: string
          finished_at: string | null
          id: string
          kind: string
          last_error: string | null
          organization_id: string
          requested_by: string | null
          scheduled_at: string
          started_at: string | null
          status: string
        }
        Insert: {
          attempts?: number
          courier_id: string
          created_at?: string
          finished_at?: string | null
          id?: string
          kind?: string
          last_error?: string | null
          organization_id: string
          requested_by?: string | null
          scheduled_at?: string
          started_at?: string | null
          status?: string
        }
        Update: {
          attempts?: number
          courier_id?: string
          created_at?: string
          finished_at?: string | null
          id?: string
          kind?: string
          last_error?: string | null
          organization_id?: string
          requested_by?: string | null
          scheduled_at?: string
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "courier_analysis_jobs_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "couriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_analysis_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_analysis_jobs_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      courier_document_extracts: {
        Row: {
          courier_id: string
          created_at: string
          document_id: string
          fts_extract: unknown
          id: string
          model: string | null
          organization_id: string
          page_count: number | null
          text: string
          tokens_used: number | null
          updated_at: string
        }
        Insert: {
          courier_id: string
          created_at?: string
          document_id: string
          fts_extract?: unknown
          id?: string
          model?: string | null
          organization_id: string
          page_count?: number | null
          text?: string
          tokens_used?: number | null
          updated_at?: string
        }
        Update: {
          courier_id?: string
          created_at?: string
          document_id?: string
          fts_extract?: unknown
          id?: string
          model?: string | null
          organization_id?: string
          page_count?: number | null
          text?: string
          tokens_used?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "courier_document_extracts_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "couriers"
            referencedColumns: ["id"]
          },
        ]
      }
      courier_documents: {
        Row: {
          checksum: string | null
          courier_id: string
          created_at: string
          document_type: Database["public"]["Enums"]["document_type"]
          file_name: string | null
          file_size: number | null
          id: string
          mime_type: string | null
          organization_id: string
          storage_key: string
        }
        Insert: {
          checksum?: string | null
          courier_id: string
          created_at?: string
          document_type: Database["public"]["Enums"]["document_type"]
          file_name?: string | null
          file_size?: number | null
          id?: string
          mime_type?: string | null
          organization_id: string
          storage_key: string
        }
        Update: {
          checksum?: string | null
          courier_id?: string
          created_at?: string
          document_type?: Database["public"]["Enums"]["document_type"]
          file_name?: string | null
          file_size?: number | null
          id?: string
          mime_type?: string | null
          organization_id?: string
          storage_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "courier_documents_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "couriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      courier_events: {
        Row: {
          courier_id: string
          created_at: string
          created_by: string | null
          event_type: string
          id: string
          organization_id: string
          payload: Json | null
        }
        Insert: {
          courier_id: string
          created_at?: string
          created_by?: string | null
          event_type: string
          id?: string
          organization_id: string
          payload?: Json | null
        }
        Update: {
          courier_id?: string
          created_at?: string
          created_by?: string | null
          event_type?: string
          id?: string
          organization_id?: string
          payload?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "courier_events_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "couriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      courier_links: {
        Row: {
          courier_id: string
          created_at: string
          external_id: string
          external_status: string | null
          external_type: string
          id: string
          last_sync_at: string | null
          organization_id: string
          sync_status: Database["public"]["Enums"]["sync_status"] | null
        }
        Insert: {
          courier_id: string
          created_at?: string
          external_id: string
          external_status?: string | null
          external_type: string
          id?: string
          last_sync_at?: string | null
          organization_id: string
          sync_status?: Database["public"]["Enums"]["sync_status"] | null
        }
        Update: {
          courier_id?: string
          created_at?: string
          external_id?: string
          external_status?: string | null
          external_type?: string
          id?: string
          last_sync_at?: string | null
          organization_id?: string
          sync_status?: Database["public"]["Enums"]["sync_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "courier_links_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "couriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_links_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      courier_notes: {
        Row: {
          content: string
          courier_id: string
          created_at: string
          created_by: string | null
          id: string
          mentioned_user_ids: string[]
          organization_id: string
          updated_at: string
        }
        Insert: {
          content: string
          courier_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          mentioned_user_ids?: string[]
          organization_id: string
          updated_at?: string
        }
        Update: {
          content?: string
          courier_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          mentioned_user_ids?: string[]
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "courier_notes_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "couriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_notes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      courier_participants: {
        Row: {
          address: string | null
          courier_id: string
          email: string | null
          first_name: string | null
          fts_participant: unknown
          id: string
          last_name: string | null
          metadata: Json | null
          name: string | null
          organization: string | null
          organization_id: string
          phone: string | null
          role: Database["public"]["Enums"]["participant_role"]
          socle_contact_id: string | null
        }
        Insert: {
          address?: string | null
          courier_id: string
          email?: string | null
          first_name?: string | null
          fts_participant?: unknown
          id?: string
          last_name?: string | null
          metadata?: Json | null
          name?: string | null
          organization?: string | null
          organization_id: string
          phone?: string | null
          role: Database["public"]["Enums"]["participant_role"]
          socle_contact_id?: string | null
        }
        Update: {
          address?: string | null
          courier_id?: string
          email?: string | null
          first_name?: string | null
          fts_participant?: unknown
          id?: string
          last_name?: string | null
          metadata?: Json | null
          name?: string | null
          organization?: string | null
          organization_id?: string
          phone?: string | null
          role?: Database["public"]["Enums"]["participant_role"]
          socle_contact_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "courier_participants_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "couriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_participants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      courier_relations: {
        Row: {
          created_at: string
          created_by: string | null
          created_via: Database["public"]["Enums"]["courier_relation_origin"]
          id: string
          note: string | null
          organization_id: string
          relation_type: Database["public"]["Enums"]["courier_relation_type"]
          source_courier_id: string
          target_courier_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          created_via?: Database["public"]["Enums"]["courier_relation_origin"]
          id?: string
          note?: string | null
          organization_id: string
          relation_type: Database["public"]["Enums"]["courier_relation_type"]
          source_courier_id: string
          target_courier_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          created_via?: Database["public"]["Enums"]["courier_relation_origin"]
          id?: string
          note?: string | null
          organization_id?: string
          relation_type?: Database["public"]["Enums"]["courier_relation_type"]
          source_courier_id?: string
          target_courier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "courier_relations_source_courier_id_fkey"
            columns: ["source_courier_id"]
            isOneToOne: false
            referencedRelation: "couriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_relations_target_courier_id_fkey"
            columns: ["target_courier_id"]
            isOneToOne: false
            referencedRelation: "couriers"
            referencedColumns: ["id"]
          },
        ]
      }
      courier_sequences: {
        Row: {
          direction: Database["public"]["Enums"]["courier_direction"]
          id: string
          last_value: number
          organization_id: string
          year: number
        }
        Insert: {
          direction: Database["public"]["Enums"]["courier_direction"]
          id?: string
          last_value?: number
          organization_id: string
          year: number
        }
        Update: {
          direction?: Database["public"]["Enums"]["courier_direction"]
          id?: string
          last_value?: number
          organization_id?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "courier_sequences_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      courier_tags: {
        Row: {
          color: string | null
          created_at: string
          created_by: string | null
          id: string
          name: string
          organization_id: string
          tag_group: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          organization_id: string
          tag_group?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          organization_id?: string
          tag_group?: string
        }
        Relationships: [
          {
            foreignKeyName: "courier_tags_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      couriers: {
        Row: {
          ai_suggested_links: Json
          assigned_service: string | null
          channel: Database["public"]["Enums"]["courier_channel"]
          chrono: string | null
          created_at: string
          created_by: string | null
          direction: Database["public"]["Enums"]["courier_direction"]
          dismissed_link_suggestions: Json
          fts_body: unknown
          fts_subject: unknown
          id: string
          metadata: Json | null
          organization_id: string
          parent_courier_id: string | null
          received_at: string | null
          sent_at: string | null
          socle_organization_id: string | null
          subject: string | null
          updated_at: string
          workflow_state_id: string | null
        }
        Insert: {
          ai_suggested_links?: Json
          assigned_service?: string | null
          channel: Database["public"]["Enums"]["courier_channel"]
          chrono?: string | null
          created_at?: string
          created_by?: string | null
          direction: Database["public"]["Enums"]["courier_direction"]
          dismissed_link_suggestions?: Json
          fts_body?: unknown
          fts_subject?: unknown
          id?: string
          metadata?: Json | null
          organization_id: string
          parent_courier_id?: string | null
          received_at?: string | null
          sent_at?: string | null
          socle_organization_id?: string | null
          subject?: string | null
          updated_at?: string
          workflow_state_id?: string | null
        }
        Update: {
          ai_suggested_links?: Json
          assigned_service?: string | null
          channel?: Database["public"]["Enums"]["courier_channel"]
          chrono?: string | null
          created_at?: string
          created_by?: string | null
          direction?: Database["public"]["Enums"]["courier_direction"]
          dismissed_link_suggestions?: Json
          fts_body?: unknown
          fts_subject?: unknown
          id?: string
          metadata?: Json | null
          organization_id?: string
          parent_courier_id?: string | null
          received_at?: string | null
          sent_at?: string | null
          socle_organization_id?: string | null
          subject?: string | null
          updated_at?: string
          workflow_state_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "couriers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "couriers_parent_courier_id_fkey"
            columns: ["parent_courier_id"]
            isOneToOne: false
            referencedRelation: "couriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "couriers_socle_organization_id_fkey"
            columns: ["socle_organization_id"]
            isOneToOne: false
            referencedRelation: "socle_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "couriers_workflow_state_id_fkey"
            columns: ["workflow_state_id"]
            isOneToOne: false
            referencedRelation: "workflow_states"
            referencedColumns: ["id"]
          },
        ]
      }
      imap_settings: {
        Row: {
          auto_fetch: boolean
          created_at: string
          folder: string
          host: string
          id: string
          is_scan_inbox: boolean
          label: string
          last_error: string | null
          last_fetch_at: string | null
          max_email_bytes: number | null
          organization_id: string
          password: string
          port: number
          scan_allowed_senders: string[] | null
          socle_organization_id: string | null
          updated_at: string
          use_tls: boolean
          username: string
        }
        Insert: {
          auto_fetch?: boolean
          created_at?: string
          folder?: string
          host?: string
          id?: string
          is_scan_inbox?: boolean
          label?: string
          last_error?: string | null
          last_fetch_at?: string | null
          max_email_bytes?: number | null
          organization_id: string
          password?: string
          port?: number
          scan_allowed_senders?: string[] | null
          socle_organization_id?: string | null
          updated_at?: string
          use_tls?: boolean
          username?: string
        }
        Update: {
          auto_fetch?: boolean
          created_at?: string
          folder?: string
          host?: string
          id?: string
          is_scan_inbox?: boolean
          label?: string
          last_error?: string | null
          last_fetch_at?: string | null
          max_email_bytes?: number | null
          organization_id?: string
          password?: string
          port?: number
          scan_allowed_senders?: string[] | null
          socle_organization_id?: string | null
          updated_at?: string
          use_tls?: boolean
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "imap_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "imap_settings_socle_organization_id_fkey"
            columns: ["socle_organization_id"]
            isOneToOne: false
            referencedRelation: "socle_organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          read: boolean
          resource_id: string | null
          title: string | null
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          read?: boolean
          resource_id?: string | null
          title?: string | null
          type?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          read?: boolean
          resource_id?: string | null
          title?: string | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_integrations: {
        Row: {
          access_token: string | null
          api_base_url: string | null
          api_key: string | null
          api_url_ticketingapp: string | null
          client_id: string | null
          client_secret: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          last_sync_at: string | null
          organization_id: string
          provider: string
          socle_root_org_id: string | null
        }
        Insert: {
          access_token?: string | null
          api_base_url?: string | null
          api_key?: string | null
          api_url_ticketingapp?: string | null
          client_id?: string | null
          client_secret?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          last_sync_at?: string | null
          organization_id: string
          provider: string
          socle_root_org_id?: string | null
        }
        Update: {
          access_token?: string | null
          api_base_url?: string | null
          api_key?: string | null
          api_url_ticketingapp?: string | null
          client_id?: string | null
          client_secret?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          last_sync_at?: string | null
          organization_id?: string
          provider?: string
          socle_root_org_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_integrations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_users: {
        Row: {
          created_at: string
          id: string
          is_active: boolean | null
          is_signataire: boolean
          organization_id: string
          role: string
          signataire_title: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean | null
          is_signataire?: boolean
          organization_id: string
          role: string
          signataire_title?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean | null
          is_signataire?: boolean
          organization_id?: string
          role?: string
          signataire_title?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_users_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_users_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          address_city: string | null
          address_complement: string | null
          address_postal_code: string | null
          address_street: string | null
          contact_email: string | null
          courier_retention_days: number | null
          created_at: string
          id: string
          logo_url: string | null
          metadata: Json
          multiple_imap: boolean
          name: string
          phone: string | null
          primary_color: string | null
          reply_template_data: string | null
          reply_template_design: Json | null
          reply_template_html: string | null
          reply_template_storage_key: string | null
          secondary_color: string | null
          slug: string
          socle_org_id: string | null
          status: string
          updated_at: string
          website: string | null
        }
        Insert: {
          address_city?: string | null
          address_complement?: string | null
          address_postal_code?: string | null
          address_street?: string | null
          contact_email?: string | null
          courier_retention_days?: number | null
          created_at?: string
          id?: string
          logo_url?: string | null
          metadata?: Json
          multiple_imap?: boolean
          name: string
          phone?: string | null
          primary_color?: string | null
          reply_template_data?: string | null
          reply_template_design?: Json | null
          reply_template_html?: string | null
          reply_template_storage_key?: string | null
          secondary_color?: string | null
          slug: string
          socle_org_id?: string | null
          status?: string
          updated_at?: string
          website?: string | null
        }
        Update: {
          address_city?: string | null
          address_complement?: string | null
          address_postal_code?: string | null
          address_street?: string | null
          contact_email?: string | null
          courier_retention_days?: number | null
          created_at?: string
          id?: string
          logo_url?: string | null
          metadata?: Json
          multiple_imap?: boolean
          name?: string
          phone?: string | null
          primary_color?: string | null
          reply_template_data?: string | null
          reply_template_design?: Json | null
          reply_template_html?: string | null
          reply_template_storage_key?: string | null
          secondary_color?: string | null
          slug?: string
          socle_org_id?: string | null
          status?: string
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      portal_form_submissions: {
        Row: {
          created_at: string
          id: string
          ip_hash: string | null
          portal_form_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          ip_hash?: string | null
          portal_form_id: string
        }
        Update: {
          created_at?: string
          id?: string
          ip_hash?: string | null
          portal_form_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_form_submissions_portal_form_id_fkey"
            columns: ["portal_form_id"]
            isOneToOne: false
            referencedRelation: "portal_forms"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_forms: {
        Row: {
          allowed_origins: string[] | null
          config: Json
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string
          service_id: string | null
          socle_organization_id: string | null
          token: string
          updated_at: string
        }
        Insert: {
          allowed_origins?: string[] | null
          config?: Json
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          service_id?: string | null
          socle_organization_id?: string | null
          token?: string
          updated_at?: string
        }
        Update: {
          allowed_origins?: string[] | null
          config?: Json
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          service_id?: string | null
          socle_organization_id?: string | null
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_forms_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_forms_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_forms_socle_organization_id_fkey"
            columns: ["socle_organization_id"]
            isOneToOne: false
            referencedRelation: "socle_organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      procedure_organizations: {
        Row: {
          created_at: string
          obsoleted_at: string | null
          organization_id: string
          procedure_id: string
          socle_organization_id: string
          synced_at: string
        }
        Insert: {
          created_at?: string
          obsoleted_at?: string | null
          organization_id: string
          procedure_id: string
          socle_organization_id: string
          synced_at?: string
        }
        Update: {
          created_at?: string
          obsoleted_at?: string | null
          organization_id?: string
          procedure_id?: string
          socle_organization_id?: string
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "procedure_organizations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procedure_organizations_procedure_id_fkey"
            columns: ["procedure_id"]
            isOneToOne: false
            referencedRelation: "procedures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procedure_organizations_socle_organization_id_fkey"
            columns: ["socle_organization_id"]
            isOneToOne: false
            referencedRelation: "socle_organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      procedures: {
        Row: {
          agent_description: string | null
          arpege_config_fields: Json | null
          color: string | null
          created_at: string
          created_by: string | null
          description: string | null
          display_order: number
          external_reference_id: string | null
          external_source: string | null
          form_schema: Json | null
          icon: string | null
          id: string
          input_duration_minutes: number | null
          is_displayed: boolean
          keywords: Json | null
          knowledge_base: Json | null
          name: string
          obsoleted_at: string | null
          organization_id: string
          requester_config: Json | null
          socle_category_id: string | null
          socle_id: string | null
          synced_at: string | null
          translations: Json | null
          type: string | null
          updated_at: string
          user_description: string | null
        }
        Insert: {
          agent_description?: string | null
          arpege_config_fields?: Json | null
          color?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_order?: number
          external_reference_id?: string | null
          external_source?: string | null
          form_schema?: Json | null
          icon?: string | null
          id?: string
          input_duration_minutes?: number | null
          is_displayed?: boolean
          keywords?: Json | null
          knowledge_base?: Json | null
          name: string
          obsoleted_at?: string | null
          organization_id: string
          requester_config?: Json | null
          socle_category_id?: string | null
          socle_id?: string | null
          synced_at?: string | null
          translations?: Json | null
          type?: string | null
          updated_at?: string
          user_description?: string | null
        }
        Update: {
          agent_description?: string | null
          arpege_config_fields?: Json | null
          color?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_order?: number
          external_reference_id?: string | null
          external_source?: string | null
          form_schema?: Json | null
          icon?: string | null
          id?: string
          input_duration_minutes?: number | null
          is_displayed?: boolean
          keywords?: Json | null
          knowledge_base?: Json | null
          name?: string
          obsoleted_at?: string | null
          organization_id?: string
          requester_config?: Json | null
          socle_category_id?: string | null
          socle_id?: string | null
          synced_at?: string | null
          translations?: Json | null
          type?: string | null
          updated_at?: string
          user_description?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "procedures_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          description: string | null
          id: string
          name: string
          organization_id: string
        }
        Insert: {
          description?: string | null
          id?: string
          name: string
          organization_id: string
        }
        Update: {
          description?: string | null
          id?: string
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      service_members: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          service_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          service_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          service_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_members_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      service_signatories: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          service_id: string
          signatory_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          service_id: string
          signatory_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          service_id?: string
          signatory_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_signatories_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_signatories_signatory_id_fkey"
            columns: ["signatory_id"]
            isOneToOne: false
            referencedRelation: "signatories"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          address_city: string | null
          address_complement: string | null
          address_postal_code: string | null
          address_street: string | null
          contact_email: string | null
          created_at: string
          created_by: string | null
          email: string | null
          id: string
          imap_settings_id: string | null
          name: string
          organization_id: string
          phone: string | null
          reply_workflow_id: string | null
          updated_at: string
          website: string | null
          workflow_id: string
        }
        Insert: {
          address_city?: string | null
          address_complement?: string | null
          address_postal_code?: string | null
          address_street?: string | null
          contact_email?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          imap_settings_id?: string | null
          name: string
          organization_id: string
          phone?: string | null
          reply_workflow_id?: string | null
          updated_at?: string
          website?: string | null
          workflow_id: string
        }
        Update: {
          address_city?: string | null
          address_complement?: string | null
          address_postal_code?: string | null
          address_street?: string | null
          contact_email?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          imap_settings_id?: string | null
          name?: string
          organization_id?: string
          phone?: string | null
          reply_workflow_id?: string | null
          updated_at?: string
          website?: string | null
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "services_imap_settings_id_fkey"
            columns: ["imap_settings_id"]
            isOneToOne: false
            referencedRelation: "imap_settings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "services_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "services_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      signatories: {
        Row: {
          created_at: string
          created_by: string | null
          first_name: string
          id: string
          last_name: string
          organization_id: string
          signature_storage_key: string | null
          title: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          first_name: string
          id?: string
          last_name: string
          organization_id: string
          signature_storage_key?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          first_name?: string
          id?: string
          last_name?: string
          organization_id?: string
          signature_storage_key?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      smtp_settings: {
        Row: {
          created_at: string
          from_email: string
          from_name: string
          host: string
          id: string
          organization_id: string
          password: string
          port: number
          socle_org_id: string | null
          socle_updated_at: string | null
          synced_at: string | null
          use_tls: boolean
          username: string
        }
        Insert: {
          created_at?: string
          from_email?: string
          from_name?: string
          host?: string
          id?: string
          organization_id: string
          password?: string
          port?: number
          socle_org_id?: string | null
          socle_updated_at?: string | null
          synced_at?: string | null
          use_tls?: boolean
          username?: string
        }
        Update: {
          created_at?: string
          from_email?: string
          from_name?: string
          host?: string
          id?: string
          organization_id?: string
          password?: string
          port?: number
          socle_org_id?: string | null
          socle_updated_at?: string | null
          synced_at?: string | null
          use_tls?: boolean
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "smtp_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      socle_categories: {
        Row: {
          created_at: string
          icon: string | null
          id: string
          name: string
          obsoleted_at: string | null
          organization_id: string
          socle_id: string
          synced_at: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          icon?: string | null
          id?: string
          name: string
          obsoleted_at?: string | null
          organization_id: string
          socle_id: string
          synced_at?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          icon?: string | null
          id?: string
          name?: string
          obsoleted_at?: string | null
          organization_id?: string
          socle_id?: string
          synced_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "socle_categories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      socle_document_types: {
        Row: {
          created_at: string
          id: string
          name: string
          obsoleted_at: string | null
          organization_id: string
          socle_id: string
          synced_at: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          obsoleted_at?: string | null
          organization_id: string
          socle_id: string
          synced_at?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          obsoleted_at?: string | null
          organization_id?: string
          socle_id?: string
          synced_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "socle_document_types_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      socle_organization_members: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          socle_organization_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          socle_organization_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          socle_organization_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "socle_organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "socle_organization_members_socle_organization_id_fkey"
            columns: ["socle_organization_id"]
            isOneToOne: false
            referencedRelation: "socle_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "socle_organization_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      socle_organization_signatories: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          signatory_id: string
          socle_organization_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          signatory_id: string
          socle_organization_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          signatory_id?: string
          socle_organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "socle_organization_signatories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "socle_organization_signatories_signatory_id_fkey"
            columns: ["signatory_id"]
            isOneToOne: false
            referencedRelation: "signatories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "socle_organization_signatories_socle_organization_id_fkey"
            columns: ["socle_organization_id"]
            isOneToOne: false
            referencedRelation: "socle_organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      socle_organizations: {
        Row: {
          address: string | null
          created_at: string
          email: string | null
          id: string
          logo_url: string | null
          name: string
          obsoleted_at: string | null
          organization_id: string
          phone: string | null
          reply_workflow_id: string | null
          slug: string | null
          socle_id: string
          socle_parent_id: string | null
          status: string
          synced_at: string
          type: string | null
          updated_at: string
          workflow_id: string | null
        }
        Insert: {
          address?: string | null
          created_at?: string
          email?: string | null
          id?: string
          logo_url?: string | null
          name: string
          obsoleted_at?: string | null
          organization_id: string
          phone?: string | null
          reply_workflow_id?: string | null
          slug?: string | null
          socle_id: string
          socle_parent_id?: string | null
          status?: string
          synced_at?: string
          type?: string | null
          updated_at?: string
          workflow_id?: string | null
        }
        Update: {
          address?: string | null
          created_at?: string
          email?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          obsoleted_at?: string | null
          organization_id?: string
          phone?: string | null
          reply_workflow_id?: string | null
          slug?: string | null
          socle_id?: string
          socle_parent_id?: string | null
          status?: string
          synced_at?: string
          type?: string | null
          updated_at?: string
          workflow_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "socle_organizations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "socle_organizations_reply_workflow_id_fkey"
            columns: ["reply_workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "socle_organizations_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      socle_sync_runs: {
        Row: {
          counters: Json | null
          created_at: string
          dry_run: boolean
          error: string | null
          finished_at: string | null
          id: string
          organization_id: string
          started_at: string
          status: string
        }
        Insert: {
          counters?: Json | null
          created_at?: string
          dry_run?: boolean
          error?: string | null
          finished_at?: string | null
          id?: string
          organization_id: string
          started_at?: string
          status?: string
        }
        Update: {
          counters?: Json | null
          created_at?: string
          dry_run?: boolean
          error?: string | null
          finished_at?: string | null
          id?: string
          organization_id?: string
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "socle_sync_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          first_name: string | null
          id: string
          is_active: boolean | null
          is_superadmin: boolean
          last_name: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          first_name?: string | null
          id?: string
          is_active?: boolean | null
          is_superadmin?: boolean
          last_name?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          first_name?: string | null
          id?: string
          is_active?: boolean | null
          is_superadmin?: boolean
          last_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      workflow_states: {
        Row: {
          category: Database["public"]["Enums"]["workflow_category"]
          created_at: string
          id: string
          is_final: boolean | null
          is_initial: boolean | null
          is_send: boolean
          name: string
          organization_id: string
          requires_signature: boolean
          workflow_id: string
        }
        Insert: {
          category: Database["public"]["Enums"]["workflow_category"]
          created_at?: string
          id?: string
          is_final?: boolean | null
          is_initial?: boolean | null
          is_send?: boolean
          name: string
          organization_id: string
          requires_signature?: boolean
          workflow_id: string
        }
        Update: {
          category?: Database["public"]["Enums"]["workflow_category"]
          created_at?: string
          id?: string
          is_final?: boolean | null
          is_initial?: boolean | null
          is_send?: boolean
          name?: string
          organization_id?: string
          requires_signature?: boolean
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_states_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_states_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_transitions: {
        Row: {
          condition: Json | null
          created_at: string
          from_state_id: string
          id: string
          kind: string | null
          name: string | null
          organization_id: string
          to_state_id: string
          workflow_id: string
        }
        Insert: {
          condition?: Json | null
          created_at?: string
          from_state_id: string
          id?: string
          kind?: string | null
          name?: string | null
          organization_id: string
          to_state_id: string
          workflow_id: string
        }
        Update: {
          condition?: Json | null
          created_at?: string
          from_state_id?: string
          id?: string
          kind?: string | null
          name?: string | null
          organization_id?: string
          to_state_id?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_transitions_from_state_id_fkey"
            columns: ["from_state_id"]
            isOneToOne: false
            referencedRelation: "workflow_states"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_transitions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_transitions_to_state_id_fkey"
            columns: ["to_state_id"]
            isOneToOne: false
            referencedRelation: "workflow_states"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_transitions_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflows: {
        Row: {
          created_at: string
          id: string
          is_default: boolean | null
          name: string
          organization_id: string
          type: Database["public"]["Enums"]["workflow_type"]
        }
        Insert: {
          created_at?: string
          id?: string
          is_default?: boolean | null
          name: string
          organization_id: string
          type: Database["public"]["Enums"]["workflow_type"]
        }
        Update: {
          created_at?: string
          id?: string
          is_default?: boolean | null
          name?: string
          organization_id?: string
          type?: Database["public"]["Enums"]["workflow_type"]
        }
        Relationships: [
          {
            foreignKeyName: "workflows_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_analysis_jobs: {
        Args: { p_limit?: number }
        Returns: {
          attempts: number
          courier_id: string
          id: string
          kind: string
          organization_id: string
        }[]
      }
      clara_search_tsquery: {
        Args: { p_keywords: string; p_prefix: boolean }
        Returns: unknown
      }
      clear_smtp_settings_from_socle: {
        Args: { p_org_id: string }
        Returns: boolean
      }
      current_user_orgs: { Args: never; Returns: string[] }
      enqueue_courier_analysis: {
        Args: { p_courier_id: string; p_kind?: string }
        Returns: string
      }
      get_cron_secret: { Args: never; Returns: string }
      is_admin_of: { Args: { _org: string }; Returns: boolean }
      is_editor_of: { Args: { _org: string }; Returns: boolean }
      is_member_of: { Args: { _org: string }; Returns: boolean }
      is_superadmin: { Args: { _user_id: string }; Returns: boolean }
      is_transition_guard_bypassed: { Args: never; Returns: boolean }
      partner_integration_status: {
        Args: { p_organization_id: string; p_provider?: string }
        Returns: {
          configured: boolean
          is_active: boolean
        }[]
      }
      purge_expired_data: { Args: never; Returns: Json }
      requeue_stale_analysis_jobs: {
        Args: { p_older_than?: string }
        Returns: number
      }
      search_couriers: {
        Args: {
          p_date_from?: string
          p_date_to?: string
          p_direction?: string
          p_include_null_state?: boolean
          p_keywords?: string
          p_limit?: number
          p_offset?: number
          p_organization_id: string
          p_prefix_match?: boolean
          p_socle_organization_id?: string
          p_sort_by?: string
          p_sort_dir?: string
          p_tag_names?: string[]
          p_transferred_only?: boolean
          p_visible_socle_organization_ids?: string[]
          p_workflow_state_id?: string
          p_workflow_state_ids?: string[]
        }
        Returns: {
          assigned_service: string
          channel: string
          chrono: string
          created_at: string
          direction: string
          id: string
          is_large_email: boolean
          is_transferred: boolean
          match_in: string[]
          organization_id: string
          received_at: string
          recipient_name: string
          sender_first_name: string
          sender_last_name: string
          sender_name: string
          sent_at: string
          socle_organization_id: string
          subject: string
          tags: string[]
          total_count: number
          updated_at: string
          workflow_state_id: string
        }[]
      }
      stats_by_channel: {
        Args: {
          p_org_id: string
          p_since?: string
          p_socle_organization_id?: string
        }
        Returns: {
          channel: string
          count: number
        }[]
      }
      stats_by_service: {
        Args: { p_direction: string; p_org_id: string; p_since?: string }
        Returns: {
          count: number
          service_name: string
          socle_organization_id: string
        }[]
      }
      stats_inbound_by_day: {
        Args: { p_org_id: string; p_socle_organization_id?: string }
        Returns: {
          count: number
          day: string
        }[]
      }
      stats_inbound_by_month: {
        Args: {
          p_months?: number
          p_org_id: string
          p_socle_organization_id?: string
        }
        Returns: {
          count: number
          month: string
        }[]
      }
      stats_processing_times: {
        Args: { p_org_id: string; p_since?: string }
        Returns: {
          avg_days_to_instruction: number
          avg_days_to_processed: number
          courier_count: number
          service_name: string
          socle_organization_id: string
        }[]
      }
      stats_replies_by_month: {
        Args: {
          p_months?: number
          p_org_id: string
          p_socle_organization_id?: string
        }
        Returns: {
          count: number
          month: string
        }[]
      }
      stats_tag_evolution: {
        Args: {
          p_org_id: string
          p_since?: string
          p_socle_organization_id?: string
        }
        Returns: {
          count: number
          period: string
          tag_group: string
          tag_name: string
        }[]
      }
      sync_smtp_settings_from_socle: {
        Args: {
          p_from_email: string
          p_from_name: string
          p_host: string
          p_org_id: string
          p_password: string
          p_port: number
          p_socle_org_id: string
          p_socle_updated_at: string
          p_use_tls: boolean
          p_username: string
        }
        Returns: undefined
      }
      trigger_fetch_inbound_emails: { Args: never; Returns: number }
      trigger_iris_sync: { Args: never; Returns: number }
      trigger_process_analysis_queue: { Args: never; Returns: number }
      trigger_socle_sync: { Args: never; Returns: number }
    }
    Enums: {
      courier_channel: "paper" | "email" | "portal"
      courier_direction: "inbound" | "outbound" | "internal"
      courier_relation_origin: "manual" | "ai_suggestion"
      courier_relation_type: "relance" | "sujet_lie"
      document_type: "original" | "response" | "attachment"
      participant_role: "sender" | "recipient" | "cc"
      sync_status: "pending" | "synced" | "error"
      workflow_category: "pending" | "processing" | "processed" | "archived"
      workflow_type: "inbound" | "reply"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      courier_channel: ["paper", "email", "portal"],
      courier_direction: ["inbound", "outbound", "internal"],
      courier_relation_origin: ["manual", "ai_suggestion"],
      courier_relation_type: ["relance", "sujet_lie"],
      document_type: ["original", "response", "attachment"],
      participant_role: ["sender", "recipient", "cc"],
      sync_status: ["pending", "synced", "error"],
      workflow_category: ["pending", "processing", "processed", "archived"],
      workflow_type: ["inbound", "reply"],
    },
  },
} as const
