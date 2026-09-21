import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import {
  PET_SUPABASE_URL,
  PET_SUPABASE_PUBLISHABLE_KEY,
  PET_MOSAICS_BUCKET,
} from "./pet-config";

/**
 * Mosaic Pet — authorization boundary for the FINAL (purchased) print file.
 *
 * The browser must never sign `print.jpg` itself: storage RLS only proves
 * ownership, not payment. This server function is the single place where the
 * final download link is minted, and it re-reads every fact from the database
 * (ownership, payment state, print availability, object path). Nothing from
 * the client is trusted except the project id, which is then matched against
 * the caller's own projects.
 *
 * Preview / zoom / DZI signing is intentionally NOT routed through here — the
 * free preview stays available to the owner before purchase.
 */

const InputSchema = z.object({
  eventId: z.string().uuid(),
});

/** Short-lived on purpose: the link is used immediately by the download click. */
const SIGNED_URL_TTL_SECONDS = 5 * 60;

function authedSupabase(token: string) {
  return createClient<Database>(PET_SUPABASE_URL, PET_SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

async function requireBearerUser() {
  const request = getRequest();
  const authHeader = request?.headers?.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    throw new Error("Unauthorized: missing bearer token");
  }
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) throw new Error("Unauthorized: empty bearer token");
  const supabase = authedSupabase(token);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user?.id) throw new Error("Unauthorized: invalid session");
  return { supabase, userId: data.user.id };
}

/** Converts a stored value (absolute URL or path) into a bucket-relative path. */
function toStoragePath(value: string): string | null {
  let path = value;
  if (/^https?:\/\//.test(value)) {
    const match = value.match(
      new RegExp(`/${PET_MOSAICS_BUCKET}/(.+)$`),
    );
    if (!match) return null;
    path = match[1];
  }
  path = path.replace(/^\/+/, "").split("?")[0];
  return path || null;
}

export const getFinalMosaicDownloadUrl = createServerFn({ method: "POST" })
  .inputValidator((data) => InputSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabase, userId } = await requireBearerUser();

    // 1. Ownership — the project must belong to the authenticated caller.
    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("id, organizer_id, payment_status, download_expires_at")
      .eq("id", data.eventId)
      .eq("organizer_id", userId)
      .maybeSingle();
    if (eventError || !event) {
      throw new Error("Not authorized for this mosaic.");
    }

    // 2. Payment — server-side truth, never the browser's word.
    if (event.payment_status !== "paid") {
      throw new Error("This mosaic has not been purchased yet.");
    }

    // 3. Retention window, when one is configured.
    if (
      event.download_expires_at &&
      new Date(event.download_expires_at).getTime() < Date.now()
    ) {
      throw new Error("This download link has expired.");
    }

    // 4. Final print availability — resolved from the database only.
    const { data: mosaic, error: mosaicError } = await supabase
      .from("mosaics")
      .select("id, event_id, print_url, print_status, final_available")
      .eq("event_id", data.eventId)
      .eq("print_status", "ready")
      .not("print_url", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (mosaicError || !mosaic?.print_url) {
      throw new Error("Your final mosaic is not ready yet.");
    }

    // 5. Object path is derived server-side and must stay inside this project.
    const path = toStoragePath(mosaic.print_url);
    if (!path || path.split("/")[0] !== data.eventId) {
      throw new Error("Your final mosaic is not ready yet.");
    }

    const { data: signed, error: signError } = await supabase.storage
      .from(PET_MOSAICS_BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS, {
        download: `mosaic-print-${data.eventId}.jpg`,
      });
    if (signError || !signed?.signedUrl) {
      throw new Error("Could not prepare your download just now.");
    }

    return { url: signed.signedUrl, expiresInSeconds: SIGNED_URL_TTL_SECONDS };
  });
