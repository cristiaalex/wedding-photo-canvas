import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { MosaicViewer } from "@/components/mosaic-viewer";
import { MemoryLightbox, type MemoryLightboxItem } from "@/components/memory-lightbox";
import { useEventUploads } from "@/hooks/use-photo-data";
import type { MosaicManifest } from "@/lib/mosaic-generator";

// Supabase signed URLs expire at 60 min — refresh just before.
const SIGNED_URL_STALE_MS = 55 * 60 * 1000;
const SIGNED_URL_GC_MS = 60 * 60 * 1000;


export const Route = createFileRoute("/_authenticated/mosaic/$eventId")({
  head: () => ({
    meta: [
      { title: "Explore Your Pet Mosaic — Mosaic Pet" },
      { name: "description", content: "Zoom into your pet mosaic and discover every memory within the artwork." },
      { property: "og:title", content: "Explore Your Pet Mosaic — Mosaic Pet" },
      { property: "og:description", content: "Zoom into your pet mosaic and discover every memory within the artwork." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MosaicViewerPage,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6 text-center">
        <div>
          <p className="text-destructive">{error.message}</p>
          <button
            type="button"
            onClick={() => {
              reset();
              router.invalidate();
            }}
            className="btn-primary mt-4"
          >
            Try again
          </button>
        </div>
      </div>
    );
  },
  notFoundComponent: () => (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <p className="text-muted-foreground">Mosaic not found.</p>
    </div>
  ),
});

function MosaicViewerPage() {
  const { eventId } = Route.useParams();
  const [lightboxPath, setLightboxPath] = useState<string | null>(null);
  const uploadsQuery = useEventUploads(eventId);
  const uploads = uploadsQuery.data ?? [];

  // Extract the {eventId}/{photoId} folder prefix from either a storage path
  // (e.g. "abc/def/original.jpg") or a signed URL
  // (e.g. "https://.../storage/v1/object/sign/photos/abc/def/thumb_300.webp?token=…").
  const folderOf = useCallback((pathOrUrl: string): string => {
    let p = pathOrUrl.split("?")[0];
    const m = p.match(/\/photos\/(.+)$/);
    if (m) p = m[1];
    const i = p.lastIndexOf("/");
    return i >= 0 ? p.slice(0, i) : p;
  }, []);

  const lightboxItems: MemoryLightboxItem[] = useMemo(
    () => uploads.map((u) => ({
      id: u.id,
      path: u.image_url,
      guestName: u.guest_name,
      uploadedAt: u.uploaded_at,
    })),
    [uploads],
  );

  const lightboxIndex = useMemo(() => {
    if (!lightboxPath) return -1;
    const targetFolder = folderOf(lightboxPath);
    return lightboxItems.findIndex((it) => folderOf(it.path) === targetFolder);
  }, [lightboxPath, lightboxItems, folderOf]);

  // Fallback item when the tile's original upload is not (yet) in the uploads list.
  // `lightboxPath` here is the signed tile URL; MemoryLightbox passes http URLs through unchanged.
  const fallbackItems: MemoryLightboxItem[] = useMemo(
    () => lightboxPath
      ? [{ id: lightboxPath, path: lightboxPath, guestName: null, uploadedAt: new Date().toISOString() }]
      : [],
    [lightboxPath],
  );

  const handleTileClick = useCallback((src: string) => {
    setLightboxPath(src);
  }, []);

  const eventQuery = useQuery({
    queryKey: ["event-name", eventId],
    queryFn: async () => {
      const { data } = await supabase
        .from("events")
        .select("event_name")
        .eq("id", eventId)
        .maybeSingle();
      return data?.event_name ?? "";
    },
    staleTime: 5 * 60 * 1000,
  });

  const mosaicRowQuery = useQuery({
    queryKey: ["mosaic-row", eventId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mosaics")
        .select(
          "id, image_url, mosaic_image_url, dzi_url, dzi_status, tile_base_url, tiles_json, status",
        )
        .eq("event_id", eventId)
        .in("status", ["ready", "deepzoom_ready"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      // `image_url` holds the single web zoom WebP (private object path) once
      // `dzi_status === 'ready'`. Older rows may point at a .dzi manifest,
      // which is no longer used — those fall back to the preview image.
      const toPath = (v: string) =>
        /^https?:\/\//.test(v) ? (v.split("?")[0].match(/\/mosaics\/(.+)$/)?.[1] ?? v) : v;
      const webZoomPath =
        data?.dzi_status === "ready" && data?.image_url && /\.webp$/i.test(data.image_url.split("?")[0])
          ? toPath(data.image_url)
          : null;
      const fallbackSource =
        data?.mosaic_image_url ??
        (data?.image_url && !/\.dzi$/i.test(data.image_url.split("?")[0]) ? data.image_url : null);
      if (!data || (!webZoomPath && !fallbackSource)) {
        throw new Error("No ready mosaic for this event yet.");
      }
      return {
        mosaicId: data.id as string,
        webZoomPath,
        fallbackPath: fallbackSource ? toPath(fallbackSource) : null,
        manifest: (data.tiles_json ?? null) as MosaicManifest | null,
      };
    },
    staleTime: 30 * 1000,
  });

  const loadedManifest = mosaicRowQuery.data?.manifest ?? null;


  // Signed (private) URL, cached per mosaic. Prefers the single web zoom
  // image; falls back to the preview image if it is missing or unsignable.
  const signedUrlQuery = useQuery({
    queryKey: ["signed-mosaic-url", mosaicRowQuery.data?.mosaicId, mosaicRowQuery.data?.webZoomPath],
    queryFn: async () => {
      const row = mosaicRowQuery.data!;
      for (const p of [row.webZoomPath, row.fallbackPath]) {
        if (!p) continue;
        const { data } = await supabase.storage.from("mosaics").createSignedUrl(p, 60 * 60);
        if (data?.signedUrl) return data.signedUrl;
      }
      throw new Error("Could not open your mosaic.");
    },
    enabled: !!mosaicRowQuery.data,
    staleTime: SIGNED_URL_STALE_MS,
    gcTime: SIGNED_URL_GC_MS,
  });

  const eventName = eventQuery.data ?? "";
  const imageUrl = signedUrlQuery.data ?? null;
  const manifest = loadedManifest;
  const error =
    (mosaicRowQuery.error instanceof Error ? mosaicRowQuery.error.message : null) ??
    (signedUrlQuery.error instanceof Error ? signedUrlQuery.error.message : null);



  return (
    <div className="flex h-[100dvh] flex-col bg-mist/40">
      <header className="flex items-center justify-between border-b-2 border-sky/15 bg-background/90 px-4 py-3 backdrop-blur md:px-8 md:py-4">
        <div className="min-w-0 flex-1 pr-3">
            <p className="text-eyebrow text-coral">Look what your memories made</p>
          <h1 className="truncate text-display text-xl md:text-2xl">
            {eventName || "Your mosaic"}
          </h1>
        </div>
        <Link
          to="/mosaic"
          className="text-eyebrow shrink-0 inline-flex items-center gap-1.5 text-primary/80 hover:text-primary"
        >
           <span aria-hidden>←</span> Back
        </Link>
      </header>
      <div className="relative flex-1">
        {error && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-destructive">
            {error}
          </div>
        )}
        {!error && !imageUrl && (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
            Opening your mosaic…
          </div>
        )}
        {imageUrl && (
          <MosaicViewer
            imageUrl={imageUrl}
            manifest={manifest}
            onTileClick={handleTileClick}
          />
        )}
      </div>

      {lightboxPath && (lightboxIndex >= 0 ? (
        <MemoryLightbox
          items={lightboxItems}
          index={lightboxIndex}
          onIndexChange={(i) => setLightboxPath(lightboxItems[i]?.path ?? null)}
          onClose={() => setLightboxPath(null)}
        />
      ) : (
        <MemoryLightbox
          items={fallbackItems}
          index={0}
          onIndexChange={() => {}}
          onClose={() => setLightboxPath(null)}
        />
      ))}
    </div>
  );
}
