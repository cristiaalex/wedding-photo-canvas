/**
 * Resumable (TUS) upload for special RAW sources ONLY.
 *
 * Apple ProRAW / DNG frames are ~85 MB, which the standard
 * `/storage/v1/object/...` endpoint rejects ("The object exceeded the maximum
 * allowed size"). Supabase Storage exposes a TUS endpoint that accepts large
 * files in fixed 6 MB chunks — that is what this helper uses.
 *
 * Normal JPEG/PNG/HEIC uploads never come through here; they keep using
 * `supabase.storage.upload()` exactly as before.
 */

import * as tus from "tus-js-client";
import { supabase, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "@/lib/supabase";

export async function uploadRawResumable(opts: {
  bucket: string;
  path: string;
  file: File;
  contentType?: string;
  onProgress?: (fraction: number) => void;
}): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token ?? SUPABASE_PUBLISHABLE_KEY;

  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(opts.file, {
      endpoint: `${SUPABASE_URL.replace(/\/$/, "")}/storage/v1/upload/resumable`,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      headers: {
        authorization: `Bearer ${accessToken}`,
        apikey: SUPABASE_PUBLISHABLE_KEY,
        "x-upsert": "true",
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName: opts.bucket,
        objectName: opts.path,
        contentType: opts.contentType || "application/octet-stream",
        cacheControl: "31536000, immutable",
      },
      // Supabase requires a fixed 6 MB chunk size.
      chunkSize: 6 * 1024 * 1024,
      onError: (err) => reject(new Error(err.message || "Upload failed")),
      onProgress: (sent, total) => {
        if (total > 0) opts.onProgress?.(sent / total);
      },
      onSuccess: () => resolve(),
    });

    void upload
      .findPreviousUploads()
      .then((prev) => {
        if (prev.length > 0) upload.resumeFromPreviousUpload(prev[0]!);
        upload.start();
      })
      .catch(() => upload.start());
  });
}
