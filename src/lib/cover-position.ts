// Cover framing (scale, focal point) is encoded into the `cover_image_url`
// as a URL fragment so we don't need a new database column. The fragment
// is never sent over the wire — the CDN receives only the base URL.
//
// Format: `<url>#pos=x:<0..100>,y:<0..100>,s:<1..4>`

export type CoverPosition = {
  /** Focal X in percent (0..100). 50 = center. */
  x: number;
  /** Focal Y in percent (0..100). 50 = center. */
  y: number;
  /** Zoom multiplier on top of object-cover baseline. 1 = default. */
  scale: number;
};

export const DEFAULT_COVER_POSITION: CoverPosition = { x: 50, y: 50, scale: 1 };

const POS_RE = /#pos=([^#]+)$/i;

export function parseCoverUrl(url: string | null | undefined): {
  src: string | null;
  position: CoverPosition;
} {
  if (!url) return { src: null, position: { ...DEFAULT_COVER_POSITION } };
  const m = url.match(POS_RE);
  if (!m) return { src: url, position: { ...DEFAULT_COVER_POSITION } };
  const src = url.slice(0, m.index);
  const parts = m[1].split(",");
  const out: CoverPosition = { ...DEFAULT_COVER_POSITION };
  for (const p of parts) {
    const [k, v] = p.split(":");
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    if (k === "x") out.x = clamp(n, 0, 100);
    else if (k === "y") out.y = clamp(n, 0, 100);
    else if (k === "s") out.scale = clamp(n, 1, 4);
  }
  return { src, position: out };
}

export function buildCoverUrl(src: string, position: CoverPosition): string {
  const base = src.replace(POS_RE, "");
  const { x, y, scale } = position;
  // Only append when non-default to keep URLs clean.
  const isDefault = x === 50 && y === 50 && scale === 1;
  if (isDefault) return base;
  return `${base}#pos=x:${round(x)},y:${round(y)},s:${round(scale, 3)}`;
}

/**
 * Style object to apply to the cover `<img>` element. Uses `object-fit: cover`
 * to fill the container across any aspect ratio, `object-position` for the
 * focal point, and a matching `transform-origin` so zoom stays anchored to
 * the same point. No re-encoding of the image — the original file is never
 * modified.
 */
export function coverImageStyle(position: CoverPosition | null | undefined): React.CSSProperties {
  const p = position ?? DEFAULT_COVER_POSITION;
  return {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    objectPosition: `${p.x}% ${p.y}%`,
    transform: `scale(${p.scale})`,
    transformOrigin: `${p.x}% ${p.y}%`,
    willChange: "transform",
  };
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function round(n: number, digits = 1) {
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}
