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
      courier_participants: {
        Row: {
          address: string | null
          courier_id: string
          email: string | null
          id: string
          metadata: Json | null
          name: string | null
          organization: string | null
          organization_id: string
          role: Database["public"]["Enums"]["participant_role"]
        }
        Insert: {
          address?: string | null
          courier_id: string
          email?: string | null
          id?: string
          metadata?: Json | null
          name?: string | null
          organization?: string | null
          organization_id: string
          role: Database["public"]["Enums"]["participant_role"]
        }
        Update: {
          address?: string | null
          courier_id?: string
          email?: string | null
          id?: string
          metadata?: Json | null
          name?: string | null
          organization?: string | null
          organization_id?: string
          role?: Database["public"]["Enums"]["participant_role"]
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
      couriers: {
        Row: {
          assigned_service: string | null
          channel: Database["public"]["Enums"]["courier_channel"]
          chrono: string | null
          created_at: string
          created_by: string | null
          direction: Database["public"]["Enums"]["courier_direction"]
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
          organization_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean | null
          organization_id: string
          role: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean | null
          organization_id?: string
          role?: string
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
          created_at: string
          id: string
          logo_url: string | null
          metadata: Json
          name: string
          primary_color: string | null
          secondary_color: string | null
          slug: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          logo_url?: string | null
          metadata?: Json
          name: string
          primary_color?: string | null
          secondary_color?: string | null
          slug: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          logo_url?: string | null
          metadata?: Json
          name?: string
          primary_color?: string | null
          secondary_color?: string | null
          slug?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
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
      users: {
        Row: {
          created_at: string
          email: string
          first_name: string | null
          id: string
          is_active: boolean | null
          is_superadmin: boolean
          last_name: string | null
          password_hash: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          first_name?: string | null
          id?: string
          is_active?: boolean | null
          is_superadmin?: boolean
          last_name?: string | null
          password_hash?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          first_name?: string | null
          id?: string
          is_active?: boolean | null
          is_superadmin?: boolean
          last_name?: string | null
          password_hash?: string | null
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
          name: string
          organization_id: string
          workflow_id: string
        }
        Insert: {
          category: Database["public"]["Enums"]["workflow_category"]
          created_at?: string
          id?: string
          is_final?: boolean | null
          is_initial?: boolean | null
          name: string
          organization_id: string
          workflow_id: string
        }
        Update: {
          category?: Database["public"]["Enums"]["workflow_category"]
          created_at?: string
          id?: string
          is_final?: boolean | null
          is_initial?: boolean | null
          name?: string
          organization_id?: string
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
        }
        Insert: {
          created_at?: string
          id?: string
          is_default?: boolean | null
          name: string
          organization_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_default?: boolean | null
          name?: string
          organization_id?: string
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
      [_ in never]: never
    }
    Enums: {
      courier_channel: "paper" | "email" | "portal"
      courier_direction: "inbound" | "outbound" | "internal"
      document_type: "original" | "response" | "attachment"
      participant_role: "sender" | "recipient" | "cc"
      sync_status: "pending" | "synced" | "error"
      workflow_category: "pending" | "processing" | "processed" | "archived"
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
      workflow_category: ["pending", "processing", "processed", "archived"],
    },
  },
} as const
