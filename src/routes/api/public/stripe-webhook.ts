import { createFileRoute } from "@tanstack/react-router";
import type Stripe from "stripe";

/**
 * Stripe webhook endpoint.
 *
 * Public prefix (external caller = Stripe), so the handler secures itself:
 * every request must carry a valid `stripe-signature` over the RAW body.
 * Processing is idempotent — event ids are claimed in `stripe_events` and all
 * subscription writes are upserts keyed on the organizer.
 */
export const Route = createFileRoute("/api/public/stripe-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const {
          getStripe,
          getWebhookSecret,
          recordPurchase,
          claimStripeEvent,
          BillingConfigError,
        } = await import("@/lib/billing.server");

        let stripe: Stripe;
        let secret: string;
        try {
          stripe = getStripe();
          secret = getWebhookSecret();
        } catch (err) {
          if (err instanceof BillingConfigError) {
            console.error("[stripe-webhook] not configured:", err.message);
            return new Response("Stripe not configured", { status: 500 });
          }
          throw err;
        }

        const signature = request.headers.get("stripe-signature");
        if (!signature) return new Response("Missing signature", { status: 400 });

        const rawBody = await request.text();
        let event: Stripe.Event;
        try {
          event = await stripe.webhooks.constructEventAsync(
            rawBody,
            signature,
            secret,
          );
        } catch (err) {
          console.error(
            "[stripe-webhook] signature verification failed",
            err instanceof Error ? err.message : err,
          );
          return new Response("Invalid signature", { status: 400 });
        }

        const fresh = await claimStripeEvent(event.id, event.type);
        if (!fresh) {
          console.log("[stripe-webhook] duplicate delivery ignored", event.id);
          return new Response("Already processed", { status: 200 });
        }

        try {
          switch (event.type) {
            // Primary signal: the one-time Checkout payment completed.
            case "checkout.session.completed":
            case "checkout.session.async_payment_succeeded": {
              const session = event.data.object;
              if (session.mode !== "payment") break;
              if (session.payment_status !== "paid") break;

              const customerId =
                typeof session.customer === "string"
                  ? session.customer
                  : (session.customer?.id ?? null);
              if (!customerId) break;

              const paymentIntentId =
                typeof session.payment_intent === "string"
                  ? session.payment_intent
                  : (session.payment_intent?.id ?? null);

              // Resolve the purchased price from the line items.
              let priceId: string | null = null;
              try {
                const items = await stripe.checkout.sessions.listLineItems(
                  session.id,
                  { limit: 1 },
                );
                priceId = items.data[0]?.price?.id ?? null;
              } catch (err) {
                console.error("[stripe-webhook] line item lookup failed", err);
              }

              await recordPurchase({
                userId:
                  session.metadata?.["user_id"] ?? session.client_reference_id ?? null,
                eventId: session.metadata?.["event_id"] ?? null,
                customerId,
                paymentIntentId,
                checkoutSessionId: session.id,
                priceId,
                amountTotal: session.amount_total ?? null,
                currency: session.currency ?? null,
                paidAt: new Date(event.created * 1000).toISOString(),
                // Discount snapshot, built from the verified Stripe amounts.
                discount: await (async () => {
                  const applied = session.discounts?.[0];
                  const promoId = applied
                    ? typeof applied.promotion_code === "string"
                      ? applied.promotion_code
                      : (applied.promotion_code?.id ?? null)
                    : null;
                  if (!promoId) return null;
                  try {
                    const { buildDiscountSnapshot } = await import(
                      "@/lib/admin-discounts.server"
                    );
                    return await buildDiscountSnapshot({
                      promotionCodeId: promoId,
                      amountPaidCents: session.amount_total ?? null,
                      amountDiscountCents:
                        session.total_details?.amount_discount ?? null,
                      amountSubtotalCents: session.amount_subtotal ?? null,
                    });
                  } catch (err) {
                    console.error("[stripe-webhook] discount snapshot failed", err);
                    return null;
                  }
                })(),
              });
              break;
            }

            // Safety net for payments confirmed outside the Checkout callback.
            case "payment_intent.succeeded": {
              const intent = event.data.object;
              const customerId =
                typeof intent.customer === "string"
                  ? intent.customer
                  : (intent.customer?.id ?? null);
              if (!customerId) break;
              if (intent.metadata?.["product"] !== "mosaic_wedding_pro") break;

              await recordPurchase({
                userId: intent.metadata?.["user_id"] ?? null,
                eventId: intent.metadata?.["event_id"] ?? null,
                customerId,
                paymentIntentId: intent.id,
                amountTotal: intent.amount_received ?? intent.amount ?? null,
                currency: intent.currency ?? null,
                paidAt: new Date(event.created * 1000).toISOString(),
              });
              break;
            }

            case "checkout.session.expired":
            case "payment_intent.payment_failed": {
              // Nothing to persist: the organizer simply stays on Free.
              console.log("[stripe-webhook] payment not completed", event.type);
              break;
            }

            default:
              console.log("[stripe-webhook] unhandled event type", event.type);
          }
        } catch (err) {

          console.error("[stripe-webhook] handler error", {
            id: event.id,
            type: event.type,
            message: err instanceof Error ? err.message : String(err),
          });
          // 500 → Stripe retries; the duplicate guard makes retries safe.
          return new Response("Handler error", { status: 500 });
        }

        return new Response("ok", { status: 200 });
      },
    },
  },
});
