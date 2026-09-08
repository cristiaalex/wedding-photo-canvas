import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SiteHeader } from "@/components/site-header";
import { supabase, COVERS_BUCKET } from "@/lib/supabase";
import type { Event } from "@/lib/database.types";
import {
  validateCoverFile,
  prepareCoverForUpload,
  describeUploadError,
} from "@/lib/cover-image";

export const Route = createFileRoute("/_authenticated/edit-event/$eventId")({
  head: () => ({
    meta: [
      { title: "Edit event — Mosaic" },
      { name: "description", content: "Update your event details. The event URL and QR code stay the same." },
    ],
  }),
  component: EditEventPage,
});

function splitNames(eventName: string | null): [string, string] {
  if (!eventName) return ["", ""];
  const parts = eventName.split("&").map((s) => s.trim());
  return [parts[0] ?? "", parts[1] ?? ""];
}

function EditEventPage() {
  const { eventId } = Route.useParams();
  const navigate = useNavigate();

  const [event, setEvent] = useState<Event | null>(null);
  const [partnerOne, setPartnerOne] = useState("");
  const [partnerTwo, setPartnerTwo] = useState("");
  const [weddingDate, setWeddingDate] = useState("");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;
      if (!userId) {
        if (!cancelled) setLoadError("Please sign in again.");
        return;
      }
      // Ownership filter: refuse to load events the caller doesn't own.
      const { data, error } = await supabase
        .from("events")
        .select("*")
        .eq("id", eventId)
        .eq("organizer_id", userId)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setLoadError("We couldn't load this event.");
        return;
      }
      setEvent(data);
      const [p1, p2] = splitNames(data.event_name);
      setPartnerOne(p1);
      setPartnerTwo(p2);
      setWeddingDate(data.wedding_date ?? "");
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!event) return;
    setError(null);
    setSubmitting(true);

    const eventName =
      partnerOne && partnerTwo
        ? `${partnerOne.trim()} & ${partnerTwo.trim()}`
        : partnerOne.trim() || partnerTwo.trim() || event.event_name;

    let coverImageUrl: string | null = event.cover_image_url;
    if (coverFile) {
      const check = validateCoverFile(coverFile);
      if (!check.ok) {
        setSubmitting(false);
        setError(check.message);
        return;
      }
      const { file, contentType, ext } = prepareCoverForUpload(coverFile);
      // Reuse the existing immutable slug folder so storage paths stay stable.
      const path = `${event.slug}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(COVERS_BUCKET)
        .upload(path, file, { contentType, upsert: true, cacheControl: "86400" });
      if (upErr) {
        console.error("[cover] upload failed", upErr);
        setSubmitting(false);
        setError(`We couldn't upload your new cover image: ${describeUploadError(upErr)}`);
        return;
      }
      const { data: pub } = supabase.storage.from(COVERS_BUCKET).getPublicUrl(path);
      coverImageUrl = pub.publicUrl;
    }

    // IMPORTANT: do not include `slug` in the update. Slug is immutable
    // per the Event URL Policy so existing QR codes and guest links stay valid.
    // Ownership filter on write so a stale local `event` can't be used to
    // mutate another user's row even if RLS were misconfigured.
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id ?? "";
    const { error: updateError } = await supabase
      .from("events")
      .update({
        event_name: eventName,
        wedding_date: weddingDate || null,
        cover_image_url: coverImageUrl,
      })
      .eq("id", event.id)
      .eq("organizer_id", userId);

    setSubmitting(false);

    if (updateError) {
      setError("We couldn't save your changes. Please try again.");
      return;
    }

    navigate({ to: "/dashboard" });
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-5 pt-24 pb-20 md:px-12 md:pt-32">
          <p className="text-sm text-destructive">{loadError}</p>
          <Link to="/dashboard" className="text-eyebrow mt-6 inline-block text-muted-foreground hover:text-foreground">
            ← Back to dashboard
          </Link>
        </main>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-5 pt-24 pb-20 md:px-12 md:pt-32">
          <p className="text-eyebrow text-muted-foreground">Loading event…</p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,var(--ivory),oklch(0.965_0.018_72))]">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 pt-24 pb-24 md:px-12 md:pt-32">
        <Link to="/dashboard" className="text-eyebrow text-muted-foreground hover:text-primary">
          ← Back to dashboard
        </Link>
        <section className="mt-8 rounded-[1.75rem] surface-fade p-5 shadow-[var(--shadow-soft)] md:p-10">
          <p className="text-eyebrow">Edit wedding</p>
          <h1 className="text-display mt-4 text-4xl md:text-6xl">
            Polish the <span className="text-script text-[color:var(--dusty)]">details</span>
          </h1>
          <div className="mt-6 hairline" />
          <p className="mt-6 max-w-lg text-sm leading-6 text-muted-foreground">
            Update names, date, or cover image. Your event URL, QR code, guest links and
            uploads stay exactly as they are.
          </p>

        <form className="mt-10 space-y-9" onSubmit={onSubmit}>
          <div className="grid gap-8 md:grid-cols-2">
            <div>
              <label className="text-eyebrow text-muted-foreground">Partner one</label>
              <input
                className="field mt-2"
                placeholder="First name"
                value={partnerOne}
                onChange={(e) => setPartnerOne(e.target.value)}
              />
            </div>
            <div>
              <label className="text-eyebrow text-muted-foreground">Partner two</label>
              <input
                className="field mt-2"
                placeholder="First name"
                value={partnerTwo}
                onChange={(e) => setPartnerTwo(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="text-eyebrow text-muted-foreground">Wedding date</label>
            <input
              type="date"
              className="field mt-2"
              value={weddingDate}
              onChange={(e) => setWeddingDate(e.target.value)}
            />
          </div>

          <div>
            <label className="text-eyebrow text-muted-foreground">Cover image</label>
            {event.cover_image_url && (
              <img
                src={event.cover_image_url}
                alt="Current cover"
                className="mt-3 h-44 w-full rounded-2xl object-cover"
              />
            )}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              className="field mt-3"
              onChange={(e) => setCoverFile(e.target.files?.[0] ?? null)}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Leave empty to keep the current cover image.
            </p>
          </div>

          <div>
            <label className="text-eyebrow text-muted-foreground">Event URL</label>
            <div className="mt-2 flex items-center border-b border-border/60">
              <span className="text-sm text-muted-foreground">mosaic.app/e/</span>
              <span className="flex-1 py-3 text-foreground">{event.slug}</span>
              <span className="text-eyebrow text-muted-foreground">Locked</span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              The event URL is permanent so existing QR codes and guest links keep working.
              Contact support if you ever need it changed.
            </p>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex flex-col-reverse gap-4 border-t border-border/60 pt-8 sm:flex-row sm:items-center sm:justify-between">
            <Link to="/dashboard" className="text-eyebrow text-center text-muted-foreground hover:text-primary sm:text-left">
              Cancel
            </Link>
            <button type="submit" disabled={submitting} className="btn-primary w-full disabled:opacity-60 sm:w-fit">
              {submitting ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
        </section>
      </main>
    </div>
  );
}
