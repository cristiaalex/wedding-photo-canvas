import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { PetWordmark } from "@/components/pet-wordmark";
import { Button } from "@/components/ui/button";
import heroAsset from "@/assets/pet-mosaic-gallery.jpg.asset.json";

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
      <header className="border-b border-border px-5 py-5 md:px-12"><PetWordmark /></header>
      <main className="mx-auto grid max-w-7xl gap-10 px-5 py-10 sm:px-8 md:grid-cols-2 md:items-center md:px-12 md:py-20">
        <section className="max-w-md">
          <p className="text-eyebrow text-gold">Your private studio</p>
          <h1 className="mt-4 text-display text-5xl md:text-6xl">Continue your artwork.</h1>
          <p className="mt-6 text-sm leading-7 text-muted-foreground">Enter your email and we&rsquo;ll send a secure sign-in link. There is no password to remember.</p>
          {sent ? (
            <div className="mt-9 border-y border-border py-7">
              <p className="text-display text-2xl">Check your inbox</p>
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
          <p className="mt-6 text-xs leading-5 text-muted-foreground">Your account is created automatically when you start. It keeps your photos and artwork private across devices.</p>
        </section>
        <img src={heroAsset.url} alt="Framed cat photo mosaic in a gallery" width={1280} height={1536} className="aspect-[4/5] w-full object-cover shadow-elegant" />
      </main>
    </div>
  );
}