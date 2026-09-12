import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/auth/callback")({
  ssr: false,
  head: () => ({ meta: [
    { title: "Signing you in — Mosaic Pet" },
    { name: "description", content: "Securely opening your private Mosaic Pet studio." },
    { property: "og:title", content: "Signing you in — Mosaic Pet" },
    { property: "og:description", content: "Securely opening your private Mosaic Pet studio." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: AuthCallback,
});

type CallbackState =
  | { kind: "working" }
  | { kind: "expired"; description: string }
  | { kind: "error"; description: string };

// Business rule: authenticated user → has a pet project? YES → studio,
// NO → onboarding. This is the ONLY branching post-auth.
async function decideDestination(userId: string): Promise<string> {
  try {
    const { data } = await supabase
      .from("events")
      .select("id")
      .eq("organizer_id", userId)
      .limit(1);
    return data && data.length > 0 ? "/dashboard" : "/onboarding";
  } catch {
    return "/dashboard";
  }
}

// Module-level guard against StrictMode/remount double-invocation. Magic-link
// OTP tokens are single-use; a second verifyOtp always returns "expired".
let inFlight: Promise<void> | null = null;
const consumedTokens = new Set<string>();

const isDev = import.meta.env.DEV;
const log = (...args: unknown[]) => {
  if (isDev) console.log("[AuthCallback]", ...args);
};

function AuthCallback() {
  const navigate = useNavigate();
  const [state, setState] = useState<CallbackState>({ kind: "working" });
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    let cancelled = false;

    const run = async () => {
      try {
        const search = window.location.search;
        const hash = window.location.hash;
        const params = new URLSearchParams(search);
        const hashParams = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);

        const errorCode = params.get("error_code") || hashParams.get("error_code");
        const errorParam = params.get("error") || hashParams.get("error");
        const errorDescription =
          params.get("error_description") || hashParams.get("error_description");

        if (errorCode || errorParam) {
          const existing = await supabase.auth.getSession();
          if (!existing.data.session) {
            const friendly =
              errorCode === "otp_expired"
                ? "This sign-in link has already been used or has expired. Email previewers and spam filters sometimes open the link before you do — please request a new one."
                : (errorDescription || errorParam || "Sign-in failed.").replace(/\+/g, " ");
            if (!cancelled) setState({ kind: "expired", description: friendly });
            return;
          }
        }

        const code = params.get("code");
        const tokenHash = params.get("token_hash") || hashParams.get("token_hash");
        const otpType = params.get("type") || hashParams.get("type");
        const accessToken = hashParams.get("access_token");
        const refreshToken = hashParams.get("refresh_token");

        // Recovery is the only override. Every other authenticated user is
        // routed by the single business rule: has a Pet project → studio,
        // otherwise → onboarding. This is decided AFTER the session exists,
        // below.
        const isRecovery = otpType === "recovery";

        const pre = await supabase.auth.getSession();
        if (pre.data.session) {
          window.history.replaceState({}, "", "/auth/callback");
          const dest = isRecovery
            ? "/reset-password"
            : await decideDestination(pre.data.session.user.id);
          if (!cancelled) navigate({ to: dest, replace: true });
          return;
        }

        if (code) {
          window.history.replaceState({}, "", "/auth/callback");
          const ex = await supabase.auth.exchangeCodeForSession(code);
          if (ex.error) {
            if (!cancelled)
              setState({ kind: "error", description: `Sign-in failed: ${ex.error.message}` });
            return;
          }
        } else if (tokenHash && otpType) {
          if (!consumedTokens.has(tokenHash)) {
            consumedTokens.add(tokenHash);
            window.history.replaceState({}, "", "/auth/callback");
            const v = await supabase.auth.verifyOtp({
              token_hash: tokenHash,
              type: otpType as "magiclink" | "email" | "recovery" | "invite" | "signup",
            });
            if (v.error) {
              const after = await supabase.auth.getSession();
              if (!after.data.session) {
                const isExpired =
                  v.error.message.toLowerCase().includes("expired") ||
                  v.error.message.toLowerCase().includes("invalid");
                const friendly = isExpired
                  ? "This sign-in link has already been used or has expired. Please request a new one."
                  : `Sign-in failed: ${v.error.message}`;
                if (!cancelled)
                  setState({
                    kind: isExpired ? "expired" : "error",
                    description: friendly,
                  });
                return;
              }
            }
          }
        } else if (accessToken && refreshToken) {
          // Implicit hash tokens — defer to SDK auto-detect.
        }

        let session = null;
        for (let i = 0; i < 40; i++) {
          if (cancelled) return;
          const s = await supabase.auth.getSession();
          if (s.data.session) {
            session = s.data.session;
            break;
          }
          await new Promise((r) => setTimeout(r, 100));
        }

        if (!session) {
          if (!cancelled)
            setState({
              kind: "expired",
              description:
                "We couldn't complete sign-in. The link may have been opened by an email previewer before you got to it — please request a new one.",
            });
          return;
        }

        window.history.replaceState({}, "", "/auth/callback");
        const dest = isRecovery
          ? "/reset-password"
          : await decideDestination(session.user.id);
        if (!cancelled) navigate({ to: dest, replace: true });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log("Unexpected error:", msg);
        if (!cancelled) setState({ kind: "error", description: msg });
      }
    };

    if (!inFlight) {
      inFlight = run().finally(() => {
        inFlight = null;
      });
    } else {
      inFlight.catch(() => {});
    }

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <div
      data-auth-callback-screen
      className="min-h-screen flex items-center justify-center bg-mist/35 px-4"
    >
      <div className="w-full max-w-lg text-center">
        {state.kind === "working" && (
          <div className="flex flex-col items-center gap-6">
            <div
              className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin"
              aria-hidden="true"
            />
            <p className="text-display text-2xl">Opening your happy place…</p>
          </div>
        )}
        {state.kind === "expired" && (
          <div className="joyful-card bg-card p-7 text-left">
            <p className="text-eyebrow text-coral">That link had a short little life</p>
            <p className="mt-3 text-sm text-foreground">{state.description}</p>
            <Link to="/login" className="btn-primary mt-6 inline-flex">
              Request a new link
            </Link>
          </div>
        )}
        {state.kind === "error" && (
          <div className="joyful-card bg-card p-7 text-left">
            <p className="text-eyebrow text-destructive">Sign-in error</p>
            <p className="mt-3 text-sm text-foreground">{state.description}</p>
            <Link to="/login" className="btn-primary mt-6 inline-flex">
              Back to sign in
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
