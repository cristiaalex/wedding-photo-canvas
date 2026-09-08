import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Lock, Upload as UploadIcon, Trash2, AlertTriangle, X, Move } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { PageStack } from "@/components/page-layout";
import { supabase, COVERS_BUCKET, PHOTOS_BUCKET, MOSAICS_BUCKET } from "@/lib/supabase";
import type { Event } from "@/lib/database.types";
import { isTrialPlan } from "@/lib/trial";
import {
  validateCoverFile,
  prepareCoverForUpload,
  describeUploadError,
} from "@/lib/cover-image";
import { CoverPhotoEditor } from "@/components/cover-photo-editor";
import { CoverHero } from "@/components/cover-hero";
import {
  parseCoverUrl,
  buildCoverUrl,
  type CoverPosition,
} from "@/lib/cover-position";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Event Settings — Mosaic" }] }),
  component: SettingsPage,
});



function splitNames(eventName: string | null): [string, string] {
  if (!eventName) return ["", ""];
  const parts = eventName.split("&").map((s) => s.trim());
  return [parts[0] ?? "", parts[1] ?? ""];
}

type GuestPermissions = {
  guests_can_view_gallery: boolean;
  guestbook_enabled: boolean;
  guestbook_public: boolean;
  show_owner_uploads_to_guests: boolean;
};

const DEFAULT_PERMISSIONS: GuestPermissions = {
  guests_can_view_gallery: true,
  guestbook_enabled: true,
  guestbook_public: true,
  // The "Keep your uploads private" toggle defaults to OFF (privacy inactive),
  // so owner uploads follow normal guest visibility until the couple opts in.
  show_owner_uploads_to_guests: true,
};

