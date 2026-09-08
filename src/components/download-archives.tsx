import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, Loader2, RotateCcw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { DownloadBatch } from "@/lib/database.types";
import {
  getDownloadArchiveUrl,
  requestDownloadArchive,
  retryDownloadArchive,
} from "@/lib/archive.functions";
import { cn } from "@/lib/utils";

/**
 * Owner-only "Download all photos".
 *
 * Incremental by design: each click archives ONLY the photos that are not yet
 * part of an existing archive. Nothing is generated automatically, and no
 * previous archive is ever rebuilt.
 */
export function DownloadArchives({ eventId }: { eventId: string | null }) {
  const qc = useQueryClient();
  const requestFn = useServerFn(requestDownloadArchive);
  const retryFn = useServerFn(retryDownloadArchive);
  const signFn = useServerFn(getDownloadArchiveUrl);

  const [notice, setNotice] = useState<string | null>(null);

  const batchesQuery = useQuery({
    queryKey: ["download-batches", eventId],
    enabled: !!eventId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("download_batches")
        .select("*")
        .eq("event_id", eventId!)
        .order("batch_number", { ascending: true });
      if (error) throw error;
      return (data ?? []) as DownloadBatch[];
    },
    refetchInterval: (query) => {
      const rows = (query.state.data ?? []) as DownloadBatch[];
      return rows.some((b) => b.status === "pending" || b.status === "processing") ? 4000 : false;
    },
  });

  const batches = batchesQuery.data ?? [];
  const busy = batches.some((b) => b.status === "pending" || b.status === "processing");

  const prepare = useMutation({
    mutationFn: async () => requestFn({ data: { eventId: eventId! } }),
    onSuccess: (res) => {
      setNotice(res.created ? null : "All your photos are already in the archives below.");
      void qc.invalidateQueries({ queryKey: ["download-batches", eventId] });
    },
    onError: (err: unknown) =>
      setNotice(err instanceof Error ? err.message : "Could not start the download."),
  });

  const retry = useMutation({
    mutationFn: async (batchId: string) => retryFn({ data: { eventId: eventId!, batchId } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["download-batches", eventId] }),
  });

  const [signingId, setSigningId] = useState<string | null>(null);
  const download = useCallback(
    async (batch: DownloadBatch) => {
      if (!eventId) return;
      setSigningId(batch.id);
      try {
        const { url } = await signFn({ data: { eventId, batchId: batch.id } });
        window.location.href = url;
      } catch (err) {
        setNotice(err instanceof Error ? err.message : "Could not prepare the download link.");
      } finally {
        setSigningId(null);
      }
    },
    [eventId, signFn],
  );

  // Deep link from the dashboard Quick action ("Download originals").
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash !== "#download-all") return;
    const t = window.setTimeout(() => {
      document.getElementById("download-all")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 300);
    return () => window.clearTimeout(t);
  }, [eventId]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(t);
  }, [notice]);

  if (!eventId) return null;

  return (
    <section id="download-all" className="scroll-mt-28 border-t border-border/60 pt-8 md:pt-12">
      <p className="text-eyebrow">Download</p>
      <h2 className="text-display mt-3 text-2xl md:text-3xl">Download all photos</h2>
      <p className="mt-3 max-w-md text-sm text-muted-foreground">
        Original files, exactly as they were uploaded.
      </p>

      <button
        type="button"
        onClick={() => prepare.mutate()}
        disabled={prepare.isPending || busy}
        className={cn(
          "mt-6 inline-flex items-center gap-2 rounded-full border border-border bg-[color:var(--ivory)] px-5 py-2.5 text-sm text-foreground transition-colors",
          "hover:border-primary/40 hover:bg-[color:var(--champagne)]/35",
          (prepare.isPending || busy) && "cursor-not-allowed opacity-60",
        )}
      >
        {prepare.isPending || busy ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Preparing your download…
          </>
        ) : (
          <>
            <Download className="h-4 w-4" />
            Download all photos
          </>
        )}
      </button>

      {notice && <p className="mt-3 text-xs text-muted-foreground">{notice}</p>}

      {batches.length > 0 && (
        <>
          <p className="mt-8 text-xs text-muted-foreground">
            {batches.length === 1
              ? "Your photos are available in 1 archive."
              : `Your photos are available in ${batches.length} archives.`}
          </p>
          <ul className="mt-3 flex flex-col gap-2.5">
            {batches.map((b) => (
              <li
                key={b.id}
                className="flex flex-col gap-3 rounded-2xl surface-fade p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="font-sans text-sm text-foreground">Archive {b.batch_number}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {b.photo_count.toLocaleString()} {b.photo_count === 1 ? "photo" : "photos"}
                    {b.status === "completed" && b.size_bytes ? ` · ${formatBytes(b.size_bytes)}` : ""}
                  </p>
                </div>

                {b.status === "completed" ? (
                  <button
                    type="button"
                    onClick={() => download(b)}
                    disabled={signingId === b.id}
                    className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-border bg-[color:var(--ivory)] px-4 py-2 text-xs uppercase tracking-[0.14em] text-foreground transition-colors hover:border-primary/40 hover:bg-[color:var(--champagne)]/35"
                  >
                    {signingId === b.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5" />
                    )}
                    Download
                  </button>
                ) : b.status === "failed" ? (
                  <div className="flex shrink-0 flex-wrap items-center gap-3">
                    <span className="text-xs text-muted-foreground">Download preparation failed</span>
                    <button
                      type="button"
                      onClick={() => retry.mutate(b.id)}
                      disabled={retry.isPending}
                      className="inline-flex items-center gap-2 rounded-full border border-border bg-[color:var(--ivory)] px-4 py-2 text-xs uppercase tracking-[0.14em] text-foreground transition-colors hover:border-primary/40 hover:bg-[color:var(--champagne)]/35"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Retry
                    </button>
                  </div>
                ) : (
                  <span className="inline-flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Preparing download…
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}
