// Hand-written types mirroring the external Supabase schema.
// Source: events, uploads, mosaics in the user's existing project.

export type Event = {
  id: string;
  organizer_id: string | null;
  event_name: string | null;
  wedding_date: string | null; // ISO date
  venue: string | null;
  welcome_message: string | null;
  cover_image_url: string | null;
  qr_image_url: string | null;
  slug: string;
  plan: string | null;
  created_at: string;
  // Guest Experience settings — persisted booleans that drive the three
  // toggles in the owner's Settings page and the guest-facing gating.
  guests_can_view_gallery?: boolean | null;
  guestbook_enabled?: boolean | null;
  guestbook_public?: boolean | null;
  // Owner-upload privacy: when false (default) photos uploaded by the couple
  // are hidden from guests. Enforced by the uploads SELECT policy.
  show_owner_uploads_to_guests?: boolean | null;
};

export type EventInsert = {
  id?: string;
  organizer_id?: string | null;
  event_name?: string | null;
  wedding_date?: string | null;
  venue?: string | null;
  welcome_message?: string | null;
  cover_image_url?: string | null;
  qr_image_url?: string | null;
  slug: string;
  plan?: string | null;
  created_at?: string;
  guests_can_view_gallery?: boolean;
  guestbook_enabled?: boolean;
  guestbook_public?: boolean;
  show_owner_uploads_to_guests?: boolean;
};

export type Upload = {
  id: string;
  event_id: string;
  guest_name: string | null;
  image_url: string;
  file_hash: string | null;
  uploaded_at: string;
  guest_uuid: string | null;
  // Stamped server-side by a trigger: true when the couple uploaded the photo.
  uploaded_by_owner?: boolean | null;
  // Optimized Original pipeline (special RAW formats only — DNG/ProRAW).
  // NULL on every normal JPEG/HEIC upload.
  original_format?: string | null;
  optimize_status?: "pending" | "processing" | "ready" | "failed" | string | null;
  optimize_error?: string | null;
  source_path?: string | null;
  original_size_bytes?: number | null;
  optimized_size_bytes?: number | null;
  optimized_at?: string | null;
};

export type UploadInsert = {
  id?: string;
  event_id: string;
  guest_name?: string | null;
  image_url: string;
  file_hash?: string | null;
  uploaded_at?: string;
  guest_uuid?: string | null;
  original_format?: string | null;
  optimize_status?: string | null;
  optimize_error?: string | null;
  source_path?: string | null;
  original_size_bytes?: number | null;
  optimized_size_bytes?: number | null;
  optimized_at?: string | null;
};

export type MosaicStatus =
  | "pending"
  | "queued"
  | "processing"
  | "ready"
  | "deepzoom_ready"
  | "failed"
  | string;

export type Mosaic = {
  id: string;
  event_id: string;
  source_image_url: string | null;
  // Legacy column names (kept optional for backwards-compat with older rows).
  mosaic_image_url?: string | null;
  preview_image_url?: string | null;
  thumb_image_url?: string | null;
  deepzoom_manifest_url?: string | null;
  // Current column names written by the mosaic-worker (see progress.ts).
  // Single-master pipeline: `image_url` holds the DZI manifest URL; there
  // is no separate 8k preview variant anymore.
  image_url?: string | null;
  thumb_url?: string | null;
  preview_url?: string | null;
  print_url?: string | null;

  print_status?: "processing" | "ready" | "failed" | string | null;
  dzi_url?: string | null;
  dzi_status?: "processing" | "ready" | "failed" | string | null;
  tile_base_url?: string | null;
  deepzoom_ready?: boolean | null;
  progress?: number | null;
  deepzoom_progress?: number | null;
  checkpoints?: Record<string, unknown> | null;
  stage?: string | null;
  error?: string | null;
  tiles_json: unknown | null;
  photo_count: number | null;
  tile_count: number | null;
  status: MosaicStatus | null;
  metadata?: {
    matcher?: {
      name?: string;
      uniquePhotosUsed?: number;
      maxReusePerPhoto?: number;
      swapsApplied?: number;
      reassignmentsApplied?: number;
    } | null;
    palette?: { size?: number } | null;
  } | null;
  created_at: string;
  completed_at?: string | null;
};

export type GuestbookMessage = {
  id: string;
  event_id: string;
  guest_name: string | null;
  message: string;
  created_at: string;
};

export type GuestbookMessageInsert = {
  id?: string;
  event_id: string;
  guest_name?: string | null;
  message: string;
  created_at?: string;
};

export type DownloadBatchStatus = "pending" | "processing" | "completed" | "failed";

export type DownloadBatch = {
  id: string;
  event_id: string;
  batch_number: number;
  photo_count: number;
  status: DownloadBatchStatus;
  storage_path: string | null;
  size_bytes: number | null;
  attempts: number;
  worker_id: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};

export type DownloadBatchItem = {
  batch_id: string;
  upload_id: string;
  event_id: string;
};

export type Database = {
  public: {
    Tables: {
      events: {
        Row: Event;
        Insert: EventInsert;
        Update: Partial<EventInsert>;
        Relationships: [];
      };
      uploads: {
        Row: Upload;
        Insert: UploadInsert;
        Update: Partial<UploadInsert>;
        Relationships: [];
      };
      mosaics: {
        Row: Mosaic;
        Insert: Partial<Mosaic> & { event_id: string };
        Update: Partial<Mosaic>;
        Relationships: [];
      };
      download_batches: {
        Row: DownloadBatch;
        Insert: Partial<DownloadBatch> & { event_id: string; batch_number: number };
        Update: Partial<DownloadBatch>;
        Relationships: [];
      };
      download_batch_items: {
        Row: DownloadBatchItem;
        Insert: DownloadBatchItem;
        Update: Partial<DownloadBatchItem>;
        Relationships: [];
      };
      guestbook_messages: {
        Row: GuestbookMessage;
        Insert: GuestbookMessageInsert;
        Update: Partial<GuestbookMessageInsert>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      create_download_batch: {
        Args: { _event_id: string };
        Returns: DownloadBatch | null;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
