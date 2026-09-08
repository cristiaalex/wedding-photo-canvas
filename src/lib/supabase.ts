import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

// External Supabase project (user-managed). Anon/publishable key is safe in client code.
export const SUPABASE_URL = "https://redjgmjkgdaplgsqjfrg.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_PjmSlDgNlKVPJ1J49xhwZg_Wxi5OfNH";

// Existing Supabase storage buckets (managed by the project owner).
// - covers:  public  — event cover images
// - photos:  private — guest photo uploads (served via signed URLs)
// - mosaics: private — generated mosaic outputs (served via signed URLs)
export const COVERS_BUCKET = "covers";
export const PHOTOS_BUCKET = "photos";
export const MOSAICS_BUCKET = "mosaics";

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
