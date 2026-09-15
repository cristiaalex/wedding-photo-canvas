import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight, Sparkles } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import type { Event } from "@/lib/database.types";
import { petProjectName } from "@/lib/pet-product";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [
    { title: "My Mosaics — Mosaic Pet" },
    { name: "description", content: "See the pet mosaics you have already created and open them again." },
    { property: "og:title", content: "My Mosaics — Mosaic Pet" },
    { property: "og:description", content: "See the pet mosaics you have already created and open them again." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: MyMosaicsPage,
});

type Item = {
  project: Event;
  thumb: string | null;
  createdAt: string;
  photos: number;
  previewReady: boolean;
  finalReady: boolean;
};

async function signMosaicPath(value: string | null | undefined): Promise<string | null> {
  if (!value) return null;
  let path = value;
  if (/^https?:\/\//.test(value)) {
    const match = value.match(/\/mosaics\/(.+)$/);
    if (!match) return value;
    path = match[1];
  }
  const { data } = await supabase.storage.from("mosaics").createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
}

function MyMosaicsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Item[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const { data: events } = await supabase
        .from("events").select("*").eq("organizer_id", auth.user.id)
        .order("created_at", { ascending: false });
      if (cancelled) return;
      if (!events || events.length === 0) { navigate({ to: "/create", replace: true }); return; }

      const resolved = await Promise.all(events.map(async (project) => {
        const { data: mosaic } = await supabase
          .from("mosaics").select("thumb_url,preview_url,created_at,status,print_url,print_status,final_available")
          .eq("event_id", project.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
        const { count } = await supabase
          .from("uploads").select("id", { count: "exact", head: true }).eq("event_id", project.id);
        const thumb = await signMosaicPath(mosaic?.thumb_url ?? mosaic?.preview_url);
        const finalReady =
          (!!mosaic?.print_url && mosaic.print_status === "ready") || mosaic?.final_available === true;
        return {
          project,
          thumb,
          createdAt: mosaic?.created_at ?? project.created_at,
          photos: count ?? 0,
          previewReady: !!(mosaic?.preview_url || mosaic?.thumb_url),
          finalReady,
        } as Item;
      }));
      if (!cancelled) setItems(resolved);
    })();
    return () => { cancelled = true; };
  }, [navigate]);


  return (
    <AppShell>
      <div className="space-y-9 py-4 md:py-8">
        <header>
          <span className="sticker inline-flex bg-sunshine/35 px-4 py-2 text-xs font-extrabold">My Mosaics</span>
          <h1 className="mt-5 text-display text-4xl md:text-5xl">The mosaics you&rsquo;ve made</h1>
        </header>

        {items === null ? (
          <p className="py-20 text-center text-eyebrow">Looking for your mosaics…</p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <li key={item.project.id} className="joyful-card overflow-hidden p-0">
                <div className="aspect-square w-full bg-mist">
                  {item.thumb ? (
                    <img src={item.thumb} alt="Pet mosaic" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <span className="grid h-full w-full place-items-center text-sky"><Sparkles className="h-6 w-6" /></span>
                  )}
                </div>
                <div className="p-5">
                  <p className="text-display text-2xl">{petProjectName(item.project.pet_name || item.project.event_name)}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Created {new Date(item.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </p>
                  <Button asChild variant="outline" className="mt-5 w-full"><Link to="/mosaic">View mosaic <ArrowRight /></Link></Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
