import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { MemoryLightbox, type MemoryLightboxItem } from "@/components/memory-lightbox";
import { PetPhotoUploader } from "@/components/pet-photo-uploader";
import { useEventUploads, useSignedPhotoUrls } from "@/hooks/use-photo-data";
import type { Event } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/_authenticated/gallery")({
  head: () => ({ meta: [
    { title: "Your Pet Photos — Mosaic Pet" },
    { name: "description", content: "Review the private source photographs used to create your pet mosaic." },
    { property: "og:title", content: "Your Pet Photos — Mosaic Pet" },
    { property: "og:description", content: "Review the private source photographs used to create your pet mosaic." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: GalleryPage,
});

function GalleryPage() {
  const navigate = useNavigate();
  const [project, setProject] = useState<Event | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);
  useEffect(() => { let stop = false; void (async () => { const { data: auth } = await supabase.auth.getUser(); if (!auth.user) return; const { data } = await supabase.from("events").select("*").eq("organizer_id", auth.user.id).order("created_at", { ascending: false }).limit(1).maybeSingle(); if (stop) return; if (!data) navigate({ to: "/onboarding", replace: true }); else setProject(data); })(); return () => { stop = true; }; }, [navigate]);
  const uploadsQuery = useEventUploads(project?.id);
  const uploads = uploadsQuery.data ?? [];
  const urls = useSignedPhotoUrls(uploads.map((upload) => upload.image_url), "thumb_600");
  const items: MemoryLightboxItem[] = useMemo(() => uploads.map((upload) => ({ id: upload.id, path: upload.image_url, guestName: null, uploadedAt: upload.uploaded_at })), [uploads]);
  return <AppShell weddingName={project?.pet_name}><div className="space-y-12 py-4 md:py-8">
    <header><p className="text-eyebrow text-gold">Private source library</p><h1 className="mt-4 text-display text-5xl md:text-7xl">Your pet&rsquo;s photos</h1><p className="mt-5 max-w-2xl text-sm leading-7 text-muted-foreground">These memories create your mosaic. They are processing materials—not the purchased download—and remain private while your artwork is prepared.</p></header>
    {project && <PetPhotoUploader eventId={project.id} petName={project.pet_name} compact />}
    <div className="flex items-center justify-between border-y border-border py-4"><p className="text-eyebrow">{uploads.length} {uploads.length === 1 ? "photo" : "photos"}</p><p className="text-xs text-muted-foreground">Tap any image to view it</p></div>
    {uploadsQuery.isLoading ? <p className="py-20 text-center text-eyebrow">Gathering photos…</p> : uploads.length === 0 ? <div className="grid min-h-64 place-items-center border border-dashed border-border text-center"><div><ImageIcon className="mx-auto h-7 w-7 text-gold" /><p className="mt-4 text-display text-2xl">Your first memory will appear here.</p></div></div> : <div className="columns-2 gap-2 sm:columns-3 md:columns-4 md:gap-4">{uploads.map((upload, index) => { const src = urls.data?.get(upload.image_url); return <button key={upload.id} type="button" onClick={() => setLightbox(index)} className="mb-2 block w-full break-inside-avoid overflow-hidden bg-muted md:mb-4" aria-label="Open pet photo">{src ? <img src={src} alt="Uploaded pet memory" loading="lazy" className="h-auto w-full transition-transform duration-300 hover:scale-[1.02]" /> : <span className="block aspect-square animate-pulse" />}</button>; })}</div>}
    {lightbox !== null && items[lightbox] && <MemoryLightbox items={items} index={lightbox} onIndexChange={setLightbox} onClose={() => setLightbox(null)} />}
  </div></AppShell>;
}