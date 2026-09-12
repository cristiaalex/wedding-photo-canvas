import { supabase, PHOTOS_BUCKET } from "@/lib/supabase";
import { generateMosaic } from "@/lib/mosaic-generator";
import { signVariantUrls } from "@/lib/image-variants";
import { fetchAllUploads } from "@/lib/fetch-all-uploads";

// Mosaic Pet: a pet collection is far smaller than an event collection.
// Ten memories is enough for the engine to build a convincing mosaic.
export const MIN_PHOTOS_FOR_MOSAIC = 10;
export const STALE_MS = 15 * 60 * 1000;

export type RunOptions = {
  eventId: string;
  coverImageUrl: string | null;
  onProgress?: (stage: string, pct: number) => void;
};

export type RunResult = { ok: true } | { ok: false; error: string };

/**
 * Run a full mosaic generation end-to-end. Encapsulates the legacy
 * MosaicPanel flow so the page can drive it without rendering the panel.
 */
export async function runMosaicGeneration({
  eventId,
  coverImageUrl,
  onProgress,
}: RunOptions): Promise<RunResult> {
  // Concurrency guard
  const { data: inflight } = await supabase
    .from("mosaics")
    .select("id,status,created_at")
    .eq("event_id", eventId)
    .eq("status", "processing")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (inflight) {
    const age = Date.now() - new Date(inflight.created_at).getTime();
    if (age < STALE_MS) {
      return { ok: false, error: "A generation is already in progress." };
    }
    const staleFailPayload = { status: "failed" };
    console.info("[mosaics-db-write:before]", {
      operation: "UPDATE",
      table: "public.mosaics",
      file: "src/lib/run-mosaic-generation.ts",
      function: "runMosaicGeneration",
      line: 41,
      match: { id: inflight.id },
      payload: staleFailPayload,
    });
    await supabase.from("mosaics").update(staleFailPayload).eq("id", inflight.id);
  }

  const insertPayload = {
    event_id: eventId,
    status: "processing",
    stage: "processing",
    progress: 0,
    print_status: null,
    dzi_status: null,
    deepzoom_ready: false,
    deepzoom_progress: 0,
    checkpoints: {},
  };
  console.info("[mosaics-db-write:before]", {
    operation: "INSERT",
    table: "public.mosaics",
    file: "src/lib/run-mosaic-generation.ts",
    function: "runMosaicGeneration",
    line: 44,
    payload: insertPayload,
  });
  const { data: inserted, error: insErr } = await supabase
    .from("mosaics")
    .insert(insertPayload)
    .select("id")
    .single();
  if (insErr || !inserted) {
    console.error("[mosaics-db-write:failed]", {
      operation: "INSERT",
      table: "public.mosaics",
      file: "src/lib/run-mosaic-generation.ts",
      function: "runMosaicGeneration",
      line: 44,
      payload: insertPayload,
      error: insErr,
    });
    return { ok: false, error: insErr?.message ?? "Failed to start mosaic" };
  }
  const mosaicId = inserted.id;

  try {
    if (!coverImageUrl) throw new Error("Event has no cover image");

    const uploads = await fetchAllUploads<{ image_url: string | null }>(
      eventId,
      { columns: "image_url", logTag: "mosaic" },
    );
    const rawPaths = uploads.map((u) => u.image_url).filter((s): s is string => Boolean(s));
    const httpUrls = rawPaths.filter((p) => /^https?:\/\//i.test(p));
    const storagePaths = rawPaths.filter((p) => !/^https?:\/\//i.test(p));
    const signedUrls: string[] = [];
    const urlToPath = new Map<string, string>();
    if (storagePaths.length > 0) {
      const signedMap = await signVariantUrls(storagePaths, "display", 60 * 60);
      for (const originalPath of storagePaths) {
        const signedUrl = signedMap.get(originalPath);
        if (signedUrl) {
          signedUrls.push(signedUrl);
          urlToPath.set(signedUrl, originalPath);
        }
      }
    }
    httpUrls.forEach((u) => urlToPath.set(u, u));
    const tileUrls = [...httpUrls, ...signedUrls];
    console.log(`[mosaic] generation start bucket=${PHOTOS_BUCKET} tiles=${tileUrls.length}`);

    if (tileUrls.length < MIN_PHOTOS_FOR_MOSAIC) {
      throw new Error(
        `Need at least ${MIN_PHOTOS_FOR_MOSAIC} photos (have ${tileUrls.length}).`,
      );
    }

    const { blob, previewBlob, thumbBlob, manifest, uniquePhotos } =
      await generateMosaic(coverImageUrl, tileUrls, {}, onProgress);
    manifest.tiles = manifest.tiles.map((t) => ({
      ...t,
      src: urlToPath.get(t.src) ?? t.src,
    }));

    const path = `${eventId}/${mosaicId}.jpg`;
    const previewPath = `${eventId}/${mosaicId}_preview.jpg`;
    const thumbPath = `${eventId}/${mosaicId}_thumb.jpg`;
    const [{ error: upErr1 }, { error: upErr2 }, { error: upErr3 }] = await Promise.all([
      supabase.storage.from("mosaics").upload(path, blob, {
        contentType: "image/jpeg",
        upsert: true,
        cacheControl: "31536000, immutable",
      }),
      supabase.storage.from("mosaics").upload(previewPath, previewBlob, {
        contentType: "image/jpeg",
        upsert: true,
        cacheControl: "31536000, immutable",
      }),
      supabase.storage.from("mosaics").upload(thumbPath, thumbBlob, {
        contentType: "image/jpeg",
        upsert: true,
        cacheControl: "31536000, immutable",
      }),
    ]);
    if (upErr1) throw upErr1;
    if (upErr2) throw upErr2;
    if (upErr3) throw upErr3;

    // Try update with completed_at first; if the column doesn't exist on
    // older schemas, retry without it.
    const completedAt = new Date().toISOString();
    const baseUpdate = {
      status: "ready" as const,
      mosaic_image_url: path,
      source_image_url: coverImageUrl,
      photo_count: uniquePhotos,
      tile_count: manifest.tiles.length,
      tiles_json: manifest,
    };
    const completePayload = { ...baseUpdate, completed_at: completedAt };
    console.info("[mosaics-db-write:before]", {
      operation: "UPDATE",
      table: "public.mosaics",
      file: "src/lib/run-mosaic-generation.ts",
      function: "runMosaicGeneration",
      line: 138,
      match: { id: mosaicId },
      payload: completePayload,
    });
    let { error: updErr } = await supabase
      .from("mosaics")
      .update(completePayload)
      .eq("id", mosaicId);
    if (updErr && /completed_at/i.test(updErr.message ?? "")) {
      console.warn("[mosaic] completed_at column missing — falling back");
      console.info("[mosaics-db-write:before]", {
        operation: "UPDATE",
        table: "public.mosaics",
        file: "src/lib/run-mosaic-generation.ts",
        function: "runMosaicGeneration",
        line: 144,
        match: { id: mosaicId },
        payload: baseUpdate,
      });
      ({ error: updErr } = await supabase
        .from("mosaics")
        .update(baseUpdate)
        .eq("id", mosaicId));
    }
    if (updErr) throw updErr;

    // Cleanup older mosaics for this event
    try {
      const { data: priorRows } = await supabase
        .from("mosaics")
        .select("id")
        .eq("event_id", eventId)
        .neq("id", mosaicId);
      const priorIds = (priorRows ?? []).map((r) => r.id);
      const { data: listed } = await supabase.storage.from("mosaics").list(eventId, { limit: 1000 });
      const toRemove = (listed ?? [])
        .map((o) => o.name)
        .filter((name) => !name.startsWith(mosaicId) && name !== "tmp")
        .map((name) => `${eventId}/${name}`);
      // Always sweep the tmp/ folder — temporary regen covers must not accumulate.
      const { data: tmpListed } = await supabase.storage
        .from("mosaics")
        .list(`${eventId}/tmp`, { limit: 1000 });
      const tmpToRemove = (tmpListed ?? []).map((o) => `${eventId}/tmp/${o.name}`);
      const allToRemove = [...toRemove, ...tmpToRemove];
      if (allToRemove.length > 0) await supabase.storage.from("mosaics").remove(allToRemove);
      if (priorIds.length > 0) await supabase.from("mosaics").delete().in("id", priorIds);
    } catch (cleanupErr) {
      console.warn("[mosaic] cleanup failed", cleanupErr);
    }

    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[mosaic] generation failed", e);
    const failPayload = { status: "failed" };
    console.info("[mosaics-db-write:before]", {
      operation: "UPDATE",
      table: "public.mosaics",
      file: "src/lib/run-mosaic-generation.ts",
      function: "runMosaicGeneration",
      line: 180,
      match: { id: mosaicId },
      payload: failPayload,
    });
    await supabase.from("mosaics").update(failPayload).eq("id", mosaicId);
    return { ok: false, error: msg };
  }
}
