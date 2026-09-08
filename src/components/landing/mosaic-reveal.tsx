import { useEffect, useRef, useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { SS, SUPERSAMPLED } from "@/components/landing/hero-mosaic";
import mosaicWideAsset from "@/assets/mosaic-wide.jpg.asset.json";
import mosaicCloseAsset from "@/assets/mosaic-close.jpg.asset.json";

const WIDE = mosaicWideAsset.url;
const CLOSE = mosaicCloseAsset.url;

/** the close-up crop covers 1/CROSSOVER of the wide frame, same centre */
const CROSSOVER = 3.5;

/**
 * Scroll-driven reveal: starts deep inside a single guest photograph of the
 * real Mosaic and zooms out until the whole portrait is visible.
 */
export function MosaicReveal({ className = "" }: { grid?: number; className?: string }) {
  const isMobile = useIsMobile();
  const ref = useRef<HTMLDivElement | null>(null);
  const [p, setP] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const r = el.getBoundingClientRect();
        const vh = window.innerHeight || 1;
        const raw = (vh * 0.6 - r.top) / (vh * 0.1 + r.height * 0.5);
        setP(Math.min(1, Math.max(0, raw)));
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  const start = isMobile ? 7.5 : 8.6;
  const scale = start - (start - 1) * p;
  const closeOpacity = Math.min(1, Math.max(0, (scale - CROSSOVER * 0.55) / (CROSSOVER * 0.45)));


  return (
    <div
      ref={ref}
      className={`relative overflow-hidden rounded-[1rem] bg-[color:var(--ink)] ${className}`}
    >
      <img
        src={WIDE}
        alt="A real Mosaic: a wedding portrait composed from thousands of guest photographs"
        className="absolute object-cover"
        style={{
          ...SUPERSAMPLED,
          objectPosition: "50% 50%",
          transformOrigin: "50% 50%",
          transform: `scale(${scale / SS})`,
          transition: "transform 240ms linear",
        }}
        loading="lazy"
      />
      <img
        src={CLOSE}
        alt=""
        aria-hidden
        className="absolute object-cover"
        style={{
          ...SUPERSAMPLED,
          objectPosition: "50% 50%",
          transformOrigin: "50% 50%",
          transform: `scale(${Math.max(1, scale / CROSSOVER) / SS})`,
          opacity: closeOpacity,
          transition: "transform 240ms linear, opacity 400ms ease",
        }}
        loading="lazy"
      />

      {/* vignette */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 80% at 50% 45%, transparent 40%, color-mix(in oklab, var(--ink) 52%, transparent) 100%)",
        }}
      />
    </div>
  );
}
