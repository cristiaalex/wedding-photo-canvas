import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({ meta: [{ title: "Set a new password — Mosaic" }] }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const search = new URLSearchParams(window.location.search);
        const hash = new URLSearchParams(
          window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash,
        );

        const code = search.get("code");
        const tokenHash = search.get("token_hash") || hash.get("token_hash");
        const type = search.get("type") || hash.get("type");
        const accessToken = hash.get("access_token");
        const refreshToken = hash.get("refresh_token");

        if (code) {
          const r = await supabase.auth.exchangeCodeForSession(code);
          if (r.error) throw r.error;
        } else if (accessToken && refreshToken) {
          const r = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (r.error) throw r.error;
        } else if (tokenHash) {
          const r = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: (type as "recovery") || "recovery",
          });
          if (r.error) throw r.error;
        }

        // Whether we just exchanged or arrived already-signed-in, confirm a session exists.
        const { data } = await supabase.auth.getSession();
        if (!data.session) {
          setError(
            "This password reset link is invalid or has expired. Please request a new one.",
          );
        } else {
          setReady(true);
          window.history.replaceState({}, "", "/reset-password");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setChecking(false);
      }
    })();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (error) {
      setError(error.message);
      return;
    }
    setSuccess(true);
    setTimeout(() => navigate({ to: "/dashboard", replace: true }), 1500);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <p className="text-eyebrow text-primary">Account recovery</p>
        <h1 className="text-display mt-4 text-4xl">Set a new password</h1>

        {checking && (
          <p className="mt-8 text-sm text-muted-foreground">Verifying your recovery link…</p>
        )}

        {!checking && success && (
          <div className="mt-8 border border-border/60 rounded-sm p-6">
            <p className="text-eyebrow text-primary">Password updated</p>
            <p className="mt-3 text-sm">Redirecting you to your dashboard…</p>
          </div>
        )}

        {!checking && !success && ready && (
          <form className="mt-8 space-y-6" onSubmit={onSubmit}>
            <div>
              <label className="text-eyebrow text-muted-foreground">New password</label>
              <input
                type="password"
                required
                autoComplete="new-password"
                className="field mt-2"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div>
              <label className="text-eyebrow text-muted-foreground">Confirm password</label>
              <input
                type="password"
                required
                autoComplete="new-password"
                className="field mt-2"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="btn-primary w-full disabled:opacity-60"
            >
              {submitting ? "Updating…" : "Update password"}
            </button>
          </form>
        )}

        {!checking && !ready && error && (
          <p className="mt-8 text-sm text-destructive">{error}</p>
        )}
      </div>
    </div>
  );
}
