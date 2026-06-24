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
          organization_id: string
          procedure_id: string
          status: string
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
          organization_id: string
          procedure_id: string
          status?: string
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
          organization_id?: string
          procedure_id?: string
          status?: string
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
        ]
      }
      ai_usage_counters: {
        Row: {
          id: string
          organization_id: string
          period: string
          provider: string
          reserved_tokens: number
          updated_at: string
          used_tokens: number
        }
        Insert: {
          id?: string
          organization_id: string
          period: string
          provider?: string
          reserved_tokens?: number
          updated_at?: string
          used_tokens?: number
        }
        Update: {
          id?: string
          organization_id?: string
          period?: string
          provider?: string
          reserved_tokens?: number
          updated_at?: string
          used_tokens?: number
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_counters_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_usage_events: {
        Row: {
          actual_tokens: number | null
          counter_provider: string | null
          created_at: string
          created_by: string | null
          estimated_tokens: number
          id: string
          organization_id: string
          period: string
          provider: string
          resource_type: string
          settled_at: string | null
          status: string
        }
        Insert: {
          actual_tokens?: number | null
          counter_provider?: string | null
          created_at?: string
          created_by?: string | null
          estimated_tokens: number
          id?: string
          organization_id: string
          period: string
          provider: string
          resource_type: string
          settled_at?: string | null
          status?: string
        }
        Update: {
          actual_tokens?: number | null
          counter_provider?: string | null
          created_at?: string
          created_by?: string | null
          estimated_tokens?: number
          id?: string
          organization_id?: string
          period?: string
          provider?: string
          resource_type?: string
          settled_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_usage_quotas: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          monthly_limit_tokens: number
          organization_id: string
          period_unit: string
          provider: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          monthly_limit_tokens: number
          organization_id: string
          period_unit?: string
          provider?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          monthly_limit_tokens?: number
          organization_id?: string
          period_unit?: string
          provider?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_quotas_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
        Relationships: []
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
        Relationships: []
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
          organization_id: string
          updated_at: string
        }
        Insert: {
          content: string
          courier_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          content?: string
          courier_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
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
          usager_id: string | null
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
          usager_id?: string | null
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
          usager_id?: string | null
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
        }
        Insert: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          organization_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          organization_id?: string
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
          assigned_service: string | null
          channel: Database["public"]["Enums"]["courier_channel"]
          chrono: string | null
          created_at: string
          created_by: string | null
          direction: Database["public"]["Enums"]["courier_direction"]
          fts_body: unknown
          fts_subject: unknown
          id: string
          metadata: Json | null
          organization_id: string
          parent_courier_id: string | null
          received_at: string | null
          sent_at: string | null
          subject: string | null
          updated_at: string
          workflow_state_id: string | null
        }
        Insert: {
          assigned_service?: string | null
          channel: Database["public"]["Enums"]["courier_channel"]
          chrono?: string | null
          created_at?: string
          created_by?: string | null
          direction: Database["public"]["Enums"]["courier_direction"]
          fts_body?: unknown
          fts_subject?: unknown
          id?: string
          metadata?: Json | null
          organization_id: string
          parent_courier_id?: string | null
          received_at?: string | null
          sent_at?: string | null
          subject?: string | null
          updated_at?: string
          workflow_state_id?: string | null
        }
        Update: {
          assigned_service?: string | null
          channel?: Database["public"]["Enums"]["courier_channel"]
          chrono?: string | null
          created_at?: string
          created_by?: string | null
          direction?: Database["public"]["Enums"]["courier_direction"]
          fts_body?: unknown
          fts_subject?: unknown
          id?: string
          metadata?: Json | null
          organization_id?: string
          parent_courier_id?: string | null
          received_at?: string | null
          sent_at?: string | null
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
          label: string
          last_error: string | null
          last_fetch_at: string | null
          organization_id: string
          password: string
          port: number
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
          label?: string
          last_error?: string | null
          last_fetch_at?: string | null
          organization_id: string
          password?: string
          port?: number
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
          label?: string
          last_error?: string | null
          last_fetch_at?: string | null
          organization_id?: string
          password?: string
          port?: number
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
          api_url_ticketingapp: string | null
          client_id: string | null
          client_secret: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          organization_id: string | null
          provider: string
        }
        Insert: {
          access_token?: string | null
          api_base_url?: string | null
          api_url_ticketingapp?: string | null
          client_id?: string | null
          client_secret?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          organization_id?: string | null
          provider: string
        }
        Update: {
          access_token?: string | null
          api_base_url?: string | null
          api_url_ticketingapp?: string | null
          client_id?: string | null
          client_secret?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          organization_id?: string | null
          provider?: string
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
          created_at: string
          domiciliary_file_enabled: boolean
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
          created_at?: string
          domiciliary_file_enabled?: boolean
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
          created_at?: string
          domiciliary_file_enabled?: boolean
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
        ]
      }
      procedures: {
        Row: {
          arpege_config_fields: Json | null
          color: string | null
          created_at: string
          created_by: string | null
          description: string | null
          display_order: number
          external_reference_id: string | null
          external_source: string | null
          icon: string | null
          id: string
          is_displayed: boolean
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          arpege_config_fields?: Json | null
          color?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_order?: number
          external_reference_id?: string | null
          external_source?: string | null
          icon?: string | null
          id?: string
          is_displayed?: boolean
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          arpege_config_fields?: Json | null
          color?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_order?: number
          external_reference_id?: string | null
          external_source?: string | null
          icon?: string | null
          id?: string
          is_displayed?: boolean
          name?: string
          organization_id?: string
          updated_at?: string
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
      quartiers: {
        Row: {
          color: string | null
          created_at: string
          created_by: string | null
          geom: unknown
          id: string
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          geom: unknown
          id?: string
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          geom?: unknown
          id?: string
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quartiers_organization_id_fkey"
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
          updated_at: string
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
          updated_at?: string
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
          updated_at?: string
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
      spatial_ref_sys: {
        Row: {
          auth_name: string | null
          auth_srid: number | null
          proj4text: string | null
          srid: number
          srtext: string | null
        }
        Insert: {
          auth_name?: string | null
          auth_srid?: number | null
          proj4text?: string | null
          srid: number
          srtext?: string | null
        }
        Update: {
          auth_name?: string | null
          auth_srid?: number | null
          proj4text?: string | null
          srid?: number
          srtext?: string | null
        }
        Relationships: []
      }
      usagers: {
        Row: {
          address_apartment: string | null
          address_btq: string | null
          address_building: string | null
          address_city: string | null
          address_complement: string | null
          address_lat: number | null
          address_lon: number | null
          address_number: string | null
          address_postal_code: string | null
          address_street: string | null
          arrival_date: string | null
          birth_date: string | null
          category: Database["public"]["Enums"]["usager_category"]
          civilite: Database["public"]["Enums"]["usager_civilite"] | null
          created_at: string
          created_by: string | null
          death_date: string | null
          departure_date: string | null
          email: string | null
          family_status:
            | Database["public"]["Enums"]["usager_family_status"]
            | null
          first_name: string | null
          id: string
          last_name: string | null
          marriage_date: string | null
          nationality: string | null
          organization_id: string
          pacs_date: string | null
          phone: string | null
          phone_2: string | null
          quartier_auto: boolean
          quartier_id: string | null
          updated_at: string
          usual_name: string | null
        }
        Insert: {
          address_apartment?: string | null
          address_btq?: string | null
          address_building?: string | null
          address_city?: string | null
          address_complement?: string | null
          address_lat?: number | null
          address_lon?: number | null
          address_number?: string | null
          address_postal_code?: string | null
          address_street?: string | null
          arrival_date?: string | null
          birth_date?: string | null
          category?: Database["public"]["Enums"]["usager_category"]
          civilite?: Database["public"]["Enums"]["usager_civilite"] | null
          created_at?: string
          created_by?: string | null
          death_date?: string | null
          departure_date?: string | null
          email?: string | null
          family_status?:
            | Database["public"]["Enums"]["usager_family_status"]
            | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          marriage_date?: string | null
          nationality?: string | null
          organization_id: string
          pacs_date?: string | null
          phone?: string | null
          phone_2?: string | null
          quartier_auto?: boolean
          quartier_id?: string | null
          updated_at?: string
          usual_name?: string | null
        }
        Update: {
          address_apartment?: string | null
          address_btq?: string | null
          address_building?: string | null
          address_city?: string | null
          address_complement?: string | null
          address_lat?: number | null
          address_lon?: number | null
          address_number?: string | null
          address_postal_code?: string | null
          address_street?: string | null
          arrival_date?: string | null
          birth_date?: string | null
          category?: Database["public"]["Enums"]["usager_category"]
          civilite?: Database["public"]["Enums"]["usager_civilite"] | null
          created_at?: string
          created_by?: string | null
          death_date?: string | null
          departure_date?: string | null
          email?: string | null
          family_status?:
            | Database["public"]["Enums"]["usager_family_status"]
            | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          marriage_date?: string | null
          nationality?: string | null
          organization_id?: string
          pacs_date?: string | null
          phone?: string | null
          phone_2?: string | null
          quartier_auto?: boolean
          quartier_id?: string | null
          updated_at?: string
          usual_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "usagers_quartier_id_fkey"
            columns: ["quartier_id"]
            isOneToOne: false
            referencedRelation: "quartiers"
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
      geography_columns: {
        Row: {
          coord_dimension: number | null
          f_geography_column: unknown
          f_table_catalog: unknown
          f_table_name: unknown
          f_table_schema: unknown
          srid: number | null
          type: string | null
        }
        Relationships: []
      }
      geometry_columns: {
        Row: {
          coord_dimension: number | null
          f_geometry_column: unknown
          f_table_catalog: string | null
          f_table_name: unknown
          f_table_schema: unknown
          srid: number | null
          type: string | null
        }
        Insert: {
          coord_dimension?: number | null
          f_geometry_column?: unknown
          f_table_catalog?: string | null
          f_table_name?: unknown
          f_table_schema?: unknown
          srid?: number | null
          type?: string | null
        }
        Update: {
          coord_dimension?: number | null
          f_geometry_column?: unknown
          f_table_catalog?: string | null
          f_table_name?: unknown
          f_table_schema?: unknown
          srid?: number | null
          type?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _postgis_deprecate: {
        Args: { newname: string; oldname: string; version: string }
        Returns: undefined
      }
      _postgis_index_extent: {
        Args: { col: string; tbl: unknown }
        Returns: unknown
      }
      _postgis_pgsql_version: { Args: never; Returns: string }
      _postgis_scripts_pgsql_version: { Args: never; Returns: string }
      _postgis_selectivity: {
        Args: { att_name: string; geom: unknown; mode?: string; tbl: unknown }
        Returns: number
      }
      _postgis_stats: {
        Args: { ""?: string; att_name: string; tbl: unknown }
        Returns: string
      }
      _st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_crosses: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      _st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_intersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      _st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      _st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      _st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_sortablehash: { Args: { geom: unknown }; Returns: number }
      _st_touches: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_voronoi: {
        Args: {
          clip?: unknown
          g1: unknown
          return_polygons?: boolean
          tolerance?: number
        }
        Returns: unknown
      }
      _st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      addauth: { Args: { "": string }; Returns: boolean }
      addgeometrycolumn:
        | {
            Args: {
              catalog_name: string
              column_name: string
              new_dim: number
              new_srid_in: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
      create_quartier_from_geojson: {
        Args: {
          p_color: string
          p_geojson: Json
          p_name: string
          p_org_id: string
        }
        Returns: string
      }
      create_quartiers_batch: {
        Args: { p_items: Json; p_org_id: string }
        Returns: {
          quartier_id: string
          quartier_name: string
        }[]
      }
      current_user_orgs: { Args: never; Returns: string[] }
      disablelongtransactions: { Args: never; Returns: string }
      dropgeometrycolumn:
        | {
            Args: {
              catalog_name: string
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | { Args: { column_name: string; table_name: string }; Returns: string }
      dropgeometrytable:
        | {
            Args: {
              catalog_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | { Args: { schema_name: string; table_name: string }; Returns: string }
        | { Args: { table_name: string }; Returns: string }
      enablelongtransactions: { Args: never; Returns: string }
      equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      geometry: { Args: { "": string }; Returns: unknown }
      geometry_above: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_below: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_cmp: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_contained_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_distance_box: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_distance_centroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_eq: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_ge: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_gt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_le: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_left: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_lt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overabove: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overbelow: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overleft: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overright: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_right: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_within: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geomfromewkt: { Args: { "": string }; Returns: unknown }
      get_cron_secret: { Args: never; Returns: string }
      gettransactionid: { Args: never; Returns: unknown }
      is_admin_of: { Args: { _org: string }; Returns: boolean }
      is_member_of: { Args: { _org: string }; Returns: boolean }
      is_superadmin: { Args: { _user_id: string }; Returns: boolean }
      list_quartiers_geojson: {
        Args: { p_org_id: string }
        Returns: {
          color: string
          geojson: Json
          id: string
          name: string
        }[]
      }
      longtransactionsenabled: { Args: never; Returns: boolean }
      populate_geometry_columns:
        | { Args: { tbl_oid: unknown; use_typmod?: boolean }; Returns: number }
        | { Args: { use_typmod?: boolean }; Returns: string }
      postgis_constraint_dims: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_srid: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_type: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: string
      }
      postgis_extensions_upgrade: { Args: never; Returns: string }
      postgis_full_version: { Args: never; Returns: string }
      postgis_geos_version: { Args: never; Returns: string }
      postgis_lib_build_date: { Args: never; Returns: string }
      postgis_lib_revision: { Args: never; Returns: string }
      postgis_lib_version: { Args: never; Returns: string }
      postgis_libjson_version: { Args: never; Returns: string }
      postgis_liblwgeom_version: { Args: never; Returns: string }
      postgis_libprotobuf_version: { Args: never; Returns: string }
      postgis_libxml_version: { Args: never; Returns: string }
      postgis_proj_version: { Args: never; Returns: string }
      postgis_scripts_build_date: { Args: never; Returns: string }
      postgis_scripts_installed: { Args: never; Returns: string }
      postgis_scripts_released: { Args: never; Returns: string }
      postgis_svn_version: { Args: never; Returns: string }
      postgis_type_name: {
        Args: {
          coord_dimension: number
          geomname: string
          use_new_name?: boolean
        }
        Returns: string
      }
      postgis_version: { Args: never; Returns: string }
      postgis_wagyu_version: { Args: never; Returns: string }
      quartier_for_point: {
        Args: { p_lat: number; p_lon: number; p_org_id: string }
        Returns: string
      }
      recalculate_usager_quartiers: {
        Args: { p_org_id: string }
        Returns: undefined
      }
      release_stale_ai_reservations: {
        Args: { p_max_age_minutes?: number }
        Returns: number
      }
      reserve_ai_usage: {
        Args: {
          p_estimated_tokens: number
          p_org_id: string
          p_provider: string
          p_resource_type: string
          p_user_id: string
        }
        Returns: {
          allowed: boolean
          event_id: string
          reason: string
        }[]
      }
      search_couriers: {
        Args: {
          p_date_from?: string
          p_date_to?: string
          p_direction?: string
          p_keywords?: string
          p_limit?: number
          p_offset?: number
          p_organization_id: string
          p_service?: string
          p_tag_names?: string[]
          p_workflow_state_id?: string
        }
        Returns: {
          assigned_service: string
          direction: string
          id: string
          match_in: string[]
          organization_id: string
          received_at: string
          subject: string
          total_count: number
          workflow_state_id: string
        }[]
      }
      search_usagers: {
        Args: {
          p_birthday_years?: number[]
          p_limit?: number
          p_marriage_anniv_years?: number[]
          p_max_inbound?: number
          p_min_inbound?: number
          p_offset?: number
          p_org_id: string
          p_quartier_ids?: string[]
          p_search?: string
          p_sent_from?: string
          p_sent_to?: string
        }
        Returns: {
          address_apartment: string
          address_btq: string
          address_building: string
          address_city: string
          address_complement: string
          address_lat: number
          address_lon: number
          address_number: string
          address_postal_code: string
          address_street: string
          arrival_date: string
          birth_date: string
          category: Database["public"]["Enums"]["usager_category"]
          civilite: Database["public"]["Enums"]["usager_civilite"]
          created_at: string
          created_by: string
          death_date: string
          departure_date: string
          email: string
          family_status: Database["public"]["Enums"]["usager_family_status"]
          first_name: string
          id: string
          inbound_count: number
          last_name: string
          marriage_date: string
          nationality: string
          organization_id: string
          pacs_date: string
          phone: string
          phone_2: string
          quartier_auto: boolean
          quartier_id: string
          updated_at: string
          usual_name: string
        }[]
      }
      settle_ai_usage: {
        Args: { p_actual_tokens: number; p_event_id: string; p_status: string }
        Returns: undefined
      }
      st_3dclosestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3ddistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_3dlongestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmakebox: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmaxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dshortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_addpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_angle:
        | { Args: { line1: unknown; line2: unknown }; Returns: number }
        | {
            Args: { pt1: unknown; pt2: unknown; pt3: unknown; pt4?: unknown }
            Returns: number
          }
      st_area:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_asencodedpolyline: {
        Args: { geom: unknown; nprecision?: number }
        Returns: string
      }
      st_asewkt: { Args: { "": string }; Returns: string }
      st_asgeojson:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: {
              geom_column?: string
              maxdecimaldigits?: number
              pretty_bool?: boolean
              r: Record<string, unknown>
            }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_asgml:
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
            }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
        | {
            Args: {
              geom: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
      st_askml:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_aslatlontext: {
        Args: { geom: unknown; tmpl?: string }
        Returns: string
      }
      st_asmarc21: { Args: { format?: string; geom: unknown }; Returns: string }
      st_asmvtgeom: {
        Args: {
          bounds: unknown
          buffer?: number
          clip_geom?: boolean
          extent?: number
          geom: unknown
        }
        Returns: unknown
      }
      st_assvg:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_astext: { Args: { "": string }; Returns: string }
      st_astwkb:
        | {
            Args: {
              geom: unknown
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              geom: unknown[]
              ids: number[]
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
      st_asx3d: {
        Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
        Returns: string
      }
      st_azimuth:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: number }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
      st_boundingdiagonal: {
        Args: { fits?: boolean; geom: unknown }
        Returns: unknown
      }
      st_buffer:
        | {
            Args: { geom: unknown; options?: string; radius: number }
            Returns: unknown
          }
        | {
            Args: { geom: unknown; quadsegs: number; radius: number }
            Returns: unknown
          }
      st_centroid: { Args: { "": string }; Returns: unknown }
      st_clipbybox2d: {
        Args: { box: unknown; geom: unknown }
        Returns: unknown
      }
      st_closestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_collect: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_concavehull: {
        Args: {
          param_allow_holes?: boolean
          param_geom: unknown
          param_pctconvex: number
        }
        Returns: unknown
      }
      st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_coorddim: { Args: { geometry: unknown }; Returns: number }
      st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_crosses: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_curvetoline: {
        Args: { flags?: number; geom: unknown; tol?: number; toltype?: number }
        Returns: unknown
      }
      st_delaunaytriangles: {
        Args: { flags?: number; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_difference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_disjoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_distance:
        | {
            Args: { geog1: unknown; geog2: unknown; use_spheroid?: boolean }
            Returns: number
          }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
      st_distancesphere:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
        | {
            Args: { geom1: unknown; geom2: unknown; radius: number }
            Returns: number
          }
      st_distancespheroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_expand:
        | { Args: { box: unknown; dx: number; dy: number }; Returns: unknown }
        | {
            Args: { box: unknown; dx: number; dy: number; dz?: number }
            Returns: unknown
          }
        | {
            Args: {
              dm?: number
              dx: number
              dy: number
              dz?: number
              geom: unknown
            }
            Returns: unknown
          }
      st_force3d: { Args: { geom: unknown; zvalue?: number }; Returns: unknown }
      st_force3dm: {
        Args: { geom: unknown; mvalue?: number }
        Returns: unknown
      }
      st_force3dz: {
        Args: { geom: unknown; zvalue?: number }
        Returns: unknown
      }
      st_force4d: {
        Args: { geom: unknown; mvalue?: number; zvalue?: number }
        Returns: unknown
      }
      st_generatepoints:
        | { Args: { area: unknown; npoints: number }; Returns: unknown }
        | {
            Args: { area: unknown; npoints: number; seed: number }
            Returns: unknown
          }
      st_geogfromtext: { Args: { "": string }; Returns: unknown }
      st_geographyfromtext: { Args: { "": string }; Returns: unknown }
      st_geohash:
        | { Args: { geog: unknown; maxchars?: number }; Returns: string }
        | { Args: { geom: unknown; maxchars?: number }; Returns: string }
      st_geomcollfromtext: { Args: { "": string }; Returns: unknown }
      st_geometricmedian: {
        Args: {
          fail_if_not_converged?: boolean
          g: unknown
          max_iter?: number
          tolerance?: number
        }
        Returns: unknown
      }
      st_geometryfromtext: { Args: { "": string }; Returns: unknown }
      st_geomfromewkt: { Args: { "": string }; Returns: unknown }
      st_geomfromgeojson:
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": string }; Returns: unknown }
      st_geomfromgml: { Args: { "": string }; Returns: unknown }
      st_geomfromkml: { Args: { "": string }; Returns: unknown }
      st_geomfrommarc21: { Args: { marc21xml: string }; Returns: unknown }
      st_geomfromtext: { Args: { "": string }; Returns: unknown }
      st_gmltosql: { Args: { "": string }; Returns: unknown }
      st_hasarc: { Args: { geometry: unknown }; Returns: boolean }
      st_hausdorffdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_hexagon: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_hexagongrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_interpolatepoint: {
        Args: { line: unknown; point: unknown }
        Returns: number
      }
      st_intersection: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_intersects:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_isvaliddetail: {
        Args: { flags?: number; geom: unknown }
        Returns: Database["public"]["CompositeTypes"]["valid_detail"]
        SetofOptions: {
          from: "*"
          to: "valid_detail"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      st_length:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_letters: { Args: { font?: Json; letters: string }; Returns: unknown }
      st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      st_linefromencodedpolyline: {
        Args: { nprecision?: number; txtin: string }
        Returns: unknown
      }
      st_linefromtext: { Args: { "": string }; Returns: unknown }
      st_linelocatepoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_linetocurve: { Args: { geometry: unknown }; Returns: unknown }
      st_locatealong: {
        Args: { geometry: unknown; leftrightoffset?: number; measure: number }
        Returns: unknown
      }
      st_locatebetween: {
        Args: {
          frommeasure: number
          geometry: unknown
          leftrightoffset?: number
          tomeasure: number
        }
        Returns: unknown
      }
      st_locatebetweenelevations: {
        Args: { fromelevation: number; geometry: unknown; toelevation: number }
        Returns: unknown
      }
      st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makebox2d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makeline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makevalid: {
        Args: { geom: unknown; params: string }
        Returns: unknown
      }
      st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_minimumboundingcircle: {
        Args: { inputgeom: unknown; segs_per_quarter?: number }
        Returns: unknown
      }
      st_mlinefromtext: { Args: { "": string }; Returns: unknown }
      st_mpointfromtext: { Args: { "": string }; Returns: unknown }
      st_mpolyfromtext: { Args: { "": string }; Returns: unknown }
      st_multilinestringfromtext: { Args: { "": string }; Returns: unknown }
      st_multipointfromtext: { Args: { "": string }; Returns: unknown }
      st_multipolygonfromtext: { Args: { "": string }; Returns: unknown }
      st_node: { Args: { g: unknown }; Returns: unknown }
      st_normalize: { Args: { geom: unknown }; Returns: unknown }
      st_offsetcurve: {
        Args: { distance: number; line: unknown; params?: string }
        Returns: unknown
      }
      st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_perimeter: {
        Args: { geog: unknown; use_spheroid?: boolean }
        Returns: number
      }
      st_pointfromtext: { Args: { "": string }; Returns: unknown }
      st_pointm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
        }
        Returns: unknown
      }
      st_pointz: {
        Args: {
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_pointzm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_polyfromtext: { Args: { "": string }; Returns: unknown }
      st_polygonfromtext: { Args: { "": string }; Returns: unknown }
      st_project: {
        Args: { azimuth: number; distance: number; geog: unknown }
        Returns: unknown
      }
      st_quantizecoordinates: {
        Args: {
          g: unknown
          prec_m?: number
          prec_x: number
          prec_y?: number
          prec_z?: number
        }
        Returns: unknown
      }
      st_reduceprecision: {
        Args: { geom: unknown; gridsize: number }
        Returns: unknown
      }
      st_relate: { Args: { geom1: unknown; geom2: unknown }; Returns: string }
      st_removerepeatedpoints: {
        Args: { geom: unknown; tolerance?: number }
        Returns: unknown
      }
      st_segmentize: {
        Args: { geog: unknown; max_segment_length: number }
        Returns: unknown
      }
      st_setsrid:
        | { Args: { geog: unknown; srid: number }; Returns: unknown }
        | { Args: { geom: unknown; srid: number }; Returns: unknown }
      st_sharedpaths: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_shortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_simplifypolygonhull: {
        Args: { geom: unknown; is_outer?: boolean; vertex_fraction: number }
        Returns: unknown
      }
      st_split: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_square: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_squaregrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_srid:
        | { Args: { geog: unknown }; Returns: number }
        | { Args: { geom: unknown }; Returns: number }
      st_subdivide: {
        Args: { geom: unknown; gridsize?: number; maxvertices?: number }
        Returns: unknown[]
      }
      st_swapordinates: {
        Args: { geom: unknown; ords: unknown }
        Returns: unknown
      }
      st_symdifference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_symmetricdifference: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_tileenvelope: {
        Args: {
          bounds?: unknown
          margin?: number
          x: number
          y: number
          zoom: number
        }
        Returns: unknown
      }
      st_touches: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_transform:
        | {
            Args: { from_proj: string; geom: unknown; to_proj: string }
            Returns: unknown
          }
        | {
            Args: { from_proj: string; geom: unknown; to_srid: number }
            Returns: unknown
          }
        | { Args: { geom: unknown; to_proj: string }; Returns: unknown }
      st_triangulatepolygon: { Args: { g1: unknown }; Returns: unknown }
      st_union:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
        | {
            Args: { geom1: unknown; geom2: unknown; gridsize: number }
            Returns: unknown
          }
      st_voronoilines: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_voronoipolygons: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_wkbtosql: { Args: { wkb: string }; Returns: unknown }
      st_wkttosql: { Args: { "": string }; Returns: unknown }
      st_wrapx: {
        Args: { geom: unknown; move: number; wrap: number }
        Returns: unknown
      }
      stats_by_channel: {
        Args: { p_org_id: string; p_service_name?: string; p_since?: string }
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
        }[]
      }
      stats_inbound_by_day: {
        Args: { p_org_id: string; p_service_name?: string }
        Returns: {
          count: number
          day: string
        }[]
      }
      stats_inbound_by_month: {
        Args: { p_months?: number; p_org_id: string; p_service_name?: string }
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
        }[]
      }
      stats_replies_by_month: {
        Args: { p_months?: number; p_org_id: string; p_service_name?: string }
        Returns: {
          count: number
          month: string
        }[]
      }
      stats_tag_evolution: {
        Args: { p_org_id: string; p_service_name?: string; p_since?: string }
        Returns: {
          count: number
          period: string
          tag_name: string
        }[]
      }
      stats_usagers_by_quartier: {
        Args: { p_org_id: string }
        Returns: {
          color: string
          count: number
          quartier_id: string
          quartier_name: string
        }[]
      }
      trigger_arpege_sync: { Args: never; Returns: number }
      trigger_fetch_inbound_emails: { Args: never; Returns: number }
      unlockrows: { Args: { "": string }; Returns: number }
      updategeometrysrid: {
        Args: {
          catalogn_name: string
          column_name: string
          new_srid_in: number
          schema_name: string
          table_name: string
        }
        Returns: string
      }
      usagers_outside_quartiers: {
        Args: { p_org_id: string }
        Returns: {
          address_lat: number
          address_lon: number
          first_name: string
          id: string
          last_name: string
        }[]
      }
    }
    Enums: {
      courier_channel: "paper" | "email" | "portal"
      courier_direction: "inbound" | "outbound" | "internal"
      document_type: "original" | "response" | "attachment"
      participant_role: "sender" | "recipient" | "cc"
      sync_status: "pending" | "synced" | "error"
      usager_category: "citoyen" | "entreprise" | "association"
      usager_civilite: "madame" | "monsieur"
      usager_family_status:
        | "celibataire"
        | "marie"
        | "pacse"
        | "inconnu"
        | "divorce"
      workflow_category: "pending" | "processing" | "processed" | "archived"
      workflow_type: "inbound" | "reply"
    }
    CompositeTypes: {
      geometry_dump: {
        path: number[] | null
        geom: unknown
      }
      valid_detail: {
        valid: boolean | null
        reason: string | null
        location: unknown
      }
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      courier_channel: ["paper", "email", "portal"],
      courier_direction: ["inbound", "outbound", "internal"],
      document_type: ["original", "response", "attachment"],
      participant_role: ["sender", "recipient", "cc"],
      sync_status: ["pending", "synced", "error"],
      usager_category: ["citoyen", "entreprise", "association"],
      usager_civilite: ["madame", "monsieur"],
      usager_family_status: [
        "celibataire",
        "marie",
        "pacse",
        "inconnu",
        "divorce",
      ],
      workflow_category: ["pending", "processing", "processed", "archived"],
      workflow_type: ["inbound", "reply"],
    },
  },
} as const
