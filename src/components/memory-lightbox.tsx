import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Trash2, X, ChevronLeft, ChevronRight, Heart } from "lucide-react";
import { useSignedPhotoUrls } from "@/hooks/use-photo-data";
import { signVariantUrls } from "@/lib/image-variants";

export type MemoryLightboxItem = {
  id: string;
  path: string;
  guestName: string | null;
  uploadedAt: string;
};

type Props = {
  items: MemoryLightboxItem[];
  index: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
  onDelete?: (item: MemoryLightboxItem) => void | Promise<void>;
};

/**
 * Native-feeling gallery lightbox.
 *
 * The stage is a horizontal "film strip" — each slide sits at `i * 100%` and
 * the track translates by `-currentIndex * 100% + dragOffset`. Dragging shows
 * the previous and next photos following the finger, releases snap with a
 * spring-like easing, and adjacent photos are preloaded so the swipe is
 * always continuous (never a black flash).
 */
export function MemoryLightbox({ items, index, onIndexChange, onClose, onDelete }: Props) {
  const total = items.length;
  const safe = Math.max(0, Math.min(index, total - 1));

  const paths = useMemo(() => items.map((i) => i.path), [items]);
  const signed = useSignedPhotoUrls(paths, "display");
  const urlFor = useCallback((i: number) => {
    const it = items[i];
    return it ? signed.data?.get(it.path) : undefined;
  }, [items, signed.data]);

  // Predictive preload: keep prev, current, +2 next decoded.
  const decodedRef = useRef<Set<string>>(new Set());
  const [, forcePaint] = useState(0);
  useEffect(() => {
    const targets = [safe - 1, safe, safe + 1, safe + 2].filter((i) => i >= 0 && i < total);
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

  // Track which slides to actually render (virtualize around current).
  const renderRange = useMemo(() => {
    const start = Math.max(0, safe - 2);
    const end = Math.min(total - 1, safe + 2);
    const arr: number[] = [];
    for (let i = start; i <= end; i++) arr.push(i);
    return arr;
  }, [safe, total]);

  // Drag state.
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);
  const lockedAxis = useRef<"x" | "y" | null>(null);
  const lastX = useRef(0);
  const lastT = useRef(0);
  const velocity = useRef(0);
  const [dx, setDx] = useState(0);
  const [animating, setAnimating] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const widthRef = useRef(0);
  useEffect(() => {
    const measure = () => { widthRef.current = stageRef.current?.clientWidth ?? window.innerWidth; };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    startX.current = e.clientX;
    startY.current = e.clientY;
    lockedAxis.current = null;
    lastX.current = e.clientX;
    lastT.current = performance.now();
    velocity.current = 0;
    setAnimating(false);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (startX.current == null || startY.current == null) return;
    const ddx = e.clientX - startX.current;
    const ddy = e.clientY - startY.current;
    if (lockedAxis.current == null) {
      if (Math.abs(ddx) < 6 && Math.abs(ddy) < 6) return;
      lockedAxis.current = Math.abs(ddx) > Math.abs(ddy) ? "x" : "y";
    }
    if (lockedAxis.current !== "x") return;
    // Resistance at the edges.
    let v = ddx;
    if ((safe === 0 && v > 0) || (safe === total - 1 && v < 0)) v = v * 0.35;
    const now = performance.now();
    const dt = Math.max(1, now - lastT.current);
    velocity.current = (e.clientX - lastX.current) / dt; // px / ms
    lastX.current = e.clientX;
    lastT.current = now;
    setDx(v);
  };
  const settle = (targetIndex: number) => {
    setAnimating(true);
    setDx(0);
    if (targetIndex !== safe) onIndexChange(targetIndex);
    // animation duration matches CSS below
    window.setTimeout(() => setAnimating(false), 380);
  };
  const onPointerUp = () => {
    if (startX.current == null) { return; }
    const w = widthRef.current || window.innerWidth;
    const distanceRatio = Math.abs(dx) / w;
    // iOS-style: short flick with any velocity should page.
    const v = velocity.current; // px / ms, sign = direction
    const fast = Math.abs(v) > 0.35;
    let target = safe;
    // Velocity direction wins when the flick is fast.
    if (fast && v < 0 && safe < total - 1) target = safe + 1;
    else if (fast && v > 0 && safe > 0) target = safe - 1;
    else if (distanceRatio > 0.2 && dx < 0 && safe < total - 1) target = safe + 1;
    else if (distanceRatio > 0.2 && dx > 0 && safe > 0) target = safe - 1;
    startX.current = null;
    startY.current = null;
    lockedAxis.current = null;
    settle(target);
  };

  const goPrev = useCallback(() => { if (safe > 0) { setAnimating(true); setDx(0); onIndexChange(safe - 1); window.setTimeout(() => setAnimating(false), 380); } }, [safe, onIndexChange]);
  const goNext = useCallback(() => { if (safe < total - 1) { setAnimating(true); setDx(0); onIndexChange(safe + 1); window.setTimeout(() => setAnimating(false), 380); } }, [safe, total, onIndexChange]);

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
    return () => { document.body.style.overflow = prev; };
  }, []);

  const displayedItem = items[safe];
  const handleDownload = async () => {
    if (!displayedItem) return;
    const filename = buildDownloadFilename(displayedItem);
    // Sign the ORIGINAL variant lazily — only for the photo being downloaded,
    // so gallery load keeps using the cheap `display` signatures.
    let originalUrl: string | undefined;
    try {
      const signedOriginal = await signVariantUrls([displayedItem.path], "original");
      originalUrl = signedOriginal.get(displayedItem.path);
    } catch {
      /* fall back below */
    }
    const url = originalUrl ?? urlFor(safe);
    if (!url) return;
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const a = document.createElement("a");
      const obj = URL.createObjectURL(blob);
      a.href = obj;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(obj);
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  const handleDelete = async () => {
    if (!displayedItem || !onDelete) return;
    if (!window.confirm("Delete this memory? This cannot be undone.")) return;
    await onDelete(displayedItem);
  };

  if (typeof document === "undefined" || !displayedItem) return null;

  const dateLabel = formatDate(displayedItem.uploadedAt);
  const timeLabel = formatTime(displayedItem.uploadedAt);

  const w = widthRef.current || (typeof window !== "undefined" ? window.innerWidth : 1);
  const GAP = 12; // px gap between slides — iOS-native breathing room
  const slideStride = w + GAP;
  const trackTransform = `translate3d(${-safe * slideStride + dx}px, 0, 0)`;
  // Slight scale: 0.97 while dragging, 1 at rest.
  const dragRatio = Math.min(1, Math.abs(dx) / (w * 0.6));
  const stageScale = 1 - 0.03 * dragRatio;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[100] flex flex-col bg-black text-white md:flex-row"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Top bar (mobile) */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between bg-gradient-to-b from-black/55 to-transparent px-4 pb-6 pt-[max(env(safe-area-inset-top),0.5rem)] md:hidden">
        <div className="pointer-events-auto text-[0.7rem] tabular-nums text-white/75">{safe + 1} / {total}</div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="pointer-events-auto grid h-9 w-9 place-items-center rounded-full bg-white/10 backdrop-blur"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Stage — film strip */}
      <div
        ref={stageRef}
        className="relative flex flex-1 select-none items-center justify-center overflow-hidden"
        style={{ touchAction: "pan-y" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {safe > 0 && (
          <button
            type="button"
            onClick={goPrev}
            aria-label="Previous memory"
            className="absolute left-3 top-1/2 z-10 hidden h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-white/10 backdrop-blur transition-colors hover:bg-white/20 md:grid"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}
        {safe < total - 1 && (
          <button
            type="button"
            onClick={goNext}
            aria-label="Next memory"
            className="absolute right-3 top-1/2 z-10 hidden h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-white/10 backdrop-blur transition-colors hover:bg-white/20 md:grid"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        )}

        <div
          className="absolute inset-0 will-change-transform"
          style={{
            transform: trackTransform,
            transition: animating ? "transform 380ms cubic-bezier(0.22, 1, 0.36, 1)" : "none",
          }}
        >
          {renderRange.map((i) => {
            const it = items[i];
            const url = urlFor(i);
            const decoded = url ? decodedRef.current.has(url) : false;
            return (
              <div
                key={it.id}
                className="absolute inset-y-0 flex items-center justify-center"
                style={{ left: `${i * slideStride}px`, width: `${w}px` }}
              >
                {url ? (
                  <img
                    src={url}
                    alt={it.guestName ? `Memory from ${it.guestName}` : "Memory"}
                    draggable={false}
                    className="max-h-full max-w-full object-contain transition-[opacity,transform] duration-300 ease-out"
                    style={{
                      opacity: decoded ? 1 : 0,
                      transform: i === safe ? `scale(${stageScale})` : "scale(1)",
                    }}
                    onLoad={() => {
                      if (url) {
                        decodedRef.current.add(url);
                        forcePaint((n) => n + 1);
                      }
                    }}
                  />
                ) : (
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Mobile bottom bar */}
      <div className="relative z-10 shrink-0 border-t border-white/10 bg-black/85 px-4 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-3 backdrop-blur-md md:hidden">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-sans text-[0.95rem] leading-tight text-white">
              Favorite memory
            </p>
            <p className="mt-0.5 truncate text-[0.7rem] tabular-nums text-white/55">
              {dateLabel} · {timeLabel}
              <span className="ml-2 inline-flex items-center gap-1 text-white/60"><Heart className="h-3 w-3" /> Pet memory</span>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={handleDownload}
              className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-white/25 active:bg-white/30"
            >
              <Download className="h-4 w-4" />
              Download
            </button>
            {onDelete && (
              <button
                type="button"
                onClick={handleDelete}
                aria-label="Delete"
                className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white/80 transition-colors hover:bg-red-500/20 hover:text-red-300"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Desktop side panel */}
      <aside className="relative z-10 hidden shrink-0 flex-col gap-6 border-l border-white/10 bg-black/80 px-7 py-10 backdrop-blur-md md:flex md:w-[320px]">
        <div className="flex items-center justify-between">
          <div className="text-xs tabular-nums text-white/60">{safe + 1} / {total}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-9 w-9 place-items-center rounded-full bg-white/10 transition-colors hover:bg-white/20"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-1">
          <p className="text-[0.65rem] font-bold text-white/50">ONE OF THE LITTLE MOMENTS</p>
          <p className="font-sans text-xl font-bold text-white">Favorite memory</p>
        </div>

        <div className="space-y-2 text-sm text-white/80">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[0.65rem] uppercase tracking-[0.18em] text-white/40">Date</span>
            <span className="tabular-nums">{dateLabel}</span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[0.65rem] uppercase tracking-[0.18em] text-white/40">Time</span>
            <span className="tabular-nums">{timeLabel}</span>
          </div>
        </div>

        <div className="mt-auto flex flex-col gap-2 pt-4">
          <button
            type="button"
            onClick={handleDownload}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-white/20 bg-white/5 px-4 py-2.5 text-sm text-white transition-colors hover:bg-white/15"
          >
            <Download className="h-4 w-4" />
            Download
          </button>
          {onDelete && (
            <button
              type="button"
              onClick={handleDelete}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 px-4 py-2.5 text-sm text-white/70 transition-colors hover:border-red-400/60 hover:text-red-300"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
          )}
        </div>
      </aside>
    </div>,
    document.body,
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  } catch { return iso; }
}
function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}

function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function buildDownloadFilename(item: MemoryLightboxItem): string {
  const guest = slugify(item.guestName ?? "guest") || "guest";
  let datePart = "";
  try {
    const d = new Date(item.uploadedAt);
    if (!Number.isNaN(d.getTime())) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      datePart = `${y}-${m}-${day}_${hh}${mm}`;
    }
  } catch { /* noop */ }
  const shortId = item.id.replace(/-/g, "").slice(0, 6);
  const parts = ["mosaic", guest, datePart, shortId].filter(Boolean);
  return `${parts.join("_")}.${originalExt(item.path)}`;
}

/** Extension of the stored ORIGINAL file (modern `…/original.heic` or legacy `…/uuid.png`). */
function originalExt(path: string): string {
  const name = path.split("?")[0].split("/").pop() ?? "";
  const i = name.lastIndexOf(".");
  const ext = i >= 0 ? name.slice(i + 1).toLowerCase() : "";
  return /^[a-z0-9]{2,5}$/.test(ext) ? ext : "jpg";
}

