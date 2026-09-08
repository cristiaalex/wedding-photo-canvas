import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image as ImageIcon, Video, Sparkles, MessageCircle, Copy, Check, ExternalLink } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PageStack } from "@/components/page-layout";
import { supabase } from "@/lib/supabase";
import { useEventUploads, useSignedPhotoUrls } from "@/hooks/use-photo-data";

import { guestUrlForSlug } from "@/lib/qr";
import { MemoryLightbox, type MemoryLightboxItem } from "@/components/memory-lightbox";
import { DownloadArchives } from "@/components/download-archives";
import { cn } from "@/lib/utils";
import type { Event, Upload } from "@/lib/database.types";
import { displayGuestName } from "@/lib/guest-identity";

export const Route = createFileRoute("/_authenticated/gallery")({
  head: () => ({
    meta: [
      { title: "Memories — Mosaic" },
      { name: "description", content: "Every photo shared by your guests, gathered as one wedding story." },
    ],
  }),
  component: GalleryPage,
});

/* ------------------------------------------------------------------ */
/* Filter architecture — future-ready (Favorites / Albums / AI / etc) */
/* ------------------------------------------------------------------ */

type ScopeFilter = "all" | "photos" | "favorites" | "videos";
type SortOrder = "newest" | "oldest";

/* ------------------------------------------------------------------ */
/* Page                                                                 */
/* ------------------------------------------------------------------ */

