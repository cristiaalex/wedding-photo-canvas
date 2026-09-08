import { createClient } from "@supabase/supabase-js";
import { getRequest } from "@tanstack/react-start/server";
import type { Database } from "./database.types";
import { PET_SUPABASE_URL, PET_SUPABASE_PUBLISHABLE_KEY } from "./pet-config";
import { petWorkerEndpoint } from "./pet-env.server";

type OptimizeInput = { eventId: string; uploadId: string };

function createRequestClient(bearer: string | null) {
  const key = PET_SUPABASE_PUBLISHABLE_KEY;
  return createClient<Database>(PET_SUPABASE_URL, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    global: {
      headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (!bearer && key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) {
          headers.delete("Authorization");
        }
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      },
    },
  });
}

async function requestSupabase(eventId: string) {
  // Read the header from the active server-function Request. This is the same
  // path used by the working authenticated mosaic-worker calls and avoids
  // relying on an indirect header accessor after the dynamic server import.
  const authorization = getRequest().headers.get("authorization") ?? "";
  const bearer = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : null;
  const client = createRequestClient(bearer);

  if (!bearer) return { client, authenticated: false as const };

  // A present bearer token changes this into the private owner path. Validate
  // it with Auth first, then prove that its subject owns the requested event.
  // Never fall back to anonymous access when a caller supplied an invalid token.
  const { data: userData, error: userError } = await client.auth.getUser(bearer);
  const userId = userData.user?.id;
  if (userError || !userId) {
    console.error("[optimize:owner-auth-failed]", {
      eventId,
      message: userError?.message ?? "No authenticated user returned",
    });
    throw new Error("Unauthorized: invalid organizer session.");
  }

  const { data: event, error: eventError } = await client
    .from("events")
    .select("id")
    .eq("id", eventId)
    .eq("organizer_id", userId)
    .maybeSingle();
  if (eventError || !event) {
    console.error("[optimize:owner-check-failed]", {
      eventId,
      userId,
      message: eventError?.message ?? "No owned event returned",
    });
    throw new Error("Not authorized for this event.");
  }

  return { client, authenticated: true as const };
}

async function callWorker(path: string, body: unknown) {
  const { url: endpoint, token: workerToken } = petWorkerEndpoint(path);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${workerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text().catch(() => "");
  if (!response.ok && response.status !== 202) {
    throw new Error(`Worker error (${response.status}): ${text || response.statusText}`);
  }
}

export async function requestOptimizedOriginalServer(data: OptimizeInput) {
  const { client, authenticated } = await requestSupabase(data.eventId);

  // The authenticated organizer was already validated against this event in
  // requestSupabase(). Dispatch directly to the trusted worker instead of
  // making the trigger depend on a second owner-row SELECT/UPDATE through RLS.
  // The worker verifies that uploadId belongs to eventId before enqueueing and
  // uses a stable `optimize-${uploadId}` job id, so retries stay idempotent.
  // This is deliberately owner-only; anonymous uploads retain the existing
  // row-level lookup below.
  if (authenticated) {
    await callWorker("/optimize", data);
    return { status: "processing" as const };
  }

  const { data: row, error: lookupError } = await client
    .from("uploads")
    .select("id, event_id, uploaded_by_owner, optimize_status, optimize_error, source_path")
    .eq("id", data.uploadId)
    .eq("event_id", data.eventId)
    .maybeSingle();

  if (lookupError) {
    console.error("[optimize:lookup-failed]", {
      uploadId: data.uploadId,
      message: lookupError.message,
    });
    throw new Error("The optimization request could not verify this upload.");
  }
  if (!row) throw new Error("Upload not found or access denied.");
  if (row.optimize_status === "ready") return { status: "ready" as const };
  if (!row.optimize_status || !row.source_path)
    throw new Error("This upload does not need optimization.");
  if (row.optimize_status === "processing") {
    return { status: "processing" as const };
  }

  // A private owner row must never become reachable through this anonymous
  // branch. Authenticated owner requests have already returned above.
  if (row.uploaded_by_owner) throw new Error("Authentication is required for this private upload.");

  try {
    await callWorker("/optimize", data);
    return { status: "processing" as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown worker error";
    console.error("[optimize:dispatch-failed]", {
      uploadId: data.uploadId,
      eventId: data.eventId,
      message,
    });
    throw new Error("The optimization job could not be started. Please retry.");
  }
}

export async function getOptimizedOriginalStatusServer(data: OptimizeInput) {
  const { client } = await requestSupabase(data.eventId);
  const { data: row, error } = await client
    .from("uploads")
    .select("id, optimize_status, optimize_error, optimized_size_bytes")
    .eq("id", data.uploadId)
    .eq("event_id", data.eventId)
    .maybeSingle();
  if (error) throw new Error("The optimization status could not be read.");
  if (!row) throw new Error("Upload not found or access denied.");
  return {
    status: row.optimize_status ?? null,
    error: row.optimize_error ?? null,
    optimizedBytes: row.optimized_size_bytes ?? null,
  };
}