function SettingsPage() {
  const navigate = useNavigate();
  const [event, setEvent] = useState<Event | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Wedding details (Section 1)
  const [partnerOne, setPartnerOne] = useState("");
  const [partnerTwo, setPartnerTwo] = useState("");
  const [weddingDate, setWeddingDate] = useState("");
  const [venue, setVenue] = useState("");
  const [welcomeMessage, setWelcomeMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  // Cover (Section 2)
  const [coverUploading, setCoverUploading] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Cover editor state — used both when replacing a photo and when
  // adjusting the framing of the current cover.
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorSrc, setEditorSrc] = useState<string | null>(null);
  const [editorInitialPos, setEditorInitialPos] = useState<CoverPosition | null>(null);
  const [pendingCoverBaseUrl, setPendingCoverBaseUrl] = useState<string | null>(null);
  const [editorSaving, setEditorSaving] = useState(false);
  // Object URL bookkeeping so previews from freshly-picked files get revoked.
  const editorObjectUrlRef = useRef<string | null>(null);

  // Guest experience (Section 3) — UI-only for now (no schema yet)
  const [permissions, setPermissions] = useState<GuestPermissions>(DEFAULT_PERMISSIONS);

  // Trial counts (Section 4)
  const [photoCount, setPhotoCount] = useState<number>(0);

  // (Event Status open/closed toggle removed — collection period will be
  // driven by the subscription lifecycle, not a user-facing switch.)

  // Danger zone (Section 6)
  const [deleting, setDeleting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");


  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;
      if (!userId) {
        setLoadError("Please sign in again to access settings.");
        return;
      }
      const { data, error } = await supabase
        .from("events")
        .select("*")
        .eq("organizer_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setLoadError("We couldn't find your event.");
        return;
      }
      setEvent(data);
      const [p1, p2] = splitNames(data.event_name);
      setPartnerOne(p1);
      setPartnerTwo(p2);
      setWeddingDate(data.wedding_date ?? "");
      setVenue(data.venue ?? "");
      setWelcomeMessage(data.welcome_message ?? "");
      setPermissions({
        guests_can_view_gallery: data.guests_can_view_gallery ?? true,
        guestbook_enabled: data.guestbook_enabled ?? true,
        guestbook_public: data.guestbook_public ?? true,
        show_owner_uploads_to_guests: data.show_owner_uploads_to_guests ?? false,
      });

      const { count } = await supabase
        .from("uploads")
        .select("id", { count: "exact", head: true })
        .eq("event_id", data.id);
      if (!cancelled) setPhotoCount(count ?? 0);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const originalName = event ? splitNames(event.event_name) : ["", ""];
  const detailsChanged = useMemo(() => {
    if (!event) return false;
    return (
      partnerOne !== originalName[0] ||
      partnerTwo !== originalName[1] ||
      weddingDate !== (event.wedding_date ?? "") ||
      venue !== (event.venue ?? "") ||
      welcomeMessage !== (event.welcome_message ?? "")
    );
  }, [event, partnerOne, partnerTwo, weddingDate, venue, welcomeMessage, originalName]);

  async function handleSaveDetails(e: React.FormEvent) {
    e.preventDefault();
    if (!event || !detailsChanged) return;
    setSaving(true);
    setSaveError(null);
    const eventName =
      partnerOne && partnerTwo
        ? `${partnerOne.trim()} & ${partnerTwo.trim()}`
        : partnerOne.trim() || partnerTwo.trim() || event.event_name;
    const { error } = await supabase
      .from("events")
      .update({
        event_name: eventName,
        wedding_date: weddingDate || null,
        venue: venue.trim() || null,
        welcome_message: welcomeMessage.trim() || null,
      })
      .eq("id", event.id);
    setSaving(false);
    if (error) {
      setSaveError("We couldn't save your changes. Please try again.");
      return;
    }
    setEvent({
      ...event,
      event_name: eventName,
      wedding_date: weddingDate || null,
      venue: venue.trim() || null,
      welcome_message: welcomeMessage.trim() || null,
    });
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2200);
  }

  function releaseEditorObjectUrl() {
    if (editorObjectUrlRef.current) {
      URL.revokeObjectURL(editorObjectUrlRef.current);
      editorObjectUrlRef.current = null;
    }
  }

  // Step 1: user picked a new file → upload it, then open the editor.
  async function handleReplaceCover(file: File) {
    if (!event) return;
    const check = validateCoverFile(file);
    if (!check.ok) {
      setCoverError(check.message);
      return;
    }
    setCoverError(null);
    setCoverUploading(true);
    const { file: prepared, contentType, ext } = prepareCoverForUpload(file);
    const path = `${event.slug}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from(COVERS_BUCKET)
      .upload(path, prepared, { contentType, upsert: true, cacheControl: "86400" });
    setCoverUploading(false);
    if (upErr) {
      setCoverError(`We couldn't upload your new cover: ${describeUploadError(upErr)}`);
      return;
    }
    const { data: pub } = supabase.storage.from(COVERS_BUCKET).getPublicUrl(path);
    const baseUrl = pub.publicUrl;
    // Preview from the local file for instant feedback while the CDN warms.
    releaseEditorObjectUrl();
    const local = URL.createObjectURL(prepared);
    editorObjectUrlRef.current = local;
    setEditorSrc(local);
    setEditorInitialPos(null);
    setPendingCoverBaseUrl(baseUrl);
    setEditorOpen(true);
  }

  // Step 2: user tapped "Adjust cover" on the existing image.
  function handleAdjustCover() {
    if (!event?.cover_image_url) return;
    const { src, position } = parseCoverUrl(event.cover_image_url);
    if (!src) return;
    setEditorSrc(src);
    setEditorInitialPos(position);
    setPendingCoverBaseUrl(src);
    setEditorOpen(true);
  }

  async function handleEditorSave(position: CoverPosition) {
    if (!event || !pendingCoverBaseUrl) return;
    setEditorSaving(true);
    const nextUrl = buildCoverUrl(pendingCoverBaseUrl, position);
    const { error } = await supabase
      .from("events")
      .update({ cover_image_url: nextUrl })
      .eq("id", event.id);
    setEditorSaving(false);
    if (error) {
      setCoverError("We couldn't save the cover framing. Please try again.");
      return;
    }
    setEvent({ ...event, cover_image_url: nextUrl });
    setEditorOpen(false);
    releaseEditorObjectUrl();
    setEditorSrc(null);
    setPendingCoverBaseUrl(null);
  }

  function handleEditorCancel() {
    setEditorOpen(false);
    releaseEditorObjectUrl();
    setEditorSrc(null);
    setPendingCoverBaseUrl(null);
  }


  async function handleRemoveCover() {
    if (!event || !event.cover_image_url) return;
    setCoverError(null);
    setCoverUploading(true);
    const { error } = await supabase
      .from("events")
      .update({ cover_image_url: null })
      .eq("id", event.id);
    setCoverUploading(false);
    if (error) {
      setCoverError("We couldn't remove the cover. Please try again.");
      return;
    }
    setEvent({ ...event, cover_image_url: null });
  }

  async function listAllUnder(bucket: string, prefix: string): Promise<string[]> {
    // Storage list is shallow. Walk one level deep — enough for our layout
    // (photos/<eventId>/<photoId>/file, mosaics/<eventId>/file).
    const out: string[] = [];
    const { data: top } = await supabase.storage.from(bucket).list(prefix, { limit: 1000 });
    for (const entry of top ?? []) {
      if (entry.id) {
        // It's a file at this level.
        out.push(`${prefix}/${entry.name}`);
        continue;
      }
      // It's a folder — list its contents too.
      const { data: nested } = await supabase.storage
        .from(bucket)
        .list(`${prefix}/${entry.name}`, { limit: 1000 });
      for (const n of nested ?? []) {
        out.push(`${prefix}/${entry.name}/${n.name}`);
      }
    }
    return out;
  }

  async function handleDeleteConfirmed() {
    if (!event) return;
    if (deleteConfirm.trim().toUpperCase() !== "DELETE") return;
    setDeleting(true);
    try {
      // 1. Storage: photos for this event.
      const photoPaths = await listAllUnder(PHOTOS_BUCKET, event.id);
      if (photoPaths.length > 0) {
        await supabase.storage.from(PHOTOS_BUCKET).remove(photoPaths);
      }
      // 2. Storage: mosaics for this event.
      const mosaicPaths = await listAllUnder(MOSAICS_BUCKET, event.id);
      if (mosaicPaths.length > 0) {
        await supabase.storage.from(MOSAICS_BUCKET).remove(mosaicPaths);
      }
      // 3. Storage: cover image (single object).
      if (event.cover_image_url) {
        // Extract the storage path from a public URL like
        // .../object/public/covers/<slug>/<file>
        const m = event.cover_image_url.match(/\/covers\/(.+)$/);
        if (m) {
          await supabase.storage.from(COVERS_BUCKET).remove([m[1]]);
        }
      }
      // 4. Database: rows linked to this event. Final event delete is
      // ownership-scoped so a stale local `event` cannot delete another
      // user's row even if RLS were misconfigured.
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id ?? "";
      await supabase.from("mosaics").delete().eq("event_id", event.id);
      await supabase.from("guestbook_messages").delete().eq("event_id", event.id);
      await supabase.from("uploads").delete().eq("event_id", event.id);
      // 5. Finally, the event itself.
      const { error: evErr } = await supabase
        .from("events")
        .delete()
        .eq("id", event.id)
        .eq("organizer_id", userId);
      if (evErr) throw evErr;

      toast.success("Event deleted", {
        description: "Everything has been permanently removed.",
      });
      navigate({ to: "/onboarding", replace: true });
    } catch (e) {
      console.error("[settings] delete failed", e);
      toast.error("Could not delete the event", {
        description: "Please try again or contact support.",
      });
      setDeleting(false);
    }
  }

  const isTrial = isTrialPlan(event?.plan ?? null);
  const guestUrl = event ? `mosaic.wedding/e/${event.slug}` : "";

  if (loadError) {
    return (
      <AppShell>
        <PageHeader />
        <Card>
          <p className="text-sm text-destructive">{loadError}</p>
          <Link to="/dashboard" className="text-eyebrow mt-6 inline-block text-muted-foreground hover:text-foreground">
            ← Back to dashboard
          </Link>
        </Card>
      </AppShell>
    );
  }

  if (!event) {
    return (
      <AppShell>
        <PageHeader />
        <Card>
          <p className="text-eyebrow text-muted-foreground">Loading…</p>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageStack>
        <PageHeader />
        {/* Section 1 — Wedding Details */}
        <Card>
          <SectionTitle title="Wedding details" />
          <form className="mt-10 space-y-8" onSubmit={handleSaveDetails}>
            <div className="grid gap-8 md:grid-cols-2">
              <Field label="Partner one">
                <input
                  className="field mt-2"
                  value={partnerOne}
                  onChange={(e) => setPartnerOne(e.target.value)}
                  placeholder="First name"
                />
              </Field>
              <Field label="Partner two">
                <input
                  className="field mt-2"
                  value={partnerTwo}
                  onChange={(e) => setPartnerTwo(e.target.value)}
                  placeholder="First name"
                />
              </Field>
            </div>
            <div className="grid gap-8 md:grid-cols-2">
              <Field label="Wedding date">
                <input
                  type="date"
                  className="field mt-2"
                  value={weddingDate}
                  onChange={(e) => setWeddingDate(e.target.value)}
                />
              </Field>
              <Field label="Venue">
                <input
                  className="field mt-2"
                  value={venue}
                  onChange={(e) => setVenue(e.target.value)}
                  placeholder="Where you'll celebrate"
                />
              </Field>
            </div>
            <Field label="Welcome message">
              <textarea
                className="field mt-2 min-h-[110px] resize-y"
                value={welcomeMessage}
                onChange={(e) => setWelcomeMessage(e.target.value)}
                placeholder="A short note your guests will see when they arrive."
              />
            </Field>

            <div>
              <label className="text-eyebrow text-muted-foreground">Event address</label>
              <div className="mt-2 flex items-center gap-3 rounded-2xl surface-fade px-4 py-3">
                <span className="text-sm text-foreground/90">{guestUrl}</span>
                <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Lock className="h-3.5 w-3.5" />
                  Locked
                </span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                This address is permanent because your QR code depends on it.
              </p>
            </div>

            {saveError && <p className="text-sm text-destructive">{saveError}</p>}

            <div className="flex items-center justify-end gap-4 border-t border-border/60 pt-6">
              {savedFlash && (
                <span className="text-eyebrow text-[color:var(--dusty)]">Saved</span>
              )}
              <button
                type="submit"
                disabled={!detailsChanged || saving}
                className="btn-primary disabled:opacity-40"
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </form>
        </Card>

        {/* Section 2 — Cover Photo */}
        <Card>
          <SectionTitle title="Cover photo" />
          <div className="mt-10 space-y-6">
            {(() => {
              const { src, position } = parseCoverUrl(event.cover_image_url);
              return src ? (
                <CoverHero
                  src={src}
                  position={position}
                  alt="Cover preview"
                  className="aspect-[2/1] rounded-3xl border border-border/60"
                />
              ) : (
                <div className="flex aspect-[2/1] w-full items-center justify-center rounded-3xl border border-dashed border-border/60 bg-[color:var(--ivory)]/40">
                  <p className="text-sm text-muted-foreground">No cover yet.</p>
                </div>
              );
            })()}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleReplaceCover(f);
                e.target.value = "";
              }}
            />

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={coverUploading}
                className="btn-primary inline-flex items-center gap-2 disabled:opacity-40"
              >
                <UploadIcon className="h-4 w-4" />
                {coverUploading ? "Working…" : event.cover_image_url ? "Replace cover" : "Upload cover"}
              </button>
              {event.cover_image_url && (
                <button
                  type="button"
                  onClick={handleAdjustCover}
                  disabled={coverUploading}
                  className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-transparent px-5 py-2.5 text-eyebrow text-foreground transition hover:border-[color:var(--dusty)] hover:bg-[color:var(--champagne)]/40 disabled:opacity-40"
                >
                  <Move className="h-4 w-4" />
                  Adjust cover
                </button>
              )}
              {event.cover_image_url && (
                <button
                  type="button"
                  onClick={handleRemoveCover}
                  disabled={coverUploading}
                  className="text-eyebrow text-muted-foreground hover:text-foreground disabled:opacity-40"
                >
                  Remove cover
                </button>
              )}
            </div>
            {coverError && <p className="text-sm text-destructive">{coverError}</p>}
          </div>
        </Card>

        {/* Section 3 — Guest Experience */}
        <Card>
          <SectionTitle title="Guest experience" />
          <div className="mt-10 divide-y divide-border/50">
            <PermissionToggleRow
              title="Gallery visibility"
              caption="Allow guests to browse photos shared at your wedding."
              field="guests_can_view_gallery"
              permissions={permissions}
              setPermissions={setPermissions}
              eventId={event.id}
            />
            <PermissionToggleRow
              title="Guestbook"
              caption="Allow guests to leave messages for you."
              field="guestbook_enabled"
              permissions={permissions}
              setPermissions={setPermissions}
              eventId={event.id}
            />
            <PermissionToggleRow
              title="Show guestbook publicly"
              caption="Let guests see messages shared by others."
              field="guestbook_public"
              permissions={permissions}
              setPermissions={setPermissions}
              eventId={event.id}
            />
            <PermissionToggleRow
              title="Keep your uploads private"
              caption="Keep photos you upload to your event private from guests."
              field="show_owner_uploads_to_guests"
              permissions={permissions}
              setPermissions={setPermissions}
              eventId={event.id}
              invert
            />
          </div>
        </Card>

        {/* Section 4 — Trial Status */}
        {isTrial && (
          <Card>
            <SectionTitle title="Wedding trial" />
            <div className="mt-10 grid gap-6 sm:grid-cols-2">
              <Stat label="Current memories" value={`${photoCount}`} />
              <Stat label="Remaining" value="Unlimited" />
            </div>
            <div className="mt-6">
              <p className="text-eyebrow text-muted-foreground">Upload window</p>
              <p className="mt-2 text-sm text-foreground/90">Open until your event closes.</p>
            </div>
            <div className="mt-8 rounded-2xl surface-fade p-6">
              <p className="text-sm leading-6 text-foreground/85">
                Your Mosaic is already growing. Most weddings become truly beautiful after
                collecting around 1,000 memories. Upgrade whenever you're ready.
              </p>
              <button
                type="button"
                disabled
                className="btn-primary mt-5 cursor-not-allowed opacity-40"
              >
                Learn about Premium
              </button>
            </div>
          </Card>
        )}


        {/* Section 6 — Danger Zone */}
        <div className="rounded-[1.75rem] border border-[color:var(--dusty)]/40 bg-[color:var(--ivory)]/60 p-8 shadow-[var(--shadow-soft)] md:p-12">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-[color:var(--dusty)]" />
            <p className="text-eyebrow text-[color:var(--dusty)]">Danger zone</p>
          </div>
          <h3 className="text-display mt-3 text-2xl md:text-3xl">Delete this event</h3>
          <p className="mt-4 max-w-lg text-sm leading-6 text-muted-foreground">
            Deleting an event permanently removes memories, guestbook, QR and Mosaic.
            This action cannot be undone.
          </p>
          <button
            type="button"
            onClick={() => {
              setDeleteConfirm("");
              setDeleteOpen(true);
            }}
            disabled={deleting}
            className="mt-6 inline-flex items-center gap-2 rounded-full border border-[color:var(--dusty)]/60 px-5 py-2.5 text-sm font-medium text-[color:var(--dusty)] transition hover:bg-[color:var(--dusty)]/10 disabled:opacity-40"
          >
            <Trash2 className="h-4 w-4" />
            {deleting ? "Deleting…" : "Delete event"}
          </button>
        </div>
      </PageStack>

      {deleteOpen && (
        <DeleteEventDialog
          eventName={event.event_name}
          value={deleteConfirm}
          onChange={setDeleteConfirm}
          onCancel={() => {
            if (deleting) return;
            setDeleteOpen(false);
            setDeleteConfirm("");
          }}
          onConfirm={handleDeleteConfirmed}
          deleting={deleting}
        />
      )}

      {editorOpen && editorSrc && (
        <CoverPhotoEditor
          open
          imageSrc={editorSrc}
          initialPosition={editorInitialPos}
          eventName={event.event_name}
          weddingDateLabel={
            event.wedding_date
              ? new Date(event.wedding_date).toLocaleDateString(undefined, {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })
              : null
          }
          venue={event.venue}
          welcomeMessage={welcomeMessage || event.welcome_message || null}

          onCancel={handleEditorCancel}
          onSave={handleEditorSave}
          saving={editorSaving}
        />
      )}
    </AppShell>
  );
}

