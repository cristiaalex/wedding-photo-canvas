import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/account")({
  ssr: false,
  head: () => ({ meta: [
    { title: "Your account — Mosaic Pet" },
    { name: "description", content: "Open your Mosaic Pet account to revisit and download your pet mosaic." },
    { property: "og:title", content: "Your account — Mosaic Pet" },
    { property: "og:description", content: "Open your Mosaic Pet account to revisit and download your pet mosaic." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: AccountPage,
});

function AccountPage() {
  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.getUser();
      // Anonymous studio sessions have no email — send those to sign-in so a
      // returning customer always lands on their own purchased mosaic.
      window.location.replace(data.user?.email ? "/dashboard" : "/login?redirect=%2Fdashboard");
    })();
  }, []);

  return (
    <div className="grid min-h-svh place-items-center bg-background">
      <p className="text-eyebrow text-muted-foreground">Opening your account…</p>
    </div>
  );
}
