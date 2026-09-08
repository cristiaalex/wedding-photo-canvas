import { useEffect, useState } from "react";
import mosaicWideAsset from "@/assets/mosaic-wide.jpg.asset.json";
import mosaicCloseAsset from "@/assets/mosaic-close.jpg.asset.json";

const WIDE = mosaicWideAsset.url;
const CLOSE = mosaicCloseAsset.url;

/**
 * The close-up asset is a native-resolution crop covering 1/CROSSOVER of the
 * wide image, centred on the same point. Above this zoom level we swap to it
 * so deep zoom shows real print detail instead of magnified JPEG.
 */
const CROSSOVER = 3.5;

const ZOOM_MS = 1700;
const PAUSE_MS = 650;

/** Initial descent: gentle pull-back from deep inside a single memory. */
const OPENING = [
  { label: "one memory, up close", ms: ZOOM_MS, scale: 9.6 },
  { label: "part of something bigger", ms: ZOOM_MS, scale: 4.4 },
  { label: "thousands of moments", ms: ZOOM_MS, scale: 2.2 },
  { label: "one Mosaic", ms: ZOOM_MS, scale: 1 },
  { label: "one Mosaic", ms: PAUSE_MS, scale: 1 },
] as const;

/** Continuous loop: zoom in ×3, then zoom out ×2 — never a hard cut. */
const LOOP = [
  { label: "thousands of moments", ms: ZOOM_MS, scale: 2.6 },
  { label: "part of something bigger", ms: ZOOM_MS, scale: 5.2 },
  { label: "one memory, up close", ms: ZOOM_MS, scale: 9.6 },
  { label: "one memory, up close", ms: PAUSE_MS, scale: 9.6 },
  { label: "thousands of moments", ms: ZOOM_MS, scale: 3.4 },
  { label: "one Mosaic", ms: ZOOM_MS, scale: 1 },
  { label: "one Mosaic", ms: PAUSE_MS, scale: 1 },
] as const;

/**
 * Layers are laid out SS× larger than the frame and then scaled down, so the
 * browser rasterises them above 1:1 and mid-zoom frames never look soft.
 */
export const SS = 1.7;
export const SUPERSAMPLED: React.CSSProperties = {
  width: `${SS * 100}%`,
  height: `${SS * 100}%`,
  maxWidth: "none",
  maxHeight: "none",
  left: `${-(SS - 1) * 50}%`,
  top: `${-(SS - 1) * 50}%`,
  backfaceVisibility: "hidden",
};

const ZOOM_TRANSITION = `transform ${ZOOM_MS}ms cubic-bezier(0.62,0.02,0.28,1), opacity ${ZOOM_MS}ms ease`;
const PAUSE_TRANSITION = "none";

function getStep(index: number) {
  if (index < OPENING.length) return OPENING[index]!;
  return LOOP[(index - OPENING.length) % LOOP.length]!;
}


function getPrevStep(index: number) {
  if (index <= 0) return null;
  return getStep(index - 1);
}

/**
 * Cinematic hero visual: the camera starts deep inside a single guest
 * photograph of the real Mosaic, pulls back quickly, then gently breathes
 * in and out in a seamless loop. There is no hard cut from the widest view
 * back to the closest — the motion is always continuous.
 */
export function HeroMosaic({ className = "" }: { className?: string }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const step = getStep(index);
    const id = window.setTimeout(() => setIndex((i) => i + 1), step.ms);
    return () => window.clearTimeout(id);
  }, [index]);

  const step = getStep(index);
  const prevStep = getPrevStep(index);
  const isPause = prevStep && prevStep.scale === step.scale;
  /* slight overscan hides the print's own darker edges/corners at full view */
  const scale = step.scale * 1.08;
  /* gradual crossfade: the close-up takes over well before the wide asset
     runs out of pixels, so no frame of the animation is ever soft */
  const closeOpacity = Math.min(1, Math.max(0, (scale - CROSSOVER * 0.55) / (CROSSOVER * 0.45)));

  return (
    <figure className={`relative overflow-hidden rounded-[1rem] ${className}`}>
      <div
        className="relative h-full w-full overflow-hidden rounded-[1rem] bg-[color:var(--ink)]"
        style={{
          /* Safari clips transformed children only with an explicit mask */
          WebkitMaskImage: "-webkit-radial-gradient(white, black)",
          isolation: "isolate",
        }}
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
            transition: isPause ? PAUSE_TRANSITION : ZOOM_TRANSITION,
          }}
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
            transition: isPause ? PAUSE_TRANSITION : ZOOM_TRANSITION,
          }}
        />


        {/* soft vignette keeps the frame editorial */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(115% 78% at 50% 42%, transparent 46%, color-mix(in oklab, var(--ink) 42%, transparent) 100%)",
          }}
        />
      </div>

      <figcaption className="mt-3 flex items-center justify-center gap-3 md:mt-5 md:justify-start">
        <span className="h-px w-6 bg-[color:var(--dusty)]/50" />
        <span className="text-script text-sm text-muted-foreground transition-opacity duration-500 md:text-base">
          {step.label}
        </span>
        <span className="h-px w-6 bg-[color:var(--dusty)]/50" />
      </figcaption>
    </figure>
  );
}
