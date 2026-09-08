import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

/**
 * Whether ANY mosaic row exists for this event. Once true, guests lose the
 * ability to remove their own uploads (see delete_own_upload RPC).
 */
export function useEventHasMosaic(eventId: string | null | undefined) {
  return useQuery({
    queryKey: ["event-has-mosaic", eventId],
    queryFn: async (): Promise<boolean> => {
      const { count, error } = await supabase
        .from("mosaics")
        .select("id", { count: "exact", head: true })
        .eq("event_id", eventId!);
      if (error) return false;
      return (count ?? 0) > 0;
    },
    enabled: !!eventId,
    staleTime: 60 * 1000,
  });
}
