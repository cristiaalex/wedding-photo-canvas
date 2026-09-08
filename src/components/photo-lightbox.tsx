import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSignedPhotoUrls } from "@/hooks/use-photo-data";

export type LightboxPhoto = {
  /** Stored original path (e.g. {eventId}/{photoId}/original.jpg). */
  path: string;
  caption?: string | null;
  /** True when the currently-viewing guest device uploaded this photo. */
  ownedByMe?: boolean;
  /** When ownedByMe, whether the removal window is still open. */
  canRemove?: boolean;
};

type Props = {
  photos: LightboxPhoto[];
  index: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
  /** Optional subtitle rendered as a small caption under the photo. */
  subtitle?: string;
  /**
   * When set AND the current photo is `ownedByMe`, a "⋯" menu appears with a
   * "Remove photo" action. The parent handles the confirmation dialog and
   * the delete itself.
   */
  onRequestRemove?: (index: number) => void;
};

type Transform = { scale: number; tx: number; ty: number };
type GestureMode = "idle" | "swipe" | "pan" | "pinch";

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;
const DOUBLE_TAP_MS = 280;
const IDENTITY: Transform = { scale: 1, tx: 0, ty: 0 };

/**
 * Fullscreen lightbox for the guest gallery.
 *
 * Behaviour:
 *  - Single-pointer horizontal drag at scale=1 → film-strip swipe between
 *    photos (iOS-native feel, adjacent slides preloaded).
 *  - Pinch (2 pointers) → smooth zoom 1×–5× centered on the pinch midpoint.
 *  - Pan (drag while zoomed) → moves the zoomed image.
 *  - Double-tap → toggles between 1× and 2.5× at the tap location.
 *  - Zoom state resets when the user navigates to another photo.
 */