/* ───────── building blocks ───────── */

function PageHeader() {
  return (
    <header>
      <h1 className="text-display text-4xl md:text-6xl">Event settings</h1>
      <div className="mt-6 hairline" />
    </header>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-[1.75rem] surface-fade p-8 shadow-[var(--shadow-soft)] md:p-12">
      {children}
    </section>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <div>
      <p className="text-eyebrow text-muted-foreground invisible" aria-hidden="true">
        &nbsp;
      </p>
      <h2 className="text-display mt-2 text-2xl md:text-3xl">{title}</h2>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-eyebrow text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-eyebrow text-muted-foreground">{label}</p>
      <p className="text-display mt-2 text-3xl">{value}</p>
    </div>
  );
}

function ToggleRow({
  title,
  caption,
  checked,
  onChange,
}: {
  title: string;
  caption: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-6 py-5 first:pt-0 last:pb-0">
      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{caption}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

type PermField =
  | "guests_can_view_gallery"
  | "guestbook_enabled"
  | "guestbook_public"
  | "show_owner_uploads_to_guests";

function PermissionToggleRow({
  title,
  caption,
  field,
  permissions,
  setPermissions,
  eventId,
  invert = false,
}: {
  title: string;
  caption: string;
  field: PermField;
  permissions: GuestPermissions;
  setPermissions: React.Dispatch<React.SetStateAction<GuestPermissions>>;
  eventId: string;
  invert?: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // When `invert` is true, the toggle visually represents the opposite of the
  // stored boolean. This lets a row read as a standard ON/OFF feature toggle
  // even when the underlying field semantics are reversed.
  const storedValue = permissions[field];
  const displayValue = invert ? !storedValue : storedValue;

  async function handleChange(nextDisplayValue: boolean) {
    const nextStoredValue = invert ? !nextDisplayValue : nextDisplayValue;
    const previous = storedValue;
    setPermissions((p) => ({ ...p, [field]: nextStoredValue }));
    setSaving(true);
    setError(null);
    const { error } = await supabase
      .from("events")
      .update({ [field]: nextStoredValue } as Partial<import("@/lib/database.types").EventInsert>)
      .eq("id", eventId);
    setSaving(false);
    if (error) {
      // Revert on failure — never leave UI showing a non-persisted state.
      setPermissions((p) => ({ ...p, [field]: previous }));
      setError("Couldn't save. Please try again.");
      toast.error("Couldn't save that change.");
      return;
    }
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1000);
  }

  return (
    <div className="flex items-start justify-between gap-6 py-5 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{caption}</p>
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      </div>
      <div className="flex items-center gap-3">
        <span
          aria-live="polite"
          className={`text-eyebrow text-[0.65rem] text-[color:var(--dusty)] transition-opacity ${
            savedFlash ? "opacity-100" : "opacity-0"
          }`}
        >
          ✓ Saved
        </span>
        <Toggle
          checked={displayValue}
          onChange={handleChange}
        />

      </div>
    </div>
  );
}



function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={
        "relative mt-1 inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-300 " +
        (checked
          ? "border-[color:var(--dusty)] bg-[color:var(--dusty)]"
          : "border-border bg-[color:var(--mist)]")
      }
    >
      <span
        className={
          "inline-block h-[1.15rem] w-[1.15rem] transform rounded-full bg-[color:var(--ivory)] shadow-[var(--shadow-elegant)] transition-transform duration-300 " +
          (checked ? "translate-x-[1.4rem]" : "translate-x-[0.15rem]")
        }
      />
    </button>

  );
}

