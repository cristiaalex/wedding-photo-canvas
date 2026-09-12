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
  useEffect(() => { let stop = false; void (async () => { const { data: auth } = await supabase.auth.getUser(); if (!auth.user) return; const { data } = await supabase.from("events").select("*").eq("organizer_id", auth.user.id).order("created_at", { ascending: false }).limit(1).maybeSingle(); if (stop) return; if (!data) navigate({ to: "/create", replace: true }); else setProject(data); })(); return () => { stop = true; }; }, [navigate]);
  const uploadsQuery = useEventUploads(project?.id);
  const uploads = uploadsQuery.data ?? [];
  const urls = useSignedPhotoUrls(uploads.map((upload) => upload.image_url), "thumb_600");
  const items: MemoryLightboxItem[] = useMemo(() => uploads.map((upload) => ({ id: upload.id, path: upload.image_url, guestName: null, uploadedAt: upload.uploaded_at })), [uploads]);
  return <AppShell projectName={project?.pet_name}><div className="space-y-10 py-4 md:py-8">
    <header><span className="sticker inline-flex bg-mist px-4 py-2 text-xs font-extrabold">Their greatest hits</span><h1 className="mt-5 text-display text-4xl md:text-6xl">All the little moments</h1><p className="mt-5 max-w-2xl text-sm leading-7 text-muted-foreground">Every cuddle, adventure and funny face helps create the big picture. Your photos stay private while your mosaic is being made.</p></header>
    {project && <PetPhotoUploader eventId={project.id} petName={project.pet_name} compact />}
    <div className="flex items-center justify-between rounded-2xl bg-mist px-5 py-4"><p className="text-sm font-extrabold">{uploads.length} {uploads.length === 1 ? "memory" : "memories"}</p><p className="text-xs text-muted-foreground">Tap one for a closer look</p></div>
    {uploadsQuery.isLoading ? <p className="py-20 text-center text-eyebrow">Gathering the good stuff…</p> : uploads.length === 0 ? <div className="grid min-h-64 place-items-center rounded-[2rem] border-2 border-dashed border-sky/40 bg-card text-center"><div><ImageIcon className="mx-auto h-8 w-8 text-sky" /><p className="mt-4 text-display text-2xl">Your first happy memory will appear here.</p></div></div> : <div className="columns-2 gap-3 sm:columns-3 md:columns-4 md:gap-4">{uploads.map((upload, index) => { const src = urls.data?.get(upload.image_url); return <button key={upload.id} type="button" onClick={() => setLightbox(index)} className="mb-3 block w-full break-inside-avoid overflow-hidden rounded-2xl border-4 border-card bg-muted shadow-[var(--shadow-elegant)] transition-transform hover:-translate-y-1 md:mb-4" aria-label="Open pet photo">{src ? <img src={src} alt="Uploaded pet memory" loading="lazy" className="h-auto w-full transition-transform duration-300 hover:scale-[1.02]" /> : <span className="block aspect-square animate-pulse" />}</button>; })}</div>}
    {lightbox !== null && items[lightbox] && <MemoryLightbox items={items} index={lightbox} onIndexChange={setLightbox} onClose={() => setLightbox(null)} />}
  </div></AppShell>;
}