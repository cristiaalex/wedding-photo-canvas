// Hand-written types mirroring the Mosaic Pet database schema
// (supabase/migrations-external/*.sql). Pet product columns added by
// 20260909_pet_product_model.sql are optional so existing code keeps compiling.

export type PetOrientation = "portrait" | "landscape" | "square";
export type PetProcessingStatus =
  | "draft"
  | "uploads_complete"
  | "preview_queued"
  | "preview_processing"
  | "preview_ready"
  | "final_queued"
  | "final_processing"
  | "final_ready"
  | "failed";
export type PetPaymentStatus = "unpaid" | "pending" | "paid" | "refunded" | "failed";
export type PetDownloadStatus = "unavailable" | "available" | "downloaded" | "expired";
export type PetSourceCleanupStatus = "pending" | "scheduled" | "running" | "done" | "failed" | "skipped";

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

  // --- Mosaic Pet project / order model (20260909_pet_product_model) ---
  product_kind?: string | null;
  customer_email?: string | null;
  pet_name?: string | null;
  main_upload_id?: string | null;
  orientation?: PetOrientation | null;
  print_size?: string | null;
  processing_status?: PetProcessingStatus | string | null;
  payment_status?: PetPaymentStatus | string | null;
  paid_at?: string | null;
  download_status?: PetDownloadStatus | string | null;
  download_expires_at?: string | null;
  source_cleanup_status?: PetSourceCleanupStatus | string | null;
  source_cleanup_at?: string | null;
  source_cleanup_error?: string | null;
  source_bytes_total?: number | null;
  uploads_completed_at?: string | null;
  preview_requested_at?: string | null;
  preview_ready_at?: string | null;
  final_requested_at?: string | null;
  final_ready_at?: string | null;
  updated_at?: string | null;
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
  product_kind?: string | null;
  customer_email?: string | null;
  pet_name?: string | null;
  main_upload_id?: string | null;
  orientation?: PetOrientation | null;
  print_size?: string | null;
  processing_status?: PetProcessingStatus | string | null;
  payment_status?: PetPaymentStatus | string | null;
  download_status?: PetDownloadStatus | string | null;
  source_cleanup_status?: PetSourceCleanupStatus | string | null;
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
  // --- Mosaic Pet source lifecycle (20260909_pet_product_model) ---
  source_kind?: "photo" | "zip" | "zip_entry" | string | null;
  parent_upload_id?: string | null;
  storage_path?: string | null;
  size_bytes?: number | null;
  width_px?: number | null;
  height_px?: number | null;
  processing_status?: string | null;
  processing_error?: string | null;
  extracted_count?: number | null;
  processed_at?: string | null;
  deleted_at?: string | null;
  updated_at?: string | null;
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
  source_kind?: "photo" | "zip" | "zip_entry" | string | null;
  parent_upload_id?: string | null;
  storage_path?: string | null;
  size_bytes?: number | null;
  width_px?: number | null;
  height_px?: number | null;
  processing_status?: string | null;
  processing_error?: string | null;
  extracted_count?: number | null;
  processed_at?: string | null;
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
  // --- Mosaic Pet preview/final lifecycle (20260909_pet_product_model) ---
  job_kind?: "preview" | "final" | string | null;
  orientation?: PetOrientation | null;
  print_size?: string | null;
  main_upload_id?: string | null;
  preview_storage_path?: string | null;
  preview_size_bytes?: number | null;
  preview_width_px?: number | null;
  preview_height_px?: number | null;
  preview_ready_at?: string | null;
  final_storage_path?: string | null;
  final_size_bytes?: number | null;
  final_width_px?: number | null;
  final_height_px?: number | null;
  final_format?: string | null;
  final_ready_at?: string | null;
  final_verified_at?: string | null;
  final_available?: boolean | null;
  expires_at?: string | null;
  download_count?: number | null;
  first_downloaded_at?: string | null;
  last_downloaded_at?: string | null;
  queued_at?: string | null;
  started_at?: string | null;
  print_completed_at?: string | null;
  dzi_completed_at?: string | null;
  failed_at?: string | null;
  sources_released_at?: string | null;
  updated_at?: string | null;
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
