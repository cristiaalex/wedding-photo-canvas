import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Image as ImageIcon } from "lucide-react";
import { PetPhotoUploader } from "@/components/pet-photo-uploader";
import { PetWordmark } from "@/components/pet-wordmark";
import { Button } from "@/components/ui/button";
import { useEventUploads, useSignedPhotoUrls } from "@/hooks/use-photo-data";
import type { Event, EventInsert, PetOrientation } from "@/lib/database.types";
import { PET_PRINT_OPTIONS } from "@/lib/pet-product";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/_authenticated/onboarding")({
  ssr: false,
  head: () => ({ meta: [
    { title: "Create your pet mosaic — Mosaic Pet" },
    { name: "description", content: "Upload your pet photos and choose the shape, size and main portrait for your mosaic." },
    { property: "og:title", content: "Create your pet mosaic — Mosaic Pet" },
    { property: "og:description", content: "Upload your pet photos and choose the shape, size and main portrait for your mosaic." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: OnboardingPage,
});

function safeSlug(name: string) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "pet";
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

function OnboardingPage() {
  const navigate = useNavigate();
  const [project, setProject] = useState<Event | null>(null);
  const [petName, setPetName] = useState("");
  const [step, setStep] = useState<"name" | "photos" | "format" | "portrait">("name");
  const [orientation, setOrientation] = useState<PetOrientation>("portrait");
  const [printSize, setPrintSize] = useState(PET_PRINT_OPTIONS.portrait[1].id);
  const [mainUploadId, setMainUploadId] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const { data } = await supabase.from("events").select("*").eq("organizer_id", auth.user.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (cancelled) return;
      if (data) navigate({ to: "/dashboard", replace: true });
    })();
    return () => { cancelled = true; };
  }, [navigate]);

  const uploadsQuery = useEventUploads(project?.id);
  const uploads = uploadsQuery.data ?? [];
  const signed = useSignedPhotoUrls(uploads.map((item) => item.image_url), "thumb_300");
  const selectedSize = useMemo(() => PET_PRINT_OPTIONS[orientation].find((option) => option.id === printSize) ?? PET_PRINT_OPTIONS[orientation][1], [orientation, printSize]);

  async function createProject() {
    if (!petName.trim()) return;
    setWorking(true); setError(null);
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) { setError("Please sign in again."); setWorking(false); return; }
    const payload: EventInsert = {
      slug: safeSlug(petName), organizer_id: auth.user.id, event_name: petName.trim(), pet_name: petName.trim(),
      product_kind: "pet_mosaic", plan: "free", processing_status: "draft", payment_status: "unpaid",
      download_status: "unavailable", source_cleanup_status: "pending",
    };
    const { data, error: insertError } = await supabase.from("events").insert(payload).select("*").single();
    setWorking(false);
    if (insertError || !data) { setError(insertError?.message || "We couldn’t start your artwork."); return; }
    setProject(data); setStep("photos");
  }

  async function saveConfiguration() {
    if (!project || !mainUploadId || !selectedSize) return;
    setWorking(true); setError(null);
    const chosen = uploads.find((upload) => upload.id === mainUploadId);
    const { error: saveError } = await supabase.from("events").update({
      orientation, print_size: selectedSize.id, main_upload_id: mainUploadId,
      cover_image_url: chosen?.image_url ?? project.cover_image_url,
      processing_status: "uploads_complete",
    }).eq("id", project.id);
    setWorking(false);
    if (saveError) { setError("We couldn’t save those choices. Please try again."); return; }
    navigate({ to: "/mosaic" });
  }

  const order = ["name", "photos", "format", "portrait"] as const;
  const current = order.indexOf(step);
  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="flex items-center justify-between border-b-2 border-sky/15 bg-card px-5 py-4 md:px-12">
        <PetWordmark />
        <div className="flex gap-1.5" aria-label={`Step ${current + 1} of 4`}>
          {order.map((item, index) => <span key={item} className={`h-2 rounded-full transition-all ${index === current ? "w-9 bg-coral" : index < current ? "w-2 bg-mint" : "w-2 bg-border"}`} />)}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-5 py-10 sm:px-8 md:py-16">
        {step === "name" && (
          <section className="mx-auto max-w-2xl">
            <span className="sticker inline-flex bg-sunshine/35 px-4 py-2 text-xs font-extrabold">Let&rsquo;s make something happy</span>
            <h1 className="mt-5 text-display text-4xl md:text-6xl">Who&rsquo;s your furry best friend?</h1>
            <p className="mt-5 max-w-lg text-base leading-7 text-muted-foreground">Tell us their name, then we&rsquo;ll gather all the little moments that make them one of a kind.</p>
            <label htmlFor="pet-name" className="mt-12 block text-eyebrow">Pet&rsquo;s name</label>
            <input id="pet-name" autoFocus className="field mt-3 text-2xl" value={petName} onChange={(e) => setPetName(e.target.value)} placeholder="e.g. Mabel" onKeyDown={(e) => { if (e.key === "Enter") void createProject(); }} />
            <Button size="lg" className="mt-8 w-full sm:w-auto" disabled={!petName.trim() || working} onClick={() => void createProject()}>{working ? "Beginning…" : "Continue"}<ArrowRight /></Button>
          </section>
        )}
        {step === "photos" && project && (
          <section>
            <p className="text-eyebrow text-coral">Step 2 · The fun part</p>
            <h1 className="mt-4 text-display text-4xl md:text-6xl">Bring us {petName}&rsquo;s best moments.</h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground">The cuddles, adventures, naps and wonderfully weird faces. They all belong.</p>
            <div className="mt-10"><PetPhotoUploader eventId={project.id} petName={petName} /></div>
            <div className="mt-7 flex flex-col gap-4 rounded-3xl bg-mist p-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground"><strong className="font-extrabold text-foreground">{uploads.length}</strong> little {uploads.length === 1 ? "moment" : "moments"} collected</p>
              <Button size="lg" disabled={uploads.length === 0} onClick={() => setStep("format")}>Choose format <ArrowRight /></Button>
            </div>
          </section>
        )}
        {step === "format" && (
          <section>
            <button onClick={() => setStep("photos")} className="inline-flex items-center gap-2 text-sm text-muted-foreground"><ArrowLeft className="h-4 w-4" /> Photos</button>
            <p className="mt-8 text-eyebrow text-coral">Step 3 · Pick your shape</p>
            <h1 className="mt-4 text-display text-4xl md:text-6xl">How should the big picture look?</h1>
            <div className="mt-10 grid grid-cols-3 gap-3">
              {(["landscape", "portrait", "square"] as PetOrientation[]).map((value) => (
                 <Button key={value} variant={orientation === value ? "default" : "outline"} className="h-24 flex-col capitalize" onClick={() => { setOrientation(value); setPrintSize(PET_PRINT_OPTIONS[value][1].id); }}>
                  <span className={value === "landscape" ? "h-5 w-8 border" : value === "portrait" ? "h-8 w-5 border" : "h-6 w-6 border"} />{value}
                </Button>
              ))}
            </div>
            <p className="mt-10 text-eyebrow">Print size</p>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              {PET_PRINT_OPTIONS[orientation].map((option) => (
                 <button key={option.id} type="button" onClick={() => setPrintSize(option.id)} className={`min-h-24 rounded-3xl border-2 p-5 text-left transition-all ${printSize === option.id ? "border-coral bg-blush shadow-sm" : "border-border bg-card hover:border-sky"}`}>
                   <span className="flex items-center justify-between text-display text-xl">{option.label}{printSize === option.id && <Check className="h-5 w-5 text-coral" />}</span>
                  <span className="mt-2 block text-sm text-muted-foreground">{option.dimensions}</span>
                </button>
              ))}
            </div>
            <Button size="lg" className="mt-8 w-full sm:w-auto" onClick={() => setStep("portrait")}>Choose main photo <ArrowRight /></Button>
          </section>
        )}
        {step === "portrait" && (
          <section>
            <button onClick={() => setStep("format")} className="inline-flex items-center gap-2 text-sm text-muted-foreground"><ArrowLeft className="h-4 w-4" /> Format</button>
            <p className="mt-8 text-eyebrow text-coral">Step 4 · The star of the show</p>
            <h1 className="mt-4 text-display text-4xl md:text-6xl">Which photo looks most like your best friend?</h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground">This becomes the big picture. Every other little memory will fit inside it.</p>
            <div className="mt-9 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
              {uploads.map((upload) => {
                const src = signed.data?.get(upload.image_url);
                 return <button key={upload.id} type="button" onClick={() => setMainUploadId(upload.id)} aria-label="Choose as main photo" className={`relative aspect-square overflow-hidden rounded-2xl border-4 transition-transform hover:-translate-y-1 ${mainUploadId === upload.id ? "border-coral shadow-[var(--shadow-soft)]" : "border-card"}`}>
                  {src ? <img src={src} alt="Uploaded pet photo" className="h-full w-full object-cover" /> : <span className="grid h-full place-items-center bg-muted"><ImageIcon className="h-5 w-5" /></span>}
                  {mainUploadId === upload.id && <span className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-primary text-primary-foreground"><Check className="h-3.5 w-3.5" /></span>}
                </button>;
              })}
            </div>
            {error && <p className="mt-5 text-sm text-destructive">{error}</p>}
            <Button size="lg" className="mt-8 w-full sm:w-auto" disabled={!mainUploadId || working} onClick={() => void saveConfiguration()}>{working ? "Saving…" : "Generate my preview"}<ArrowRight /></Button>
          </section>
        )}
      </main>
    </div>
  );
}