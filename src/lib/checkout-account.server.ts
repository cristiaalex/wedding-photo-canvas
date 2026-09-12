import { createClient } from "@supabase/supabase-js";
import {
  PET_SUPABASE_URL,
  PET_SUPABASE_PUBLISHABLE_KEY,
  PET_SITE_ORIGIN,
} from "./pet-config";
import { requirePetEnv } from "./pet-env.server";
import { adminSupabase } from "./billing.server";

/**
 * Anonymous → customer account handover for Mosaic Pet.
 *
 * Before checkout the customer works inside a Supabase anonymous session, so
 * every project / upload / mosaic row already has a real `organizer_id` and all
 * existing RLS and storage policies keep working unchanged.
 *
 * At checkout we collect an email address. After a successful payment the
 * anonymous account is either promoted to that email (the normal case) or, when
 * the email already belongs to a returning customer, the project is moved to
 * that existing account. Nothing is ever recreated.
 *
 * Server-only: reads the service-role key. Never import from the browser.
 */

type AdminUser = { id: string; email: string | null };

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Looks an auth user up by email through the GoTrue admin API. */
async function findUserByEmail(email: string): Promise<AdminUser | null> {
  const key = requirePetEnv("SUPABASE_SERVICE_ROLE_KEY");
  const url = `${PET_SUPABASE_URL}/auth/v1/admin/users?filter=${encodeURIComponent(email)}`;
  const response = await fetch(url, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { users?: AdminUser[] };
  const match = (body.users ?? []).find(
    (user) => (user.email ?? "").toLowerCase() === email,
  );
  return match ?? null;
}

/**
 * Associates the paid project with an account for `email`.
 * Returns the user id that now owns the project.
 */
export async function linkPurchaseToEmail(input: {
  payingUserId: string | null;
  email: string | null;
  eventId: string | null;
}): Promise<string | null> {
  const { payingUserId, eventId } = input;
  if (!payingUserId) return null;
  const email = input.email ? normalizeEmail(input.email) : null;
  if (!email) return payingUserId;

  const admin = adminSupabase();

  // 1. Promote the (anonymous) paying account to the checkout email.
  const promoted = await admin.auth.admin.updateUserById(payingUserId, {
    email,
    email_confirm: true,
  });
  if (!promoted.error) return payingUserId;

  // 2. Email already belongs to a returning customer → move the project there.
  const existing = await findUserByEmail(email);
  if (!existing || existing.id === payingUserId) {
    console.error(
      "[checkout] could not attach email to account",
      promoted.error.message,
    );
    return payingUserId;
  }

  if (eventId) {
    const { error } = await admin
      .from("events")
      .update({ organizer_id: existing.id })
      .eq("id", eventId);
    if (error) {
      console.error("[checkout] project transfer failed", error.message);
      return payingUserId;
    }
  }
  return existing.id;
}

/** Marks the purchased project as paid so the studio can unlock the download. */
export async function markProjectPaid(eventId: string | null): Promise<void> {
  if (!eventId) return;
  const { error } = await adminSupabase()
    .from("events")
    .update({ payment_status: "paid" })
    .eq("id", eventId);
  if (error) console.error("[checkout] could not mark project paid", error.message);
}

/**
 * Sends the customer a passwordless sign-in link so they can reach their
 * mosaic from any device. Uses the existing magic-link architecture.
 */
export async function sendAccessEmail(email: string | null): Promise<void> {
  if (!email) return;
  try {
    const client = createClient(PET_SUPABASE_URL, PET_SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await client.auth.signInWithOtp({
      email: normalizeEmail(email),
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${PET_SITE_ORIGIN}/auth/callback`,
      },
    });
    if (error) console.error("[checkout] access email failed", error.message);
  } catch (err) {
    console.error("[checkout] access email failed", err);
  }
}
