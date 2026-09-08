import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles, CreditCard, Loader2 } from "lucide-react";
import {
  getBillingState,
  createCheckoutSession,
  createPortalSession,
  type BillingState,
} from "@/lib/billing.functions";

/**
 * Billing / subscription panel for the organizer dashboard.
 * Purely informational for now — it never gates any feature.
 */
export function BillingCard({ eventId }: { eventId?: string }) {
  const loadState = useServerFn(getBillingState);
  const startCheckout = useServerFn(createCheckoutSession);
  const openPortal = useServerFn(createPortalSession);

  const [state, setState] = useState<BillingState | null>(null);
  const [busy, setBusy] = useState<"checkout" | "portal" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [justUpgraded, setJustUpgraded] = useState(false);
  // Optional discount code. Only the raw string is sent; the discount itself
  // is validated and applied server-side.
  const [promo, setPromo] = useState("");
  const [showPromo, setShowPromo] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setState(await loadState());
    } catch (err) {
      console.error(err);
      setState(null);
    }
  }, [loadState]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Success return from Stripe Checkout. The webhook is authoritative, so we
  // simply re-read the stored state (with one delayed retry for webhook lag).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("billing") !== "success") return;
    setJustUpgraded(true);
    const t = window.setTimeout(() => void refresh(), 2500);
    window.history.replaceState({}, "", window.location.pathname);
    return () => window.clearTimeout(t);
  }, [refresh]);

  const plan = state?.plan ?? "free";
  const label = statusLabel(state);
  const purchased = state?.paidAt
    ? new Date(state.paidAt).toLocaleDateString(undefined, {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  async function handleUpgrade() {
    setBusy("checkout");
    setError(null);
    try {
      const { url } = await startCheckout({
        data: {
          ...(eventId ? { eventId } : {}),
          ...(promo.trim() ? { promoCode: promo.trim() } : {}),
        },
      });
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(null);
    }
  }

  async function handlePortal() {
    setBusy("portal");
    setError(null);
    try {
      const { url } = await openPortal();
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(null);
    }
  }

  return (
    <article className="overflow-hidden rounded-[1rem] surface-fade shadow-[var(--shadow-soft)]">
      <div className="p-5 sm:p-6 md:p-8">
        <p className="text-eyebrow text-muted-foreground">Your plan</p>

        <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-display text-2xl sm:text-3xl">{label}</h2>
            {justUpgraded && plan !== "pro" && (
              <p className="mt-2 text-sm text-muted-foreground">
                Payment received — finishing up. This will refresh in a moment.
              </p>
            )}
            {plan === "pro" && (
              <p className="mt-2 text-sm text-muted-foreground">
                {purchased
                  ? `One-time purchase on ${purchased} — yours for good.`
                  : "One-time purchase — yours for good."}
              </p>
            )}
            {plan === "free" && !justUpgraded && (
              <p className="mt-2 text-sm text-muted-foreground">
                Everything works as it does today. Pro is a single one-time
                payment — no subscription, no renewals.
              </p>
            )}
          </div>

          <div className="shrink-0">
            {state?.hasPurchase && state?.hasCustomer ? (
              <button
                type="button"
                onClick={handlePortal}
                disabled={busy !== null}
                className="btn-ghost inline-flex items-center gap-2"
              >
                {busy === "portal" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CreditCard className="h-4 w-4" />
                )}
                Manage billing
              </button>
            ) : (
              <button
                type="button"
                onClick={handleUpgrade}
                disabled={busy !== null}
                className="btn-primary inline-flex items-center gap-2"
              >
                {busy === "checkout" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                Upgrade to Pro
              </button>
            )}
          </div>
        </div>

        {!state?.hasPurchase && (
          <div className="mt-5">
            {showPromo ? (
              <label className="flex flex-col gap-2 sm:max-w-xs">
                <span className="text-eyebrow text-muted-foreground">
                  Discount code
                </span>
                <input
                  value={promo}
                  onChange={(e) => setPromo(e.target.value.toUpperCase())}
                  placeholder="ENTER CODE"
                  className="w-full rounded-[0.75rem] bg-black/[0.04] px-3 py-2.5 font-mono text-sm tracking-wide outline-none placeholder:font-sans placeholder:tracking-normal placeholder:text-muted-foreground"
                />
                <span className="text-xs text-muted-foreground">
                  Applied at checkout.
                </span>
              </label>
            ) : (
              <button
                type="button"
                onClick={() => setShowPromo(true)}
                className="text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
              >
                I have a discount code
              </button>
            )}
          </div>
        )}


        {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
      </div>
    </article>
  );
}

function statusLabel(state: BillingState | null): string {
  if (!state) return "Free";
  return state.plan === "pro" ? "Pro — Active" : "Free";
}
