// Paginated fetch for the `uploads` table.
//
// PostgREST enforces a default max-rows of 1000 per request. An unbounded
// `.select()` silently truncates results, which previously capped mosaic
// input and the live photo counter at 1000 even when the event had more
// photos. This helper pages through ALL rows for an event.

import { supabase } from "@/lib/supabase";
import type { Upload } from "@/lib/database.types";

const PAGE_SIZE = 500;

export type UploadColumns =
  | "*"
  | "image_url"
  | "id,image_url"
  | "id,event_id,guest_name,image_url,file_hash,uploaded_at";

export async function fetchAllUploads<T = Upload>(
  eventId: string,
  options: {
    columns?: string;
    order?: { column: string; ascending: boolean };
    logTag?: string;
  } = {},
): Promise<T[]> {
  const columns = options.columns ?? "*";
  const all: T[] = [];
  let page = 0;
  const tag = options.logTag ?? "mosaic";

  while (true) {
    let q = supabase
      .from("uploads")
      .select(columns)
      .eq("event_id", eventId)
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (options.order) {
      q = q.order(options.order.column, { ascending: options.order.ascending });
    }
    const { data, error } = await q;
    if (error) throw error;
    const rows = (data ?? []) as unknown as T[];
    console.log(`[${tag}] uploadsFetched=${rows.length} (page ${page + 1})`);
    if (rows.length === 0) break;
    all.push(...rows);
    if (rows.length < PAGE_SIZE) {
      page++;
      break;
    }
    page++;
  }

  console.log(`[${tag}] pagesFetched=${page}`);
  console.log(`[${tag}] totalPhotosUsed=${all.length}`);
  return all;
}
