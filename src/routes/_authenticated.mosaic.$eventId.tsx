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
            className="mt-4 rounded-sm border border-foreground px-3 py-2 text-foreground"
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
      // In the single-master pipeline, `image_url` is the DZI manifest URL
      // when `dzi_status === 'ready'`. For legacy rows it's a plain JPEG,
      // so only treat it as a DZI manifest when DZI actually succeeded.
      const dziReady = data?.dzi_status === "ready";
      const dziUrl = data?.dzi_url ?? (dziReady ? data?.image_url ?? null : null);
      // Prefer the legacy JPEG for OpenSeadragon's single-image fallback;
      // otherwise fall back to image_url (which is a DZI manifest for new rows).
      const mosaicSource =
        data?.mosaic_image_url ?? data?.image_url ?? null;
      if (!data || !mosaicSource) throw new Error("No ready mosaic for this event yet.");
      const toPath = (v: string) =>
        /^https?:\/\//.test(v) ? (v.match(/\/mosaics\/(.+)$/)?.[1] ?? v) : v;
      return {
        mosaicId: data.id as string,
        mosaicPath: toPath(mosaicSource),
        dziUrl,
        manifest: (data.tiles_json ?? null) as MosaicManifest | null,
      };
    },
    staleTime: 30 * 1000,
  });

  const loadedManifest = mosaicRowQuery.data?.manifest ?? null;


  // Cache the signed URL per-mosaic, so remounts within 55 min reuse the same
  // token → CDN can actually cache the JPEG instead of re-fetching for every
  // fresh query-string.
  const signedUrlQuery = useQuery({
    queryKey: ["signed-mosaic-url", mosaicRowQuery.data?.mosaicId],
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from("mosaics")
        .createSignedUrl(mosaicRowQuery.data!.mosaicPath, 60 * 60);
      if (error || !data) throw error ?? new Error("Could not sign mosaic URL");
      return data.signedUrl;
    },
    enabled: !!mosaicRowQuery.data?.mosaicPath,
    staleTime: SIGNED_URL_STALE_MS,
    gcTime: SIGNED_URL_GC_MS,
  });

  const eventName = eventQuery.data ?? "";
  const imageUrl = signedUrlQuery.data ?? null;
  const dziUrl = mosaicRowQuery.data?.dziUrl ?? null;
  const manifest = loadedManifest;
  const error =
    (mosaicRowQuery.error instanceof Error ? mosaicRowQuery.error.message : null) ??
    (signedUrlQuery.error instanceof Error ? signedUrlQuery.error.message : null);



  return (
    <div className="flex h-[100dvh] flex-col bg-[linear-gradient(180deg,var(--ivory),oklch(0.955_0.02_72))]">
      <header className="flex items-center justify-between border-b border-border/60 bg-[color:var(--ivory)]/86 px-4 py-3 backdrop-blur md:px-8 md:py-4">
        <div className="min-w-0 flex-1 pr-3">
           <p className="text-eyebrow text-primary">Your pet mosaic</p>
          <h1 className="truncate text-display text-xl md:text-2xl">
            {eventName || "Your mosaic"}
          </h1>
        </div>
        <Link
          to="/mosaic"
          className="text-eyebrow shrink-0 inline-flex items-center gap-1.5 text-primary/80 hover:text-primary"
        >
           <span aria-hidden>←</span> Preview
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
            dziUrl={dziUrl}
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
