import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { PET_SITE_ORIGIN, PET_STRIPE_PRODUCT_TAG } from "./pet-config";

/**
 * Client-callable billing RPCs. Every handler resolves the authenticated
 * organizer server-side from the bearer token — client-supplied identifiers
 * are never trusted. Stripe secrets stay inside `billing.server.ts`, which is
 * loaded dynamically so it never enters the client bundle.
 */

function authHeader(): string | null {
  return getRequest()?.headers?.get("authorization") ?? null;
}

function siteOrigin(): string {
  const req = getRequest();
  const origin = req?.headers?.get("origin");
  if (origin) return origin;
  try {
    return new URL(req!.url).origin;
  } catch {
    return PET_SITE_ORIGIN;
  }
}

export type BillingState = {
  status: string;
  plan: "free" | "pro";
  paidAt: string | null;
  priceId: string | null;
  amountTotal: number | null;
  currency: string | null;
  hasCustomer: boolean;
  hasPurchase: boolean;
};

export const getBillingState = createServerFn({ method: "GET" }).handler(
  async (): Promise<BillingState> => {
    const { requireOrganizer, adminSupabase } = await import("./billing.server");
    const organizer = await requireOrganizer(authHeader());
    const admin = adminSupabase();

    const { data, error } = await admin
      .from("subscriptions")
      .select(
        "status, stripe_customer_id, stripe_payment_intent_id, stripe_price_id, paid_at, amount_total, currency",
      )
      .eq("user_id", organizer.userId)
      .maybeSingle();

    if (error) {
      console.error("[billing] state lookup failed", error.message);
      throw new Error("Unable to load billing state");
    }

    if (!data) {
      return {
        status: "none",
        plan: "free",
        paidAt: null,
        priceId: null,
        amountTotal: null,
        currency: null,
        hasCustomer: false,
        hasPurchase: false,
      };
    }

    const paid = data.status === "paid" || Boolean(data.paid_at);

    return {
      status: data.status ?? "none",
      plan: paid ? "pro" : "free",
      paidAt: data.paid_at ?? null,
      priceId: data.stripe_price_id ?? null,
      amountTotal: data.amount_total ?? null,
      currency: data.currency ?? null,
      hasCustomer: Boolean(data.stripe_customer_id),
      hasPurchase: paid,
    };
  },
);

export const createCheckoutSession = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        eventId: z.string().uuid().optional(),
        // Collected at checkout: the address where we send access to the
        // finished mosaic. This is the only point the product asks for it.
        email: z.string().trim().email().max(200).optional(),
        // Raw string only. The discount value, partner and commission are
        // resolved server-side; the browser is never trusted for pricing.
        promoCode: z.string().trim().max(40).optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data }): Promise<{ url: string }> => {
    const {
      requireOrganizer,
      ensureStripeCustomer,
      getStripe,
      resolveOneTimePriceId,
      authedSupabase,
      BillingConfigError,
    } = await import("./billing.server");


    try {
      const organizer = await requireOrganizer(authHeader());

      // Only accept an event the organizer actually owns (RLS-scoped read).
      let eventId: string | null = null;
      if (data.eventId) {
        const { data: ev } = await authedSupabase(organizer.token)
          .from("events")
          .select("id")
          .eq("id", data.eventId)
          .eq("organizer_id", organizer.userId)
          .maybeSingle();
        eventId = ev?.id ?? null;
      }

      const customerId = await ensureStripeCustomer(organizer);

      // Anonymous studio sessions have no email yet; stamp the checkout
      // address on the Stripe customer so receipts reach the right inbox.
      const checkoutEmail = data.email?.toLowerCase() ?? organizer.email ?? null;
      if (checkoutEmail && checkoutEmail !== organizer.email) {
        try {
          await getStripe().customers.update(customerId, { email: checkoutEmail });
        } catch (err) {
          console.error("[billing] could not store checkout email", err);
        }
      }
      const origin = siteOrigin();

      const metadata = {
        user_id: organizer.userId,
        product: PET_STRIPE_PRODUCT_TAG,
        ...(eventId ? { event_id: eventId } : {}),
        ...(checkoutEmail ? { customer_email: checkoutEmail } : {}),
      };

      const priceId = await resolveOneTimePriceId();

      // Optional discount code: validated server-side (status, expiry, usage
      // limit, per-customer limit) before it is attached to the session.
      let discounts:
        | Array<{ promotion_code: string }>
        | undefined;
      if (data.promoCode) {
        const { resolveDiscountForCheckout } = await import(
          "./admin-discounts.server"
        );
        const resolved = await resolveDiscountForCheckout(data.promoCode, organizer);
        discounts = [{ promotion_code: resolved.promotionCodeId }];
        (metadata as Record<string, string>)["discount_code"] = resolved.row.code;
      }

      const session = await getStripe().checkout.sessions.create({
        mode: "payment",
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        // EUR only. Stripe Adaptive Pricing would otherwise present a local
        // currency (e.g. RON) plus a conversion fee; the price is EUR and the
        // customer must always see the EUR amount.
        ...({ adaptive_pricing: { enabled: false } } as Record<string, unknown>),
        // Managed Payments is on by default on some accounts and requires a
        // product tax code; we bill a single digital service, so opt out.
        ...({ managed_payments: { enabled: false } } as Record<string, unknown>),
        // Disable Stripe Automatic Tax so the one-time price is charged as-is.
        automatic_tax: { enabled: false },
        // One purchase = one discount. `discounts` and `allow_promotion_codes`
        // are mutually exclusive in Stripe, so a session pre-loaded with a
        // Mosaic-validated code never shows a promotion-code field, and a
        // session without one accepts exactly one Stripe promotion code.
        ...(discounts ? { discounts } : { allow_promotion_codes: true }),
        client_reference_id: organizer.userId,
        invoice_creation: { enabled: true },
        // Pet returns the customer to their mosaic studio, where the
        // "being finished" state and the final download live.
        success_url: `${origin}/mosaic?billing=success&session_id={CHECKOUT_SESSION_ID}${eventId ? `&event=${eventId}` : ""}`,
        cancel_url: `${origin}/mosaic?billing=cancelled${eventId ? `&event=${eventId}` : ""}`,
        metadata,
        payment_intent_data: { metadata },
      });

      if (!session.url) throw new Error("Stripe returned no checkout URL");
      return { url: session.url };
    } catch (err) {
      console.error("[billing] checkout session failed", err);
      if (err instanceof BillingConfigError) {
        throw new Error(`Payments are not configured yet. ${err.message}`);
      }
      if (err instanceof Error && err.message === "Unauthorized") throw err;
      // Discount rejections are user-facing and already worded for customers.
      if (err instanceof Error && err.constructor?.name === "DiscountError") {
        throw new Error(err.message);
      }
      const detail = err instanceof Error && err.message ? ` (${err.message})` : "";
      throw new Error(`Could not start checkout. Please try again.${detail}`);
    }
  });



