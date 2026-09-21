import { useEffect, useRef } from "react";
import OpenSeadragon from "openseadragon";
import type { MosaicManifest } from "@/lib/mosaic-generator";
import { supabase, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, MOSAICS_BUCKET } from "@/lib/supabase";

type Props = {
  imageUrl: string;
  /** Optional Deep Zoom manifest URL (.dzi). When provided, OpenSeadragon loads the pyramid instead of the single JPEG. */
  dziUrl?: string | null;
  manifest: MosaicManifest | null;
  /** Called when the user taps/clicks a tile. Receives the tile's original (storage) path. */
  onTileClick?: (originalPath: string, tileIndex: number) => void;
};

type SavedViewport = { center: OpenSeadragon.Point; zoom: number };

/**
 * The Deep Zoom pyramid lives in the PRIVATE `mosaics` bucket, so the stored
 * `dzi_url` (a `/object/public/...` link) cannot be fetched. Reduce whatever
 * we were given to the bucket-relative object path instead.
 */
function toMosaicsObjectPath(urlOrPath: string): string | null {
  const clean = urlOrPath.split("?")[0];
  if (!/^https?:\/\//.test(clean)) return clean.replace(/^\/+/, "");
  const m = clean.match(new RegExp(`/${MOSAICS_BUCKET}/(.+)$`));
  return m ? m[1] : null;
}

/**
 * Interactive mosaic viewer.
 *
 * The OpenSeadragon instance is created once per mosaic image URL and
 * preserved across unrelated parent re-renders (e.g. opening the
 * fullscreen lightbox). Latest `manifest` / `onTileClick` are read
 * through refs so prop identity changes never destroy the viewer.
 */
export function MosaicViewer({ imageUrl, dziUrl, manifest, onTileClick }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<OpenSeadragon.Viewer | null>(null);
  const manifestRef = useRef(manifest);
  const onTileClickRef = useRef(onTileClick);
  const savedViewportRef = useRef<SavedViewport | null>(null);
  const lastSourceKeyRef = useRef<string | null>(null);

  useEffect(() => {
    manifestRef.current = manifest;
  }, [manifest]);
  useEffect(() => {
    onTileClickRef.current = onTileClick;
  }, [onTileClick]);

  useEffect(() => {
    if (!hostRef.current) return;
    // Prefer the DZI pyramid when available — true Google-Maps-style zoom.
    // Fall back to the single JPEG so old mosaics still render.
    const sourceKey = dziUrl ? `dzi:${dziUrl}` : `img:${imageUrl}`;
    if (lastSourceKeyRef.current === sourceKey && viewerRef.current) {
      return;
    }
    lastSourceKeyRef.current = sourceKey;

    let cancelled = false;
    let viewer: OpenSeadragon.Viewer | null = null;
    let ro: ResizeObserver | null = null;

    /**
     * Read the private `.dzi` manifest through the authenticated Storage API
     * and turn it into an inline tile source whose tiles are fetched with the
     * same credentials. Returns null when the pyramid is unreachable, so the
     * caller can fall back to the flat preview image.
     */
    async function buildPrivateDziSource(): Promise<{
      tileSources: OpenSeadragon.Options["tileSources"];
      ajaxHeaders: Record<string, string>;
    } | null> {
      if (!dziUrl) return null;
      const manifestPath = toMosaicsObjectPath(dziUrl);
      if (!manifestPath) return null;
      try {
        const { data, error } = await supabase.storage.from(MOSAICS_BUCKET).download(manifestPath);
        if (error || !data) return null;
        const xml = new DOMParser().parseFromString(await data.text(), "text/xml");
        const image = xml.querySelector("Image");
        const size = xml.querySelector("Size");
        if (!image || !size) return null;
        const width = Number(size.getAttribute("Width"));
        const height = Number(size.getAttribute("Height"));
        if (!width || !height) return null;

        const dir = manifestPath.replace(/\/[^/]+$/, "");
        const base = manifestPath.replace(/\.dzi$/i, "");
        const tileDir = base.startsWith(dir) ? `${base}_files` : `${dir}/dzi_files`;

        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token ?? SUPABASE_PUBLISHABLE_KEY;

        return {
          tileSources: {
            Image: {
              xmlns: "http://schemas.microsoft.com/deepzoom/2008",
              Url: `${SUPABASE_URL}/storage/v1/object/${MOSAICS_BUCKET}/${tileDir}/`,
              Format: image.getAttribute("Format") ?? "jpg",
              Overlap: image.getAttribute("Overlap") ?? "1",
              TileSize: image.getAttribute("TileSize") ?? "256",
              Size: { Width: String(width), Height: String(height) },
            },
          } as unknown as OpenSeadragon.Options["tileSources"],
          ajaxHeaders: {
            apikey: SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${token}`,
          },
        };
      } catch {
        return null;
      }
    }

    (async () => {
      const dzi = await buildPrivateDziSource();
      if (cancelled || !hostRef.current) return;

      viewer = OpenSeadragon({
        element: hostRef.current,
        tileSources: dzi ? dzi.tileSources : { type: "image", url: imageUrl },
        loadTilesWithAjax: !!dzi,
        ajaxHeaders: dzi ? dzi.ajaxHeaders : undefined,
        crossOriginPolicy: false,
        drawer: "canvas",
        prefixUrl: "https://cdn.jsdelivr.net/npm/openseadragon@6/build/openseadragon/images/",
        showNavigationControl: true,
        showZoomControl: true,
        showHomeControl: true,
        showFullPageControl: true,
        gestureSettingsTouch: { pinchToZoom: true, flickEnabled: true },
        gestureSettingsMouse: { scrollToZoom: true, clickToZoom: false },
        minZoomImageRatio: 0.9,
        maxZoomPixelRatio: 2.3,
        visibilityRatio: 1,
        animationTime: 0.4,
        springStiffness: 8,
        immediateRender: true,
        preserveImageSizeOnResize: true,
      });
      viewerRef.current = viewer;

      // If the pyramid fails mid-flight, fall back to the flat preview image.
      if (dzi) {
        viewer.addOnceHandler("open-failed", () => {
          try {
            viewer?.open({ type: "image", url: imageUrl });
          } catch {
            /* noop */
          }
        });
      }

      const kick = () => {
        try {
          if (!viewer) return;
          const saved = savedViewportRef.current;
          if (saved) {
            viewer.viewport.panTo(saved.center, true);
            viewer.viewport.zoomTo(saved.zoom, undefined, true);
          } else {
            viewer.viewport.goHome(true);
          }
          viewer.forceRedraw();
        } catch {
          /* noop */
        }
      };
      viewer.addHandler("open", () => {
        kick();
        requestAnimationFrame(kick);
        setTimeout(kick, 120);
      });
      ro = new ResizeObserver(() => {
        try {
          if (!viewer) return;
          const item = viewer.world.getItemAt(0);
          if (item) viewer.viewport.resize(item.getContentSize());
          viewer.forceRedraw();
        } catch {
          /* noop */
        }
      });
      ro.observe(hostRef.current);

      viewer.addHandler("canvas-click", (e) => {
        const ev = e as unknown as { quick: boolean; position: OpenSeadragon.Point };
        const m = manifestRef.current;
        const cb = onTileClickRef.current;
        if (!viewer || !ev.quick || !m || !cb || !viewer.world.getItemAt(0)) return;
        const vp = viewer.viewport.pointFromPixel(ev.position);
        const imgPt = viewer.world.getItemAt(0).viewportToImageCoordinates(vp);
        // Portrait/landscape-safe grid math. Prefer explicit rectangular
        // dimensions on the manifest; fall back to the legacy square `grid` /
        // `outputSize` scalars for older mosaics generated before those fields
        // existed.
        const cols = m.cols ?? m.grid;
        const rows = m.rows ?? m.grid;
        const outW = m.outputWidth ?? m.outputSize;
        const outH = m.outputHeight ?? m.outputSize;
        const cx = Math.floor((imgPt.x / outW) * cols);
        const cy = Math.floor((imgPt.y / outH) * rows);
        if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return;
        const idx = cy * cols + cx;
        const tile = m.tiles[idx];
        if (!tile) return;
        try {
          savedViewportRef.current = {
            center: viewer.viewport.getCenter(),
            zoom: viewer.viewport.getZoom(),
          };
        } catch {
          /* noop */
        }
        cb(tile.src, idx);
      });
    })();

    return () => {
      cancelled = true;
      ro?.disconnect();
      try {
        if (viewer) {
          savedViewportRef.current = {
            center: viewer.viewport.getCenter(),
            zoom: viewer.viewport.getZoom(),
          };
        }
      } catch {
        /* noop */
      }
      viewer?.destroy();
      viewerRef.current = null;
      lastSourceKeyRef.current = null;
    };
  }, [imageUrl, dziUrl]);

  return (
    <div className="relative h-full w-full">
      <div ref={hostRef} className="h-full w-full bg-mist/50" />
    </div>
  );
}
