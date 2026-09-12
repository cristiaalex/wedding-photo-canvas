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
      events: {
        Row: {
          cover_image_url: string | null
          created_at: string
          event_name: string | null
          id: string
          organizer_id: string | null
          plan: string | null
          qr_image_url: string | null
          slug: string
          venue: string | null
          wedding_date: string | null
          welcome_message: string | null
        }
        Insert: {
          cover_image_url?: string | null
          created_at?: string
          event_name?: string | null
          id?: string
          organizer_id?: string | null
          plan?: string | null
          qr_image_url?: string | null
          slug: string
          venue?: string | null
          wedding_date?: string | null
          welcome_message?: string | null
        }
        Update: {
          cover_image_url?: string | null
          created_at?: string
          event_name?: string | null
          id?: string
          organizer_id?: string | null
          plan?: string | null
          qr_image_url?: string | null
          slug?: string
          venue?: string | null
          wedding_date?: string | null
          welcome_message?: string | null
        }
        Relationships: []
      }
      guestbook_messages: {
        Row: {
          created_at: string
          event_id: string
          guest_name: string | null
          id: string
          message: string
        }
        Insert: {
          created_at?: string
          event_id: string
          guest_name?: string | null
          id?: string
          message: string
        }
        Update: {
          created_at?: string
          event_id?: string
          guest_name?: string | null
          id?: string
          message?: string
        }
        Relationships: [
          {
            foreignKeyName: "guestbook_messages_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      mosaics: {
        Row: {
          completed_at: string | null
          created_at: string
          deepzoom_manifest_url: string | null
          event_id: string
          id: string
          mosaic_image_url: string | null
          photo_count: number | null
          source_image_url: string | null
          status: string | null
          thumb_image_url: string | null
          tile_count: number | null
          tiles_json: Json | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          deepzoom_manifest_url?: string | null
          event_id: string
          id?: string
          mosaic_image_url?: string | null
          photo_count?: number | null
          source_image_url?: string | null
          status?: string | null
          thumb_image_url?: string | null
          tile_count?: number | null
          tiles_json?: Json | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          deepzoom_manifest_url?: string | null
          event_id?: string
          id?: string
          mosaic_image_url?: string | null
          photo_count?: number | null
          source_image_url?: string | null
          status?: string | null
          thumb_image_url?: string | null
          tile_count?: number | null
          tiles_json?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "mosaics_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      uploads: {
        Row: {
          event_id: string
          file_hash: string | null
          guest_name: string | null
          id: string
          image_url: string
          uploaded_at: string
        }
        Insert: {
          event_id: string
          file_hash?: string | null
          guest_name?: string | null
          id?: string
          image_url: string
          uploaded_at?: string
        }
        Update: {
          event_id?: string
          file_hash?: string | null
          guest_name?: string | null
          id?: string
          image_url?: string
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "uploads_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
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
      [_ in never]: never
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
  public: {
    Enums: {},
  },
} as const
