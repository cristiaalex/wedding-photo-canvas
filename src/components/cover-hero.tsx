import type { CSSProperties, ReactNode } from "react";
import { coverImageStyle, type CoverPosition } from "@/lib/cover-position";

// ---------------------------------------------------------------------------
// CoverHero
// The single rendering engine for cover photos across the entire application.
// Every screen that shows the couple's cover (guest page hero, dashboard
// event hero, settings preview, onboarding cover preview) MUST use this
// component so the crop, positioning, and dissolve are pixel-identical.
//
// Technique (extracted from the onboarding cover preview):
//  1. A single <img> styled by `coverImageStyle(position)` — this gives:
//       object-fit: cover
//       object-position: {x}% {y}%
//       transform: scale({s})
//       transform-origin: {x}% {y}%
//     Framing is data-only (`{x,y,scale}`) — the original file is never
//     re-encoded, and the same style renders identically at any aspect.
//  2. A pure-CSS linear gradient overlay from `transparent → transparent →
//     fadeTo`, where `fadeTo` is the page's own background color. Because
//     the gradient ends in the exact color the image sits on, the seam is
//     invisible. No SVG masks, no mask-image, no canvas — just CSS.
//
// Do NOT reintroduce mask-image / multi-stop alpha curves / atmospheric
// washes for the fade. The simplicity is what makes the transition feel
// premium — anything more layered starts to look artificial.
// ---------------------------------------------------------------------------

export type CoverHeroProps = {
  /** Bare image URL (already stripped of the `#pos=` fragment). */
  src: string | null | undefined;
  /** Focal point + zoom to apply via `coverImageStyle`. */
  position: CoverPosition | null | undefined;
  /** Accessible alt text for the cover image. */
  alt?: string;
  /** Sizing / aspect / rounding classes for the outer container. */
  className?: string;
  /** Load priority — eager for above-the-fold hero, lazy elsewhere. */
  eager?: boolean;
  /**
   * When set, render a bottom-anchored dissolve into this color. Use the
   * exact background color the cover sits on (e.g. `#F7F4EF` for the guest
   * page, `var(--ivory)` for onboarding). Omit for card-framed previews.
   */
  fadeTo?: string;
  /**
   * How much of the container the fade spans, 0..1. Default 1 (full
   * height), matching the onboarding preview. Lower values keep more of
   * the image opaque before the dissolve begins.
   */
  fadeCoverage?: number;
  /**
   * Fallback letter shown when there is no cover image. Rendered on a
   * subtle champagne/blush gradient identical to other empty covers.
   */
  fallbackLetter?: string | null;
  /**
   * Absolute-positioned overlay content (info card, "Adjust framing"
   * button, share affordances, etc.). Rendered above the fade.
   */
  children?: ReactNode;
};

export function CoverHero({
  src,
  position,
  alt = "Cover photo",
  className,
  eager,
  fadeTo,
  fadeCoverage = 1,
  fallbackLetter,
  children,
}: CoverHeroProps) {
  const fadeStyle: CSSProperties | undefined = fadeTo
    ? {
        // Match the onboarding preview exactly: linear-gradient(to bottom,
        // transparent 0%, transparent 50%, fadeTo 100%). The middle stop
        // keeps the top half fully opaque; the bottom half dissolves.
        background: `linear-gradient(to bottom, transparent 0%, transparent ${
          Math.max(0, 1 - fadeCoverage) * 100
        }%, ${fadeTo} 100%)`,
      }
    : undefined;

  return (
    <div className={`relative overflow-hidden ${className ?? ""}`.trim()}>
      {src ? (
        <img
          src={src}
          alt={alt}
          style={coverImageStyle(position)}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          className="absolute inset-0"
          draggable={false}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-[linear-gradient(135deg,var(--champagne),color-mix(in_oklab,var(--blush)_30%,var(--ivory)))]">
          {fallbackLetter && (
            <span className="text-script text-7xl text-foreground/40">
              {fallbackLetter}
            </span>
          )}
        </div>
      )}

      {fadeStyle && (
        <div
          className="pointer-events-none absolute inset-0"
          style={fadeStyle}
          aria-hidden
        />
      )}

      {children}
    </div>
  );
}
