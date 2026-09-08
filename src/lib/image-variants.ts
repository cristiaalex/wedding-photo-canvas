import { supabase, PHOTOS_BUCKET } from "@/lib/supabase";

// Path scheme produced by `prepareUpload`:
//   {eventId}/{photoId}/original.{ext}
//   {eventId}/{photoId}/display.webp
//   {eventId}/{photoId}/thumb_600.webp
//   {eventId}/{photoId}/thumb_300.webp
//
// Legacy uploads use {eventId}/{uuid}.{ext} with no folder — for those we fall
// back to the original path so existing photos keep rendering.

export type PhotoVariant = "original" | "display" | "thumb_600" | "thumb_300";

const ORIGINAL_RE = /^(.+)\/original\.[^/]+$/i;

export function hasVariants(path: string | null | undefined): boolean {
  return !!path && ORIGINAL_RE.test(path);
}

export function variantPath(
  originalPath: string,
  variant: PhotoVariant,
): string {
  if (variant === "original") return originalPath;
  const m = originalPath.match(ORIGINAL_RE);
  if (!m) return originalPath; // legacy path → no variants, fall back to original
  return `${m[1]}/${variant}.webp`;
}

/**
 * Batch-sign a list of stored photo paths, returning a map keyed by the
 * ORIGINAL stored path so callers can look up `signed[upload.image_url]`
 * regardless of which variant they asked for.
 *
 * Already-public http(s) URLs are passed through unchanged.
 */
export async function signVariantUrls(
  originalPaths: Array<string | null | undefined>,
  variant: PhotoVariant,
  ttlSeconds = 60 * 60,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const cleaned = Array.from(
    new Set(
      originalPaths.filter(
        (p): p is string => typeof p === "string" && p.length > 0,
      ),
    ),
  );
  const httpUrls = cleaned.filter((p) => /^https?:\/\//i.test(p));
  const storagePaths = cleaned.filter((p) => !/^https?:\/\//i.test(p));
  for (const u of httpUrls) out.set(u, u);
  if (storagePaths.length === 0) return out;

  // variantPath → original path (so we can re-key the response).
  const variantToOriginal = new Map<string, string>();
  for (const p of storagePaths) {
    variantToOriginal.set(variantPath(p, variant), p);
  }
  const allVariantPaths = Array.from(variantToOriginal.keys());

  for (let i = 0; i < allVariantPaths.length; i += 100) {
    const chunk = allVariantPaths.slice(i, i + 100);
    const { data } = await supabase.storage
      .from(PHOTOS_BUCKET)
      .createSignedUrls(chunk, ttlSeconds);
    data?.forEach((s) => {
      if (s.path && s.signedUrl) {
        const orig = variantToOriginal.get(s.path);
        if (orig) out.set(orig, s.signedUrl);
      }
    });
  }
  return out;
}
