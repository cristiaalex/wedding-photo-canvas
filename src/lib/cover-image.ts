// Cover image validation & preparation.
//
// We accept the formats that browsers and our storage pipeline can render
// directly. RAW/DNG and other camera-native formats are rejected at the
// client with a clear message so the user knows exactly why.

export const SUPPORTED_COVER_MIME_TYPES = [
  "image/jpeg",
  "image/pjpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
] as const;

const UNSUPPORTED_RAW_HINTS = [
  "dng",
  "raw",
  "arw",
  "cr2",
  "cr3",
  "nef",
  "nrw",
  "orf",
  "rw2",
  "raf",
  "srw",
  "tif",
  "tiff",
];

export type PreparedCover = {
  file: File | Blob;
  contentType: string;
  ext: string;
};

function extFromName(name: string): string {
  const raw = (name.split(".").pop() ?? "").toLowerCase();
  return /^[a-z0-9]+$/.test(raw) ? raw : "";
}

export function validateCoverFile(file: File): { ok: true } | { ok: false; message: string } {
  const mime = (file.type || "").toLowerCase();
  const ext = extFromName(file.name);

  // eslint-disable-next-line no-console
  console.log(`[cover] selected file name="${file.name}" type="${file.type}" size=${file.size}`);

  if (UNSUPPORTED_RAW_HINTS.includes(ext) || mime === "image/x-adobe-dng" || mime === "image/dng" || mime === "image/x-raw") {
    return {
      ok: false,
      message:
        "RAW/DNG photos are not currently supported. Please choose JPG, HEIC or PNG.",
    };
  }

  if (mime && !SUPPORTED_COVER_MIME_TYPES.includes(mime as typeof SUPPORTED_COVER_MIME_TYPES[number]) && !mime.startsWith("image/")) {
    return {
      ok: false,
      message: `Unsupported file type "${file.type || ext || "unknown"}". Please upload JPG, PNG, WEBP, HEIC or HEIF.`,
    };
  }

  // Some iOS uploads arrive with no MIME type — accept based on extension.
  if (!mime) {
    const okExt = ["jpg", "jpeg", "png", "webp", "heic", "heif"].includes(ext);
    if (!okExt) {
      return {
        ok: false,
        message: `Unsupported file type "${ext || "unknown"}". Please upload JPG, PNG, WEBP, HEIC or HEIF.`,
      };
    }
  }

  return { ok: true };
}

export function prepareCoverForUpload(file: File): PreparedCover {
  const mime = (file.type || "").toLowerCase();
  let ext = extFromName(file.name);

  let contentType = mime;
  if (!contentType || !contentType.startsWith("image/")) {
    contentType =
      ext === "png"
        ? "image/png"
        : ext === "webp"
          ? "image/webp"
          : ext === "heic"
            ? "image/heic"
            : ext === "heif"
              ? "image/heif"
              : "image/jpeg";
  }
  if (!ext) {
    ext =
      contentType === "image/png"
        ? "png"
        : contentType === "image/webp"
          ? "webp"
          : contentType === "image/heic"
            ? "heic"
            : contentType === "image/heif"
              ? "heif"
              : "jpg";
  }

  return { file, contentType, ext };
}

export function describeUploadError(err: unknown): string {
  if (!err) return "Unknown upload error.";
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err && "message" in err && typeof (err as { message: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  return String(err);
}
