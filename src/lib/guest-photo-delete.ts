// Guest-only photo removal.
//
// Two-phase flow because Supabase blocks `DELETE FROM storage.objects` from
// SQL (error 42501 — "Use the Storage API instead"):
//
//   1. `prepare_own_upload_delete` RPC validates ownership + 24h + no-mosaic
//      and returns the storage paths that must be removed.
//   2. The app calls `supabase.storage.from('photos').remove(paths)`.
//   3. `finalize_own_upload_delete` RPC re-validates and deletes the
//      uploads row so realtime DELETE fires for every viewer.
//
// Used ONLY from the guest page (post-upload review + gallery lightbox
// overflow menu). Dashboard moderation is unchanged.

import { supabase } from "@/lib/supabase";
import { PHOTOS_BUCKET } from "@/lib/supabase";
import { forgetMyUpload } from "@/lib/guest-uploads";

export type DeleteReason =
  | "not_found"
  | "forbidden"
  | "expired"
  | "mosaic_generated"
  | "unknown";

export type DeleteResult = { ok: true } | { ok: false; reason: DeleteReason };

type PreparePayload = {
  ok?: boolean;
  reason?: DeleteReason;
  paths?: string[] | null;
} | null;

type FinalizePayload = { ok?: boolean; reason?: DeleteReason } | null;

export async function deleteOwnUpload(params: {
  eventId: string;
  uploadId: string;
  guestUuid: string;
}): Promise<DeleteResult> {
  // 1. Validate + fetch storage paths.
  const { data: prepData, error: prepError } = await supabase.rpc(
    "prepare_own_upload_delete" as never,
    {
      _upload_id: params.uploadId,
      _guest_uuid: params.guestUuid,
    } as never,
  );
  if (prepError) {
    console.warn("[delete_own_upload] prepare rpc error", prepError);
    return { ok: false, reason: "unknown" };
  }
  const prep = prepData as PreparePayload;
  if (!prep?.ok) {
    return { ok: false, reason: prep?.reason ?? "unknown" };
  }

  // 2. Remove every storage object under {event_id}/{photo_id}/ via the
  //    Storage API. Storage errors are logged but do not block the row
  //    delete — orphaned objects are far less harmful than an undeletable
  //    photo card, and the organizer dashboard can still moderate.
  const paths = Array.isArray(prep.paths) ? prep.paths.filter(Boolean) : [];
  if (paths.length > 0) {
    const { error: storageError } = await supabase.storage
      .from(PHOTOS_BUCKET)
      .remove(paths);
    if (storageError) {
      console.warn("[delete_own_upload] storage.remove error", storageError);
    }
  }

  // 3. Delete the uploads row — triggers realtime DELETE for all viewers.
  const { data: finData, error: finError } = await supabase.rpc(
    "finalize_own_upload_delete" as never,
    {
      _upload_id: params.uploadId,
      _guest_uuid: params.guestUuid,
    } as never,
  );
  if (finError) {
    console.warn("[delete_own_upload] finalize rpc error", finError);
    return { ok: false, reason: "unknown" };
  }
  const fin = finData as FinalizePayload;
  if (!fin?.ok) {
    return { ok: false, reason: fin?.reason ?? "unknown" };
  }

  forgetMyUpload(params.eventId, params.uploadId);
  return { ok: true };
}

export function deleteReasonMessage(reason: DeleteReason): string {
  switch (reason) {
    case "expired":
      return "The 24-hour window to remove this photo has passed.";
    case "mosaic_generated":
      return "The mosaic has already been generated — photos can no longer be removed.";
    case "forbidden":
      return "This photo can't be removed from this device.";
    case "not_found":
      return "This photo no longer exists.";
    default:
      return "Something went wrong. Please try again.";
  }
}
