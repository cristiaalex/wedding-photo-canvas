import { useEffect, useRef } from "react";
import OpenSeadragon from "openseadragon";
import type { MosaicManifest } from "@/lib/mosaic-generator";

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
    const tileSources: OpenSeadragon.Options["tileSources"] = dziUrl
      ? dziUrl
      : { type: "image", url: imageUrl };
    const viewer = OpenSeadragon({
      element: hostRef.current,
      tileSources,
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

    const kick = () => {
      try {
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
    const ro = new ResizeObserver(() => {
      try {
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
      if (!ev.quick || !m || !cb || !viewer.world.getItemAt(0)) return;
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

    return () => {
      ro.disconnect();
      try {
        savedViewportRef.current = {
          center: viewer.viewport.getCenter(),
          zoom: viewer.viewport.getZoom(),
        };
      } catch {
        /* noop */
      }
      viewer.destroy();
      viewerRef.current = null;
      lastSourceKeyRef.current = null;
    };
  }, [imageUrl, dziUrl]);

  return (
    <div className="relative h-full w-full">
      <div ref={hostRef} className="h-full w-full bg-[color:var(--champagne)]/25" />
    </div>
  );
}
