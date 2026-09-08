import { useEffect, useMemo, useRef, useState } from "react";
import { supabase, PHOTOS_BUCKET } from "@/lib/supabase";
import { prepareUpload, ImagePipelineError } from "@/lib/image-pipeline";
import { useQueryClient } from "@tanstack/react-query";
import { rememberMyUpload } from "@/lib/guest-uploads";
import { deleteOwnUpload, deleteReasonMessage } from "@/lib/guest-photo-delete";
import { signVariantUrls } from "@/lib/image-variants";
import { isSpecialRawFile, rawExtOf } from "@/lib/raw-formats";
import { uploadRawResumable } from "@/lib/raw-tus-upload";
import {
  requestOptimizedOriginal,
  getOptimizedOriginalStatus,
} from "@/lib/optimize.functions";


const ACCEPTED_EXTS = ["jpg", "jpeg", "png", "heic", "heif", "dng"];

type UploadStatus = "queued" | "preparing" | "uploading" | "done" | "failed" | "duplicate";

type Item = {
  id: string;
  file: File;
  previewUrl: string | null;
  status: UploadStatus;
  error: string | null;
  hash?: string;
  /** DB row id for successfully-inserted uploads (needed to remove). */
  uploadRowId?: string;
  /** Storage path so review can render the uploaded photo. */
  imagePath?: string;
  /** Signed thumbnail URL used by the review screen. */
  thumbUrl?: string;
};

async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}
function fileExt(name: string) {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}
function isHeic(file: File) {
  const ext = fileExt(file.name);
  return ext === "heic" || ext === "heif" || file.type === "image/heic" || file.type === "image/heif";
}
async function convertHeicToJpeg(file: File): Promise<File> {
  const heic2any = (await import("heic2any")).default;
  const blob = (await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 })) as Blob;
  const base = file.name.replace(/\.(heic|heif)$/i, "");
  return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
}

type Props = {
  open: boolean;
  onClose: () => void;
  eventId: string | null;
  eventPlan?: string | null;
  guestName?: string | null;
  guestUuid?: string | null;
  eventName?: string | null;
  onViewGallery?: () => void;
  initialFiles?: File[] | null;
};

const REASSURANCE_MESSAGES = [
  "Preparing your memories…",
  "Optimizing photos…",
  "Uploading securely…",
  "Almost there…",
];

