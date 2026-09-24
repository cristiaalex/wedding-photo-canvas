import { useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import {
  CoverPosition,
  DEFAULT_COVER_POSITION,
  coverImageStyle,
} from "@/lib/cover-position";
import { GuestHeroContent } from "@/components/guest-hero-content";
import logo from "@/assets/mosaic-pet-logo-upscaled.png";

// ---------------------------------------------------------------------------
// CoverPhotoEditor — true WYSIWYG editor for the Guest Page hero.
//
// The preview surface is rendered with the *exact* same DOM, classes, image
// styles and dissolve as the live Guest Page hero (see src/routes/e.$slug.tsx
// and src/components/cover-hero.tsx). Because the interaction container IS
// the preview box, drag / zoom math operates on the identical viewport the
// couple will see — no vertical shift, no re-crop after Save.
//
// The editor also reserves the same lightweight header used throughout
// onboarding (Mosaic logo on the left, optional progress dots on the right)
// so the hero starts at the same vertical offset as it does mid-flow.
// ---------------------------------------------------------------------------

export type CoverPhotoEditorProps = {
  open: boolean;
  imageSrc: string;
  initialPosition?: CoverPosition | null;
  eventName: string | null;
  weddingDateLabel?: string | null;
  venue?: string | null;
  welcomeMessage?: string | null;

  /** When provided, shows onboarding-style progress dots (0-indexed). */
  stepIndex?: number;
  stepCount?: number;

  onCancel: () => void;
  onSave: (position: CoverPosition) => void;
  saving?: boolean;
  saveLabel?: string;
};

const MIN_SCALE = 1;
const MAX_SCALE = 4;

// Must match the Guest Page hero classes exactly — see src/routes/e.$slug.tsx.
const HERO_CLASSES = "h-[62vh] w-full sm:h-[68vh] md:h-[74vh]";
const PAGE_BG = "#F7F4EF";

export function CoverPhotoEditor({
  open,
  imageSrc,
  initialPosition,
  eventName,
  weddingDateLabel,
  venue,
  welcomeMessage,
  stepIndex,
  stepCount = 4,
  onCancel,
  onSave,
  saving,
  saveLabel = "Save",
}: CoverPhotoEditorProps) {
  const [position, setPosition] = useState<CoverPosition>(
    initialPosition ?? DEFAULT_COVER_POSITION,
  );
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const gestureRef = useRef<{
    startPos: CoverPosition;
    startDist: number;
    startCenter: { x: number; y: number };
    containerRect: DOMRect;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    setPosition(initialPosition ?? DEFAULT_COVER_POSITION);
  }, [open, imageSrc, initialPosition]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  const overflow = useMemo(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || !natural) return { x: 0, y: 0 };
    const cW = rect.width;
    const cH = rect.height;
    const imgAR = natural.w / natural.h;
    const contAR = cW / cH;
    let drawnW: number;
    let drawnH: number;
    if (imgAR > contAR) {
      drawnH = cH;
      drawnW = cH * imgAR;
    } else {
      drawnW = cW;
      drawnH = cW / imgAR;
    }
    drawnW *= position.scale;
    drawnH *= position.scale;
    return {
      x: Math.max(0, drawnW - cW),
      y: Math.max(0, drawnH - cH),
    };
  }, [natural, position.scale]);

  function applyDragDelta(dxPx: number, dyPx: number, from: CoverPosition) {
    const nx = overflow.x > 0 ? from.x - (dxPx / overflow.x) * 100 : from.x;
    const ny = overflow.y > 0 ? from.y - (dyPx / overflow.y) * 100 : from.y;
    setPosition((p) => ({
      ...p,
      x: clamp(nx, 0, 100),
      y: clamp(ny, 0, 100),
    }));
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const rect = containerRef.current!.getBoundingClientRect();
    const pts = Array.from(pointersRef.current.values());
    if (pts.length >= 2) {
      const [a, b] = pts;
      gestureRef.current = {
        startPos: position,
        startDist: Math.hypot(a.x - b.x, a.y - b.y),
        startCenter: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        containerRect: rect,
      };
    } else {
      gestureRef.current = {
        startPos: position,
        startDist: 0,
        startCenter: { x: e.clientX, y: e.clientY },
        containerRect: rect,
      };
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gestureRef.current;
    if (!g) return;
    const pts = Array.from(pointersRef.current.values());
    if (pts.length >= 2) {
      const [a, b] = pts;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (g.startDist > 0) {
        const nextScale = clamp(
          g.startPos.scale * (dist / g.startDist),
          MIN_SCALE,
          MAX_SCALE,
        );
        setPosition((p) => ({ ...p, scale: nextScale }));
      }
    } else {
      const dx = e.clientX - g.startCenter.x;
      const dy = e.clientY - g.startCenter.y;
      applyDragDelta(dx, dy, g.startPos);
    }
  }

  function endPointer(e: React.PointerEvent<HTMLDivElement>) {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size === 0) gestureRef.current = null;
    else {
      const [only] = Array.from(pointersRef.current.values());
      gestureRef.current = {
        startPos: position,
        startDist: 0,
        startCenter: only,
        containerRect: containerRef.current!.getBoundingClientRect(),
      };
    }
  }

  function onWheel(e: React.WheelEvent<HTMLDivElement>) {
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.015 : 0.0025));
    setPosition((p) => ({
      ...p,
      scale: clamp(p.scale * factor, MIN_SCALE, MAX_SCALE),
    }));
  }

  if (!open) return null;

  const showDots = typeof stepIndex === "number" && stepCount > 0;

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col motion-safe:animate-[fade-in_180ms_ease-out_both]"
      style={{ background: PAGE_BG }}
      role="dialog"
      aria-modal="true"
      aria-label="Cover photo editor"
    >
      {/* Header — mirrors the onboarding header exactly so the hero starts
          at the same vertical offset as it does mid-flow. */}
      <header
        className="flex items-center justify-between gap-4 px-6 py-4 md:px-12 md:py-6"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 1rem)" }}
      >
        <img
          src={logo}
          alt="Mosaic Pet"
          className="h-7 w-auto object-contain sm:h-8 md:h-8 lg:h-10"
        />
        {showDots ? (
          <div className="flex items-center gap-1.5">
            {Array.from({ length: stepCount }).map((_, i) => (
              <span
                key={i}
                className={
                  "h-1.5 rounded-full transition-all duration-500 " +
                  (i === stepIndex
                    ? "w-6 bg-[color:var(--gold)]"
                    : "w-1.5 bg-border/60")
                }
              />
            ))}
          </div>
        ) : (
          <span aria-hidden />
        )}
      </header>

      {/* Hero preview — identical classes, image style and fade as the live
          Guest Page. The interaction surface IS the preview box, so drag /
          zoom math operates on the exact viewport guests will see. */}
      <section
        className="relative w-full"
        style={{ background: PAGE_BG }}
      >
        <div
          ref={containerRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          onPointerLeave={endPointer}
          onWheel={onWheel}
          className={`relative overflow-hidden touch-none select-none ${HERO_CLASSES}`}
          style={{ cursor: "grab", background: PAGE_BG }}
        >
          <img
            src={imageSrc}
            alt="Cover preview"
            draggable={false}
            onLoad={(e) => {
              const el = e.currentTarget;
              setNatural({ w: el.naturalWidth, h: el.naturalHeight });
            }}
            style={coverImageStyle(position)}
            className="pointer-events-none absolute inset-0"
          />

          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background: `linear-gradient(to bottom, transparent 0%, transparent 0%, ${PAGE_BG} 100%)`,
            }}
            aria-hidden
          />

          <div className="pointer-events-none absolute inset-0">
            <GuestHeroContent
              eventName={eventName}
              weddingDateLabel={weddingDateLabel}
              venue={venue}
              welcomeMessage={welcomeMessage}
            />
          </div>
        </div>
      </section>

      {/* Bottom controls — Cancel · zoom · Save, in a single elegant pill. */}
      <div
        className="mt-auto px-5 py-4 md:px-8"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}
      >
        <div className="mx-auto flex max-w-xl items-center gap-3 rounded-full bg-[color:var(--ivory)]/75 px-4 py-3 shadow-sm backdrop-blur-md">
          <button
            type="button"
            onClick={onCancel}
            className="text-eyebrow rounded-full px-3 py-1.5 text-foreground/70 transition hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => setPosition(DEFAULT_COVER_POSITION)}
            aria-label="Reset framing"
            className="text-muted-foreground transition hover:text-foreground"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
          <input
            type="range"
            min={MIN_SCALE}
            max={MAX_SCALE}
            step={0.01}
            value={position.scale}
            onChange={(e) =>
              setPosition((p) => ({ ...p, scale: Number(e.target.value) }))
            }
            className="flex-1 accent-[color:var(--gold,theme(colors.foreground))]"
            aria-label="Zoom"
          />
          <button
            type="button"
            onClick={() => onSave(position)}
            disabled={saving}
            className="text-eyebrow rounded-full bg-foreground px-4 py-2 text-[color:var(--ivory)] shadow-sm transition hover:bg-foreground/90 disabled:opacity-40"
          >
            {saving ? "Saving…" : saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}
