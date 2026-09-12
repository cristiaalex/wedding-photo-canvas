import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check, CreditCard, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createCheckoutSession, createPortalSession, getBillingState, type BillingState } from "@/lib/billing.functions";
import { PET_PRICE_LABEL } from "@/lib/pet-product";

export function BillingCard({ eventId }: { eventId?: string }) {
  const loadState = useServerFn(getBillingState);
  const startCheckout = useServerFn(createCheckoutSession);
  const openPortal = useServerFn(createPortalSession);
  const [state, setState] = useState<BillingState | null>(null);
  const [busy, setBusy] = useState<"checkout" | "portal" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [promo, setPromo] = useState("");
  const [showPromo, setShowPromo] = useState(false);

  const refresh = useCallback(async () => { try { setState(await loadState()); } catch { setState(null); } }, [loadState]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("billing") !== "success") return;
    const timer = window.setTimeout(() => void refresh(), 2500);
    window.history.replaceState({}, "", window.location.pathname);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  async function checkout() {
    setBusy("checkout"); setError(null);
    try {
      const { url } = await startCheckout({ data: { ...(eventId ? { eventId } : {}), ...(promo.trim() ? { promoCode: promo.trim() } : {}) } });
      window.location.href = url;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Checkout is not available yet."); setBusy(null); }
  }
  async function portal() {
    setBusy("portal"); setError(null);
    try { const { url } = await openPortal(); window.location.href = url; }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Billing could not be opened."); setBusy(null); }
  }

  if (state?.hasPurchase) return <div className="rounded-[2rem] border-2 border-mint bg-mint/25 p-6"><p className="flex items-center gap-2 text-display text-2xl"><span className="grid h-8 w-8 place-items-center rounded-full bg-mint"><Check className="h-5 w-5 text-navy" /></span> It&rsquo;s yours!</p><p className="mt-3 text-sm leading-6 text-muted-foreground">Your high-resolution final mosaic will pop up here as soon as it is ready.</p>{state.hasCustomer && <Button variant="outline" className="mt-5" onClick={() => void portal()} disabled={busy !== null}>{busy === "portal" ? <Loader2 className="animate-spin" /> : <CreditCard />}View receipt</Button>}</div>;

  return <div className="joyful-card bg-card p-6 md:p-8">
    <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-eyebrow text-coral">Make it yours forever</p><h3 className="mt-2 text-display text-3xl">{PET_PRICE_LABEL}</h3><p className="mt-2 text-sm text-muted-foreground">One happy payment · One high-resolution final mosaic · No subscription</p></div><Button size="lg" onClick={() => void checkout()} disabled={busy !== null}>{busy === "checkout" ? <Loader2 className="animate-spin" /> : <CreditCard />}Get my final mosaic</Button></div>
    {showPromo ? <label className="mt-6 block max-w-xs"><span className="text-eyebrow">Discount code</span><input className="field mt-2" value={promo} onChange={(event) => setPromo(event.target.value.toUpperCase())} placeholder="ENTER CODE" /></label> : <button type="button" className="mt-5 text-sm text-muted-foreground underline" onClick={() => setShowPromo(true)}>I have a discount code</button>}
    {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
  </div>;
}