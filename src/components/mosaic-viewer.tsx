import { useEffect, useRef } from "react";
import OpenSeadragon from "openseadragon";
import type { MosaicManifest } from "@/lib/mosaic-generator";

type Props = {
  /**
   * Short-lived signed URL of the image to explore — the single web zoom
   * WebP when available, otherwise the regular preview image.
   */
  imageUrl: string;
  manifest: MosaicManifest | null;
  /** Called when the user taps/clicks a tile. Receives the tile's original (storage) path. */
  onTileClick?: (originalPath: string, tileIndex: number) => void;
};

type SavedViewport = { center: OpenSeadragon.Point; zoom: number };

/**
 * Interactive mosaic viewer (single image — no tile pyramid).
 *
 * Supports pinch/scroll zoom, pan, home (fit-to-screen) and fullscreen.
 * The instance is created once per image URL; latest `manifest` /
 * `onTileClick` are read through refs so prop changes never rebuild it.
 */
export function MosaicViewer({ imageUrl, manifest, onTileClick }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const manifestRef = useRef(manifest);
  const onTileClickRef = useRef(onTileClick);
  const savedViewportRef = useRef<SavedViewport | null>(null);

  useEffect(() => {
    manifestRef.current = manifest;
  }, [manifest]);
  useEffect(() => {
    onTileClickRef.current = onTileClick;
  }, [onTileClick]);

  useEffect(() => {
    if (!hostRef.current) return;

    const viewer = OpenSeadragon({
      element: hostRef.current,
      tileSources: { type: "image", url: imageUrl } as never,
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
      const item = viewer.world.getItemAt(0);
      if (!ev.quick || !m || !cb || !item) return;
      const vp = viewer.viewport.pointFromPixel(ev.position);
      const imgPt = item.viewportToImageCoordinates(vp);
      // The displayed image is a downscaled copy of the master, so map
      // clicks through its own pixel size rather than the master size.
      const size = item.getContentSize();
      const cols = m.cols ?? m.grid;
      const rows = m.rows ?? m.grid;
      const cx = Math.floor((imgPt.x / size.x) * cols);
      const cy = Math.floor((imgPt.y / size.y) * rows);
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
    };
  }, [imageUrl]);

  return (
    <div className="relative h-full w-full">
      <div ref={hostRef} className="h-full w-full bg-mist/50" />
    </div>
  );
}
