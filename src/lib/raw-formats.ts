// Special photographic formats that browsers cannot decode and that are
// disproportionately large (Apple ProRAW is ~85 MB per frame).
//
// These bypass the normal client-side pipeline entirely: the raw file is
// uploaded as-is to a temporary source path and the Railway worker turns it
// into an "Optimized Original" (full-resolution, high-quality JPEG) plus the
// usual display/thumb variants. Everything else — JPEG, HEIC, PNG — keeps the
// existing client pipeline untouched.
//
// Start with DNG only. Additional RAW formats (CR2/CR3/NEF/ARW/…) get added
// here one at a time, after validation.

export const SPECIAL_RAW_EXTS = ["dng"] as const;

export function rawExtOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function isSpecialRawFile(file: { name: string; type?: string }): boolean {
  const ext = rawExtOf(file.name);
  if ((SPECIAL_RAW_EXTS as readonly string[]).includes(ext)) return true;
  const type = (file.type ?? "").toLowerCase();
  return type === "image/x-adobe-dng" || type === "image/dng";
}
