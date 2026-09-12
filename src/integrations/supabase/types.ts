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
      admin_audit_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_user_id: string
          created_at: string
          detail: Json | null
          id: string
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_user_id: string
          created_at?: string
          detail?: Json | null
          id?: string
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_user_id?: string
          created_at?: string
          detail?: Json | null
          id?: string
          target_id?: string | null
          target_type?: string | null
        }
        Relationships: []
      }
      download_batch_items: {
        Row: {
          batch_id: string
          event_id: string
          upload_id: string
        }
        Insert: {
          batch_id: string
          event_id: string
          upload_id: string
        }
        Update: {
          batch_id?: string
          event_id?: string
          upload_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "download_batch_items_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "download_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "download_batch_items_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "download_batch_items_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      download_batches: {
        Row: {
          attempts: number
          batch_number: number
          completed_at: string | null
          created_at: string
          error: string | null
          event_id: string
          id: string
          photo_count: number
          size_bytes: number | null
          started_at: string | null
          status: string
          storage_path: string | null
          worker_id: string | null
        }
        Insert: {
          attempts?: number
          batch_number: number
          completed_at?: string | null
          created_at?: string
          error?: string | null
          event_id: string
          id?: string
          photo_count?: number
          size_bytes?: number | null
          started_at?: string | null
          status?: string
          storage_path?: string | null
          worker_id?: string | null
        }
        Update: {
          attempts?: number
          batch_number?: number
          completed_at?: string | null
          created_at?: string
          error?: string | null
          event_id?: string
          id?: string
          photo_count?: number
          size_bytes?: number | null
          started_at?: string | null
          status?: string
          storage_path?: string | null
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "download_batches_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          cover_image_url: string | null
          created_at: string
          event_name: string | null
          guestbook_enabled: boolean
          guestbook_public: boolean
          guests_can_view_gallery: boolean
          id: string
          organizer_id: string | null
          plan: string | null
          qr_image_url: string | null
          show_owner_uploads_to_guests: boolean
          slug: string
          venue: string | null
          wedding_date: string | null
          welcome_message: string | null
        }
        Insert: {
          cover_image_url?: string | null
          created_at?: string
          event_name?: string | null
          guestbook_enabled?: boolean
          guestbook_public?: boolean
          guests_can_view_gallery?: boolean
          id?: string
          organizer_id?: string | null
          plan?: string | null
          qr_image_url?: string | null
          show_owner_uploads_to_guests?: boolean
          slug: string
          venue?: string | null
          wedding_date?: string | null
          welcome_message?: string | null
        }
        Update: {
          cover_image_url?: string | null
          created_at?: string
          event_name?: string | null
          guestbook_enabled?: boolean
          guestbook_public?: boolean
          guests_can_view_gallery?: boolean
          id?: string
          organizer_id?: string | null
          plan?: string | null
          qr_image_url?: string | null
          show_owner_uploads_to_guests?: boolean
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
          checkpoints: Json
          completed_at: string | null
          created_at: string
          deepzoom_manifest_url: string | null
          deepzoom_progress: number
          deepzoom_ready: boolean
          dzi_status: string | null
          dzi_url: string | null
          error: string | null
          event_id: string
          id: string
          image_url: string | null
          metadata: Json | null
          mosaic_image_url: string | null
          photo_count: number | null
          preview_url: string | null
          print_status: string | null
          print_url: string | null
          progress: number
          source_image_url: string | null
          stage: string | null
          status: string | null
          thumb_image_url: string | null
          thumb_url: string | null
          tile_base_url: string | null
          tile_count: number | null
          tiles_json: Json | null
          worker_id: string | null
        }
        Insert: {
          checkpoints?: Json
          completed_at?: string | null
          created_at?: string
          deepzoom_manifest_url?: string | null
          deepzoom_progress?: number
          deepzoom_ready?: boolean
          dzi_status?: string | null
          dzi_url?: string | null
          error?: string | null
          event_id: string
          id?: string
          image_url?: string | null
          metadata?: Json | null
          mosaic_image_url?: string | null
          photo_count?: number | null
          preview_url?: string | null
          print_status?: string | null
          print_url?: string | null
          progress?: number
          source_image_url?: string | null
          stage?: string | null
          status?: string | null
          thumb_image_url?: string | null
          thumb_url?: string | null
          tile_base_url?: string | null
          tile_count?: number | null
          tiles_json?: Json | null
          worker_id?: string | null
        }
        Update: {
          checkpoints?: Json
          completed_at?: string | null
          created_at?: string
          deepzoom_manifest_url?: string | null
          deepzoom_progress?: number
          deepzoom_ready?: boolean
          dzi_status?: string | null
          dzi_url?: string | null
          error?: string | null
          event_id?: string
          id?: string
          image_url?: string | null
          metadata?: Json | null
          mosaic_image_url?: string | null
          photo_count?: number | null
          preview_url?: string | null
          print_status?: string | null
          print_url?: string | null
          progress?: number
          source_image_url?: string | null
          stage?: string | null
          status?: string | null
          thumb_image_url?: string | null
          thumb_url?: string | null
          tile_base_url?: string | null
          tile_count?: number | null
          tiles_json?: Json | null
          worker_id?: string | null
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
      stripe_events: {
        Row: {
          id: string
          processed_at: string
          type: string
        }
        Insert: {
          id: string
          processed_at?: string
          type: string
        }
        Update: {
          id?: string
          processed_at?: string
          type?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          amount_total: number | null
          cancel_at_period_end: boolean
          canceled_at: string | null
          created_at: string
          currency: string | null
          current_period_end: string | null
          current_period_start: string | null
          event_id: string | null
          id: string
          paid_at: string | null
          status: string
          stripe_checkout_session_id: string | null
          stripe_customer_id: string
          stripe_payment_intent_id: string | null
          stripe_price_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_total?: number | null
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          created_at?: string
          currency?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          event_id?: string | null
          id?: string
          paid_at?: string | null
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_customer_id: string
          stripe_payment_intent_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_total?: number | null
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          created_at?: string
          currency?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          event_id?: string | null
          id?: string
          paid_at?: string | null
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_customer_id?: string
          stripe_payment_intent_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      uploads: {
        Row: {
          event_id: string
          file_hash: string | null
          guest_name: string | null
          guest_uuid: string | null
          id: string
          image_url: string
          optimize_error: string | null
          optimize_status: string | null
          optimized_at: string | null
          optimized_size_bytes: number | null
          original_format: string | null
          original_size_bytes: number | null
          source_path: string | null
          uploaded_at: string
          uploaded_by_owner: boolean
        }
        Insert: {
          event_id: string
          file_hash?: string | null
          guest_name?: string | null
          guest_uuid?: string | null
          id?: string
          image_url: string
          optimize_error?: string | null
          optimize_status?: string | null
          optimized_at?: string | null
          optimized_size_bytes?: number | null
          original_format?: string | null
          original_size_bytes?: number | null
          source_path?: string | null
          uploaded_at?: string
          uploaded_by_owner?: boolean
        }
        Update: {
          event_id?: string
          file_hash?: string | null
          guest_name?: string | null
          guest_uuid?: string | null
          id?: string
          image_url?: string
          optimize_error?: string | null
          optimize_status?: string | null
          optimized_at?: string | null
          optimized_size_bytes?: number | null
          original_format?: string | null
          original_size_bytes?: number | null
          source_path?: string | null
          uploaded_at?: string
          uploaded_by_owner?: boolean
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
      create_download_batch: {
        Args: { _event_id: string }
        Returns: {
          attempts: number
          batch_number: number
          completed_at: string | null
          created_at: string
          error: string | null
          event_id: string
          id: string
          photo_count: number
          size_bytes: number | null
          started_at: string | null
          status: string
          storage_path: string | null
          worker_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "download_batches"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      finalize_own_upload_delete: {
        Args: { _guest_uuid: string; _upload_id: string }
        Returns: Json
      }
      prepare_own_upload_delete: {
        Args: { _guest_uuid: string; _upload_id: string }
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
