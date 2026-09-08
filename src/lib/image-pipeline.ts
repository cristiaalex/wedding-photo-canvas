// Client-side image variant pipeline.
//
// For every uploaded photo we keep four artifacts inside the private
// `photos` bucket:
//
//   {eventId}/{photoId}/original.{ext}   — untouched source (premium / print)
//   {eventId}/{photoId}/display.webp     — max 3000px longest edge, q≈88
//   {eventId}/{photoId}/thumb_600.webp   — max  800px longest edge, q≈85
//   {eventId}/{photoId}/thumb_300.webp   — max  400px longest edge, q≈82
//
// Decode + resize use createImageBitmap + (Offscreen)Canvas. WebP encoding
// uses libwebp compiled to WASM via @jsquash/webp so output bytes are
// deterministic across Chrome/Safari/iOS/Android — the browser's native
// canvas WebP encoder is NOT used (Safari/iOS silently emit PNG bytes).

import encode, { init as initWebpEncoder } from "@jsquash/webp/encode";

export type PreparedVariant = {
  blob: Blob;
  contentType: string;
  size: number;
};

export type PreparedUpload = {
  photoId: string;
  ext: string;
  original: PreparedVariant;
  display: PreparedVariant;
  thumb600: PreparedVariant;
  thumb300: PreparedVariant;
  stats: PrepareStats;
};

export type PrepareStats = {
  originalBytes: number;
  originalWidth: number;
  originalHeight: number;
  decodedWidth: number;
  decodedHeight: number;
  outputs: {
    display: { width: number; height: number; bytes: number };
    thumb600: { width: number; height: number; bytes: number };
    thumb300: { width: number; height: number; bytes: number };
  };
  decodeMs: number;
  resizeMs: number;
  encodeMs: number;
  peakMemoryMb?: number;
};

export class ImagePipelineError extends Error {
  code:
    | "decode_failed"
    | "format_unsupported"
    | "corrupted"
    | "out_of_memory"
    | "canvas_unavailable"
    | "encode_failed";
  constructor(code: ImagePipelineError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "ImagePipelineError";
  }
}

function isOomError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("memory") ||
    msg.includes("allocation") ||
    msg.includes("too large") ||
    msg.includes("maximum") ||
    err instanceof RangeError
  );
}

// ---------------- Shared WebP encoder (init once per session) ----------------
//
// `initWebpEncoder()` returns a promise for the Emscripten module instance.
// We cache the promise itself so all concurrent callers await the same
// instantiation; subsequent uploads reuse the already-initialised module.
let encoderInitPromise: Promise<unknown> | null = null;
function ensureWebpEncoder(): Promise<unknown> {
  if (!encoderInitPromise) {
    encoderInitPromise = initWebpEncoder().catch((err) => {
      // Reset so a later upload can retry initialisation.
      encoderInitPromise = null;
      throw err;
    });
  }
  return encoderInitPromise;
}

async function encodeWebp(
  imageData: ImageData,
  quality: number,
): Promise<ArrayBuffer> {
  const q = Math.round(quality * 100);
  return await encode(imageData, { quality: q });
}

async function encodeWebpWithRetry(
  imageData: ImageData,
  quality: number,
): Promise<ArrayBuffer> {
  try {
    return await encodeWebp(imageData, quality);
  } catch (err) {
    // One retry, per spec — covers transient WASM allocation hiccups.
    // eslint-disable-next-line no-console
    console.warn("[image-pipeline] webp encode failed, retrying once", err);
    try {
      return await encodeWebp(imageData, quality);
    } catch (err2) {
      if (isOomError(err) || isOomError(err2)) {
        throw new ImagePipelineError(
          "out_of_memory",
          "This image exceeds your device's available memory.",
        );
      }
      throw new ImagePipelineError(
        "encode_failed",
        "This image could not be processed.",
      );
    }
  }
}

// ---------------- Resize via canvas (no encoding here) ----------------
async function resizeToImageData(
  bitmap: ImageBitmap,
  maxEdge: number,
): Promise<{ data: ImageData; width: number; height: number }> {
  const w = bitmap.width;
  const h = bitmap.height;
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));

  let canvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  let ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;
  try {
    if (typeof OffscreenCanvas !== "undefined") {
      canvas = new OffscreenCanvas(tw, th);
      ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D | null;
    } else {
      canvas = document.createElement("canvas");
      canvas.width = tw;
      canvas.height = th;
      ctx = canvas.getContext("2d") as CanvasRenderingContext2D | null;
    }
    if (!ctx) {
      throw new ImagePipelineError(
        "canvas_unavailable",
        "Your browser could not create a drawing canvas for this image.",
      );
    }
    ctx.drawImage(bitmap, 0, 0, tw, th);
    const data = ctx.getImageData(0, 0, tw, th);
    return { data, width: tw, height: th };
  } catch (err) {
    if (err instanceof ImagePipelineError) throw err;
    if (isOomError(err)) {
      throw new ImagePipelineError(
        "out_of_memory",
        "This image exceeds your device's available memory.",
      );
    }
    throw new ImagePipelineError(
      "canvas_unavailable",
      "Your browser could not draw this image.",
    );
  } finally {
    if (canvas) {
      try {
        canvas.width = 0;
        canvas.height = 0;
      } catch {
        /* noop */
      }
    }
    ctx = null;
    canvas = null;
  }
}

