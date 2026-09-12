import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { PetWordmark } from "@/components/pet-wordmark";
import { Button } from "@/components/ui/button";
import heroAsset from "@/assets/joyful-pet-duo.png";

const searchSchema = z.object({ redirect: z.string().optional() });

export const Route = createFileRoute("/login")({
  validateSearch: searchSchema,
  head: () => ({ meta: [
    { title: "Sign in — Mosaic Pet" },
    { name: "description", content: "Access your private Mosaic Pet artwork with a secure email link." },
    { property: "og:title", content: "Sign in — Mosaic Pet" },
    { property: "og:description", content: "Access your private Mosaic Pet artwork with a secure email link." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: LoginPage,
});

function LoginPage() {
  const { redirect } = useSearch({ from: "/login" });
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const safeRedirect = redirect?.startsWith("/") && !redirect.startsWith("/login") ? redirect : "/dashboard";

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getUser().then(({ data }) => { if (!cancelled && data.user) window.location.replace(safeRedirect); });
    return () => { cancelled = true; };
  }, [safeRedirect]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim()) return;
    setSending(true); setError(null);
    const result = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: `${window.location.origin}/auth/callback`, shouldCreateUser: true } });
    setSending(false);
    if (result.error) { setError(result.error.message); return; }
    setSent(true);
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b-2 border-sky/15 bg-card px-5 py-4 md:px-12"><PetWordmark /></header>
      <main className="mx-auto grid max-w-7xl gap-8 px-5 py-8 sm:px-8 md:grid-cols-2 md:items-center md:px-12 md:py-16">
        <section className="order-2 max-w-md md:order-1">
          <span className="sticker inline-flex bg-sunshine/35 px-4 py-2 text-xs font-extrabold">Your memories are waiting</span>
          <h1 className="mt-5 text-display text-4xl md:text-6xl">Let&rsquo;s get back to your best friend.</h1>
          <p className="mt-5 text-sm leading-7 text-muted-foreground">Pop in your email and we&rsquo;ll send you a safe little link. No password to remember.</p>
          {sent ? (
            <div className="joyful-card mt-9 bg-mint/25 p-7">
              <p className="text-display text-2xl">Check your inbox ✨</p>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">We sent a private link to <span className="font-medium text-foreground">{email}</span>.</p>
              <Button variant="ghost" className="mt-5" onClick={() => setSent(false)}>Use another email</Button>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-9">
              <label className="text-eyebrow" htmlFor="email">Email address</label>
              <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" className="field mt-3" />
              {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
              <Button type="submit" size="lg" className="mt-6 w-full" disabled={sending}>{sending ? "Sending…" : "Email my secure link"}</Button>
            </form>
          )}
          <p className="mt-6 text-xs leading-5 text-muted-foreground">We quietly create your private space when you start, so your photos stay yours.</p>
        </section>
        <div className="relative order-1 md:order-2"><div className="absolute inset-4 rotate-3 rounded-[3rem] bg-sunshine/30"/><img src={heroAsset} alt="Happy dog and affectionate cat" width={1200} height={1104} className="relative aspect-square w-full rounded-[2.5rem] object-cover shadow-[var(--shadow-soft)]" /><span className="sticker absolute -bottom-3 left-5 -rotate-3 bg-coral px-5 py-3 text-sm font-extrabold text-primary-foreground">Best friends forever</span></div>
      </main>
    </div>
  );
}