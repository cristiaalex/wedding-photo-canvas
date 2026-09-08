/**
 * Owner-only "Download All Photos" server functions.
 *
 * These are thin wrappers: ownership is verified with the caller's bearer
 * token, then the existing Railway worker (same WORKER_URL / WORKER_API_TOKEN
 * used by Mosaic generation) does the privileged work.
 */

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const EXTERNAL_SUPABASE_URL = "https://redjgmjkgdaplgsqjfrg.supabase.co";
const EXTERNAL_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_PjmSlDgNlKVPJ1J49xhwZg_Wxi5OfNH";

function authedSupabase(token: string) {
  return createClient<Database>(EXTERNAL_SUPABASE_URL, EXTERNAL_SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

async function requireOwner(eventId: string) {
  const request = getRequest();
  const authHeader = request?.headers?.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) throw new Error("Unauthorized");
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) throw new Error("Unauthorized");
  const supabase = authedSupabase(token);
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user?.id) throw new Error("Unauthorized");
  const { data: ev } = await supabase
    .from("events")
    .select("id, organizer_id")
    .eq("id", eventId)
    .eq("organizer_id", userData.user.id)
    .maybeSingle();
  if (!ev) throw new Error("Not authorized for this event.");
  return { supabase, userId: userData.user.id };
}

function workerEndpoint(path: string) {
  const workerUrl = process.env["WORKER_URL"];
  const workerToken = process.env["WORKER_API_TOKEN"];
  if (!workerUrl || !workerToken) throw new Error("Worker is not configured.");
  return { url: `${workerUrl.replace(/\/$/, "")}${path}`, token: workerToken };
}

async function callWorker(path: string, body: unknown) {
  const { url, token } = workerEndpoint(path);
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok && res.status !== 202) {
    throw new Error(`Worker error (${res.status}): ${text || res.statusText}`);
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const EventInput = z.object({ eventId: z.string().uuid() });
const BatchInput = z.object({ eventId: z.string().uuid(), batchId: z.string().uuid() });

/**
 * "Download All Photos".
 *
 * Creates AT MOST one new batch containing only the uploads that are not yet
 * part of any batch. When nothing is new, no batch and no ZIP job is created.
 */
export const requestDownloadArchive = createServerFn({ method: "POST" })
  .inputValidator((data) => EventInput.parse(data))
  .handler(async ({ data }) => {
    const { supabase } = await requireOwner(data.eventId);

    const { data: batch, error } = await supabase.rpc("create_download_batch", {
      _event_id: data.eventId,
    });
    if (error) throw new Error(error.message);

    if (!batch) return { created: false as const };

    await callWorker("/archive", { eventId: data.eventId, batchId: batch.id });
    return { created: true as const, batchId: batch.id, batchNumber: batch.batch_number };
  });

/** Retry a failed archive — same batch, same membership, no duplicate. */
export const retryDownloadArchive = createServerFn({ method: "POST" })
  .inputValidator((data) => BatchInput.parse(data))
  .handler(async ({ data }) => {
    await requireOwner(data.eventId);
    await callWorker("/archive", { eventId: data.eventId, batchId: data.batchId });
    return { ok: true as const };
  });

/** Lazily sign a completed archive, only when the owner clicks Download. */
export const getDownloadArchiveUrl = createServerFn({ method: "POST" })
  .inputValidator((data) => BatchInput.parse(data))
  .handler(async ({ data }) => {
    await requireOwner(data.eventId);
    const res = await callWorker("/archive-url", {
      eventId: data.eventId,
      batchId: data.batchId,
    });
    const url = typeof res["url"] === "string" ? (res["url"] as string) : null;
    if (!url) throw new Error("Archive is not ready yet.");
    return { url };
  });