export function PhotoLightbox({ photos, index, onIndexChange, onClose, subtitle, onRequestRemove }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const total = photos.length;
  const safe = Math.max(0, Math.min(index, total - 1));

  const paths = useMemo(() => photos.map((p) => p.path), [photos]);
  const signed = useSignedPhotoUrls(paths, "display");
  const urlFor = useCallback(
    (i: number) => {
      const it = photos[i];
      return it ? signed.data?.get(it.path) : undefined;
    },
    [photos, signed.data],
  );

  // Predictive preload: keep prev, current, +2 next decoded.
  const decodedRef = useRef<Set<string>>(new Set());
  const [, forcePaint] = useState(0);
  useEffect(() => {
    const targets = [safe - 1, safe, safe + 1, safe + 2].filter(
      (i) => i >= 0 && i < total,
    );
    for (const i of targets) {
      const url = urlFor(i);
      if (!url || decodedRef.current.has(url)) continue;
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        decodedRef.current.add(url);
        forcePaint((n) => n + 1);
      };
      img.src = url;
      if (img.complete && img.naturalWidth > 0) {
        decodedRef.current.add(url);
      }
    }
  }, [safe, total, urlFor]);

  const renderRange = useMemo(() => {
    const start = Math.max(0, safe - 2);
    const end = Math.min(total - 1, safe + 2);
    const arr: number[] = [];
    for (let i = start; i <= end; i++) arr.push(i);
    return arr;
  }, [safe, total]);

  // ---------------------- Gesture state ----------------------
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const gesture = useRef<GestureMode>("idle");
  const [transform, setTransform] = useState<Transform>(IDENTITY);
  const transformRef = useRef<Transform>(IDENTITY);
  useEffect(() => {
    transformRef.current = transform;
  }, [transform]);

  // Pinch bookkeeping
  const pinchStartDist = useRef(0);
  const pinchStartScale = useRef(1);
  const pinchStartMid = useRef({ x: 0, y: 0 });
  const pinchStartTx = useRef(0);
  const pinchStartTy = useRef(0);
  // Pan bookkeeping (single-pointer while zoomed)
  const panStartX = useRef(0);
  const panStartY = useRef(0);
  const panStartTx = useRef(0);
  const panStartTy = useRef(0);
  // Swipe bookkeeping (single-pointer while at scale=1)
  const swipeStartX = useRef<number | null>(null);
  const swipeStartY = useRef<number | null>(null);
  const swipeLockedAxis = useRef<"x" | "y" | null>(null);
  const swipeLastX = useRef(0);
  const swipeLastT = useRef(0);
  const swipeVelocity = useRef(0);
  const [dx, setDx] = useState(0);
  const [animating, setAnimating] = useState(false);
  // Double-tap
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const widthRef = useRef(0);
  const heightRef = useRef(0);
  useEffect(() => {
    const measure = () => {
      widthRef.current = stageRef.current?.clientWidth ?? window.innerWidth;
      heightRef.current = stageRef.current?.clientHeight ?? window.innerHeight;
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Reset zoom on slide change.
  useEffect(() => {
    setTransform(IDENTITY);
    transformRef.current = IDENTITY;
    setMenuOpen(false);
  }, [safe]);

  const clampTransform = useCallback((t: Transform): Transform => {
    const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, t.scale));
    if (scale <= 1) return { scale: 1, tx: 0, ty: 0 };
    const w = widthRef.current || 1;
    const h = heightRef.current || 1;
    // Constrain so translation can't drag the image entirely off-screen.
    const maxTx = ((scale - 1) * w) / 2;
    const maxTy = ((scale - 1) * h) / 2;
    return {
      scale,
      tx: Math.max(-maxTx, Math.min(maxTx, t.tx)),
      ty: Math.max(-maxTy, Math.min(maxTy, t.ty)),
    };
  }, []);

  const applyTransform = useCallback(
    (next: Transform) => {
      const c = clampTransform(next);
      transformRef.current = c;
      setTransform(c);
    },
    [clampTransform],
  );

  const settleSwipe = useCallback(
    (targetIndex: number) => {
      setAnimating(true);
      setDx(0);
      if (targetIndex !== safe) onIndexChange(targetIndex);
      window.setTimeout(() => setAnimating(false), 380);
    },
    [safe, onIndexChange],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2) {
      // Enter pinch mode.
      const pts = Array.from(pointers.current.values());
      const dxp = pts[0].x - pts[1].x;
      const dyp = pts[0].y - pts[1].y;
      pinchStartDist.current = Math.hypot(dxp, dyp) || 1;
      pinchStartScale.current = transformRef.current.scale;
      pinchStartMid.current = {
        x: (pts[0].x + pts[1].x) / 2,
        y: (pts[0].y + pts[1].y) / 2,
      };
      pinchStartTx.current = transformRef.current.tx;
      pinchStartTy.current = transformRef.current.ty;
      gesture.current = "pinch";
      // Cancel any in-flight swipe.
      swipeStartX.current = null;
      swipeStartY.current = null;
      swipeLockedAxis.current = null;
      setDx(0);
      setAnimating(false);
      return;
    }

    // Single pointer.
    setAnimating(false);
    if (transformRef.current.scale > 1) {
      gesture.current = "pan";
      panStartX.current = e.clientX;
      panStartY.current = e.clientY;
      panStartTx.current = transformRef.current.tx;
      panStartTy.current = transformRef.current.ty;
    } else {
      gesture.current = "swipe";
      swipeStartX.current = e.clientX;
      swipeStartY.current = e.clientY;
      swipeLockedAxis.current = null;
      swipeLastX.current = e.clientX;
      swipeLastT.current = performance.now();
      swipeVelocity.current = 0;
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (gesture.current === "pinch" && pointers.current.size >= 2) {
      const pts = Array.from(pointers.current.values()).slice(0, 2);
      const dxp = pts[0].x - pts[1].x;
      const dyp = pts[0].y - pts[1].y;
      const dist = Math.hypot(dxp, dyp) || 1;
      const ratio = dist / pinchStartDist.current;
      const nextScale = pinchStartScale.current * ratio;
      // Anchor zoom around the initial midpoint so pinch feels natural.
      const w = widthRef.current || 1;
      const h = heightRef.current || 1;
      const anchorX = pinchStartMid.current.x - w / 2;
      const anchorY = pinchStartMid.current.y - h / 2;
      const scaleDelta = nextScale / (pinchStartScale.current || 1);
      const nextTx =
        pinchStartTx.current - anchorX * (scaleDelta - 1);
      const nextTy =
        pinchStartTy.current - anchorY * (scaleDelta - 1);
      applyTransform({ scale: nextScale, tx: nextTx, ty: nextTy });
      return;
    }

    if (gesture.current === "pan") {
      const dxp = e.clientX - panStartX.current;
      const dyp = e.clientY - panStartY.current;
      applyTransform({
        scale: transformRef.current.scale,
        tx: panStartTx.current + dxp,
        ty: panStartTy.current + dyp,
      });
      return;
    }

    if (gesture.current === "swipe") {
      if (swipeStartX.current == null || swipeStartY.current == null) return;
      const ddx = e.clientX - swipeStartX.current;
      const ddy = e.clientY - swipeStartY.current;
      if (swipeLockedAxis.current == null) {
        if (Math.abs(ddx) < 6 && Math.abs(ddy) < 6) return;
        swipeLockedAxis.current = Math.abs(ddx) > Math.abs(ddy) ? "x" : "y";
      }
      if (swipeLockedAxis.current !== "x") return;
      let v = ddx;
      if ((safe === 0 && v > 0) || (safe === total - 1 && v < 0)) v = v * 0.35;
      const now = performance.now();
      const dt = Math.max(1, now - swipeLastT.current);
      swipeVelocity.current = (e.clientX - swipeLastX.current) / dt;
      swipeLastX.current = e.clientX;
      swipeLastT.current = now;
      setDx(v);
    }
  };

  const finishGesture = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);

    if (gesture.current === "pinch") {
      // If a second finger is still down, stay in a degraded pinch state
      // (rare); otherwise fall back to pan/idle based on remaining scale.
      if (pointers.current.size >= 2) return;
      // Snap back to 1× if the user pinched below.
      if (transformRef.current.scale < 1.05) {
        applyTransform(IDENTITY);
      }
      gesture.current = pointers.current.size === 1 && transformRef.current.scale > 1 ? "pan" : "idle";
      if (gesture.current === "pan" && pointers.current.size === 1) {
        const remaining = Array.from(pointers.current.values())[0];
        panStartX.current = remaining.x;
        panStartY.current = remaining.y;
        panStartTx.current = transformRef.current.tx;
        panStartTy.current = transformRef.current.ty;
      }
      return;
    }

    if (gesture.current === "pan") {
      gesture.current = "idle";
      return;
    }

    if (gesture.current === "swipe") {
      // Detect double-tap first (only meaningful when tap wasn't a drag).
      if (swipeLockedAxis.current == null) {
        const now = performance.now();
        const last = lastTap.current;
        const w = widthRef.current || 1;
        const h = heightRef.current || 1;
        if (
          last &&
          now - last.t < DOUBLE_TAP_MS &&
          Math.abs(e.clientX - last.x) < 30 &&
          Math.abs(e.clientY - last.y) < 30
        ) {
          // Double-tap: toggle zoom around the tap point.
          lastTap.current = null;
          if (transformRef.current.scale > 1.01) {
            applyTransform(IDENTITY);
          } else {
            const anchorX = e.clientX - w / 2;
            const anchorY = e.clientY - h / 2;
            const s = DOUBLE_TAP_SCALE;
            applyTransform({
              scale: s,
              tx: -anchorX * (s - 1),
              ty: -anchorY * (s - 1),
            });
          }
          swipeStartX.current = null;
          swipeStartY.current = null;
          gesture.current = "idle";
          return;
        }
        lastTap.current = { t: now, x: e.clientX, y: e.clientY };
        swipeStartX.current = null;
        swipeStartY.current = null;
        gesture.current = "idle";
        return;
      }

      // Real swipe → settle to prev/current/next.
      const w = widthRef.current || window.innerWidth;
      const distanceRatio = Math.abs(dx) / w;
      const v = swipeVelocity.current;
      const fast = Math.abs(v) > 0.35;
      let target = safe;
      if (fast && v < 0 && safe < total - 1) target = safe + 1;
      else if (fast && v > 0 && safe > 0) target = safe - 1;
      else if (distanceRatio > 0.2 && dx < 0 && safe < total - 1) target = safe + 1;
      else if (distanceRatio > 0.2 && dx > 0 && safe > 0) target = safe - 1;
      swipeStartX.current = null;
      swipeStartY.current = null;
      swipeLockedAxis.current = null;
      gesture.current = "idle";
      settleSwipe(target);
    }
  };

  const goPrev = useCallback(() => {
    if (safe > 0) {
      setAnimating(true);
      setDx(0);
      onIndexChange(safe - 1);
      window.setTimeout(() => setAnimating(false), 380);
    }
  }, [safe, onIndexChange]);
  const goNext = useCallback(() => {
    if (safe < total - 1) {
      setAnimating(true);
      setDx(0);
      onIndexChange(safe + 1);
      window.setTimeout(() => setAnimating(false), 380);
    }
  }, [safe, total, onIndexChange]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, goPrev, goNext]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  if (typeof document === "undefined") return null;
  const current = photos[safe];
  if (!current) return null;

  const w = widthRef.current || (typeof window !== "undefined" ? window.innerWidth : 1);
  const GAP = 12;
  const slideStride = w + GAP;
  // Track only moves for the swipe carousel; zoom pan lives on the current
  // slide's image transform.
  const trackTransform = `translate3d(${-safe * slideStride + dx}px, 0, 0)`;
  const dragRatio = Math.min(1, Math.abs(dx) / (w * 0.6));
  const stageScale = 1 - 0.03 * dragRatio;
  const zoomed = transform.scale > 1.01;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[100] flex flex-col bg-black/95 text-white"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Top bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent px-4 pb-8 pt-[env(safe-area-inset-top)] sm:px-6">
        <div className="pointer-events-auto flex items-center gap-2 pt-3">
          <span className="text-sm tabular-nums text-white/90">
            {safe + 1} / {total}
          </span>
          {current.ownedByMe && (
            <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-[0.65rem] font-medium tracking-wide text-white backdrop-blur">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M12 2l2.4 6.9H22l-6 4.3 2.3 6.9L12 15.8 5.7 20.1 8 13.2 2 8.9h7.6L12 2z" />
              </svg>
              Your photo
            </span>
          )}
        </div>
        <div className="pointer-events-auto mt-3 flex items-center gap-2">
          {current.ownedByMe && current.canRemove && onRequestRemove && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                aria-label="More options"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition-colors hover:bg-white/20"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <circle cx="5" cy="12" r="1.8" />
                  <circle cx="12" cy="12" r="1.8" />
                  <circle cx="19" cy="12" r="1.8" />
                </svg>
              </button>
              {menuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-0"
                    onClick={() => setMenuOpen(false)}
                    aria-hidden
                  />
                  <div
                    role="menu"
                    className="absolute right-0 z-10 mt-2 min-w-[10rem] overflow-hidden rounded-xl bg-white text-foreground shadow-xl"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        onRequestRemove(safe);
                      }}
                      className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-red-600 hover:bg-red-50"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                        <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      Remove photo
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition-colors hover:bg-white/20"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>


      {/* Desktop arrow controls — hidden while zoomed to avoid awkward paging */}
      {!zoomed && safe > 0 && (
        <button
          type="button"
          onClick={goPrev}
          aria-label="Previous photo"
          className="absolute left-2 top-1/2 z-10 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition-colors hover:bg-white/25 md:flex"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      {!zoomed && safe < total - 1 && (
        <button
          type="button"
          onClick={goNext}
          aria-label="Next photo"
          className="absolute right-2 top-1/2 z-10 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition-colors hover:bg-white/25 md:flex"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}

      {/* Stage — film strip + per-slide zoomable image */}
      <div
        ref={stageRef}
        className="relative flex-1 select-none overflow-hidden"
        // While zoomed we consume all touch gestures ourselves (pan/pinch);
        // at 1× we let the browser handle vertical scroll intent.
        style={{ touchAction: zoomed ? "none" : "pan-y" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishGesture}
        onPointerCancel={finishGesture}
      >
        <div
          className="absolute inset-0 will-change-transform"
          style={{
            transform: trackTransform,
            transition: animating ? "transform 380ms cubic-bezier(0.22, 1, 0.36, 1)" : "none",
          }}
        >
          {renderRange.map((i) => {
            const it = photos[i];
            const url = urlFor(i);
            const decoded = url ? decodedRef.current.has(url) : false;
            const isCurrent = i === safe;
            const imgTransform = isCurrent
              ? `translate3d(${transform.tx}px, ${transform.ty}px, 0) scale(${transform.scale * stageScale})`
              : "scale(1)";
            return (
              <div
                key={it.path}
                className="absolute inset-y-0 flex items-center justify-center"
                style={{ left: `${i * slideStride}px`, width: `${w}px` }}
              >
                {url ? (
                  <img
                    src={url}
                    alt={it.caption ?? "Photo"}
                    draggable={false}
                    className="max-h-full max-w-full object-contain"
                    style={{
                      opacity: decoded ? 1 : 0,
                      transform: imgTransform,
                      transition:
                        isCurrent && gesture.current === "idle"
                          ? "transform 240ms cubic-bezier(0.22, 1, 0.36, 1), opacity 300ms ease-out"
                          : "opacity 300ms ease-out",
                      transformOrigin: "center center",
                    }}
                    onLoad={() => {
                      if (url) {
                        decodedRef.current.add(url);
                        forcePaint((n) => n + 1);
                      }
                    }}
                  />
                ) : (
                  <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Caption / subtitle */}
      {(current.caption || subtitle) && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/70 to-transparent px-6 pb-[max(env(safe-area-inset-bottom),16px)] pt-10 text-center text-sm text-white/90">
          {current.caption && <div>{current.caption}</div>}
          {subtitle && (
            <div className="mt-1 text-xs uppercase tracking-[0.18em] text-white/65">
              {subtitle}
            </div>
          )}
        </div>
      )}
    </div>,
    document.body,
  );
}