function DeleteEventDialog({
  eventName,
  value,
  onChange,
  onCancel,
  onConfirm,
  deleting,
}: {
  eventName: string | null;
  value: string;
  onChange: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  deleting: boolean;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !deleting) onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [deleting, onCancel]);

  const canDelete = value.trim().toUpperCase() === "DELETE" && !deleting;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-event-title"
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
    >
      <div
        className="absolute inset-0 bg-foreground/55 backdrop-blur-sm"
        onClick={() => !deleting && onCancel()}
      />
      <div className="relative z-10 w-full max-w-md overflow-hidden rounded-t-[1.75rem] surface-fade shadow-[var(--shadow-soft)] sm:rounded-[1.75rem]">
        <div className="flex items-start justify-between border-b border-border/50 px-6 py-4">
          <div className="flex items-center gap-2 text-[color:var(--dusty)]">
            <AlertTriangle className="h-4 w-4" />
            <p className="text-eyebrow">Danger zone</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            aria-label="Close"
            className="rounded-full p-1 text-foreground/70 hover:text-foreground disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-6 py-6">
          <h3 id="delete-event-title" className="text-display text-2xl">
            Delete {eventName ?? "this event"}?
          </h3>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            Every memory, guestbook message, QR code and generated mosaic
            will be permanently removed. This cannot be undone.
          </p>
          <label className="mt-6 block">
            <span className="text-eyebrow text-muted-foreground">
              Type <span className="text-foreground">DELETE</span> to confirm
            </span>
            <input
              autoFocus
              className="field mt-2 uppercase tracking-[0.2em]"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="DELETE"
              disabled={deleting}
            />
          </label>
          <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onCancel}
              disabled={deleting}
              className="rounded-full border border-border/60 px-5 py-2.5 text-eyebrow text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={!canDelete}
              className="rounded-full bg-[color:var(--dusty)] px-5 py-2.5 text-sm font-medium text-[color:var(--ivory)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {deleting ? "Deleting…" : "Delete event"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
