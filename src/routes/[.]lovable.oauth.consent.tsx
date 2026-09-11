import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type OAuthApi = {
  getAuthorizationDetails: (
    id: string,
  ) => Promise<{ data: AuthorizationDetails | null; error: { message: string } | null }>;
  approveAuthorization: (
    id: string,
  ) => Promise<{ data: RedirectResult | null; error: { message: string } | null }>;
  denyAuthorization: (
    id: string,
  ) => Promise<{ data: RedirectResult | null; error: { message: string } | null }>;
};

type RedirectResult = { redirect_url?: string; redirect_to?: string };
type AuthorizationDetails = RedirectResult & { client?: { name?: string } };

function oauthApi(): OAuthApi {
  return (supabase.auth as unknown as { oauth: OAuthApi }).oauth;
}

export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  component: Consent,
});

function Consent() {
  const { authorization_id } = Route.useSearch();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<AuthorizationDetails | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  // Load session + authorization details once on mount.
  useState(() => {
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        setSignedIn(false);
        return;
      }
      setSignedIn(true);
      if (!authorization_id) {
        setError("This link is missing its authorization reference.");
        return;
      }
      const res = await oauthApi().getAuthorizationDetails(authorization_id);
      if (res.error) {
        setError(res.error.message);
        return;
      }
      const immediate = res.data?.redirect_url ?? res.data?.redirect_to;
      if (immediate && !res.data?.client) {
        window.location.href = immediate;
        return;
      }
      setDetails(res.data);
    })();
  });

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.href },
    });
    setBusy(false);
    if (err) setError(err.message);
    else setSent(true);
  }

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const api = oauthApi();
    const { data, error: err } = approve
      ? await api.approveAuthorization(authorization_id)
      : await api.denyAuthorization(authorization_id);
    if (err) {
      setBusy(false);
      setError(err.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("No redirect was returned. Please try again.");
      return;
    }
    window.location.href = target;
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-6 py-16">
      <h1 className="font-serif text-3xl">
        {signedIn === false ? "Sign in to continue" : `Connect ${details?.client?.name ?? "an app"}`}
      </h1>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {signedIn === false ? (
        sent ? (
          <p className="text-muted-foreground text-sm">
            Check your inbox — we sent you a sign-in link. Open it on this device to continue.
          </p>
        ) : (
          <form onSubmit={sendLink} className="flex flex-col gap-3">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="border-border bg-background rounded-md border px-4 py-3 text-base"
            />
            <button
              type="submit"
              disabled={busy}
              className="bg-primary text-primary-foreground rounded-md px-4 py-3 text-sm disabled:opacity-60"
            >
              Email me a sign-in link
            </button>
          </form>
        )
      ) : signedIn === null ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : (
        <>
          <p className="text-muted-foreground text-sm">
            This lets {details?.client?.name ?? "the app"} use Mosaic Pet on your behalf, with access
            to your own mosaics only.
          </p>
          <div className="flex gap-3">
            <button
              disabled={busy || !details}
              onClick={() => decide(true)}
              className="bg-primary text-primary-foreground flex-1 rounded-md px-4 py-3 text-sm disabled:opacity-60"
            >
              Approve
            </button>
            <button
              disabled={busy}
              onClick={() => decide(false)}
              className="border-border flex-1 rounded-md border px-4 py-3 text-sm disabled:opacity-60"
            >
              Deny
            </button>
          </div>
        </>
      )}
    </main>
  );
}