export const createPortalSession = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ url: string }> => {
    const { requireOrganizer, adminSupabase, getStripe, BillingConfigError } =
      await import("./billing.server");

    try {
      const organizer = await requireOrganizer(authHeader());
      const { data } = await adminSupabase()
        .from("subscriptions")
        .select("stripe_customer_id")
        .eq("user_id", organizer.userId)
        .maybeSingle();

      if (!data?.stripe_customer_id) {
        throw new Error("No billing account yet. Upgrade first.");
      }

      const session = await getStripe().billingPortal.sessions.create({
        customer: data.stripe_customer_id,
        return_url: `${siteOrigin()}/mosaic`,
      });
      return { url: session.url };
    } catch (err) {
      console.error("[billing] portal session failed", err);
      if (err instanceof BillingConfigError) {
        throw new Error("Payments are not configured yet.");
      }
      if (err instanceof Error && /Unauthorized|billing account/.test(err.message)) {
        throw err;
      }
      if (err instanceof Error && /No configuration provided|default configuration has not been created/i.test(err.message)) {
        throw new Error(
          "The billing portal isn't set up in Stripe yet. Activate the customer portal in your Stripe settings, then try again.",
        );
      }
      throw new Error("Could not open the billing portal. Please try again.");
    }
  },
);

/**
 * Post-Stripe return lookup. Verifies the checkout session server-side and
 * resolves the exact event from its metadata. It never unlocks downloads —
 * it only tells the page which event to load and whether the current
 * session still owns it (ownership checked with the caller's RLS scope).
 */
export const resolveCheckoutReturn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ sessionId: z.string().trim().regex(/^cs_[A-Za-z0-9_]+$/).max(255) }).parse(input),
  )
  .handler(async ({ data }): Promise<{ eventId: string | null; owned: boolean }> => {
    const { requireOrganizer, getStripe, authedSupabase } = await import("./billing.server");
    const organizer = await requireOrganizer(authHeader());
    let session;
    try {
      session = await getStripe().checkout.sessions.retrieve(data.sessionId);
    } catch (err) {
      console.error("[billing] checkout return lookup failed", err);
      return { eventId: null, owned: false };
    }
    const meta = session.metadata ?? {};
    if (meta["product"] !== PET_STRIPE_PRODUCT_TAG || session.mode !== "payment") {
      return { eventId: null, owned: false };
    }
    const eventId = meta["event_id"] ?? null;
    if (!eventId) return { eventId: null, owned: false };
    const { data: ev } = await authedSupabase(organizer.token)
      .from("events")
      .select("id")
      .eq("id", eventId)
      .eq("organizer_id", organizer.userId)
      .maybeSingle();
    return { eventId, owned: Boolean(ev?.id) };
  });
