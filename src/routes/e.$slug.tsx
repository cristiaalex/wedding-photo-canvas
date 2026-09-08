import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { UploadCloud, Heart, Calendar, MapPin } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { GuestbookMessage, Upload } from "@/lib/database.types";
import { useEventUploads, useSignedPhotoUrls } from "@/hooks/use-photo-data";
import { useEventHasMosaic } from "@/hooks/use-event-has-mosaic";
import { PhotoLightbox } from "@/components/photo-lightbox";
import { GuestUploadSheet, ConfirmRemoveDialog } from "@/components/guest-upload-sheet";
import { GuestGuestbookSheet } from "@/components/guest-guestbook-sheet";
import { GuestWelcomeDialog } from "@/components/guest-welcome-dialog";
import { useGuestIdentity, toStoredGuestName, displayGuestName } from "@/lib/guest-identity";
import { readMyMessageIds } from "@/lib/guest-messages";
import { deleteOwnUpload, deleteReasonMessage } from "@/lib/guest-photo-delete";
import { parseCoverUrl } from "@/lib/cover-position";
import { CoverHero } from "@/components/cover-hero";
import { GuestHeroContent } from "@/components/guest-hero-content";



export const Route = createFileRoute("/e/$slug")({
  head: ({ params }) => ({
    meta: [
      { title: `Share a photo — ${params.slug} on Mosaic` },
      {
        name: "description",
        content: "Upload your photos and leave a note for the couple.",
      },
      { property: "og:title", content: "You're invited to share a moment" },
      {
        property: "og:description",
        content: "Your photo becomes part of the couple's interactive mosaic.",
      },
    ],
  }),
  component: GuestRouteShell,
  notFoundComponent: GuestNotFound,
});

function GuestNotFound() {
  const { slug } = Route.useParams();
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-6 text-center">
      <p className="text-eyebrow text-primary">404</p>
      <h1 className="text-display mt-4 text-3xl">That page doesn't exist</h1>
      <p className="mt-3 max-w-sm text-sm text-muted-foreground">
        We couldn't find that sub-page for this event.
      </p>
      <Link
        to="/e/$slug"
        params={{ slug }}
        className="mt-8 text-eyebrow text-primary hover:underline"
      >
        ← Back to event
      </Link>
    </div>
  );
}

function GuestRouteShell() {
  const { slug } = Route.useParams();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const isExact = pathname === `/e/${slug}` || pathname === `/e/${slug}/`;
  if (isExact) return <GuestEventPage />;
  return <Outlet />;
}

type EventInfo = {
  id: string;
  event_name: string | null;
  wedding_date: string | null;
  venue: string | null;
  cover_image_url: string | null;
  welcome_message: string | null;
  plan: string | null;
  guests_can_view_gallery: boolean;
  guestbook_enabled: boolean;
  guestbook_public: boolean;
};


type Tab = "gallery" | "guestbook";

function formatEventDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}


