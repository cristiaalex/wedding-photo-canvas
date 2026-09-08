import process from "node:process";

/**
 * Mosaic Pet — single source of truth for SERVER-ONLY secrets.
 *
 * The `.server.ts` suffix keeps this file out of browser bundles. Values are
 * read inside functions (never at module scope) because the edge runtime
 * binds env at request time.
 *
 * All names are PET_-prefixed on purpose: Mosaic Pet never reads the legacy
 * secret slots inherited from the project it was cloned from
 * (EXTERNAL_SUPABASE_SERVICE_ROLE_KEY, STRIPE_*, WORKER_*, MOSAIC_ADMIN_EMAILS).
 * Those slots are ignored entirely, so even if they held another product's
 * credentials they can never be used here.
 *
 * NONE of these values are set yet. Provision them only once the Pet
 * database, worker deployment and Stripe account exist.
 */
export const PET_SERVER_ENV = {
  /** Service-role key of the Pet Supabase project. Bypasses RLS. */
  SUPABASE_SERVICE_ROLE_KEY: "PET_SUPABASE_SERVICE_ROLE_KEY",
  /** Base URL of the Pet mosaic-worker deployment (own deployment, not shared). */
  WORKER_URL: "PET_WORKER_URL",
  /** Bearer token the Pet worker expects. Generate fresh; never reuse another product's. */
  WORKER_API_TOKEN: "PET_WORKER_API_TOKEN",
  /** Stripe secret key of the Pet Stripe account. */
  STRIPE_SECRET_KEY: "PET_STRIPE_SECRET_KEY",
  /** Stripe one-time price id for the Pet purchase. */
  STRIPE_PRICE_ID: "PET_STRIPE_PRICE_ID",
  /** Stripe webhook signing secret for the Pet webhook endpoint. */
  STRIPE_WEBHOOK_SECRET: "PET_STRIPE_WEBHOOK_SECRET",
  /** Comma-separated allow-list of Pet administrator emails. */
  ADMIN_EMAILS: "PET_ADMIN_EMAILS",
} as const;

export type PetServerEnvKey = keyof typeof PET_SERVER_ENV;

export class PetConfigError extends Error {}

/** Reads an optional Pet secret (undefined when not provisioned). */
export function petEnv(key: PetServerEnvKey): string | undefined {
  return process.env[PET_SERVER_ENV[key]] || undefined;
}

/** Reads a required Pet secret; throws a clear error naming the missing variable. */
export function requirePetEnv(key: PetServerEnvKey): string {
  const value = petEnv(key);
  if (!value) {
    throw new PetConfigError(`Missing Mosaic Pet configuration: ${PET_SERVER_ENV[key]}`);
  }
  return value;
}

/** Resolved worker endpoint + token for the Pet worker deployment. */
export function petWorkerEndpoint(path: string): { url: string; token: string } {
  const workerUrl = petEnv("WORKER_URL");
  const workerToken = petEnv("WORKER_API_TOKEN");
  if (!workerUrl || !workerToken) {
    throw new PetConfigError(
      "Worker is not configured (PET_WORKER_URL / PET_WORKER_API_TOKEN missing).",
    );
  }
  return { url: `${workerUrl.replace(/\/$/, "")}${path}`, token: workerToken };
}
