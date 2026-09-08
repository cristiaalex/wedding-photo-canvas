import { createFileRoute, Outlet, useNavigate, useLocation, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";

import { supabase } from "@/lib/supabase";
import { getAdminSession } from "@/lib/admin.functions";
import { AdminShell } from "@/components/admin/admin-shell";

/**
 * /admin — internal Mosaic back-office.
 *
 * This client gate only controls what is rendered. Authorization is enforced
 * server-side: every admin server function re-validates the bearer token and
 * the configured admin allow-list before returning any data.
 */
export const Route = createFileRoute("/admin")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Mosaic Admin" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "description", content: "Internal Mosaic operations console." },
    ],
  }),
  component: AdminGate,
});

type GateStatus = "loading" | "ok" | "anon" | "forbidden";

function AdminGate() {
  const navigate = useNavigate();
  const location = useLocation();
  const checkAdmin = useServerFn(getAdminSession);
  const [status, setStatus] = useState<GateStatus>("loading");
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function verify() {
      // Supabase restores the session from localStorage asynchronously; asking
      // the server before that finishes returns "not admin" and would bounce a
      // legitimate admin away. So resolve the session first, and only call the
      // server when a token actually exists.
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      if (!data.session?.access_token) {
        setStatus("anon");
        return;
      }
      try {
        const res = await checkAdmin();
        if (!mounted) return;
        setEmail(res.email);
        setStatus(res.isAdmin ? "ok" : "forbidden");
      } catch {
        if (mounted) setStatus("forbidden");
      }
    }

    void verify();

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (
        event === "SIGNED_IN" ||
        event === "SIGNED_OUT" ||
        event === "INITIAL_SESSION" ||
        event === "TOKEN_REFRESHED" ||
        event === "USER_UPDATED"
      ) {
        void verify();
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [checkAdmin]);

  useEffect(() => {
    // No session at all → use the existing sign-in flow and come back here.
    if (status === "anon") {
      navigate({
        to: "/login",
        search: { redirect: location.pathname },
        replace: true,
      });
    }
  }, [status, navigate, location.pathname]);

  if (status === "forbidden") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[color:var(--ivory)] px-6">
        <div className="max-w-md text-center">
          <p className="text-eyebrow text-[color:var(--gold)]">Access denied</p>
          <h1 className="mt-5 text-display text-3xl">This account isn’t an admin</h1>
          <p className="mt-4 text-sm text-muted-foreground">
            You’re signed in{email ? ` as ${email}` : ""}, but this account doesn’t have
            access to the Mosaic back-office.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={async () => {
                await supabase.auth.signOut();
                navigate({ to: "/login", replace: true });
              }}
              className="rounded-full bg-foreground px-4 py-2.5 text-sm text-[color:var(--ivory)] transition-opacity hover:opacity-90"
            >
              Sign in with another account
            </button>
            <Link to="/" className="btn-ghost">
              Go home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (status !== "ok") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[color:var(--ivory)]">
        <p className="text-eyebrow text-muted-foreground">
          {status === "loading" ? "Verifying access…" : "Redirecting…"}
        </p>
      </div>
    );
  }

  return (
    <AdminShell email={email}>
      <Outlet />
    </AdminShell>
  );
}