function GalleryPage() {
  const [event, setEvent] = useState<Event | null>(null);
  const [eventLoading, setEventLoading] = useState(true);
  const [guestbookNames, setGuestbookNames] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (cancelled || !userData.user) { setEventLoading(false); return; }
      const { data: events } = await supabase
        .from("events").select("*")
        .eq("organizer_id", userData.user.id)
        .order("created_at", { ascending: false }).limit(1);
      if (cancelled) return;
      const ev = events?.[0] ?? null;
      setEvent(ev);
      setEventLoading(false);
      if (ev) {
        const { data: gb } = await supabase
          .from("guestbook_messages").select("guest_name").eq("event_id", ev.id);
        if (cancelled) return;
        const names = new Set<string>();
        for (const r of gb ?? []) {
          const n = (r.guest_name ?? "").trim().toLowerCase();
          if (n) names.add(n);
        }
        setGuestbookNames(names);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const uploadsQuery = useEventUploads(event?.id ?? null);
  const uploads = uploadsQuery.data ?? [];
  const loading = eventLoading || uploadsQuery.isLoading;

  const [scope, setScope] = useState<ScopeFilter>("all");
  const [sort, setSort] = useState<SortOrder>("newest");

  const filtered = useMemo(() => {
    let list: Upload[] = uploads;
    if (scope === "favorites") list = []; // future
    if (scope === "videos") list = [];    // premium
    list = [...list].sort((a, b) => {
      const ta = new Date(a.uploaded_at).getTime();
      const tb = new Date(b.uploaded_at).getTime();
      return sort === "newest" ? tb - ta : ta - tb;
    });
    return list;
  }, [uploads, scope, sort]);

  // Hero stats are derived from the full uploads list, not the filtered view.
  // Contributor count is keyed on the stable per-device guest_uuid so a
  // display-name change does not create a new contributor. Legacy rows
  // without guest_uuid fall back to guest_name.
  const stats = useMemo(() => {
    const contributors = new Set<string>();
    for (const u of uploads) {
      const uuid = u.guest_uuid?.trim();
      if (uuid) {
        contributors.add(`uuid:${uuid}`);
        continue;
      }
      const n = (u.guest_name ?? "").trim().toLowerCase();
      contributors.add(n ? `name:${n}` : "anon:__none__");
    }
    const latest = uploads.reduce<string | null>((acc, u) => {
      if (!acc || new Date(u.uploaded_at) > new Date(acc)) return u.uploaded_at;
      return acc;
    }, null);
    return { total: uploads.length, contributors: contributors.size, latest };
  }, [uploads]);

  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const lightboxItems: MemoryLightboxItem[] = useMemo(
    () => filtered.map((u) => ({
      id: u.id,
      path: u.image_url,
      guestName: u.guest_name,
      uploadedAt: u.uploaded_at,
      hasGuestbook: guestbookNames.has((u.guest_name ?? "").trim().toLowerCase()),
    })),
    [filtered, guestbookNames],
  );

  const handleDelete = async (item: MemoryLightboxItem) => {
    const { error } = await supabase.from("uploads").delete().eq("id", item.id);
    if (error) return;
    await uploadsQuery.refetch();
    setLightboxIndex((idx) => {
      if (idx == null) return idx;
      const nextLen = lightboxItems.length - 1;
      if (nextLen <= 0) return null;
      return Math.min(idx, nextLen - 1);
    });
  };

  // Calm intro overlay: only on the first gallery load per session.
  // Stays visible until thumbnails are actually decoded and masonry is stable.
  const seenKey = event?.id ? `gallery_seen_${event.id}` : null;
  const [showIntroOverlay, setShowIntroOverlay] = useState<boolean>(true);
  const [gridReady, setGridReady] = useState(false);
  const dismissIntroOverlay = useCallback(() => {
    setShowIntroOverlay(false);
    if (seenKey) { try { sessionStorage.setItem(seenKey, "1"); } catch { /* noop */ } }
  }, [seenKey]);
  useEffect(() => {
    if (!seenKey) return;
    try {
      if (sessionStorage.getItem(seenKey)) setShowIntroOverlay(false);
    } catch { /* noop */ }
  }, [seenKey]);
  useEffect(() => {
    if (!showIntroOverlay) return;
    if (loading) return;
    if (filtered.length > 0 && !gridReady) return;
    const t = window.setTimeout(() => {
      dismissIntroOverlay();
    }, 250);
    return () => window.clearTimeout(t);
  }, [showIntroOverlay, loading, filtered.length, gridReady, dismissIntroOverlay]);
  useEffect(() => {
    if (!showIntroOverlay || loading || filtered.length === 0 || gridReady) return;
    const t = window.setTimeout(() => {
      dismissIntroOverlay();
    }, 4500);
    return () => window.clearTimeout(t);
  }, [showIntroOverlay, loading, filtered.length, gridReady, dismissIntroOverlay]);

  return (
    <AppShell weddingName={event?.event_name ?? null}>
      <PageStack>
      <GalleryHero stats={stats} loading={loading} />

      <FilterBar
        scope={scope} setScope={setScope}
        sort={sort} setSort={setSort}
      />

      {loading ? (
        <SkeletonGrid />
      ) : filtered.length === 0 && uploads.length === 0 ? (
        <EmptyState event={event} />
      ) : filtered.length === 0 ? (
        <NoMatches onClear={() => { setScope("all"); }} />
      ) : (
        <MemoryGrid
          items={filtered}
          guestbookNames={guestbookNames}
          onOpen={(i) => setLightboxIndex(i)}
          onFirstPaint={() => setGridReady(true)}
        />
      )}

      {uploads.length > 0 && <DownloadArchives eventId={event?.id ?? null} />}
      </PageStack>

      <GalleryIntroOverlay visible={showIntroOverlay} />

      {lightboxIndex != null && lightboxItems[lightboxIndex] && (
        <MemoryLightbox
          items={lightboxItems}
          index={lightboxIndex}
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onDelete={handleDelete}
        />
      )}
    </AppShell>
  );
}

/* ------------------------------------------------------------------ */
/* Intro overlay — first visit only                                     */
/* ------------------------------------------------------------------ */

const INTRO_MESSAGES = [
  "Gathering your memories…",
  "Crafting your story…",
  "Arranging every beautiful moment…",
  "Almost ready…",
];

function GalleryIntroOverlay({ visible }: { visible: boolean }) {
  const [idx, setIdx] = useState(0);
  const [mounted, setMounted] = useState(visible);
  useEffect(() => {
    if (visible) setMounted(true);
    else {
      const t = window.setTimeout(() => setMounted(false), 650);
      return () => window.clearTimeout(t);
    }
  }, [visible]);
  useEffect(() => {
    if (!mounted) return;
    const t = window.setInterval(() => setIdx((i) => (i + 1) % INTRO_MESSAGES.length), 1800);
    return () => window.clearInterval(t);
  }, [mounted]);
  if (!mounted) return null;
  return (
    <div
      aria-hidden
      className="fixed inset-0 z-40 flex items-center justify-center bg-[color:var(--ivory)]/85 backdrop-blur-2xl transition-opacity duration-[600ms] ease-out"
      style={{ opacity: visible ? 1 : 0, pointerEvents: visible ? "auto" : "none" }}
    >
      <div className="flex flex-col items-center text-center">
        <div className="grid grid-cols-3 gap-1.5">
          {Array.from({ length: 9 }).map((_, i) => (
            <span
              key={i}
              className="block h-3.5 w-3.5 rounded-[3px] bg-foreground/20 md:h-4 md:w-4"
              style={{
                animation: "intro-tile 2.2s ease-in-out infinite",
                animationDelay: `${(i % 3) * 0.12 + Math.floor(i / 3) * 0.08}s`,
              }}
            />
          ))}
        </div>
        <p
          key={idx}
          className="mt-8 font-sans text-base text-foreground/65 motion-safe:animate-[fade-in_500ms_ease-out_both] md:text-lg"
        >
          {INTRO_MESSAGES[idx]}
        </p>
      </div>
      <style>{`@keyframes intro-tile { 0%, 100% { opacity: 0.2; transform: scale(0.92); } 50% { opacity: 0.95; transform: scale(1); } }`}</style>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Hero                                                                 */
/* ------------------------------------------------------------------ */

function GalleryHero({ stats, loading }: { stats: { total: number; contributors: number; latest: string | null }; loading: boolean }) {
  const parts: string[] = [];
  if (!loading) {
    parts.push(`${stats.total.toLocaleString()} ${stats.total === 1 ? "memory" : "memories"}`);
    parts.push(`${stats.contributors} ${stats.contributors === 1 ? "contributor" : "contributors"}`);
    if (stats.latest) parts.push(`Last upload ${relativeTime(stats.latest)}`);
  }
  return (
    <header className="pb-1 pt-1 md:pb-8 md:pt-2">
      <h1 className="text-display text-4xl md:text-6xl">Gallery</h1>
      <div className="mt-6 hairline" />
      <p className="mt-6 max-w-xl text-sm text-muted-foreground md:text-base">
        Every photo shared by your guests becomes part of your Mosaic.
      </p>
      <p className="mt-2 text-xs text-muted-foreground/75 md:text-sm">
        {loading ? "—" : parts.join(" · ")}
      </p>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Filter bar (sticky)                                                  */
/* ------------------------------------------------------------------ */

function FilterBar({
  scope, setScope, sort, setSort,
}: {
  scope: ScopeFilter; setScope: (s: ScopeFilter) => void;
  sort: SortOrder; setSort: (s: SortOrder) => void;
}) {
  return (
    <div className="sticky top-16 z-20 -mx-5 mb-3 border-y border-border/60 bg-[color:var(--ivory)]/90 px-5 py-2 backdrop-blur-md md:top-20 md:-mx-10 md:mb-5 md:px-10 md:py-3">
      <div className="flex items-center justify-center gap-2 md:flex-wrap md:gap-x-4 md:gap-y-3">
        <div className="flex min-w-0 items-center justify-center gap-1 overflow-x-auto md:flex-initial md:overflow-visible">
          <Chip active={scope === "all"} onClick={() => setScope("all")} icon={<Sparkles className="h-3.5 w-3.5" />}>All</Chip>
          <Chip active={scope === "photos"} onClick={() => setScope("photos")} icon={<ImageIcon className="h-3.5 w-3.5" />}>Photos</Chip>
          <Chip disabled icon={<Video className="h-3.5 w-3.5" />} premium>Videos</Chip>
        </div>

        <div className="hidden h-5 w-px bg-border/70 md:block" />

        <div className="hidden items-center gap-1 md:flex">
          <SortChip active={sort === "newest"} onClick={() => setSort("newest")}>Newest</SortChip>
          <SortChip active={sort === "oldest"} onClick={() => setSort("oldest")}>Oldest</SortChip>
        </div>
      </div>
    </div>
  );
}

function Chip({
  children, active, onClick, icon, disabled, premium,
}: {
  children: React.ReactNode; active?: boolean; onClick?: () => void;
  icon?: React.ReactNode; disabled?: boolean; premium?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-colors",
        active ? "bg-foreground text-background" : "text-foreground/70 hover:bg-foreground/5",
        disabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
      )}
    >
      {icon}
      {children}
      {premium && (
        <span className="ml-1 rounded-full border border-border px-1.5 py-px text-[0.6rem] uppercase tracking-wider text-muted-foreground">
          Premium
        </span>
      )}
    </button>
  );
}

function SortChip({ children, active, onClick }: { children: React.ReactNode; active?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-3 py-1.5 text-xs transition-colors",
        active ? "text-foreground underline underline-offset-4" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Grid                                                                 */
/* ------------------------------------------------------------------ */

function MemoryGrid({
  items, guestbookNames, onOpen, onFirstPaint,
}: {
  items: Upload[];
  guestbookNames: Set<string>;
  onOpen: (index: number) => void;
  onFirstPaint?: () => void;
}) {
  const paths = useMemo(() => items.map((u) => u.image_url), [items]);
  const signed = useSignedPhotoUrls(paths, "thumb_600");
  const decodedCountRef = useRef(0);
  const notifiedRef = useRef(false);
  const target = Math.min(items.length, 12); // enough to fill the visible viewport
  const readyTarget = useMemo(() => {
    if (!signed.data) return target;
    return items.slice(0, target).reduce((count, item) => (
      signed.data?.get(item.image_url) ? count + 1 : count
    ), 0);
  }, [items, signed.data, target]);

  useEffect(() => {
    decodedCountRef.current = 0;
    notifiedRef.current = false;
  }, [items]);

  const handleDecoded = useCallback(() => {
    if (readyTarget <= 0) return;
    decodedCountRef.current += 1;
    if (!notifiedRef.current && decodedCountRef.current >= readyTarget) {
      notifiedRef.current = true;
      // Wait one rAF so the masonry has flushed reflow before the overlay fades.
      requestAnimationFrame(() => onFirstPaint?.());
    }
  }, [readyTarget, onFirstPaint]);

  // If there are no items or signing failed, still release the overlay.
  useEffect(() => {
    if (items.length === 0 || target === 0 || signed.isError || (signed.isSuccess && readyTarget === 0)) {
      onFirstPaint?.();
    }
  }, [items.length, target, signed.isError, signed.isSuccess, readyTarget, onFirstPaint]);

  return (
    <div className="columns-2 gap-3 md:columns-3 md:gap-4 lg:columns-4">
      {items.map((u, i) => {
        const url = signed.data?.get(u.image_url);
        const hasMessage = guestbookNames.has((u.guest_name ?? "").trim().toLowerCase());
        return (
          <MemoryTile
            key={u.id}
            url={url}
            upload={u}
            hasMessage={hasMessage}
            onOpen={() => onOpen(i)}
            onDecoded={i < target ? handleDecoded : undefined}
            eager={i < target}
          />
        );
      })}
    </div>
  );
}

function MemoryTile({
  url, upload, hasMessage, onOpen, onDecoded, eager,
}: { url: string | undefined; upload: Upload; hasMessage: boolean; onOpen: () => void; onDecoded?: () => void; eager?: boolean }) {
  const [loaded, setLoaded] = useState(false);
  const settledRef = useRef(false);
  useEffect(() => {
    settledRef.current = false;
    setLoaded(false);
  }, [url]);
  const markSettled = () => {
    if (settledRef.current) return;
    settledRef.current = true;
    onDecoded?.();
  };
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group mb-3 block w-full overflow-hidden rounded-2xl border border-border/60 bg-[color:var(--ivory)]/40 text-left md:mb-4"
    >
      <div className="relative">
        
        {url ? (
          <img
            src={url}
            alt={displayGuestName(upload.guest_name) ? `Memory from ${displayGuestName(upload.guest_name)}` : "Memory"}
            loading={eager ? "eager" : "lazy"}
            decoding="async"
            onLoad={() => { setLoaded(true); markSettled(); }}
            onError={markSettled}
            className="block h-auto w-full transition-[opacity,transform] duration-700 ease-out group-hover:scale-[1.02]"
            style={{ opacity: loaded ? 1 : 0 }}
          />
        ) : (
          <div className="aspect-[4/5] w-full animate-pulse bg-foreground/5" />
        )}

        {/* Hover overlay */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 translate-y-1 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
          <div className="bg-gradient-to-t from-black/65 via-black/20 to-transparent p-3 pt-10 text-white">
            <div className="flex items-end justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-sans text-sm">
                  {displayGuestName(upload.guest_name) || "A guest"}
                </p>
                <p className="text-[0.65rem] uppercase tracking-wider text-white/70">
                  {formatShortDate(upload.uploaded_at)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2 text-white/80">
                {hasMessage && <MessageCircle className="h-3.5 w-3.5" aria-label="Left a message" />}
              </div>
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Skeleton / Empty                                                     */
/* ------------------------------------------------------------------ */

function SkeletonGrid() {
  const heights = [220, 300, 260, 340, 200, 280, 320, 240, 300, 260, 220, 320];
  return (
    <div className="columns-2 gap-3 md:columns-3 md:gap-4 lg:columns-4">
      {heights.map((h, i) => (
        <div
          key={i}
          className="mb-3 w-full animate-pulse rounded-2xl border border-border/40 bg-foreground/5 md:mb-4"
          style={{ height: `${h}px` }}
        />
      ))}
    </div>
  );
}

function EmptyState({ event }: { event: Event | null }) {
  const url = event?.slug ? guestUrlForSlug(event.slug) : "";
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* */ }
  };
  return (
    <section className="flex min-h-[50vh] flex-col items-center justify-center text-center">
      <div className="grid h-28 w-28 place-items-center rounded-full border border-border/70 bg-[color:var(--ivory)]/50">
        <ImageIcon className="h-10 w-10 text-foreground/40" strokeWidth={1.25} />
      </div>
      <h2 className="text-display mt-8 text-3xl md:text-4xl">Your story starts here.</h2>
      <p className="mt-4 max-w-md text-sm text-muted-foreground md:text-base">
        Share your guest link and the first memories will begin arriving here.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        {event?.slug && (
          <a
            href={`/e/${event.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm text-background transition-colors hover:bg-foreground/90"
          >
            <ExternalLink className="h-4 w-4" />
            Open Guest Page
          </a>
        )}
        {event?.slug && (
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-2 rounded-full border border-border px-5 py-2.5 text-sm text-foreground transition-colors hover:bg-foreground/5"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Link copied" : "Copy Guest Link"}
          </button>
        )}
      </div>
    </section>
  );
}

function NoMatches({ onClear }: { onClear: () => void }) {
  return (
    <section className="flex flex-col items-center py-20 text-center">
      <p className="text-eyebrow">No matches</p>
      <h3 className="text-display mt-4 text-2xl md:text-3xl">No memories found.</h3>
      <p className="mt-3 max-w-sm text-sm text-muted-foreground">
        Try adjusting your filters.
      </p>
      <button
        type="button"
        onClick={onClear}
        className="mt-6 inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm hover:bg-foreground/5"
      >
        Clear filters
      </button>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

function formatShortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch { return iso; }
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch { return `${d}d ago`; }
}