export function GuestUploadSheet({
  open,
  onClose,
  eventId,
  eventPlan,
  guestName,
  guestUuid,
  eventName,
  onViewGallery,
  initialFiles,
}: Props) {
  const queryClient = useQueryClient();
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [messageIndex, setMessageIndex] = useState(0);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  
  const runningRef = useRef(false);
  const autoCloseRef = useRef<ReturnType<typeof setTimeout> | null>(null);


  // Reset on close.
  useEffect(() => {
    if (!open) {
      items.forEach((i) => i.previewUrl && URL.revokeObjectURL(i.previewUrl));
      if (autoCloseRef.current) {
        clearTimeout(autoCloseRef.current);
        autoCloseRef.current = null;
      }
      setItems([]);
      setFinished(false);
      setRunning(false);
      setReviewOpen(false);
      setPendingRemoveId(null);
      setRemovingId(null);
      setRemoveError(null);
      runningRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Lock scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Consume initialFiles when sheet opens with pre-selected files.
  const initialFilesRef = useRef<File[] | null>(null);
  useEffect(() => {
    if (!open || !initialFiles || initialFiles.length === 0) return;
    if (initialFilesRef.current === initialFiles) return;
    initialFilesRef.current = initialFiles;
    addFiles(initialFiles);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialFiles]);
  useEffect(() => {
    if (!open) initialFilesRef.current = null;
  }, [open]);

  // Rotate reassurance copy while running.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setMessageIndex((i) => (i + 1) % REASSURANCE_MESSAGES.length);
    }, 2500);
    return () => clearInterval(id);
  }, [running]);

  function cancelAutoClose() {
    if (autoCloseRef.current) {
      clearTimeout(autoCloseRef.current);
      autoCloseRef.current = null;
    }
  }

  function addFiles(picked: File[] | FileList | null) {
    if (!picked || picked.length === 0) return;
    cancelAutoClose();

    const accepted = Array.from(picked);

    const next: Item[] = [];
    for (const file of accepted) {
      const ext = fileExt(file.name);
      const ok = ACCEPTED_EXTS.includes(ext) || file.type.startsWith("image/");
      const err = !ok ? "This format isn't supported." : null;
      next.push({
        id: crypto.randomUUID(),
        file,
        previewUrl: isHeic(file) || isSpecialRawFile(file) ? null : URL.createObjectURL(file),
        status: err ? "failed" : "queued",
        error: err,
      });
    }
    setItems((prev) => [...prev, ...next]);
    setFinished(false);
    const queuedIds = next.filter((i) => i.status === "queued").map((i) => i.id);
    if (queuedIds.length > 0) {
      setTimeout(() => {
        void runQueue(queuedIds);
      }, 0);
    }
  }

  function patch(id: string, p: Partial<Item>) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...p } : i)));
  }

  /**
   * Special RAW formats (DNG / Apple ProRAW) cannot be decoded by any browser,
   * and a single frame is ~85 MB. Those files skip the client pipeline: the raw
   * bytes go to a temporary source path and the background worker produces the
   * permanent "Optimized Original" (full-resolution JPEG) plus the usual
   * display/thumb variants, then deletes the source. Normal JPEG/HEIC uploads
   * never enter this branch.
   */
  async function uploadSpecialRaw(item: Item) {
    if (!eventId) return;
    // A previous attempt may have stored the RAW and row successfully but
    // failed while dispatching the background job. Retry that same row rather
    // than uploading the 80+ MB source or inserting another row again.
    if (item.uploadRowId) {
      patch(item.id, { status: "uploading", error: null });
      await requestOptimizedOriginal({ data: { eventId, uploadId: item.uploadRowId } });
      patch(item.id, { status: "done", error: null });
      return;
    }
    const photoId = crypto.randomUUID();
    const base = `${eventId}/${photoId}`;
    const ext = rawExtOf(item.file.name) || "dng";
    const sourcePath = `${base}/source.${ext}`;
    const originalPath = `${base}/original.jpg`;

    patch(item.id, { status: "uploading", error: null });
    // Large RAW sources exceed the standard object endpoint's size cap, so
    // they go through the resumable (TUS) endpoint instead.
    await uploadRawResumable({
      bucket: PHOTOS_BUCKET,
      path: sourcePath,
      file: item.file,
      contentType: item.file.type || "image/x-adobe-dng",
    });

    const { data: inserted, error: insErr } = await supabase
      .from("uploads")
      .insert({
        event_id: eventId,
        guest_name: guestName?.trim() ? guestName.trim() : null,
        // The permanent original is the optimized JPEG the worker will write.
        image_url: originalPath,
        file_hash: item.hash ?? null,
        guest_uuid: guestUuid ?? null,
        source_path: sourcePath,
        original_format: ext,
        original_size_bytes: item.file.size,
        optimize_status: "pending",
      })
      .select("id")
      .single();
    if (insErr) {
      const msg = (insErr.message || "").toLowerCase();
      if (
        msg.includes("duplicate") ||
        msg.includes("unique") ||
        (insErr as { code?: string }).code === "23505"
      ) {
        await supabase.storage.from(PHOTOS_BUCKET).remove([sourcePath]);
        patch(item.id, { status: "duplicate", error: null });
        return;
      }
      throw insErr;
    }
    const uploadId = inserted?.id as string | undefined;
    if (!uploadId) throw new Error("Upload could not be saved.");
    rememberMyUpload(eventId, uploadId);
    patch(item.id, { uploadRowId: uploadId, imagePath: originalPath });

    // The upload itself is complete once the RAW is safely in Storage.
    // Conversion continues on the worker in the background — the browser only
    // observes it, and giving up on polling never affects the worker job.
    await requestOptimizedOriginal({ data: { eventId, uploadId } });
    void (async () => {
      const deadline = Date.now() + 10 * 60 * 1000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 5000));
        try {
          const res = await getOptimizedOriginalStatus({ data: { eventId, uploadId } });
          if (res.status === "ready") {
            void queryClient.invalidateQueries();
            return;
          }
          if (res.status === "failed") return;
        } catch {
          /* transient — keep observing */
        }
      }
    })();

    patch(item.id, {
      status: "done",
      error: null,
      uploadRowId: uploadId,
      imagePath: originalPath,
    });
  }

  async function uploadOne(item: Item) {
    if (!eventId) return;
    try {
      if (isSpecialRawFile(item.file)) {
        await uploadSpecialRaw(item);
        return;
      }
      let file = item.file;
      if (isHeic(file)) {
        patch(item.id, { status: "preparing", error: null });
        try {
          file = await convertHeicToJpeg(file);
        } catch {
          throw new ImagePipelineError("format_unsupported", "This HEIC photo couldn't be converted.");
        }
      }
      patch(item.id, { status: "preparing", error: null });
      const prepared = await prepareUpload(file);

      const base = `${eventId}/${prepared.photoId}`;
      const originalPath = `${base}/original.${prepared.ext}`;
      patch(item.id, { status: "uploading", error: null });
      const displayType = prepared.display.blob.type || "image/webp";
      const t600Type = prepared.thumb600.blob.type || "image/webp";
      const t300Type = prepared.thumb300.blob.type || "image/webp";
      const results = await Promise.all([
        supabase.storage.from(PHOTOS_BUCKET).upload(originalPath, prepared.original.blob, {
          contentType: prepared.original.contentType,
          upsert: false,
          cacheControl: "31536000, immutable",
        }),
        supabase.storage.from(PHOTOS_BUCKET).upload(`${base}/display.webp`, prepared.display.blob, {
          contentType: displayType,
          upsert: true,
          cacheControl: "31536000, immutable",
        }),
        supabase.storage.from(PHOTOS_BUCKET).upload(`${base}/thumb_600.webp`, prepared.thumb600.blob, {
          contentType: t600Type,
          upsert: true,
          cacheControl: "31536000, immutable",
        }),
        supabase.storage.from(PHOTOS_BUCKET).upload(`${base}/thumb_300.webp`, prepared.thumb300.blob, {
          contentType: t300Type,
          upsert: true,
          cacheControl: "31536000, immutable",
        }),
      ]);
      for (const r of results) {
        if (r.error) throw r.error;
      }

      const { data: inserted, error: insErr } = await supabase
        .from("uploads")
        .insert({
          event_id: eventId,
          guest_name: guestName?.trim() ? guestName.trim() : null,
          image_url: originalPath,
          file_hash: item.hash ?? null,
          guest_uuid: guestUuid ?? null,
        })
        .select("id")
        .single();
      if (insErr) {
        const msg = (insErr.message || "").toLowerCase();
        if (
          msg.includes("duplicate") ||
          msg.includes("unique") ||
          (insErr as { code?: string }).code === "23505"
        ) {
          patch(item.id, { status: "duplicate", error: null });
          return;
        }
        throw insErr;
      }
      if (inserted?.id) rememberMyUpload(eventId, inserted.id);
      patch(item.id, {
        status: "done",
        error: null,
        uploadRowId: inserted?.id,
        imagePath: originalPath,
      });
    } catch (err) {
      let message = "This memory couldn't be shared.";
      if (err instanceof ImagePipelineError) message = err.message;
      else if (err instanceof Error && err.message) message = err.message;
      // eslint-disable-next-line no-console
      console.warn("[upload:failed]", { name: item.file.name, error: err });
      patch(item.id, { status: "failed", error: message });
    } finally {
      const preview = item.previewUrl;
      if (preview) {
        try {
          URL.revokeObjectURL(preview);
        } catch {
          /* noop */
        }
        patch(item.id, { previewUrl: null });
      }
    }
  }

  async function runQueue(targetIds?: string[]) {
    if (!eventId) return;
    runningRef.current = true;
    setRunning(true);
    setFinished(false);
    setMessageIndex(0);

    const snapshot = (await new Promise<Item[]>((res) =>
      setItems((prev) => {
        res(prev);
        return prev;
      }),
    )) as Item[];

    const ids = targetIds ?? snapshot.filter((i) => i.status === "queued").map((i) => i.id);
    const idSet = new Set(ids);
    const toHash = snapshot.filter((i) => idSet.has(i.id) && i.status !== "done");
    const hashes = await Promise.all(
      toHash.map(async (i) => {
        try {
          return i.hash ?? (await sha256Hex(i.file));
        } catch {
          return null;
        }
      }),
    );
    const hashById = new Map<string, string | null>();
    toHash.forEach((i, idx) => hashById.set(i.id, hashes[idx]));
    const validHashes = Array.from(new Set(hashes.filter((h): h is string => typeof h === "string")));
    const existing = new Set<string>();
    if (validHashes.length > 0) {
      const { data: existingRows } = await supabase
        .from("uploads")
        .select("file_hash")
        .eq("event_id", eventId)
        .in("file_hash", validHashes);
      existingRows?.forEach((r) => {
        if (r.file_hash) existing.add(r.file_hash);
      });
    }
    const seenInBatch = new Set<string>();
    setItems((prev) =>
      prev.map((it) => {
        if (!idSet.has(it.id)) return it;
        const h = hashById.get(it.id) ?? null;
        if (!h) return { ...it, hash: undefined };
        if (existing.has(h) || seenInBatch.has(h)) {
          return { ...it, hash: h, status: "duplicate", error: null };
        }
        seenInBatch.add(h);
        return { ...it, hash: h };
      }),
    );
    for (const id of ids) {
      const current = (await new Promise<Item | undefined>((res) =>
        setItems((prev) => {
          res(prev.find((i) => i.id === id));
          return prev;
        }),
      )) as Item | undefined;
      if (!current) continue;
      if (current.status === "done" || current.status === "duplicate") continue;
      await uploadOne(current);
    }
    runningRef.current = false;
    setRunning(false);
    setFinished(true);
    queryClient.invalidateQueries({ queryKey: ["uploads", eventId] });
  }

  const counts = useMemo(() => {
    let done = 0, failed = 0, queued = 0, active = 0, duplicate = 0;
    for (const i of items) {
      if (i.status === "done") done++;
      else if (i.status === "failed") failed++;
      else if (i.status === "queued") queued++;
      else if (i.status === "duplicate") duplicate++;
      else active++;
    }
    return { done, failed, queued, active, duplicate, total: items.length };
  }, [items]);

  const processed = counts.done + counts.duplicate + counts.failed;
  const overallPct =
    items.length === 0 ? 0 : Math.round((processed / items.length) * 100);
  const allDone =
    !running && finished && counts.queued === 0 && counts.active === 0;
  const sharedCount = counts.done + counts.duplicate;
  const hasFailures = counts.failed > 0;
  const completedIndex = Math.min(processed + 1, items.length);




  // Successfully-shared items in this session (available for the review view).
  const shared = useMemo(
    () =>
      items.filter(
        (i) => (i.status === "done" || i.status === "duplicate") && !!i.uploadRowId,
      ),
    [items],
  );

  // Sign thumbnails for the review view when we first show it.
  useEffect(() => {
    if (!reviewOpen) return;
    const paths = shared
      .filter((i) => !i.thumbUrl && i.imagePath)
      .map((i) => i.imagePath!) as string[];
    if (paths.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const map = await signVariantUrls(paths, "thumb_300");
        if (cancelled) return;
        setItems((prev) =>
          prev.map((it) => {
            if (!it.imagePath) return it;
            const url = map.get(it.imagePath);
            return url && !it.thumbUrl ? { ...it, thumbUrl: url } : it;
          }),
        );
      } catch {
        /* signing failed — review still renders without thumbnails */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reviewOpen, shared]);

  async function confirmRemove(item: Item) {
    if (!eventId || !guestUuid || !item.uploadRowId) return;
    setRemovingId(item.id);
    setRemoveError(null);
    const result = await deleteOwnUpload({
      eventId,
      uploadId: item.uploadRowId,
      guestUuid,
    });
    setRemovingId(null);
    setPendingRemoveId(null);
    if (result.ok) {
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      queryClient.invalidateQueries({ queryKey: ["uploads", eventId] });
    } else {
      setRemoveError(deleteReasonMessage(result.reason));
    }
  }



  function retryFailed() {
    cancelAutoClose();
    const failedIds = items.filter((i) => i.status === "failed").map((i) => i.id);
    if (failedIds.length === 0) return;
    setItems((prev) =>
      prev.map((i) =>
        failedIds.includes(i.id) ? { ...i, status: "queued", error: null } : i,
      ),
    );
    setFinished(false);
    setTimeout(() => {
      void runQueue(failedIds);
    }, 0);
  }


  if (!open) return null;

  const coupleName = eventName?.trim() || "the couple";
  void coupleName;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6 motion-safe:animate-[fade-in_220ms_ease-out_both]">
      <div
        className="absolute inset-0 bg-foreground/45 backdrop-blur-sm"
        onClick={running ? undefined : onClose}
      />
      <div className="relative z-10 flex w-full max-w-sm flex-col overflow-hidden rounded-[1.75rem] border border-border/60 bg-[color:var(--ivory)] shadow-[var(--shadow-soft)]">
        {!running && (
          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 z-10 rounded-full p-2 text-foreground/60 hover:text-foreground"
            aria-label="Close"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        )}

        <div className="px-7 py-10 sm:px-8 sm:py-12">
          {allDone && reviewOpen ? (
            <div className="motion-safe:animate-[fade-in_240ms_ease-out_both] text-center">
              <h3 className="text-display text-2xl sm:text-3xl">
                Your uploads
              </h3>
              <div className="mx-auto mt-4 h-px w-16 bg-foreground/25" />
              <p className="mt-4 text-sm text-foreground/75">
                Remove any photo you don't want to share.
              </p>

              {removeError && (
                <p className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {removeError}
                </p>
              )}

              <ul className="mt-6 grid grid-cols-3 gap-2">
                {shared.map((it) => {
                  const src = it.thumbUrl ?? it.previewUrl ?? null;
                  return (
                    <li
                      key={it.id}
                      className="relative aspect-square overflow-hidden rounded-xl bg-border/40"
                    >
                      {src ? (
                        <img
                          src={src}
                          alt="Your uploaded photo"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="h-full w-full animate-pulse" />
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setRemoveError(null);
                          setPendingRemoveId(it.id);
                        }}
                        disabled={removingId === it.id || !guestUuid}
                        className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-black/55 text-white shadow-sm backdrop-blur transition-colors hover:bg-black/70 disabled:opacity-40"
                        aria-label="Remove this photo"
                      >
                        {removingId === it.id ? (
                          <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                        ) : (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                          </svg>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>

              {shared.length === 0 && (
                <p className="mt-6 text-sm text-muted-foreground">
                  No uploads to review.
                </p>
              )}

              <div className="mt-8 flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setRemoveError(null);
                    if (shared.length === 0) {
                      onClose();
                    } else {
                      setReviewOpen(false);
                    }
                  }}
                  className="inline-flex w-full items-center justify-center rounded-full border border-primary/30 bg-transparent px-6 py-3.5 font-sans text-sm font-medium uppercase tracking-[0.2em] text-primary transition-colors hover:bg-primary/[0.04] active:bg-primary/[0.08]"
                >
                  Done
                </button>
              </div>
            </div>
          ) : allDone ? (
            <div className="text-center motion-safe:animate-[fade-in_280ms_ease-out_both]">
              <h3 className="text-display text-2xl sm:text-3xl">
                {sharedCount > 0
                  ? `${sharedCount} ${sharedCount === 1 ? "photo" : "photos"} uploaded successfully`
                  : "Photos uploaded successfully"}
              </h3>
              <div className="mx-auto mt-4 h-px w-16 bg-foreground/25" />
              {hasFailures ? (
                <p className="mt-4 mx-auto max-w-xs text-sm text-foreground/75 leading-relaxed">
                  {counts.failed} couldn't be uploaded.
                </p>
              ) : (
                <p className="mt-4 text-sm text-foreground/75">
                  Thank you for sharing your memories.
                </p>
              )}
              <div className="mt-8 flex flex-col gap-3">
                {shared.length > 0 && guestUuid && (
                  <button
                    type="button"
                    onClick={() => setReviewOpen(true)}
                    className="inline-flex w-full items-center justify-center rounded-full border border-primary/30 bg-transparent px-6 py-3.5 font-sans text-sm font-medium uppercase tracking-[0.2em] text-primary transition-colors hover:bg-primary/[0.04] active:bg-primary/[0.08]"
                  >
                    Review uploads
                  </button>
                )}
                {hasFailures ? (
                  <button
                    type="button"
                    onClick={retryFailed}
                    className="inline-flex w-full items-center justify-center rounded-full border border-primary/30 bg-transparent px-6 py-3.5 font-sans text-sm font-medium uppercase tracking-[0.2em] text-primary transition-colors hover:bg-primary/[0.04] active:bg-primary/[0.08]"
                  >
                    Retry failed
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onClose}
                    className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  >
                    Close
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center text-center motion-safe:animate-[fade-in_220ms_ease-out_both]">
              <h3 className="text-display text-2xl sm:text-3xl">
                Sharing your memories…
              </h3>
              <div className="mx-auto mt-4 h-px w-16 bg-foreground/25" />
              <p className="mt-4 text-sm text-foreground/75">
                {REASSURANCE_MESSAGES[messageIndex]}
              </p>
              {items.length > 0 && (
                <p className="mt-2 text-sm text-muted-foreground tabular-nums">
                  {completedIndex} of {items.length}
                </p>
              )}

              <div
                className="mt-8 h-[3px] w-full max-w-xs overflow-hidden rounded-full bg-border/60"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={overallPct}
              >
                <div
                  className="h-full rounded-full bg-[color:var(--dusty)] transition-[width] duration-500 ease-out"
                  style={{ width: `${Math.max(4, overallPct)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {pendingRemoveId && (
        <ConfirmRemoveDialog
          onCancel={() => setPendingRemoveId(null)}
          onConfirm={() => {
            const target = items.find((i) => i.id === pendingRemoveId);
            if (target) void confirmRemove(target);
          }}
          busy={removingId === pendingRemoveId}
        />
      )}
    </div>
  );
}

export function ConfirmRemoveDialog({
  onCancel,
  onConfirm,
  busy,
  title = "Remove this photo?",
  description = "This action cannot be undone.",
}: {
  onCancel: () => void;
  onConfirm: () => void;
  busy: boolean;
  title?: string;
  description?: string;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[110] flex items-center justify-center p-4 motion-safe:animate-[fade-in_180ms_ease-out_both]"
    >
      <div className="absolute inset-0 bg-foreground/55" onClick={busy ? undefined : onCancel} />
      <div className="relative z-10 w-full max-w-xs rounded-2xl bg-[color:var(--ivory)] p-6 shadow-[var(--shadow-soft)]">
        <h4 className="text-display text-lg text-foreground">{title}</h4>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-full px-5 py-2.5 text-sm font-medium text-foreground/80 hover:bg-border/30 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rounded-full bg-destructive px-5 py-2.5 text-sm font-medium text-[color:var(--ivory)] transition hover:opacity-90 disabled:opacity-60"
          >
            {busy ? "Removing…" : "Remove"}
          </button>
        </div>
      </div>
    </div>
  );
}


