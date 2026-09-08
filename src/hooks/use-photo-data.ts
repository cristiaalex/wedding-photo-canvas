import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { Upload } from "@/lib/database.types";
import { signVariantUrls, type PhotoVariant } from "@/lib/image-variants";
import { fetchAllUploads } from "@/lib/fetch-all-uploads";

// 55 min — Supabase signed URLs expire at 60 min, refresh just before.
const SIGNED_URL_STALE_MS = 55 * 60 * 1000;
const SIGNED_URL_GC_MS = 60 * 60 * 1000;

export function useEventUploads(eventId: string | null | undefined) {
  return useQuery({
    queryKey: ["uploads", eventId],
    queryFn: async (): Promise<Upload[]> => {
      return fetchAllUploads<Upload>(eventId!, {
        order: { column: "uploaded_at", ascending: false },
        logTag: "uploads",
      });
    },
    enabled: !!eventId,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });
}

export function useSignedPhotoUrls(
  paths: Array<string | null | undefined>,
  variant: PhotoVariant,
) {
  const stableKey = useMemo(() => {
    const cleaned = paths.filter(
      (p): p is string => typeof p === "string" && p.length > 0,
    );
    return cleaned.slice().sort().join("|");
  }, [paths]);

  return useQuery({
    queryKey: ["signed-photo-urls", variant, stableKey],
    queryFn: () => signVariantUrls(paths, variant),
    enabled: stableKey.length > 0,
    staleTime: SIGNED_URL_STALE_MS,
    gcTime: SIGNED_URL_GC_MS,
  });
}
