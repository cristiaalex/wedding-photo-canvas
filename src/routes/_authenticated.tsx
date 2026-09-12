import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// Client-only gate. We cannot use `beforeLoad` with `supabase.auth.getUser()`
// because Supabase restores the session from localStorage asynchronously on
// page load (and immediately after a magic-link callback). Calling getUser()
// before restoration completes returns null and bounces the user back to
// /login — which is exactly the bug we were seeing.
//
// Mosaic Pet is a no-account-required product: creating, uploading,
// configuring and previewing a mosaic must never ask for an email. When no
// session exists we therefore open a private anonymous session instead of
// redirecting to /login. The session becomes a real customer account at
// checkout, so the project and every upload stay attached to the same owner.
export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  component: AuthGate,
});

function AuthGate() {
  const [status, setStatus] = useState<"loading" | "authed" | "unavailable">("loading");

  useEffect(() => {
    let mounted = true;

    (async () => {
      const sessionRes = await supabase.auth.getSession();
      const userRes = await supabase.auth.getUser();
      if (!mounted) return;
      let user = sessionRes.data.session?.user ?? userRes.data.user ?? null;
      if (!user) {
        const guest = await supabase.auth.signInAnonymously();
        if (!mounted) return;
        if (guest.error) {
          console.error("[mosaic-pet] private session unavailable", guest.error.message);
        }
        user = guest.data?.user ?? null;
      }
      setStatus(user ? "authed" : "unavailable");
    })();

    // Only ever upgrade to "authed" here. A null session during start-up simply
    // means the guest session has not been created yet — it must never bounce
    // the customer to /login, because creating a mosaic requires no account.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted && session?.user) setStatus("authed");
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (status === "authed") return <Outlet />;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6 text-center">
      {status === "unavailable" ? (
        <p className="max-w-sm text-sm leading-6 text-muted-foreground">
          We couldn&rsquo;t open your private studio just now. Please refresh the page and try again.
        </p>
      ) : (
        <p className="text-eyebrow text-muted-foreground">Loading…</p>
      )}
    </div>
  );
}

