import Stripe from "stripe";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only Stripe + billing helpers.
 *
 * Nothing in this file may be imported from the browser: it reads the Stripe
 * secret key and the external Supabase service-role key. The `.server.ts`
 * suffix keeps it out of client bundles.
 *
 * Cloudflare Workers bind env at REQUEST time, so every value is read inside
 * a function, never at module scope.
 */

export const EXTERNAL_SUPABASE_URL = "https://redjgmjkgdaplgsqjfrg.supabase.co";
export const EXTERNAL_SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_PjmSlDgNlKVPJ1J49xhwZg_Wxi5OfNH";

export class BillingConfigError extends Error {}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new BillingConfigError(`Missing configuration: ${name}`);
  }
  return value;
}

/** Stripe client configured for the Workers runtime (fetch + WebCrypto). */
export function getStripe(): Stripe {
  return new Stripe(requireEnv("STRIPE_SECRET_KEY"), {
    httpClient: Stripe.createFetchHttpClient(),
  });
}

export function getPriceId(): string {
  return requireEnv("STRIPE_PRICE_ID");
}

/**
 * Stripe prices are immutable: a price created as `recurring` can never become
 * one-time. If the configured price id is recurring, fall back to the product's
 * current one-time price (its default price when suitable, otherwise the most
 * recent active one-time price).
 */
export async function resolveOneTimePriceId(): Promise<string> {
  const stripe = getStripe();
  const configured = getPriceId();

  const price = await stripe.prices.retrieve(configured, { expand: ["product"] });
  if (!price.recurring) return price.id;

  const product =
    typeof price.product === "string"
      ? await stripe.products.retrieve(price.product)
      : (price.product as Stripe.Product);

  if (product && !("deleted" in product && product.deleted)) {
    const def = product.default_price;
    const defId = typeof def === "string" ? def : (def?.id ?? null);
    if (defId && defId !== configured) {
      const defPrice = await stripe.prices.retrieve(defId);
      if (!defPrice.recurring && defPrice.active) return defPrice.id;
    }

    const list = await stripe.prices.list({
      product: product.id,
      active: true,
      type: "one_time",
      limit: 10,
    });
    const oneTime = list.data[0];
    if (oneTime) return oneTime.id;
  }

  throw new BillingConfigError(
    "The configured Stripe price is recurring and no active one-time price exists for this product.",
  );
}


export function getWebhookSecret(): string {
  return requireEnv("STRIPE_WEBHOOK_SECRET");
}

