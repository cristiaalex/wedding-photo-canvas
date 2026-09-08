import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import heroBride from "@/assets/hero-bride.jpg";
import logoAsset from "@/assets/mosaic-logo.png.asset.json";

const searchSchema = z.object({
  redirect: z.string().optional(),
});

export const Route = createFileRoute("/login")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Sign in — Mosaic Wedding" },
      {
        name: "description",
        content:
          "Sign in to your Mosaic Wedding suite. We'll send you a magic link — no password to remember.",
      },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { redirect } = useSearch({ from: "/login" });
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const safeRedirect =
    redirect && redirect.startsWith("/") && !redirect.startsWith("/login")
      ? redirect
      : "/dashboard";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const userRes = await supabase.auth.getUser();
      if (cancelled || !userRes.data.user) return;
      window.location.replace(safeRedirect);
    })();
    return () => {
      cancelled = true;
    };
  }, [safeRedirect, redirect]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = email.trim();
    if (!trimmed) return;
    setSending(true);

    const emailRedirectTo = `${window.location.origin}/auth/callback`;

    const { error } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: { emailRedirectTo, shouldCreateUser: true },
    });

    setSending(false);
    if (error) {
      const status = (error as { status?: number }).status;
      const code = (error as { code?: string }).code ?? "";
      if (status === 504 || /timeout|fetch|network/i.test(error.message)) {
        // The mail server took too long to answer — the link is usually still
        // sent, so show the "check your inbox" state instead of a hard error.
        setSent(true);
        return;
      }
      if (status === 429 || code === "over_email_send_rate_limit") {
        setError(
          "Too many sign-in emails were requested for this address. Please wait a few minutes and try again — any link already sent still works.",
        );
        return;
      }
      setError(error.message ? `Sign-in failed: ${error.message}` : "Sign-in failed. Please try again in a moment.");
      return;
    }
    setSent(true);
  }



  return (
    <div className="min-h-screen bg-[color:var(--ivory)]">
      {/* Header — same refined brand mark as the landing page */}
      <header className="border-b border-border/50">
        <div className="mx-auto flex max-w-7xl items-center px-5 py-4 md:px-12 md:py-6">
          <Link to="/" className="flex items-center">
            <img src={logoAsset.url} alt="Mosaic Wedding" className="h-7 w-auto sm:h-8 md:h-8 lg:h-10" />
          </Link>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl items-center gap-12 px-5 py-12 md:grid-cols-2 md:gap-20 md:px-12 md:py-20">
        {/* Editorial image */}
        <div className="order-1 md:order-2">
          <div className="relative overflow-hidden rounded-[1.5rem] shadow-[var(--shadow-soft)]">
            <div className="aspect-[16/11] md:aspect-[4/5]">
              <img
                src={heroBride}
                alt="Bride holding a wedding bouquet"
                className="h-full w-full object-cover"
                loading="eager"
              />
            </div>
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[color:var(--ink)]/45 via-transparent to-transparent" />
            <div className="absolute inset-x-0 bottom-0 p-6 md:p-8">
              <h2 className="text-display text-2xl text-[color:var(--ivory)] md:text-3xl">
                Every memory,
                <br />
                <span className="text-script">beautifully kept.</span>
              </h2>
            </div>
          </div>
        </div>

        {/* Sign-in */}
        <div className="order-2 md:order-1">
          <div className="w-full max-w-sm">
            <h1 className="text-display text-4xl md:text-5xl">
              Open your <span className="text-script">suite</span>
            </h1>
            <div className="mt-6 hairline" />
            <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
              Enter your email and we'll send a magic sign-in link. No password needed.
            </p>

            {sent ? (
              <div className="mt-10 rounded-2xl border border-border/60 bg-[color:var(--champagne)]/30 p-6">
                <p className="text-eyebrow">Check your inbox</p>
                <p className="mt-3 text-sm text-foreground">
                  We sent a magic link to <span className="font-medium">{email}</span>.
                </p>
                <p className="mt-3 text-xs text-muted-foreground">
                  Open it on this device to finish signing in. The link expires in 1 hour.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSent(false);
                    setEmail("");
                  }}
                  className="text-eyebrow mt-6 text-muted-foreground hover:text-foreground"
                >
                  Use a different email →
                </button>
              </div>
            ) : (
              <form className="mt-10 space-y-9" onSubmit={onSubmit}>
                <div>
                  <label className="text-eyebrow">Email</label>
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    className="field mt-3"
                    placeholder="you@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <button
                  type="submit"
                  disabled={sending}
                  className="btn-primary w-full py-4 disabled:opacity-60"
                >
                  {sending ? "Sending…" : "Send magic link"}
                </button>
              </form>
            )}

            <div className="mt-12 border-t border-border/50 pt-6">
              <p className="text-xs leading-relaxed text-muted-foreground">
                New here?{" "}
                <Link to="/login" className="text-foreground underline-offset-4 hover:underline">
                  Create your wedding
                </Link>{" "}
                — we'll set up your suite on first sign-in.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