function GuestEventPage() {
  const { slug } = Route.useParams();
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [eventError, setEventError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("gallery");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
  const [writeOpen, setWriteOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [changeNameOpen, setChangeNameOpen] = useState(false);
  const { identity, save: saveIdentity } = useGuestIdentity(event?.id ?? null);
  const guestName = toStoredGuestName(identity);
  const needsWelcome = !!event?.id && identity === null;
  const uploadsQuery = useEventUploads(event?.id ?? null);
  const allUploads = uploadsQuery.data ?? [];
  const memoryCount = allUploads.length;
  // Group by the stable per-device guest_uuid so a display-name change
  // (e.g. Anonymous → Madalin) never inflates the guest counter. Legacy
  // rows without guest_uuid fall back to guest_name.
  const contributorCount = useMemo(() => {
    const keys = new Set<string>();
    for (const u of allUploads) {
      const uuid = u.guest_uuid?.trim();
      if (uuid) {
        keys.add(`uuid:${uuid}`);
        continue;
      }
      const n = (u.guest_name ?? "").trim().toLowerCase();
      if (n) keys.add(`name:${n}`);
    }
    return keys.size;
  }, [allUploads]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("events")
        .select("id, event_name, wedding_date, venue, cover_image_url, welcome_message, plan, guests_can_view_gallery, guestbook_enabled, guestbook_public")
        .eq("slug", slug)
        .maybeSingle();
      if (cancelled) return;
      if (error) setEventError(error.message);
      else if (!data) setNotFound(true);
      else {
        const row = data as Partial<EventInfo> & { id: string; slug?: string };
        setEvent({
          id: row.id,
          event_name: row.event_name ?? null,
          wedding_date: row.wedding_date ?? null,
          venue: row.venue ?? null,
          cover_image_url: row.cover_image_url ?? null,
          welcome_message: row.welcome_message ?? null,
          plan: row.plan ?? null,
          guests_can_view_gallery: row.guests_can_view_gallery ?? true,
          guestbook_enabled: row.guestbook_enabled ?? true,
          guestbook_public: row.guestbook_public ?? true,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);


  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  if (notFound) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background px-6 text-center">
        <p className="text-eyebrow text-primary">Not found</p>
        <h1 className="text-display mt-4 text-3xl">This event link isn't active</h1>
      </div>
    );
  }

  const dateLabel = formatEventDate(event?.wedding_date ?? null);
  const { src: coverSrc, position: coverPos } = parseCoverUrl(event?.cover_image_url ?? null);

  return (
    <div className="min-h-screen bg-[color:var(--ivory)]">
      {/* HERO — same rendering engine as onboarding cover preview. No app
          header so the couple's photo is the first thing guests see. */}
      <section className="relative w-full bg-[color:var(--ivory)] motion-safe:animate-[fade-in_240ms_ease-out_both]">
        <CoverHero
          src={coverSrc}
          position={coverPos}
          alt={event?.event_name ?? "Wedding cover"}
          eager
          fadeTo="var(--ivory)"
          fallbackLetter={event?.event_name?.[0] ?? "M"}
          className="h-[62vh] w-full sm:h-[68vh] md:h-[74vh]"
        >
          <GuestHeroContent
            eventName={event?.event_name ?? null}
            weddingDateLabel={dateLabel}
            venue={event?.venue ?? null}
            welcomeMessage={event?.welcome_message ?? null}
          />

        </CoverHero>
      </section>


      {/* SHARE CARD */}
      <section className="mx-auto max-w-5xl lg:max-w-6xl xl:max-w-7xl px-4 pt-2 sm:px-6 md:pt-4 md:px-8">
        <div className="rounded-[1rem] border border-[color:var(--dusty)]/20 bg-[color:var(--ivory)] p-5 shadow-[var(--shadow-soft)] md:p-8 lg:p-10">
          <div className="text-center">
            <h2 className="text-display text-3xl text-foreground sm:text-4xl md:text-5xl lg:text-6xl">
              Share your memories
            </h2>
            <p className="mt-2 text-sm text-muted-foreground sm:text-base md:mt-4 md:text-lg">
              Every memory you share becomes part of our wedding mosaic.
            </p>

          </div>

          <label className="group mt-5 flex w-full cursor-pointer items-center gap-4 rounded-[1rem] border border-[color:var(--dusty)]/20 bg-[color:var(--champagne)]/30 px-4 py-3.5 transition-all hover:border-primary/40 hover:bg-[color:var(--ivory)] md:mt-7 md:gap-6 md:px-6 md:py-5 lg:mx-auto lg:max-w-2xl">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[color:var(--champagne)]/60 text-primary md:h-14 md:w-14">
              <UploadCloud className="h-5 w-5 md:h-6 md:w-6" strokeWidth={1.6} />
            </span>
            <div className="flex flex-1 flex-col items-center text-center">
              <span className="text-display text-base text-foreground sm:text-lg md:text-xl">
                Tap to choose or capture
              </span>
              <span className="text-xs text-muted-foreground sm:text-sm md:text-base">
                Sharing begins automatically
              </span>
            </div>
            <svg className="h-5 w-5 text-muted-foreground/60 md:h-6 md:w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <input
              type="file"
              accept="image/jpeg,image/png,image/heic,image/heif,.heic,.heif,.dng,image/x-adobe-dng,image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                const picked = e.target.files;
                if (picked && picked.length > 0) {
                  setPendingFiles(Array.from(picked));
                  setUploadOpen(true);
                }
                e.target.value = "";
              }}
            />
          </label>
        </div>
      </section>

      {/* LIVE STATS CARD */}
      {memoryCount > 0 && (
        <section className="mx-auto max-w-5xl lg:max-w-6xl xl:max-w-7xl px-4 pt-2 sm:px-6 md:pt-4 md:px-8">
          <div className="flex items-center justify-center gap-3 rounded-[1rem] border border-[color:var(--dusty)]/20 bg-[color:var(--ivory)] px-5 py-4 shadow-[var(--shadow-soft)]">
            <span className="inline-flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[color:var(--gold)] opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[color:var(--gold)]" />
              </span>
              <span className="text-[0.65rem] font-semibold tracking-[0.22em] uppercase text-foreground">
                Live
              </span>
            </span>
            <span className="h-4 w-px bg-[color:var(--dusty)]/25" />
            <p className="text-sm text-muted-foreground sm:text-base">
              <span className="font-semibold text-foreground">
                {memoryCount.toLocaleString()}
              </span>{" "}
              {memoryCount === 1 ? "memory" : "memories"} shared
              {contributorCount > 0 && (
                <>
                  {" "}by{" "}
                  <span className="font-semibold text-foreground">
                    {contributorCount.toLocaleString()}
                  </span>{" "}
                  {contributorCount === 1 ? "guest" : "guests"}
                </>
              )}
            </p>
          </div>
        </section>
      )}

      {/* IDENTITY ROW */}
      <section className="mx-auto max-w-5xl lg:max-w-6xl xl:max-w-7xl px-4 pt-2 sm:px-6 md:pt-4 md:px-8">
        <div className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 rounded-[1rem] border border-[color:var(--dusty)]/20 bg-[color:var(--ivory)] px-3 py-2.5 shadow-[var(--shadow-soft)] sm:gap-x-2 sm:px-5 sm:py-3">
          <span className="text-eyebrow text-[0.6rem] tracking-[0.2em] sm:text-[0.7rem] sm:tracking-[0.3em]">Sharing as</span>
          <span aria-hidden className="text-muted-foreground/60">─</span>
          <span className="text-display max-w-[9rem] truncate text-base sm:max-w-[14rem] md:max-w-[18rem]">
            {displayGuestName(guestName) || "Anonymous"}
          </span>
          <span aria-hidden className="text-muted-foreground/60">─</span>
          <button
            type="button"
            onClick={() => setChangeNameOpen(true)}
            className="text-eyebrow text-[0.6rem] tracking-[0.2em] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline sm:text-[0.7rem] sm:tracking-[0.3em]"
          >
            {displayGuestName(guestName) ? "Change name" : "Set your name"}
          </button>
        </div>
      </section>

      {/* TABS — privacy settings never remove access to a guest's OWN
          contributions; they only hide other guests' content. */}
      {(() => {
        const galleryPublic = event?.guests_can_view_gallery !== false;
        const guestbookEnabled = event?.guestbook_enabled !== false;
        const guestbookPublic = event?.guestbook_public !== false;
        const activeTab: Tab = tab;
        return (
          <>
            <nav className="mx-auto mt-2 max-w-5xl lg:max-w-6xl xl:max-w-7xl px-4 sm:px-6 md:mt-4 md:px-8">
              <div className="relative grid grid-cols-2 rounded-[1rem] border border-[color:var(--dusty)]/20 bg-[color:var(--ivory)] shadow-[var(--shadow-soft)]">
                <TabButton active={activeTab === "gallery"} onClick={() => setTab("gallery")} icon="gallery">
                  Gallery
                </TabButton>
                <span
                  aria-hidden
                  className="pointer-events-none absolute left-1/2 top-1/2 h-4 w-px -translate-x-1/2 -translate-y-1/2 bg-[color:var(--dusty)]/25"
                />
                <TabButton active={activeTab === "guestbook"} onClick={() => setTab("guestbook")} icon="book">
                  Guestbook
                </TabButton>
              </div>
            </nav>

            <main className="mx-auto max-w-5xl lg:max-w-6xl xl:max-w-7xl px-4 pb-24 pt-2 sm:px-6 md:px-8">
              {eventError && <p className="text-sm text-destructive">{eventError}</p>}

              {activeTab === "gallery" && (
                <GalleryTab
                  eventId={event?.id ?? null}
                  onUpload={() => setUploadOpen(true)}
                  guestUuid={identity?.guest_uuid ?? null}
                  mineOnly={!galleryPublic}
                />
              )}
              {activeTab === "guestbook" && (
                <GuestbookTab
                  eventId={event?.id ?? null}
                  onWrite={() => setWriteOpen(true)}
                  canSubmit={guestbookEnabled}
                  mineOnly={!guestbookPublic}
                />
              )}
            </main>
          </>
        );
      })()}




      <GuestUploadSheet
        open={uploadOpen}
        onClose={() => {
          setUploadOpen(false);
          setPendingFiles(null);
        }}
        eventId={event?.id ?? null}
        eventPlan={event?.plan ?? null}
        guestName={guestName}
        guestUuid={identity?.guest_uuid ?? null}
        eventName={event?.event_name ?? null}
        onViewGallery={() => setTab("gallery")}
        initialFiles={pendingFiles}
      />
      <GuestGuestbookSheet
        open={writeOpen}
        onClose={() => setWriteOpen(false)}
        eventId={event?.id ?? null}
        guestName={identity?.guest_name ?? null}
        onSubmitted={() => setToast("Your note has been submitted.")}
      />

      <GuestWelcomeDialog
        open={needsWelcome || changeNameOpen}
        eventName={event?.event_name ?? null}
        initialName={identity?.guest_name ?? ""}
        onSubmit={(name) => {
          saveIdentity(name);
          setChangeNameOpen(false);
        }}
      />

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 w-[min(92vw,28rem)] -translate-x-1/2 rounded-[1rem] bg-[color:var(--primary)] px-5 py-4 text-[color:var(--ivory)] shadow-[var(--shadow-soft)]">
          <div className="flex items-start gap-3">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="12" cy="12" r="9.5" />
              <path d="M8 12.5l2.5 2.5L16 9.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div className="flex-1">
              <p className="font-semibold">Success</p>
              <p className="text-sm opacity-90">{toast}</p>
            </div>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="rounded p-1 opacity-80 hover:opacity-100"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  icon: "gallery" | "book";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex items-center justify-center gap-2 py-4 text-eyebrow transition-colors ${
        active ? "text-primary" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {icon === "gallery" ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <rect x="3" y="5" width="18" height="14" rx="2.5" />
          <circle cx="9" cy="11" r="1.6" />
          <path d="M3.5 17l5-5 4 4 3-3 5 5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M4 4h6a3 3 0 013 3v13a3 3 0 00-3-3H4V4z" />
          <path d="M20 4h-6a3 3 0 00-3 3v13a3 3 0 013-3h6V4z" />
        </svg>
      )}
      {children}
      {active && (
        <span className="absolute bottom-0 left-1/2 h-[2px] w-2/3 -translate-x-1/2 rounded-full bg-primary" />
      )}
    </button>
  );
}

/* ---------------------------- Gallery tab ---------------------------- */

function GalleryTab({
  eventId,
  guestUuid,
  mineOnly,
}: {
  eventId: string | null;
  onUpload: () => void;
  guestUuid: string | null;
  mineOnly: boolean;
}) {
  const queryClient = useQueryClient();
  const uploadsQuery = useEventUploads(eventId);
  const allUploads = uploadsQuery.data ?? [];
  // Privacy: when the couple hides the gallery, a guest still sees every
  // photo they personally contributed — nothing is deleted, only hidden.
  const uploads = useMemo(
    () =>
      mineOnly
        ? allUploads.filter((u) => !!guestUuid && !!u.guest_uuid && u.guest_uuid === guestUuid)
        : allUploads,
    [allUploads, mineOnly, guestUuid],
  );
  const paths = uploads.map((u) => u.image_url);
  const signed = useSignedPhotoUrls(paths, "thumb_600");
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [pendingRemoveIdx, setPendingRemoveIdx] = useState<number | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const hasMosaicQuery = useEventHasMosaic(eventId);
  const eventHasMosaic = hasMosaicQuery.data === true;

  function ownedByMe(u: Upload): boolean {
    return !!guestUuid && !!u.guest_uuid && u.guest_uuid === guestUuid;
  }
  function withinWindow(u: Upload): boolean {
    if (!u.uploaded_at) return false;
    const uploadedAt = new Date(u.uploaded_at).getTime();
    if (!Number.isFinite(uploadedAt)) return false;
    return Date.now() - uploadedAt < 24 * 60 * 60 * 1000;
  }
  function canRemove(u: Upload): boolean {
    return ownedByMe(u) && !eventHasMosaic && withinWindow(u);
  }

  async function handleRemove() {
    if (pendingRemoveIdx === null || !eventId || !guestUuid) return;
    const target = uploads[pendingRemoveIdx];
    if (!target) return;
    setRemoving(true);
    setRemoveError(null);
    const result = await deleteOwnUpload({
      eventId,
      uploadId: target.id,
      guestUuid,
    });
    setRemoving(false);
    if (result.ok) {
      queryClient.setQueryData<Upload[]>(["uploads", eventId], (prev) =>
        (prev ?? []).filter((p) => p.id !== target.id),
      );
      queryClient.invalidateQueries({ queryKey: ["uploads", eventId] });
      setPendingRemoveIdx(null);
      setLightboxIndex(null);
    } else {
      setRemoveError(deleteReasonMessage(result.reason));
      setPendingRemoveIdx(null);
    }
  }

  // Realtime stream of new uploads.
  useEffect(() => {
    if (!eventId) return;
    const channel = supabase
      .channel(`uploads:${eventId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "uploads", filter: `event_id=eq.${eventId}` },
        (payload) => {
          const row = payload.new as Upload;
          queryClient.setQueryData<Upload[]>(["uploads", eventId], (prev) =>
            prev ? [row, ...prev.filter((p) => p.id !== row.id)] : [row],
          );
          queryClient.invalidateQueries({ queryKey: ["signed-photo-urls"] });
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "uploads", filter: `event_id=eq.${eventId}` },
        (payload) => {
          const removedId = (payload.old as { id?: string } | null)?.id;
          if (!removedId) return;
          queryClient.setQueryData<Upload[]>(["uploads", eventId], (prev) =>
            prev ? prev.filter((p) => p.id !== removedId) : prev,
          );
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId, queryClient]);

  return (
    <div>
      {mineOnly && (
        <div className="mt-3 rounded-[1rem] border border-[color:var(--dusty)]/20 bg-[color:var(--ivory)] px-4 py-3 text-center shadow-[var(--shadow-soft)]">
          <p className="text-eyebrow text-[0.6rem] tracking-[0.2em] sm:text-[0.7rem] sm:tracking-[0.3em]">
            Your photos
          </p>
          <p className="mt-1.5 text-xs text-muted-foreground sm:text-sm">
            The couple has kept the full gallery private — you can still see everything you shared.
          </p>
        </div>
      )}

      {uploads.length === 0 ? (
        <div className="mt-12 flex flex-col items-center justify-center rounded-[1rem] border border-border/60 bg-[color:var(--champagne)]/30 px-5 py-20 text-center">
          <p className="text-eyebrow">{mineOnly ? "Nothing yet" : "Awaiting the first moment"}</p>
          <h3 className="text-display mt-4 text-3xl">
            {mineOnly ? (
              <>Share your <span className="text-script">first photo</span></>
            ) : (
              <>The day is <span className="text-script">about to begin</span></>
            )}
          </h3>
        </div>
      ) : (
        <div className="mt-3 columns-2 gap-2 md:columns-3 md:gap-4 lg:columns-4 lg:gap-5 xl:columns-5">
          {uploads.map((u, i) => {
            const src = signed.data?.get(u.image_url);
            return (
              src ? (
                <figure
                  key={u.id}
                  className="mb-2 break-inside-avoid overflow-hidden rounded-[1rem] bg-card md:mb-4 lg:mb-5"
                >
                  <button
                    type="button"
                    onClick={() => setLightboxIndex(i)}
                    className="block w-full cursor-zoom-in overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/60"
                    aria-label={displayGuestName(u.guest_name) ? `Open photo by ${displayGuestName(u.guest_name)}` : "Open photo"}
                  >
                    <img
                      src={src}
                      alt={displayGuestName(u.guest_name) ? `By ${displayGuestName(u.guest_name)}` : "Guest photo"}
                      loading="lazy"
                      decoding="async"
                      sizes="(min-width: 1280px) 20vw, (min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw"
                      className="h-auto w-full transition-transform duration-300 ease-out hover:scale-[1.02]"
                    />
                  </button>
                </figure>
              ) : null
            );
          })}
        </div>
      )}


      {lightboxIndex !== null && (
        <PhotoLightbox
          photos={uploads.map((u) => ({
            path: u.image_url,
            caption: displayGuestName(u.guest_name) ? `By ${displayGuestName(u.guest_name)}` : null,
            ownedByMe: ownedByMe(u),
            canRemove: canRemove(u),
          }))}
          index={lightboxIndex}
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onRequestRemove={(i) => setPendingRemoveIdx(i)}
        />
      )}

      {pendingRemoveIdx !== null && (
        <ConfirmRemoveDialog
          busy={removing}
          onCancel={() => setPendingRemoveIdx(null)}
          onConfirm={() => void handleRemove()}
        />
      )}

      {removeError && (
        <div
          role="alert"
          className="fixed bottom-6 left-1/2 z-[70] w-[min(92vw,24rem)] -translate-x-1/2 rounded-2xl bg-destructive px-4 py-3 text-sm text-[color:var(--ivory)] shadow-[var(--shadow-soft)] motion-safe:animate-[fade-in_200ms_ease-out_both]"
        >
          <div className="flex items-start gap-3">
            <span className="flex-1">{removeError}</span>
            <button
              type="button"
              onClick={() => setRemoveError(null)}
              className="rounded p-1 opacity-90 hover:opacity-100"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------- Guestbook tab ---------------------------- */

function GuestbookTab({
  eventId,
  onWrite,
  canSubmit,
  mineOnly,
}: {
  eventId: string | null;
  onWrite: () => void;
  canSubmit: boolean;
  mineOnly: boolean;
}) {

  const [messages, setMessages] = useState<GuestbookMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [myIds, setMyIds] = useState<string[]>(() => readMyMessageIds(eventId));

  // Keep the "my notes" list fresh when this device submits a new one.
  useEffect(() => {
    const sync = () => setMyIds(readMyMessageIds(eventId));
    sync();
    window.addEventListener("my-guestbook-change", sync);
    return () => window.removeEventListener("my-guestbook-change", sync);
  }, [eventId]);

  // Privacy: hiding the public guestbook never hides a guest's own notes.
  const visibleMessages = useMemo(() => {
    if (messages === null) return null;
    if (!mineOnly) return messages;
    const mine = new Set(myIds);
    return messages.filter((m) => mine.has(m.id));
  }, [messages, mineOnly, myIds]);

  const refresh = useMemo(
    () => async () => {
      if (!eventId) return;
      const { data, error } = await supabase
        .from("guestbook_messages")
        .select("id, event_id, guest_name, message, created_at")
        .eq("event_id", eventId)
        .order("created_at", { ascending: false });
      if (error) setError(error.message);
      else setMessages((data ?? []) as GuestbookMessage[]);
    },
    [eventId],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Realtime: new messages appear instantly.
  useEffect(() => {
    if (!eventId) return;
    const channel = supabase
      .channel(`guestbook:${eventId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "guestbook_messages",
          filter: `event_id=eq.${eventId}`,
        },
        (payload) => {
          const row = payload.new as GuestbookMessage;
          setMessages((prev) => (prev ? [row, ...prev.filter((m) => m.id !== row.id)] : [row]));
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId]);

  return (
    <div className="mx-auto max-w-2xl">
      {canSubmit ? (
        <button
          type="button"
          onClick={onWrite}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-[1rem] border border-[color:var(--dusty)]/30 bg-[color:var(--champagne)]/40 px-5 py-4 text-eyebrow text-foreground shadow-[var(--shadow-soft)] transition-colors hover:border-primary/40 hover:bg-[color:var(--champagne)]/60 active:scale-[0.99]"
          style={{ letterSpacing: "0.14em" }}
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[color:var(--gold)]/20 text-primary">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M4 20l4-1L20 7a2 2 0 00-3-3L5 16l-1 4z" strokeLinejoin="round" />
            </svg>
          </span>
          Write a message
        </button>
      ) : (
        <div className="mt-2 rounded-[1rem] border border-dashed border-border/70 bg-[color:var(--ivory)]/60 p-6 text-center text-sm text-muted-foreground">
          The couple has closed new guestbook messages for now.
        </div>
      )}

      {error && <p className="mt-6 text-sm text-destructive">{error}</p>}

      {mineOnly && (
        <p className="mt-8 text-center text-xs text-muted-foreground">
          Notes from other guests are private — below are the ones you wrote.
        </p>
      )}

      <div className="mt-8 space-y-5">
        {visibleMessages === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : visibleMessages.length === 0 ? (
          <div className="rounded-[1rem] border border-dashed border-border/70 bg-[color:var(--ivory)]/60 p-8 text-center">
            <p className="text-sm text-muted-foreground">
              {mineOnly ? "You haven't written a note yet." : "No notes yet — be the first."}
            </p>
          </div>
        ) : (
          visibleMessages.map((m) => <MessageCard key={m.id} message={m} />)
        )}
      </div>

    </div>
  );
}

function MessageCard({ message }: { message: GuestbookMessage }) {
  const name = displayGuestName(message.guest_name)?.trim() || "A guest";
  const initials = name
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <article className="relative rounded-[1rem] border border-border/60 bg-[color:var(--ivory)]/90 shadow-[var(--shadow-soft)]">
      <div className="px-5 pt-5 pb-4">
        <p className="text-lg leading-relaxed text-foreground">
          <span className="text-script mr-1 text-2xl text-muted-foreground/70 align-top">“</span>
          {message.message}
        </p>
      </div>
      <div className="flex items-center justify-between border-t border-border/50 px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[color:var(--champagne)] text-xs font-semibold tracking-wider text-primary">
            {initials}
          </div>
          <div>
            <p className="text-[0.65rem] tracking-[0.25em] uppercase text-muted-foreground">From:</p>
            <p className="text-sm font-semibold text-foreground">{name}</p>
          </div>
        </div>
      </div>
      {/* Pointer */}
      <span
        aria-hidden
        className="absolute -bottom-2 left-9 h-4 w-4 rotate-45 border-b border-r border-border/60 bg-[color:var(--ivory)]/90"
      />
    </article>
  );
}

/* ---------------------------- Recent uploads strip ---------------------------- */

function RecentUploadsStrip({
  eventId,
  uploads,
  onViewAll,
}: {
  eventId: string | null;
  uploads: Upload[];
  onViewAll: () => void;
}) {
  const recent = uploads.slice(0, 5);
  const paths = useMemo(() => recent.map((u) => u.image_url), [recent]);
  const signed = useSignedPhotoUrls(paths, "thumb_600");

  if (!eventId || recent.length === 0) return null;

  return (
    <div className="mt-5">
      <div className="flex items-end justify-between">
        <p className="text-eyebrow">Recent uploads</p>
        <button
          type="button"
          onClick={onViewAll}
          className="text-eyebrow text-[0.6rem] text-primary hover:underline"
        >
          View all →
        </button>
      </div>
      <div className="mt-4 grid grid-cols-5 gap-2 sm:gap-3">
        {recent.map((u) => {
          const src = signed.data?.get(u.image_url);
          return (
            <div
              key={u.id}
              className="aspect-square overflow-hidden rounded-[1rem] bg-[color:var(--champagne)]/40"
            >
              {src ? (
                <img
                  src={src}
                  alt={displayGuestName(u.guest_name) ? `By ${displayGuestName(u.guest_name)}` : "Recent upload"}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="h-full w-full animate-pulse" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