/** Service-role client for the external Supabase project. Bypasses RLS. */
export function adminSupabase(): SupabaseClient {
  return createClient(
    EXTERNAL_SUPABASE_URL,
    requireEnv("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/** Client scoped to an organizer's bearer token (RLS applies as that user). */
export function authedSupabase(token: string): SupabaseClient {
  return createClient(EXTERNAL_SUPABASE_URL, EXTERNAL_SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
}

export type AuthedOrganizer = { userId: string; email: string | null; token: string };

/** Resolves the authenticated organizer from the request's bearer token. */
export async function requireOrganizer(
  authHeader: string | null | undefined,
): Promise<AuthedOrganizer> {
  const header = authHeader ?? "";
  if (!header.startsWith("Bearer ")) throw new Error("Unauthorized");
  const token = header.slice("Bearer ".length).trim();
  if (!token) throw new Error("Unauthorized");

  const { data, error } = await authedSupabase(token).auth.getUser(token);
  if (error || !data?.user?.id) throw new Error("Unauthorized");
  return { userId: data.user.id, email: data.user.email ?? null, token };
}

export type PurchaseRow = {
  user_id: string;
  event_id: string | null;
  stripe_customer_id: string;
  stripe_payment_intent_id: string | null;
  stripe_checkout_session_id: string | null;
  stripe_price_id: string | null;
  status: string;
  paid_at: string | null;
  amount_total: number | null;
  currency: string | null;
};

/**
 * Finds (or creates) the Stripe customer for an organizer.
 * Never creates a duplicate: the stored customer id wins, then a Stripe
 * lookup by metadata, and only then a fresh customer.
 */
export async function ensureStripeCustomer(
  organizer: AuthedOrganizer,
): Promise<string> {
  const admin = adminSupabase();
  const stripe = getStripe();

  const { data: existing } = await admin
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", organizer.userId)
    .maybeSingle();

  if (existing?.stripe_customer_id) {
    // Guard against a customer deleted in the Stripe dashboard.
    try {
      const customer = await stripe.customers.retrieve(existing.stripe_customer_id);
      if (!("deleted" in customer) || !customer.deleted) {
        return existing.stripe_customer_id;
      }
    } catch (err) {
      console.error("[billing] stored Stripe customer unusable", err);
    }
  }

  const search = organizer.email
    ? await stripe.customers.list({ email: organizer.email, limit: 10 })
    : { data: [] as Stripe.Customer[] };
  const reusable = search.data.find(
    (c) => c.metadata?.["user_id"] === organizer.userId && !c.deleted,
  );

  const customerId =
    reusable?.id ??
    (
      await stripe.customers.create({
        email: organizer.email ?? undefined,
        metadata: { user_id: organizer.userId, product: "mosaic_wedding_pro" },
      })
    ).id;

  await admin.from("subscriptions").upsert(
    {
      user_id: organizer.userId,
      stripe_customer_id: customerId,
      status: "none",
    },
    { onConflict: "user_id" },
  );

  return customerId;
}

/** Maps a Stripe customer id back to the organizer that owns it. */
async function userIdForCustomer(customerId: string): Promise<string | null> {
  const { data } = await adminSupabase()
    .from("subscriptions")
    .select("user_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  return data?.user_id ?? null;
}

/**
 * Records a confirmed ONE-TIME payment as the organizer's Pro entitlement.
 * Idempotent: keyed on user_id, so webhook replays overwrite the same row.
 */
export async function recordPurchase(input: {
  userId?: string | null;
  eventId?: string | null;
  customerId: string;
  paymentIntentId?: string | null;
  checkoutSessionId?: string | null;
  priceId?: string | null;
  amountTotal?: number | null;
  currency?: string | null;
  paidAt?: string | null;
  /**
   * Immutable per-transaction discount/commission snapshot (or null for a
   * normal full-price purchase). Never recomputed later.
   */
  discount?: Record<string, unknown> | null;
}): Promise<void> {
  const admin = adminSupabase();
  const userId = input.userId ?? (await userIdForCustomer(input.customerId));
  if (!userId) {
    console.error("[billing] cannot map payment to organizer", {
      customer: input.customerId,
      paymentIntent: input.paymentIntentId,
    });
    return;
  }

  const { error } = await admin.from("subscriptions").upsert(
    {
      user_id: userId,
      ...(input.eventId ? { event_id: input.eventId } : {}),
      stripe_customer_id: input.customerId,
      ...(input.paymentIntentId
        ? { stripe_payment_intent_id: input.paymentIntentId }
        : {}),
      ...(input.checkoutSessionId
        ? { stripe_checkout_session_id: input.checkoutSessionId }
        : {}),
      ...(input.priceId ? { stripe_price_id: input.priceId } : {}),
      ...(typeof input.amountTotal === "number"
        ? { amount_total: input.amountTotal }
        : {}),
      ...(input.currency ? { currency: input.currency } : {}),
      ...(input.discount ?? {}),
      status: "paid",
      paid_at: input.paidAt ?? new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  if (error) {
    console.error("[billing] failed to persist purchase", error.message);
    throw new Error("Failed to persist purchase");
  }
}

/** Records a Stripe event id; returns false when it was already processed. */
export async function claimStripeEvent(id: string, type: string): Promise<boolean> {
  const admin = adminSupabase();
  const { error } = await admin.from("stripe_events").insert({ id, type });
  if (!error) return true;
  // 23505 = unique violation → duplicate delivery.
  if ((error as { code?: string }).code === "23505") return false;
  console.error("[billing] stripe_events insert failed", error.message);
  // Fail open: better to reprocess (upserts are idempotent) than to drop.
  return true;
}

