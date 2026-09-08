import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { attachExternalSupabaseAuth } from "./supabase-auth-attacher";

/** Enqueue (or re-enqueue) the RAW → Optimized Original conversion. Idempotent. */
export const requestOptimizedOriginal = createServerFn({ method: "POST" })
  .middleware([attachExternalSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ eventId: z.string().uuid(), uploadId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data }) => {
    const { requestOptimizedOriginalServer } = await import("./optimize.server");
    return requestOptimizedOriginalServer(data);
  });

/** Poll the optimization state of a single upload. */
export const getOptimizedOriginalStatus = createServerFn({ method: "POST" })
  .middleware([attachExternalSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ eventId: z.string().uuid(), uploadId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data }) => {
    const { getOptimizedOriginalStatusServer } = await import("./optimize.server");
    return getOptimizedOriginalStatusServer(data);
  });
