import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Upload } from "@/lib/database.types";
import { useEventUploads, useSignedPhotoUrls } from "@/hooks/use-photo-data";
import { PhotoLightbox } from "@/components/photo-lightbox";


export const Route = createFileRoute("/e/$slug/timeline")({
  head: ({ params }) => ({
    meta: [
      { title: `Live timeline — ${params.slug}` },
      { name: "description", content: "A live, flowing stream of guest photos from the wedding." },
    ],
  }),
  component: TimelinePage,
});

function TimelinePage() {
  const { slug } = Route.useParams();
  const [eventId, setEventId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("events")
        .select("id")
        .eq("slug", slug)
        .maybeSingle();
      if (cancelled) return;
      if (error) return setError(error.message);
      if (!data) return setError(`No event found for slug "${slug}"`);
      setEventId(data.id);
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const uploadsQuery = useEventUploads(eventId);
  const uploads = uploadsQuery.data ?? [];
  const paths = uploads.map((u) => u.image_url);
  // Only ever request the thumb_600 variant for the timeline grid — the
  // original (multi-MB) is never fetched here.
  const signed = useSignedPhotoUrls(paths, "thumb_600");

  // Realtime: new uploads stream into the React Query cache.
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
          // Invalidate signed-url cache so the new path picks up a signature.
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
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-[color:var(--ivory)]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3.5 md:px-12 md:py-5">
          <Link to="/" className="text-display text-xl md:text-2xl">
            Mosaic
          </Link>
          <div className="flex items-center gap-3">
            <span className="text-eyebrow flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-foreground opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-foreground" />
              </span>
              <span className="hidden sm:inline">Live · </span>
              {uploads.length}
            </span>
            <Link
              to="/e/$slug/guestbook"
              params={{ slug }}
              className="text-eyebrow rounded-full border border-border/60 px-4 py-2.5 text-foreground/80 transition-colors hover:border-primary hover:text-primary"
            >
              Guestbook
            </Link>
            <Link
              to="/e/$slug"
              params={{ slug }}
              className="text-eyebrow rounded-full border border-foreground px-4 py-2.5 text-foreground transition-colors hover:bg-foreground hover:text-[color:var(--ivory)]"
            >
              Share
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-10 md:px-12 md:py-20">
        <div className="max-w-2xl">
          <p className="text-eyebrow">The wedding, unfolding</p>
          <h1 className="text-display mt-3 text-4xl md:mt-4 md:text-7xl">
            As the day <span className="text-script">unfolds</span>
          </h1>
          <div className="mt-5 hairline" />
          <p className="mt-5 text-sm text-muted-foreground md:text-base">
            Photos appear here the moment guests share them. Every memory, in real time.
          </p>
        </div>

        {error && <p className="mt-8 text-sm text-destructive">{error}</p>}

        {uploads.length === 0 ? (
          <div className="mt-12 flex flex-col items-center justify-center rounded-sm border border-border/60 bg-[color:var(--champagne)]/30 px-5 py-20 text-center md:mt-20 md:py-24">
            <p className="text-eyebrow">Awaiting the first moment</p>
            <h2 className="text-display mt-4 text-3xl md:text-4xl">
              The day is <span className="text-script">about to begin</span>
            </h2>
            <p className="mt-6 max-w-sm text-sm text-muted-foreground">
              Share the QR code with your guests. Their photos will stream in here.
            </p>
          </div>
        ) : (
          <div className="mt-10 columns-2 gap-2 md:mt-14 md:columns-3 md:gap-4 lg:columns-4 [column-fill:_balance]">
            {uploads.map((u, i) => {
              const src = signed.data?.get(u.image_url);
              return (
                <figure
                  key={u.id}
                  className="mb-2 break-inside-avoid overflow-hidden rounded-sm bg-card md:mb-4"
                >
                  {src ? (
                    <button
                      type="button"
                      onClick={() => setLightboxIndex(i)}
                      className="block w-full cursor-zoom-in overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/60"
                      aria-label={u.guest_name ? `Open photo by ${u.guest_name}` : "Open photo"}
                    >
                      <img
                        src={src}
                        alt={u.guest_name ? `By ${u.guest_name}` : "Guest photo"}
                        loading="lazy"
                        decoding="async"
                        sizes="(min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw"
                        className="h-auto w-full transition-transform duration-300 ease-out hover:scale-[1.02]"
                      />
                    </button>
                  ) : (
                    <div className="aspect-square w-full animate-pulse bg-[color:var(--champagne)]/40" />
                  )}
                  {u.guest_name && (
                    <figcaption className="text-script px-2.5 py-1.5 text-sm text-muted-foreground md:px-3 md:py-2 md:text-base">
                      {u.guest_name}
                    </figcaption>
                  )}
                </figure>
              );
            })}
          </div>
        )}
      </main>

      {lightboxIndex !== null && (
        <PhotoLightbox
          photos={uploads.map((u) => ({
            path: u.image_url,
            caption: u.guest_name ? `By ${u.guest_name}` : null,
          }))}
          index={lightboxIndex}
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  );
}
