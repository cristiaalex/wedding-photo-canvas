import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight, Check, Circle, Download, Images } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PetPhotoUploader } from "@/components/pet-photo-uploader";
import { Button } from "@/components/ui/button";
import type { Event, Mosaic } from "@/lib/database.types";
import { PET_PRICE_LABEL, PET_PRINT_OPTIONS, petProjectName } from "@/lib/pet-product";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [
    { title: "Your Pet Mosaic Studio — Mosaic Pet" },
    { name: "description", content: "Continue your private pet mosaic, review its preview and download the purchased final artwork." },
    { property: "og:title", content: "Your Pet Mosaic Studio — Mosaic Pet" },
    { property: "og:description", content: "Continue your private pet mosaic, review its preview and download the purchased final artwork." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: DashboardPage,
});

function DashboardPage() {
  const navigate = useNavigate();
  const [project, setProject] = useState<Event | null>(null);
  const [latest, setLatest] = useState<Mosaic | null>(null);
  const [photoCount, setPhotoCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return setLoading(false);
      const { data: event } = await supabase.from("events").select("*").eq("organizer_id", auth.user.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (cancelled) return;
      if (!event) { navigate({ to: "/onboarding", replace: true }); return; }
      const [{ count }, { data: mosaic }] = await Promise.all([
        supabase.from("uploads").select("id", { count: "exact", head: true }).eq("event_id", event.id),
        supabase.from("mosaics").select("*").eq("event_id", event.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (cancelled) return;
      setProject(event); setLatest(mosaic); setPhotoCount(count ?? 0); setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [navigate]);

  if (loading || !project) return <AppShell><div className="grid min-h-[60vh] place-items-center"><p className="text-eyebrow">Opening your studio…</p></div></AppShell>;
  const orientation = project.orientation ?? "portrait";
  const size = PET_PRINT_OPTIONS[orientation].find((option) => option.id === project.print_size);
  const previewReady = latest?.status === "ready" || latest?.status === "deepzoom_ready";
  const finalReady = latest?.final_available === true || (latest?.print_status === "ready" && project.payment_status === "paid");

  return (
    <AppShell weddingName={project.pet_name}>
      <div className="space-y-16 py-4 md:space-y-24 md:py-8">
        <header className="max-w-3xl">
          <p className="text-eyebrow text-gold">Private artwork studio</p>
          <h1 className="mt-4 text-display text-5xl md:text-7xl">{petProjectName(project.pet_name || project.event_name)}&rsquo;s mosaic</h1>
          <p className="mt-6 text-base leading-7 text-muted-foreground">Every photograph is part of the bigger picture. Continue wherever you left off.</p>
        </header>

        <section className="grid gap-px border-y border-border bg-border md:grid-cols-4">
          <Stage done={photoCount > 0} label="Photos" detail={`${photoCount} uploaded`} />
          <Stage done={!!project.main_upload_id && !!project.orientation} label="Design" detail={size ? `${orientation} · ${size.dimensions}` : "Choose format"} />
          <Stage done={previewReady} label="Preview" detail={previewReady ? "Ready to explore" : latest ? "Being created" : "Not started"} />
          <Stage done={finalReady} label="Final artwork" detail={finalReady ? "Ready to download" : project.payment_status === "paid" ? "Being finished" : "Purchase after preview"} />
        </section>

        {!project.main_upload_id ? (
          <section className="bg-surface p-7 md:p-12">
            <p className="text-eyebrow text-gold">Continue setup</p>
            <h2 className="mt-3 text-display text-4xl">Finish choosing your artwork.</h2>
            <p className="mt-4 max-w-xl text-sm leading-7 text-muted-foreground">Add your photos, choose a format and select the main portrait the mosaic will recreate.</p>
            <Button asChild size="lg" className="mt-7"><Link to="/gallery">Add photos <ArrowRight /></Link></Button>
          </section>
        ) : (
          <section className="grid gap-8 md:grid-cols-2 md:items-center">
            <div>
              <p className="text-eyebrow text-gold">Your next step</p>
              <h2 className="mt-4 text-display text-4xl md:text-5xl">{previewReady ? "Your preview is ready." : latest ? "Your portrait is taking shape." : "Ready to create the preview."}</h2>
              <p className="mt-5 text-sm leading-7 text-muted-foreground">{previewReady ? "Open it full-screen, zoom into the tiny memories, or return to your photos before purchase." : "Preview generation is included before purchase. Your source photographs stay private and available while your artwork is being prepared."}</p>
              <Button asChild size="lg" className="mt-7"><Link to="/mosaic">{previewReady ? "Explore preview" : "Create preview"}<ArrowRight /></Link></Button>
            </div>
            <dl className="border border-border bg-card p-7 md:p-9">
              <Detail term="Orientation" value={orientation} />
              <Detail term="Print size" value={size?.dimensions ?? "Not chosen"} />
              <Detail term="Purchase" value={project.payment_status === "paid" ? "Paid" : PET_PRICE_LABEL} />
              <Detail term="Final file" value={finalReady ? "High-resolution artwork ready" : "Prepared after purchase"} last />
            </dl>
          </section>
        )}

        <section>
          <div className="mb-7 flex items-end justify-between gap-4"><div><p className="text-eyebrow text-gold">Add more memories</p><h2 className="mt-3 text-display text-4xl">A richer palette of moments.</h2></div><Button asChild variant="outline"><Link to="/gallery">View all <Images /></Link></Button></div>
          <PetPhotoUploader eventId={project.id} petName={project.pet_name} />
        </section>

        {finalReady && <section className="bg-ink p-7 text-ivory md:p-12"><Download className="h-5 w-5 text-gold" /><h2 className="mt-5 text-display text-4xl text-ivory">Your final artwork is ready.</h2><p className="mt-4 max-w-xl text-sm leading-7 text-ivory/70">Open the finished mosaic to zoom and download the high-resolution, print-ready file.</p><Button asChild size="lg" className="mt-7"><Link to="/mosaic">View final mosaic <ArrowRight /></Link></Button></section>}
      </div>
    </AppShell>
  );
}

function Stage({ done, label, detail }: { done: boolean; label: string; detail: string }) {
  return <div className="min-h-28 bg-background p-5"><div className="flex items-center gap-2">{done ? <Check className="h-4 w-4 text-gold" /> : <Circle className="h-4 w-4 text-muted-foreground" />}<p className="text-eyebrow">{label}</p></div><p className="mt-4 text-sm capitalize text-foreground">{detail}</p></div>;
}
function Detail({ term, value, last = false }: { term: string; value: string; last?: boolean }) {
  return <div className={`flex items-start justify-between gap-5 py-4 ${last ? "" : "border-b border-border"}`}><dt className="text-eyebrow">{term}</dt><dd className="text-right text-sm capitalize text-foreground">{value}</dd></div>;
}