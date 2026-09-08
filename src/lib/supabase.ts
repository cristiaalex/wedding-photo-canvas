import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import {
  PET_SUPABASE_URL,
  PET_SUPABASE_PUBLISHABLE_KEY,
  PET_COVERS_BUCKET,
  PET_PHOTOS_BUCKET,
  PET_MOSAICS_BUCKET,
  isPetSupabaseConfigured,
} from "./pet-config";

// Mosaic Pet browser client. Connection values come exclusively from
// `pet-config.ts` (environment-driven) — nothing is hard-coded here.
export const SUPABASE_URL = PET_SUPABASE_URL;
export const SUPABASE_PUBLISHABLE_KEY = PET_SUPABASE_PUBLISHABLE_KEY;

// Storage buckets inside the Pet project (see pet-config.ts for retention design).
export const COVERS_BUCKET = PET_COVERS_BUCKET;
export const PHOTOS_BUCKET = PET_PHOTOS_BUCKET;
export const MOSAICS_BUCKET = PET_MOSAICS_BUCKET;

if (!isPetSupabaseConfigured && typeof console !== "undefined") {
  console.warn(
    "[mosaic-pet] Pet database is not configured yet. Set VITE_PET_SUPABASE_URL and VITE_PET_SUPABASE_PUBLISHABLE_KEY.",
  );
}

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: typeof window !== "undefined" ? localStorage : undefined,
    persistSession: true,
    autoRefreshToken: true,
    // Implicit flow: magic link verification returns #access_token & #refresh_token
    // in the URL fragment. PKCE was unreliable because the code_verifier stored at
    // link-request time was missing at callback time (different browser/storage on
    // mobile mail handoff), causing "PKCE code verifier not found in storage".
    detectSessionInUrl: true,
    flowType: "implicit",
  },
});
