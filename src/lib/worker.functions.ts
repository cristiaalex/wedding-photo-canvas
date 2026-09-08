import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const InputSchema = z.object({
  eventId: z.string().uuid(),
  mosaicId: z.string().uuid(),
  coverImageUrl: z.string().url(),
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

// External Supabase project (same project the browser client targets).
// Anon/publishable key is safe in code; it's the same key shipped to the client.
const EXTERNAL_SUPABASE_URL = "https://redjgmjkgdaplgsqjfrg.supabase.co";
const EXTERNAL_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_PjmSlDgNlKVPJ1J49xhwZg_Wxi5OfNH";

function isStorageUrl(url: string): boolean {
  // Allow only URLs served from our Supabase Storage (signed or public
  // object URLs), e.g. https://<project>.supabase.co/storage/v1/object/...
  return url.startsWith(`${EXTERNAL_SUPABASE_URL}/storage/v1/`);
}

function authedSupabase(token: string) {
  return createClient<Database>(
    EXTERNAL_SUPABASE_URL,
    EXTERNAL_SUPABASE_PUBLISHABLE_KEY,
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
  const workerUrl = process.env.WORKER_URL;
  const workerToken = process.env.WORKER_API_TOKEN;
  if (!workerUrl || !workerToken) {
    throw new Error("Worker is not configured (WORKER_URL / WORKER_API_TOKEN missing).");
  }
  return { url: `${workerUrl.replace(/\/$/, "")}${path}`, token: workerToken };
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
    let coverImageUrl = ev.cover_image_url ?? data.coverImageUrl;
    if (data.tempCoverImageUrl && isStorageUrl(data.tempCoverImageUrl)) {
      coverImageUrl = data.tempCoverImageUrl;
    }
    if (!coverImageUrl || !/^https?:\/\//i.test(coverImageUrl)) {
      throw new Error("Event has no valid cover image URL.");
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
