import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const InputSchema = z.object({
  eventId: z.string().uuid(),
  mosaicId: z.string().uuid(),
  // Either an absolute URL or a Storage object path inside the Pet project's
  // private photo area (the Pet main-photo case).
  coverImageUrl: z.string().min(1).optional(),
  /**
   * Optional one-shot override of the cover image (used by the
   * "upload another image" branch of Regenerate Mosaic). Accepted only
   * when it points to a URL inside the project's own Supabase Storage
   * to prevent SSRF.
   */
  tempCoverImageUrl: z.string().url().optional(),
});

// Note: print is now auto-generated as part of the main generate flow
// (Job C runs immediately after Job A on the worker); there is no
// separate client-triggered print endpoint anymore.

// Pet Supabase project (same project the browser client targets). All values
// come from the single Pet configuration source — nothing hard-coded here.
import {
  PET_SUPABASE_URL,
  PET_SUPABASE_PUBLISHABLE_KEY,
  isPetStorageUrl,
} from "./pet-config";

function isStorageUrl(url: string): boolean {
  // Allow only URLs served from the Pet project's own Storage (signed or
  // public object URLs) to prevent SSRF.
  return isPetStorageUrl(url);
}

function authedSupabase(token: string) {
  return createClient<Database>(
    PET_SUPABASE_URL,
    PET_SUPABASE_PUBLISHABLE_KEY,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    },
  );
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
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user?.id) {
    throw new Error("Unauthorized: invalid session");
  }
  return { supabase, userId: userData.user.id };
}

async function workerEndpoint(path: string): Promise<{ url: string; token: string }> {
  const { petWorkerEndpoint } = await import("./pet-env.server");
  return petWorkerEndpoint(path);
}

/**
 * Fire-and-forget trigger for the Railway mosaic worker (interactive job).
 *
 * Auth: requires a signed-in user who owns the target event.
 *
 * The cover URL forwarded to the worker is normally the one stored on the
 * event row. If the caller supplies `tempCoverImageUrl` AND that URL points
 * into the project's own Supabase Storage, we forward that instead — this
 * is the path used by Regenerate Mosaic's "upload another image" option.
 */
export const triggerMosaicWorker = createServerFn({ method: "POST" })
  .inputValidator((data) => InputSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabase, userId } = await requireBearerUser();

    // ---- Ownership: caller must own the event; mosaic must belong to it.
    const { data: ev, error: evErr } = await supabase
      .from("events")
      .select("id, cover_image_url, organizer_id")
      .eq("id", data.eventId)
      .eq("organizer_id", userId)
      .maybeSingle();
    if (evErr || !ev) {
      throw new Error("Not authorized for this event.");
    }

    const { data: mosaic, error: mErr } = await supabase
      .from("mosaics")
      .select("id, event_id")
      .eq("id", data.mosaicId)
      .eq("event_id", data.eventId)
      .maybeSingle();
    if (mErr || !mosaic) {
      throw new Error("Not authorized for this mosaic.");
    }

    // ---- Cover URL selection ----------------------------------------------
    // tempCoverImageUrl is honored only when it lives inside our own Storage,
    // so an attacker cannot coerce the worker into fetching arbitrary URLs.
    let coverImageUrl = ev.cover_image_url ?? data.coverImageUrl ?? "";
    if (data.tempCoverImageUrl && isStorageUrl(data.tempCoverImageUrl)) {
      coverImageUrl = data.tempCoverImageUrl;
    }
    if (!coverImageUrl) {
      throw new Error("Choose a main pet photo before creating your preview.");
    }

    // The Pet main photo lives in the private source-photo area, so the value
    // stored on the project is an object path, not a URL. Sign it (as the
    // owner, so RLS still applies) before handing it to the processing service.
    if (!/^https?:\/\//i.test(coverImageUrl)) {
      const { PET_PHOTOS_BUCKET } = await import("./pet-config");
      const objectPath = coverImageUrl.replace(/^\/+/, "");
      const { data: signed, error: signErr } = await supabase.storage
        .from(PET_PHOTOS_BUCKET)
        .createSignedUrl(objectPath, 60 * 60 * 6);
      if (signErr || !signed?.signedUrl) {
        throw new Error("Could not read the main pet photo. Please pick it again.");
      }
      coverImageUrl = signed.signedUrl;
    }

    const { url: endpoint, token: workerToken } = await workerEndpoint("/generate");
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${workerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        eventId: data.eventId,
        mosaicId: data.mosaicId,
        coverImageUrl,
      }),
    });

    if (res.status !== 202 && !res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Worker rejected job (${res.status}): ${text || res.statusText}`);
    }

    return { ok: true as const, status: res.status };
  });

// (Removed) triggerMosaicPrintWorker — the print variant is now produced
// automatically by the worker as part of the main generate flow (Job C
// runs right after Job A off the same 24k master). The frontend just
// polls `mosaics.print_status` / `print_url` and shows the Download
// Print button when ready.

const CancelSchema = z.object({
  eventId: z.string().uuid(),
  mosaicId: z.string().uuid(),
});

/**
 * Hard-stop a running generation on the Railway worker.
 *
 * Marking the row `failed` from the browser only stops DB writes — the
 * worker keeps burning CPU and collides with the next Regenerate. This
 * tells the worker to drop queued jobs for the mosaic and abort the
 * in-flight pipeline at its next checkpoint.
 */
export const cancelMosaicWorker = createServerFn({ method: "POST" })
  .inputValidator((data) => CancelSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabase, userId } = await requireBearerUser();

    const { data: ev, error: evErr } = await supabase
      .from("events")
      .select("id, organizer_id")
      .eq("id", data.eventId)
      .eq("organizer_id", userId)
      .maybeSingle();
    if (evErr || !ev) throw new Error("Not authorized for this event.");

    const { url: endpoint, token: workerToken } = await workerEndpoint("/cancel");
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${workerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ eventId: data.eventId, mosaicId: data.mosaicId }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Worker refused cancel (${res.status}): ${text || res.statusText}`);
    }
    return { ok: true as const };
  });
