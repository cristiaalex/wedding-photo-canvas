/**
 * Mosaic Pet — single source of truth for PUBLIC infrastructure configuration.
 *
 * This module is safe to import from both browser and server code. It must
 * never contain a hard-coded project URL, project id, key or bucket URL.
 * Every value is read from environment configuration so Mosaic Pet can never
 * accidentally point at another product's infrastructure.
 *
 * Public (VITE_) values — safe to ship to the browser:
 *   VITE_PET_SUPABASE_URL              e.g. https://<pet-project>.supabase.co
 *   VITE_PET_SUPABASE_PUBLISHABLE_KEY  the Pet project's anon / publishable key
 *   VITE_PET_SITE_ORIGIN               canonical site origin (default https://mosaic.pet)
 *   VITE_PET_COVERS_BUCKET             public cover images         (default "covers")
 *   VITE_PET_PHOTOS_BUCKET             TEMPORARY customer source photos (default "photos")
 *   VITE_PET_MOSAICS_BUCKET            PERMANENT final mosaic outputs   (default "mosaics")
 *
 * Server-only secrets are declared in `pet-env.server.ts` — never here.
 */

type Env = Record<string, string | undefined>;

function readEnv(name: string): string | undefined {
  const viteEnv = (import.meta as unknown as { env?: Env }).env;
  const fromVite = viteEnv?.[name];
  if (fromVite) return fromVite;
  if (typeof process !== "undefined" && process.env) {
    return process.env[name] || undefined;
  }
  return undefined;
}

/** Sentinel used only when the Pet database has not been configured yet. */
export const PET_SUPABASE_NOT_CONFIGURED_URL = "https://pet-supabase-not-configured.invalid";

export const PET_SUPABASE_URL: string =
  readEnv("VITE_PET_SUPABASE_URL")?.replace(/\/$/, "") ?? PET_SUPABASE_NOT_CONFIGURED_URL;

export const PET_SUPABASE_PUBLISHABLE_KEY: string =
  readEnv("VITE_PET_SUPABASE_PUBLISHABLE_KEY") ?? "pet-supabase-not-configured";

export const isPetSupabaseConfigured: boolean =
  PET_SUPABASE_URL !== PET_SUPABASE_NOT_CONFIGURED_URL &&
  PET_SUPABASE_PUBLISHABLE_KEY !== "pet-supabase-not-configured";

/** Canonical public origin of the Pet product (used for QR codes, Stripe return URLs). */
export const PET_SITE_ORIGIN: string =
  readEnv("VITE_PET_SITE_ORIGIN")?.replace(/\/$/, "") ?? "https://mosaic.pet";

/**
 * Storage buckets — all live inside the Pet Supabase project.
 *  - covers:  public   — cover images
 *  - photos:  private  — temporary customer source photos (short retention;
 *                        can be purged after the final mosaic is produced)
 *  - mosaics: private  — permanent / long-lived final mosaic files, print
 *                        exports and deep-zoom tiles
 */
export const PET_COVERS_BUCKET: string = readEnv("VITE_PET_COVERS_BUCKET") ?? "covers";
export const PET_PHOTOS_BUCKET: string = readEnv("VITE_PET_PHOTOS_BUCKET") ?? "photos";
export const PET_MOSAICS_BUCKET: string = readEnv("VITE_PET_MOSAICS_BUCKET") ?? "mosaics";

/**
 * Stripe metadata tag stamped on Pet customers / payments. The webhook only
 * records purchases carrying this exact tag, so another product's Stripe
 * events can never be recorded as Pet purchases.
 */
export const PET_STRIPE_PRODUCT_TAG = "mosaic_pet_one_time";

/** True when `url` points inside the Pet project's own Storage API. */
export function isPetStorageUrl(url: string): boolean {
  return isPetSupabaseConfigured && url.startsWith(`${PET_SUPABASE_URL}/storage/v1/`);
}