// Back-compat helper: produce a WebP Blob from a bitmap at given size/quality.
export async function resizeToWebp(
  bitmap: ImageBitmap,
  maxEdge: number,
  quality: number,
): Promise<Blob> {
  await ensureWebpEncoder();
  const { data } = await resizeToImageData(bitmap, maxEdge);
  const bytes = await encodeWebpWithRetry(data, quality);
  return new Blob([bytes], { type: "image/webp" });
}

function extOf(name: string, fallback = "jpg") {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : fallback;
}

function readPeakMemoryMb(): number | undefined {
  const perf = (typeof performance !== "undefined" ? performance : null) as
    | (Performance & { memory?: { usedJSHeapSize?: number } })
    | null;
  const used = perf?.memory?.usedJSHeapSize;
  return typeof used === "number" ? Math.round(used / (1024 * 1024)) : undefined;
}

export async function prepareUpload(file: File): Promise<PreparedUpload> {
  const photoId = crypto.randomUUID();
  const ext = extOf(file.name, file.type === "image/png" ? "png" : "jpg");

  // Kick off WebP encoder init in parallel with the decode — first upload of
  // the session pays ~50-150ms; subsequent uploads resolve immediately.
  const encoderReady = ensureWebpEncoder();

  // ---------------- Decode (+ EXIF orientation + sRGB conversion) ----------------
  const decodeStart = performance.now();
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
      colorSpaceConversion: "default",
    });
  } catch (err) {
    try {
      bitmap = await createImageBitmap(file);
    } catch (err2) {
      if (isOomError(err) || isOomError(err2)) {
        throw new ImagePipelineError(
          "out_of_memory",
          "This image exceeds your device's available memory.",
        );
      }
      const msg = (err2 instanceof Error ? err2.message : "").toLowerCase();
      if (msg.includes("source") || msg.includes("type") || msg.includes("format")) {
        throw new ImagePipelineError(
          "format_unsupported",
          "This image format is not supported.",
        );
      }
      throw new ImagePipelineError(
        "corrupted",
        "This image appears to be corrupted.",
      );
    }
  }
  const decodeMs = Math.round(performance.now() - decodeStart);
  const originalWidth = bitmap.width;
  const originalHeight = bitmap.height;

  try {
    // ---------------- Resize all three variants ----------------
    const resizeStart = performance.now();
    let displayPixels, thumb600Pixels, thumb300Pixels;
    try {
      [displayPixels, thumb600Pixels, thumb300Pixels] = await Promise.all([
        resizeToImageData(bitmap, 3000),
        resizeToImageData(bitmap, 800),
        resizeToImageData(bitmap, 400),
      ]);
    } catch (err) {
      if (err instanceof ImagePipelineError) throw err;
      if (isOomError(err)) {
        throw new ImagePipelineError(
          "out_of_memory",
          "This image exceeds your device's available memory.",
        );
      }
      throw new ImagePipelineError(
        "canvas_unavailable",
        "Your browser could not draw this image.",
      );
    }
    const resizeMs = Math.round(performance.now() - resizeStart);

    // Make sure encoder is ready before we start encoding.
    await encoderReady;

    // ---------------- Encode via libwebp WASM (sequential to share the heap) ----------------
    const encodeStart = performance.now();
    const displayBytes = await encodeWebpWithRetry(displayPixels.data, 0.88);
    const thumb600Bytes = await encodeWebpWithRetry(thumb600Pixels.data, 0.85);
    const thumb300Bytes = await encodeWebpWithRetry(thumb300Pixels.data, 0.82);
    const encodeMs = Math.round(performance.now() - encodeStart);

    const displayBlob = new Blob([displayBytes], { type: "image/webp" });
    const thumb600Blob = new Blob([thumb600Bytes], { type: "image/webp" });
    const thumb300Blob = new Blob([thumb300Bytes], { type: "image/webp" });

    const stats: PrepareStats = {
      originalBytes: file.size,
      originalWidth,
      originalHeight,
      decodedWidth: bitmap.width,
      decodedHeight: bitmap.height,
      outputs: {
        display: { width: displayPixels.width, height: displayPixels.height, bytes: displayBlob.size },
        thumb600: { width: thumb600Pixels.width, height: thumb600Pixels.height, bytes: thumb600Blob.size },
        thumb300: { width: thumb300Pixels.width, height: thumb300Pixels.height, bytes: thumb300Blob.size },
      },
      decodeMs,
      resizeMs,
      encodeMs,
      peakMemoryMb: readPeakMemoryMb(),
    };

    return {
      photoId,
      ext,
      original: {
        blob: file,
        contentType: file.type || "image/jpeg",
        size: file.size,
      },
      display: { blob: displayBlob, contentType: "image/webp", size: displayBlob.size },
      thumb600: { blob: thumb600Blob, contentType: "image/webp", size: thumb600Blob.size },
      thumb300: { blob: thumb300Blob, contentType: "image/webp", size: thumb300Blob.size },
      stats,
    };
  } finally {
    try {
      bitmap.close?.();
    } catch {
      /* noop */
    }
  }
}
