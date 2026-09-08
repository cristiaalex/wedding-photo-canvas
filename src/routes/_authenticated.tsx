import { createFileRoute, Outlet, useNavigate, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// Client-only gate. We cannot use `beforeLoad` with `supabase.auth.getUser()`
// because Supabase restores the session from localStorage asynchronously on
// page load (and immediately after a magic-link callback). Calling getUser()
// before restoration completes returns null and bounces the user back to
// /login — which is exactly the bug we were seeing.
//
// Instead, mount the route, subscribe to onAuthStateChange, and wait for the
// INITIAL_SESSION event before deciding whether to render or redirect.
export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  component: AuthGate,
});

function AuthGate() {
  const navigate = useNavigate();
  const location = useLocation();
  const [status, setStatus] = useState<"loading" | "authed" | "anon">("loading");

  useEffect(() => {
    let mounted = true;

    (async () => {
      const sessionRes = await supabase.auth.getSession();
      const userRes = await supabase.auth.getUser();
      if (!mounted) return;
      const user = sessionRes.data.session?.user ?? userRes.data.user ?? null;
      setStatus(user ? "authed" : "anon");
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setStatus(session?.user ? "authed" : "anon");
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (status === "anon" && !location.pathname.startsWith("/login")) {
      navigate({
        to: "/login",
        search: { redirect: location.pathname },
        replace: true,
      });
    }
  }, [status, navigate, location.pathname]);

  if (status === "authed") return <Outlet />;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <p className="text-eyebrow text-muted-foreground">Loading…</p>
    </div>
  );
}
