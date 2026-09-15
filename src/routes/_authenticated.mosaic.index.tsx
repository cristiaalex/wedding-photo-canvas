import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import {
  Sparkles,
  ExternalLink,
  Download,
  RefreshCw,
  ImageIcon,
  Printer,
  Upload as UploadIcon,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { BillingCard } from "@/components/billing-card";
import { PageStack } from "@/components/page-layout";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { isTrialPlan } from "@/lib/trial";
import { MIN_PHOTOS_FOR_MOSAIC } from "@/lib/run-mosaic-generation";

// Premium plan cap: keep the current mosaic plus the previous two generations.
// Configurable so future subscription tiers can raise it.
const MAX_MOSAIC_HISTORY = 3;
import { triggerMosaicWorker, cancelMosaicWorker } from "@/lib/worker.functions";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

import type { Event, Mosaic, MosaicStatus } from "@/lib/database.types";


export const Route = createFileRoute("/_authenticated/mosaic/")({
  head: () => ({
    meta: [
      { title: "Your Pet Mosaic Preview — Mosaic Pet" },
      {
        name: "description",
        content: "Preview and explore the pet portrait made from your favorite memories.",
      },
      { property: "og:title", content: "Your Pet Mosaic Preview — Mosaic Pet" },
      { property: "og:description", content: "Preview and explore the pet portrait made from your favorite memories." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MosaicPage,
});

/* ------------------------------------------------------------------ */

type MosaicRow = Mosaic & {
  preview_image_url?: string | null;
  thumb_image_url?: string | null;
};

type SignedMosaic = {
  row: MosaicRow;
  previewSrc: string | null;
  thumbSrc: string | null;
};

// (Removed top-level STALE_MS: client no longer auto-fails long-running jobs.)


// Terminal "completed" statuses emitted by the worker. `deepzoom_ready` is
// the final state after the deep-zoom pyramid is built; `ready` is the
// earlier state when the base mosaic image is available. Either counts as
// a finished generation for UI purposes.
const isCompletedStatus = (s: MosaicStatus | null | undefined) =>
  s === "ready" || s === "deepzoom_ready";

// Any in-flight status emitted by the worker between enqueue and completion.
// The worker progresses through queued → fetching → analyzing → building →
// uploading → finalizing → ready. `finalizing` means Job A is done but the
// downstream Deep Zoom / Print Upload jobs are still running — the mosaic
// is NOT yet user-visible as ready. We also keep the legacy "processing",
// "pending", "deepzoom", and "deepzoom_ready" values for backwards compat
// with rows written by older workers.
const PROCESSING_STATUSES = new Set<string>([
  "pending",
  "queued",
  "processing",
  "fetching",
  "analyzing",
  "building",
  "uploading",
  "finalizing",
  "deepzoom",
]);
const isProcessingStatus = (s: MosaicStatus | null | undefined) =>
  !!s && PROCESSING_STATUSES.has(s);
const PROCESSING_STATUS_VALUES = Array.from(PROCESSING_STATUSES);

// isStaleProcessingRow removed — see note above.


function MosaicPage() {
  const navigate = useNavigate();
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [photoCount, setPhotoCount] = useState(0);
  const [contributors, setContributors] = useState(0);
  const [mosaics, setMosaics] = useState<SignedMosaic[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [viewing, setViewing] = useState<SignedMosaic | null>(null);
  // Interactive viewer is wired directly; no defensive coming-soon dialog needed.
  const [crafting, setCrafting] = useState(false);
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const studioRef = useRef<HTMLDivElement | null>(null);
  const autoStarted = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!userData.user) {
        setLoading(false);
        return;
      }
      const { data: events } = await supabase
        .from("events")
        .select("*")
        .eq("organizer_id", userData.user.id)
        .order("created_at", { ascending: false })
        .limit(1);
      if (cancelled) return;
      if (!events || events.length === 0) {
        navigate({ to: "/create", replace: true });
        return;
      }
      const ev = events[0];
      setEvent(ev);

      const [{ count }, { data: uploadNames }, { data: mosaicRows }] =
        await Promise.all([
          supabase
            .from("uploads")
            .select("id", { count: "exact", head: true })
            .eq("event_id", ev.id),
          supabase
            .from("uploads")
            .select("guest_name")
            .eq("event_id", ev.id),
          supabase
            .from("mosaics")
            .select("*")
            .eq("event_id", ev.id)
            .order("created_at", { ascending: false })
            .limit(MAX_MOSAIC_HISTORY),
        ]);

      if (cancelled) return;
      setPhotoCount(count ?? 0);
      const names = new Set<string>();
      (uploadNames ?? []).forEach((u) => {
        if (u.guest_name) names.add(u.guest_name);
      });
      setContributors(names.size);

      const rows = (mosaicRows ?? []) as MosaicRow[];

      // Stale-job auto-fail removed: long-running matcher passes can keep a
      // job legitimately in-flight for >15 min; we no longer mark them failed
      // from the client. Use Railway logs / a manual retry to recover.


      const signed = await Promise.all(
        rows.map(async (row) => {
          // Single-master pipeline:
          //   - `image_url` is the DZI manifest URL (not a browsable JPEG).
          //   - `preview_url` is a high-quality WebP (~3000px, q90) derived
          //     from the raw master pixels — the source of truth for
          //     dashboard cards, loading and history strip.
          //   - `thumb_url` is a tiny 480px JPEG kept only as a fallback
          //     for legacy rows.
          const fullPath = row.mosaic_image_url ?? null;
          const previewPath =
            row.preview_url ??
            row.preview_image_url ??
            row.thumb_url ??
            row.thumb_image_url ??
            fullPath;
          // History strip renders these at ~80–96px; always prefer the
          // dedicated 480px thumbnail over the ~3000px preview WebP to
          // avoid downloading multi-MB images for tiny avatars.
          const thumbPath =
            row.thumb_url ??
            row.thumb_image_url ??
            row.preview_url ??
            row.preview_image_url ??
            previewPath ??
            fullPath;
          const usedThumbAsPreview =
            !row.preview_url &&
            !row.preview_image_url &&
            !!(row.thumb_url ?? row.thumb_image_url);
          // Diagnostic: user reports preview loads at 480x320 (thumb size).
          // Log the exact source resolution so we can tell where the
          // fallback is happening.
          console.log("[mosaic-preview-audit]", {
            mosaicId: row.id,
            status: row.status,
            preview_url: row.preview_url ?? null,
            preview_image_url: row.preview_image_url ?? null,
            thumb_url: row.thumb_url ?? null,
            thumb_image_url: row.thumb_image_url ?? null,
            mosaic_image_url: row.mosaic_image_url ?? null,
            selectedPreviewPath: previewPath,
            selectedThumbPath: thumbPath,
            usedThumbAsPreview,
          });
          if (usedThumbAsPreview) {
            console.warn(
              "[mosaic-preview-audit] preview_url is missing — falling back to thumb (~480px). This is why the mosaic looks pixelated.",
              { mosaicId: row.id },
            );
          }
          const [preview, thumb] = await Promise.all([
            signMosaicPath(previewPath),
            signMosaicPath(thumbPath),
          ]);
          console.log("[mosaic-preview-audit] signed", {
            mosaicId: row.id,
            previewSrc: preview,
            thumbSrc: thumb,
          });
          return { row, previewSrc: preview, thumbSrc: thumb } as SignedMosaic;
        }),
      );

      if (cancelled) return;
      setMosaics(signed);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate, reloadKey]);

  const latest = mosaics[0] ?? null;
  const rawStatus: MosaicStatus | null = latest?.row.status ?? null;
  const isProcessing = isProcessingStatus(rawStatus);
  const isFailed = rawStatus === "failed";
  const isTrial = isTrialPlan(event?.plan ?? null);
  // Any completed mosaic whose print variant is still being generated by the worker.
  const printProcessing = mosaics.some(
    (m) => (m.row.print_status ?? null) === "processing",
  );

  // One-shot toast when generation completes in any tab.
  const prevStatusRef = useRef<MosaicStatus | null>(null);
  useEffect(() => {
    const prev = prevStatusRef.current;
    const wasProcessing = isProcessingStatus(prev);
    if (wasProcessing && isCompletedStatus(rawStatus)) {
      toast.success("Mosaic successfully crafted.");
      setCrafting(false);
    } else if (wasProcessing && rawStatus === "failed") {
      toast.error("Mosaic generation failed", {
        description: "You can try again from the studio below.",
      });
      setCrafting(false);
    }
    prevStatusRef.current = rawStatus;
  }, [rawStatus]);

  // Merge a partial row update from realtime/polling into local state,
  // enforcing monotonic progress so late-arriving events can't rewind
  // the UI (e.g. 70% -> 60%). Terminal statuses (ready / failed) always win.
  function mergeRowPatch(patch: Partial<MosaicRow> & { id: string }) {
    setMosaics((prev) => {
      const idx = prev.findIndex((m) => m.row.id === patch.id);
      if (idx === -1) {
        // New mosaic row appeared (e.g. fresh generation from another tab).
        // Trigger a full reload so we sign URLs and enforce history cap.
        setReloadKey((k) => k + 1);
        return prev;
      }
      const current = prev[idx].row;
      const oldProgress = current.progress ?? 0;
      const newProgress = patch.progress ?? oldProgress;
      const terminal =
        patch.status === "ready" ||
        patch.status === "deepzoom_ready" ||
        patch.status === "failed";
      console.log("[mosaic-realtime] old progress", oldProgress);
      console.log("[mosaic-realtime] new progress", newProgress);
      if (!terminal && newProgress < oldProgress) {
        console.log(
          "[mosaic-realtime] ignoring stale progress",
          oldProgress,
          "->",
          newProgress,
        );
        return prev;
      }
      const merged: MosaicRow = { ...current, ...patch };
      // If terminal state or new image URLs arrived, refetch to sign fresh URLs.
      const needsResign =
        terminal ||
        (!!patch.mosaic_image_url && patch.mosaic_image_url !== current.mosaic_image_url) ||
        (!!patch.preview_url && patch.preview_url !== current.preview_url) ||
        (!!patch.thumb_url && patch.thumb_url !== current.thumb_url);
      if (needsResign) {
        setReloadKey((k) => k + 1);
      }
      const next = prev.slice();
      next[idx] = { ...prev[idx], row: merged };
      console.log("[mosaic-realtime] render", {
        mosaicId: patch.id,
        status: merged.status,
        progress: merged.progress,
      });
      return next;
    });
  }

  // Realtime updates for this event's mosaics.
  useEffect(() => {
    if (!event) return;
    const eventId = event.id;
    const channel = supabase
      .channel(`mosaics:${eventId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "mosaics",
          filter: `event_id=eq.${eventId}`,
        },
        (payload) => {
          console.log("[mosaic-realtime] update received", {
            eventType: payload.eventType,
            new: payload.new,
          });
          const row = payload.new as Partial<MosaicRow> & { id?: string };
          if (row && row.id) {
            mergeRowPatch(row as Partial<MosaicRow> & { id: string });
          } else {
            setReloadKey((k) => k + 1);
          }
        },
      )
      .subscribe((status) => {
        console.log("[mosaic-realtime] subscribed", status);
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [event]);

  // Polling fallback. Runs every 2.5s while the mosaic (or its print sidecar)
  // is non-terminal. Auto-stops once status is ready / deepzoom_ready / failed.
  // Works even when Supabase Realtime is unavailable (publication not set,
  // websocket blocked, etc.). Patches state in place — no full reload per tick.
  useEffect(() => {
    if (!event) return;
    if (!isProcessing && !printProcessing) return;
    const eventId = event.id;
    const interval = window.setInterval(async () => {
      const { data } = await supabase
        .from("mosaics")
        .select(
          "id,status,stage,progress,deepzoom_progress,print_status,dzi_status,print_url,dzi_url,tile_base_url,mosaic_image_url,preview_url,thumb_url,image_url,error,created_at",
        )
        .eq("event_id", eventId)
        .order("created_at", { ascending: false })
        .limit(MAX_MOSAIC_HISTORY);
      if (!data || data.length === 0) return;
      console.log("[mosaic-realtime] poll tick", {
        latestStatus: data[0].status,
        latestProgress: data[0].progress,
      });
      for (const row of data) {
        mergeRowPatch(row as Partial<MosaicRow> & { id: string });
      }
    }, 2500);
    return () => window.clearInterval(interval);
  }, [event, isProcessing, printProcessing]);

  // First visit straight out of the creation studio: the customer already
  // pressed "Generate my preview", so start it for them instead of making
  // them press a second button.
  useEffect(() => {
    if (loading || !event) return;
    if (autoStarted.current) return;
    if (mosaics.length > 0 || crafting || isProcessing) return;
    if (!event.cover_image_url) return;
    if (photoCount < MIN_PHOTOS_FOR_MOSAIC) return;
    autoStarted.current = true;
    void launchGeneration();
  }, [loading, event, mosaics.length, crafting, isProcessing, photoCount]);

  if (loading || !event) {
    return (
      <AppShell projectName={event?.pet_name ?? event?.event_name ?? undefined}>
        <div className="flex min-h-[60vh] items-center justify-center">
          <p className="text-eyebrow text-muted-foreground">
            Opening your mosaic…
          </p>
        </div>
      </AppShell>
    );
  }

  const latestReady = mosaics.find((m) => isCompletedStatus(m.row.status)) ?? null;
  const heroStatus: "ready" | "growing" | "empty" =
    latestReady ? "ready" : photoCount > 0 ? "growing" : "empty";

  async function launchGeneration(
    opts: { tempCoverImageUrl?: string | null } = {},
  ): Promise<void> {
    if (!event) return;
    if (crafting || isProcessing) return;
    setCrafting(true);

    // Concurrency guard: bail if a recent generation is still inflight.
    const STALE_MS = 15 * 60 * 1000;
    const { data: inflight } = await supabase
      .from("mosaics")
      .select("id,status,created_at")
      .eq("event_id", event.id)
      .in("status", [...PROCESSING_STATUS_VALUES])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (inflight) {
      const age = Date.now() - new Date(inflight.created_at).getTime();
      if (age < STALE_MS) {
        setCrafting(false);
        toast.error("Mosaic generation failed", {
          description: "A generation is already in progress.",
        });
        return;
      }
      const staleFailPayload = { status: "failed" };
      console.info("[mosaics-db-write:before]", {
        operation: "UPDATE",
        table: "public.mosaics",
        file: "src/routes/_authenticated.mosaic.index.tsx",
        function: "launchGeneration",
        line: 320,
        match: { id: inflight.id },
        payload: staleFailPayload,
      });
      await supabase.from("mosaics").update(staleFailPayload).eq("id", inflight.id);
    }

    if (!event.cover_image_url && !opts.tempCoverImageUrl) {
      setCrafting(false);
      toast.error("Mosaic generation failed", {
        description: "Choose a main pet photo before creating your preview.",
      });
      return;
    }

    const insertPayload = {
      event_id: event.id,
      job_kind: "preview",
      orientation: event.orientation ?? "portrait",
      print_size: event.print_size ?? null,
      main_upload_id: event.main_upload_id ?? null,
      status: "processing",
      stage: "processing",
      progress: 0,
      print_status: null,
      dzi_status: null,
      deepzoom_ready: false,
      deepzoom_progress: 0,
      checkpoints: {},
    };
    console.info("[mosaics-db-write:before]", {
      operation: "INSERT",
      table: "public.mosaics",
      file: "src/routes/_authenticated.mosaic.index.tsx",
      function: "launchGeneration",
      line: 331,
      payload: insertPayload,
    });
    const { data: inserted, error: insErr } = await supabase
      .from("mosaics")
      .insert(insertPayload)
      .select("id")
      .single();
    if (insErr || !inserted) {
      console.error("[mosaics-db-write:failed]", {
        operation: "INSERT",
        table: "public.mosaics",
        file: "src/routes/_authenticated.mosaic.index.tsx",
        function: "launchGeneration",
        line: 331,
        payload: insertPayload,
        error: insErr,
      });
      setCrafting(false);
      toast.error("Mosaic generation failed", {
        description: insErr?.message ?? "Failed to start mosaic",
      });
      return;
    }

    try {
      await triggerMosaicWorker({
        data: {
          eventId: event.id,
          mosaicId: inserted.id,
          coverImageUrl:
            event.cover_image_url ?? opts.tempCoverImageUrl ?? undefined,
          tempCoverImageUrl: opts.tempCoverImageUrl ?? undefined,
        },
      });
      setReloadKey((k) => k + 1);
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      const msg = /PET_WORKER_URL|PET_WORKER_API_TOKEN|not configured/i.test(raw)
        ? "Our mosaic studio isn’t reachable right now. Your photos are safe — please try again shortly."
        : raw;
      // Keep the reason on the record so Retry can show what went wrong.
      const workerFailPayload = { status: "failed", error: raw };
      console.info("[mosaics-db-write:before]", {
        operation: "UPDATE",
        table: "public.mosaics",
        file: "src/routes/_authenticated.mosaic.index.tsx",
        function: "launchGeneration",
        line: 366,
        match: { id: inserted.id },
        payload: workerFailPayload,
      });
      await supabase
        .from("mosaics")
        .update(workerFailPayload)
        .eq("id", inserted.id);
      setReloadKey((k) => k + 1);
      setCrafting(false);
      toast.error("Mosaic generation failed", { description: msg });
    }
  }



  return (
    <AppShell projectName={event.pet_name ?? event.event_name}>
      <PageStack>
        <MosaicHero status={heroStatus} />

        {isProcessing && latest && (
          <MosaicProgress
            row={latest.row}
            onCancel={async () => {
              const mosaicId = latest.row.id;
              const cancelPayload = { status: "failed" as const };
              console.info("[mosaics-db-write:before]", {
                operation: "UPDATE",
                table: "public.mosaics",
                file: "src/routes/_authenticated.mosaic.index.tsx",
                function: "onCancel",
                match: { id: mosaicId },
                payload: cancelPayload,
              });
              const { error: cancelErr } = await supabase
                .from("mosaics")
                .update(cancelPayload)
                .eq("id", mosaicId);
              if (cancelErr) {
                toast.error("Could not cancel", { description: cancelErr.message });
                return;
              }
              // Stop the worker for real — otherwise the pipeline keeps
              // running on Railway and collides with the next Regenerate.
              try {
                await cancelMosaicWorker({
                  data: { eventId: event.id, mosaicId },
                });
              } catch (err) {
                console.warn("[mosaic] worker cancel failed", err);
                toast.warning("Stopping in the background", {
                  description:
                    "The generation was marked as stopped; the worker will halt shortly.",
                });
              }
              setCrafting(false);
              setReloadKey((k) => k + 1);
              toast.success("Generation cancelled");
            }}
          />
        )}
        {isFailed && !isProcessing && (
          <FailedBanner
            onRetry={() => {
              if (typeof window !== "undefined") {
                window.requestAnimationFrame(() => {
                  studioRef.current?.scrollIntoView({
                    behavior: "smooth",
                    block: "start",
                  });
                });
              }
            }}
          />
        )}

        {latestReady ? (
          <>
            <ArtworkStage
              event={event}
              eventId={event.id}
              latestReady={latestReady}
              isProcessing={isProcessing}
              
              onRegenerate={() => setRegenerateOpen(true)}
            />
          </>
        ) : (
          <EmptyArtwork
            slug={event.slug}
            photoCount={photoCount}
            isProcessing={isProcessing}
          />
        )}


        {/* History only matters once there is more than one generation. */}
        {mosaics.length > 1 && <Generations items={mosaics} onOpen={setViewing} />}

        {!latestReady && (
          <Studio
            ref={studioRef}
            event={event}
            photoCount={photoCount}
            crafting={crafting}
            isProcessing={isProcessing}
            hasReady={!!latestReady}
            onStart={() => {
              if (latestReady) {
                setRegenerateOpen(true);
              } else {
                void launchGeneration();
              }
            }}
          />
        )}

      </PageStack>

      <RegenerateMosaicDialog
        open={regenerateOpen}
        onClose={() => setRegenerateOpen(false)}
        eventId={event.id}
        coverImageUrl={event.cover_image_url}
        busy={crafting || isProcessing}
        onConfirm={async ({ tempCoverImageUrl }) => {
          setRegenerateOpen(false);
          await launchGeneration({ tempCoverImageUrl });
        }}
      />

      <GenerationPreviewDialog
        item={viewing}
        onClose={() => setViewing(null)}
      />

    </AppShell>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

async function signMosaicPath(
  value: string | null | undefined,
): Promise<string | null> {
  if (!value) return null;
  if (/^https?:\/\//.test(value)) {
    const match = value.match(/\/mosaics\/(.+)$/);
    if (!match) return value;
    value = match[1];
  }
  const { data } = await supabase.storage
    .from("mosaics")
    .createSignedUrl(value, 60 * 60);
  return data?.signedUrl ?? null;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(0, Math.round(diffMs / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function generationDuration(row: MosaicRow): string | null {
  if (!row.completed_at) return null;
  const ms = new Date(row.completed_at).getTime() - new Date(row.created_at).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

/* ------------------------------------------------------------------ */
/* Hero                                                                 */
/* ------------------------------------------------------------------ */

function MosaicHero({ status: _status }: { status: "ready" | "growing" | "empty" }) {
  return (
    <header className="pt-1">
      <span className="sticker inline-flex bg-sunshine/35 px-4 py-2 text-xs font-extrabold">The big reveal</span>
      <h1 className="mt-5 text-display text-4xl md:text-6xl">All those little moments. Look what they made!</h1>
      <div className="mt-6 h-2 w-20 rounded-full bg-coral" />
      <p className="mt-6 max-w-xl text-base font-bold text-foreground/75 md:text-lg">
        Zoom in and every tiny memory is waiting inside.
      </p>
    </header>
  );
}


/* ------------------------------------------------------------------ */
/* Banners                                                              */
/* ------------------------------------------------------------------ */

/**
 * Emotional, backend-driven progress display.
 *
 * Single source of truth: `mosaics.stage` + `mosaics.progress` written by
 * the worker (see mosaic-worker/src/lib/progress.ts). No fake animation —
 * we only animate width transitions between real values.
 *
 * The step keys below are UI-only groupings mapped from internal stage
 * names, so the pipeline can add new stages without changing the UI.
 */
type ProgressStepKey =
  | "collecting"
  | "connecting"
  | "building"
  | "rendering"
  | "deepzoom"
  | "print"
  | "completed";

const PROGRESS_STEPS: Array<{
  key: ProgressStepKey;
  label: string;
  title: string;
  subtitle: string;
}> = [
  {
    key: "collecting",
    label: "Collecting your memories",
    title: "Collecting your memories",
    subtitle: "Gathering every photo in your private collection.",
  },
  {
    key: "connecting",
    label: "Connecting every moment",
    title: "Connecting every moment",
    subtitle: "Finding the perfect place for each memory.",
  },
  {
    key: "building",
    label: "Crafting your mosaic",
    title: "Crafting your mosaic",
    subtitle: "Thousands of tiny moments becoming one.",
  },
  {
    key: "rendering",
    label: "Preparing interactive experience",
    title: "Preparing your interactive experience",
    subtitle: "So you can explore every memory in full detail.",
  },
  {
    key: "deepzoom",
    label: "Getting the big file ready",
    title: "Getting your final mosaic ready",
    subtitle: "Making it beautifully clear for printing.",
  },
  {
    key: "print",
    label: "Finishing touches",
    title: "Putting on the finishing touches",
    subtitle: "Almost ready…",
  },
  {
    key: "completed",
    label: "Ready",
    title: "Your mosaic is ready ✨",
    subtitle: "Every cuddle, adventure and silly face—together at last.",
  },
];

/** Worker stage name → UI step. Authoritative when present. */
const STAGE_TO_STEP: Record<string, ProgressStepKey> = {
  processing: "collecting",
  fetching: "collecting",
  analyzing: "connecting",
  building: "building",
  uploading: "rendering",
  finalizing: "rendering",
  deepzoom: "deepzoom",
  deepzoom_ready: "print",
  ready: "completed",
};

function stageToStep(
  stage: string | null | undefined,
  progress: number,
): ProgressStepKey {
  // Terminal wins regardless of progress value.
  if (stage === "ready" || progress >= 100) return "completed";
  if (stage === "failed") return "collecting";
  // Prefer the explicit stage written by the worker; fall back to the
  // progress bands only when the stage is unknown. Using the stage means
  // the step markers advance on the very first realtime/poll update
  // instead of waiting for the animated bar value to catch up.
  const mapped = stage ? STAGE_TO_STEP[stage] : undefined;
  const byBand = progressToStep(progress);
  if (mapped) {
    const mappedIdx = PROGRESS_STEPS.findIndex((s) => s.key === mapped);
    const bandIdx = PROGRESS_STEPS.findIndex((s) => s.key === byBand);
    return PROGRESS_STEPS[Math.max(mappedIdx, bandIdx)]?.key ?? mapped;
  }
  return byBand;
}

function progressToStep(progress: number): ProgressStepKey {
  // Progress bands are the single source of truth (see worker STAGE_PROGRESS):
  //   0-10  collecting, 11-20 connecting, 21-70 crafting,
  //   71-92 interactive, 93-97 print, 98+ finishing.
  if (progress >= 98) return "print";
  if (progress >= 93) return "deepzoom";
  if (progress >= 71) return "rendering";
  if (progress >= 21) return "building";
  if (progress >= 11) return "connecting";
  return "collecting";
}

/**
 * Smoothly tweens a numeric value toward `target` over `durationMs` using
 * requestAnimationFrame. Guarantees monotonic behavior (never animates
 * backwards) — if a lower target arrives, the display value stays put until
 * the target catches up. Fills the 2.5s polling gap so the bar keeps easing
 * toward the last-known value instead of snapping.
 */
function useSmoothProgress(target: number, durationMs = 600): number {
  const [display, setDisplay] = useState(target);
  const fromRef = useRef(target);
  const toRef = useRef(target);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    // Monotonic guard: ignore backward targets.
    if (target <= toRef.current) return;
    fromRef.current = display;
    toRef.current = target;
    startRef.current = null;

    const tick = (t: number) => {
      if (startRef.current === null) startRef.current = t;
      const elapsed = t - startRef.current;
      const p = Math.min(1, elapsed / durationMs);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - p, 3);
      const next = fromRef.current + (toRef.current - fromRef.current) * eased;
      setDisplay(next);
      if (p < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs]);

  return display;
}

function CrossfadeText({
  text,
  className,
  as: Tag = "div",
}: {
  text: string;
  className?: string;
  as?: "h2" | "p" | "div";
}) {
  const [prev, setPrev] = useState(text);
  const [curr, setCurr] = useState(text);
  const [showCurr, setShowCurr] = useState(true);

  useEffect(() => {
    if (text === curr) return;
    setPrev(curr);
    setShowCurr(false);
    const t = setTimeout(() => {
      setCurr(text);
      setShowCurr(true);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <Tag className={className} style={{ display: "grid", gridTemplateAreas: '"stack"' }}>
      <span style={{ gridArea: "stack", opacity: showCurr ? 1 : 0, transition: "opacity 300ms ease-in-out" }}>
        {curr}
      </span>
      <span style={{ gridArea: "stack", opacity: showCurr ? 0 : 1, transition: "opacity 300ms ease-in-out" }}>
        {prev}
      </span>
    </Tag>
  );
}

function MosaicProgress({ row, onCancel }: { row: MosaicRow; onCancel?: () => void | Promise<void> }) {
  const rawProgress = typeof row.progress === "number" ? row.progress : 0;
  const progress = Math.max(0, Math.min(100, rawProgress));
  const smooth = useSmoothProgress(progress, 550);
  const displayPct = Math.round(smooth);
  // Step markers follow the REAL values from the database, not the
  // animated bar value — otherwise the checkmarks lag behind (or appear
  // frozen) while the width tween catches up.
  const stepKey = stageToStep(row.stage ?? row.status ?? null, progress);
  const activeIdx = PROGRESS_STEPS.findIndex((s) => s.key === stepKey);
  const active = PROGRESS_STEPS[activeIdx] ?? PROGRESS_STEPS[0];

  return (
    <section>
      <div className="rounded-[2rem] border-2 border-sky/20 bg-mist/45 p-8 md:p-12">
        <div className="text-center">
          <p className="text-eyebrow">In progress</p>
          <CrossfadeText
            as="h2"
            text={active.title}
            className="text-display mt-4 text-3xl text-foreground md:text-4xl breathe"
          />
          <CrossfadeText
            as="p"
            text={active.subtitle}
            className="mt-3 mx-auto max-w-xl text-sm leading-relaxed text-foreground/70 breathe"
          />
        </div>

        <div className="mt-8 mx-auto max-w-2xl">
          <div className="flex items-center gap-3">
            <div className="h-3 flex-1 overflow-hidden rounded-full bg-card">
              <div
                className="h-full rounded-full bg-coral will-change-[width]"
                style={{
                  width: `${smooth}%`,
                  transition: "width 500ms cubic-bezier(0.22, 1, 0.36, 1)",
                }}
              />
            </div>
          </div>

          {/* Step markers */}
          <ol className="mt-6 hidden md:grid grid-cols-7 gap-2">
            {PROGRESS_STEPS.map((step, i) => {
              const done = i < activeIdx;
              const current = i === activeIdx;
              return (
                <li key={step.key} className="flex flex-col items-center text-center">
                  <span
                    className={`grid h-6 w-6 place-items-center rounded-full border text-[10px] transition-all duration-500 ease-out ${
                      done
                        ? "border-primary bg-primary text-primary-foreground scale-100"
                        : current
                          ? "border-primary bg-[color:var(--ivory)] text-primary scale-110 shadow-[0_0_0_4px_color-mix(in_oklab,var(--primary)_18%,transparent)] animate-pulse"
                          : "border-border/60 bg-[color:var(--ivory)] text-muted-foreground scale-100"
                    }`}
                  >
                    <span
                      key={done ? "done" : current ? "current" : "idle"}
                      className="inline-block animate-in fade-in zoom-in-75 duration-300"
                    >
                      {done ? "✓" : i + 1}
                    </span>
                  </span>
                  <span
                    className={`mt-2 text-[10px] leading-tight transition-colors duration-500 ${
                      current
                        ? "text-foreground"
                        : done
                          ? "text-foreground/70"
                          : "text-muted-foreground"
                    }`}
                  >
                    {step.label}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>

        <p className="mt-8 mx-auto max-w-xl text-center text-xs leading-relaxed text-muted-foreground">
          Feel free to wander off. We&rsquo;ll keep making the magic and your Mosaic will be waiting here.
        </p>

        {onCancel && (
          <div className="mt-6 flex justify-center">
            <button
              type="button"
              onClick={() => void onCancel()}
              className="text-xs uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground underline-offset-4 hover:underline transition-colors"
            >
              Stop generation
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function FailedBanner({ onRetry }: { onRetry: () => void }) {
  return (
    <section>
      <div className="rounded-[2rem] surface-fade p-8 text-center md:p-12">
        <p className="text-eyebrow text-destructive">Generation interrupted</p>
        <h2 className="text-display mt-4 text-3xl text-foreground md:text-4xl">
          Your last Mosaic didn&rsquo;t finish.
        </h2>
        <p className="mt-5 mx-auto max-w-xl text-sm leading-relaxed text-foreground/70">
          Something interrupted the previous generation. You can try again
          whenever you&rsquo;re ready — nothing else has changed.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="btn-primary mt-8 inline-flex items-center gap-2"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Retry generation
        </button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Artwork (centerpiece)                                                */
/* ------------------------------------------------------------------ */

/**
 * Shared action-button styling for the Mosaic Studio card.
 *
 * Every button uses the same dimensions, typography, and radius so the
 * three actions feel like one family. Color variations distinguish purpose:
 *   - primary : main CTA (Open Interactive)
 *   - accent  : secondary action (Download Print)
 *   - muted   : tertiary / retry (Regenerate, Retry Viewer)
 *   - idle    : non-interactive loading state (Preparing…)
 */
function mosaicAction({
  variant,
}: {
  variant: "primary" | "accent" | "muted" | "idle";
}) {
  const base =
    "inline-flex w-full items-center justify-center gap-2 rounded-full px-5 py-2.5 text-eyebrow";

  switch (variant) {
    case "primary":
      return cn(
        base,
        "border border-primary/60 bg-[color:var(--ivory)] text-primary transition-colors hover:bg-primary hover:text-[color:var(--ivory)]",
      );
    case "accent":
      return cn(
        base,
        "border border-dusty/60 bg-[color:var(--ivory)] text-dusty transition-colors hover:border-dusty hover:bg-dusty/5",
      );
    case "muted":
      return cn(
        base,
        "border border-border/70 bg-[color:var(--ivory)] text-foreground/80 transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50",
      );
    case "idle":
    default:
      return cn(
        base,
        "border border-border/70 bg-[color:var(--ivory)] text-muted-foreground",
      );
  }
}

function ArtworkStage({
  event,
  eventId,
  latestReady,
  isProcessing,
  onRegenerate,
}: {
  event: Event;
  eventId: string;
  latestReady: SignedMosaic;
  isProcessing: boolean;
  onRegenerate: () => void;
}) {
  const blurClass = isProcessing
    ? "blur-md scale-[1.02]"
    : "blur-0 scale-100";

  const printStatus = (latestReady.row.print_status ?? null) as string | null;
  const printUrl = latestReady.row.print_url ?? null;
  // Handle DZI state explicitly. `dzi_status` is the source of truth once
  // Job B has reached a terminal state; `image_url`/`dzi_url` covers legacy
  // rows where the sidecar column may be null.
  const dziStatus = (latestReady.row.dzi_status ?? null) as
    | "processing"
    | "ready"
    | "failed"
    | null;
  const interactiveReady =
    dziStatus === "ready" ||
    (dziStatus !== "failed" &&
      (!!latestReady.row.dzi_url || !!latestReady.row.image_url));
  const interactiveFailed = dziStatus === "failed" && !interactiveReady;
  const interactiveProcessing = !interactiveReady && !interactiveFailed;
  const [printSignedUrl, setPrintSignedUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!printUrl) {
      setPrintSignedUrl(null);
      return;
    }
    (async () => {
      const signed = await signMosaicPath(printUrl);
      if (!cancelled) setPrintSignedUrl(signed);
    })();
    return () => {
      cancelled = true;
    };
  }, [printUrl]);

  // Only show "Preparing print…" when the worker is actively generating.
  // For legacy mosaics created before the print variant existed, BOTH
  // print_url AND print_status are null — never show the spinner in that case.
  const printGenerating =
    printStatus === "processing" || (!printUrl && printStatus != null && printStatus !== "failed");
  const printReady = !!printUrl && printStatus === "ready";
  // One-time purchase only. The final artwork is the purchased product, so it
  // is only ever offered when payment succeeded AND the print-ready file
  // actually exists and has been signed for this customer.
  const purchased = event.payment_status === "paid";
  const finalAvailable = printReady || latestReady.row.final_available === true;

  return (
    <section>
      <div className="w-full">
        <figure className="overflow-hidden rounded-[2.25rem] surface-fade shadow-[var(--shadow-soft)]">
          <div className="relative aspect-square w-full overflow-hidden bg-[color:var(--champagne)]/30">
            {latestReady.previewSrc ? (
              <img
                src={latestReady.previewSrc}
                alt="Your Mosaic"
                className={`h-full w-full object-cover transition-all duration-1000 ease-out ${blurClass}`}
                loading="eager"
                onLoad={(e) => {
                  const img = e.currentTarget;
                  const rect = img.getBoundingClientRect();
                  console.log("[mosaic-preview-onload]", {
                    mosaicId: latestReady.row.id,
                    currentSrc: img.currentSrc || img.src,
                    naturalWidth: img.naturalWidth,
                    naturalHeight: img.naturalHeight,
                    renderedWidth: Math.round(rect.width),
                    renderedHeight: Math.round(rect.height),
                    preview_url: latestReady.row.preview_url ?? null,
                    thumb_url: latestReady.row.thumb_url ?? null,
                    previewSrc: latestReady.previewSrc,
                    thumbSrc: latestReady.thumbSrc,
                  });
                  if (img.naturalWidth > 0 && img.naturalWidth < 1000) {
                    console.warn(
                      "[mosaic-preview-audit] hero image is <1000px wide — preview.webp is NOT being served (likely thumb fallback).",
                      { naturalWidth: img.naturalWidth },
                    );
                  }
                }}
              />

            ) : (
              <div className="grid h-full w-full place-items-center text-muted-foreground">
                <ImageIcon className="h-10 w-10" />
              </div>
            )}
            {!purchased && latestReady.previewSrc && <TrialWatermark />}
          </div>
        </figure>

        <p className="mt-4 text-center text-eyebrow text-muted-foreground">
          {purchased ? "Your mosaic" : "Free preview"} · crafted {formatRelativeTime(latestReady.row.completed_at ?? latestReady.row.created_at)}
        </p>

        {purchased && !finalAvailable && (
          <div className="mt-6 rounded-[2rem] border-2 border-mint bg-mint/20 p-6 text-center">
            <p className="text-display text-2xl">Your mosaic is being finished ❤️</p>
            <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">
              We&rsquo;re preparing the high-resolution, ready-to-print version. It appears here the moment it&rsquo;s ready, and we&rsquo;ll email you too.
            </p>
          </div>
        )}


          <div className="mt-10 rounded-[2rem] border-2 border-sky/20 bg-mist/45 p-6 md:p-10">
          <div className="text-center">
              <h2 className="text-display text-2xl">Play with your mosaic</h2>
          </div>

          <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-3">
            <div className="flex flex-col items-center text-center">
              {interactiveReady ? (
                <Link
                  to="/mosaic/$eventId"
                  params={{ eventId }}
                  className={mosaicAction({ variant: "primary" })}
                >
                   Zoom into the memories
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              ) : interactiveFailed ? (
                <button
                  type="button"
                  onClick={onRegenerate}
                  disabled={isProcessing}
                  className={mosaicAction({ variant: "muted" })}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Retry Viewer
                </button>
              ) : (
                <span className={mosaicAction({ variant: "idle" })}>
                  <Sparkles className="h-3.5 w-3.5 animate-pulse" />
                  Preparing…
                </span>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                 Find the tiny moments hiding inside.
              </p>
            </div>

            <div className="flex flex-col items-center text-center">
              {purchased && printReady && printSignedUrl ? (
                <a
                  href={printSignedUrl}
                  download={`mosaic-print-${eventId}.jpg`}
                  className={mosaicAction({ variant: "accent" })}
                >
                  <Download className="h-3.5 w-3.5" />
                  Download final mosaic
                </a>
              ) : !purchased ? (
                <span className={mosaicAction({ variant: "idle" })}>
                  <Printer className="h-3.5 w-3.5" />
                  Available after purchase
                </span>
              ) : (
                <span className={mosaicAction({ variant: "idle" })}>
                  <Printer className="h-3.5 w-3.5 animate-pulse" />
                   Getting your final mosaic ready…
                </span>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                Get your ready-to-print version.
              </p>
            </div>

            <div className="flex flex-col items-center text-center">
              <button
                type="button"
                onClick={onRegenerate}
                disabled={isProcessing}
                className={mosaicAction({ variant: "muted" })}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Regenerate
              </button>
              <p className="mt-3 text-xs text-muted-foreground">
                 Try a fresh version with your latest photos.
              </p>
            </div>
          </div>
        </div>

        {!purchased && (
          <div className="mt-10 rounded-[2rem] bg-blush px-5 py-10">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-eyebrow text-coral">One-time purchase</p>
              <h2 className="mt-4 text-display text-4xl">Keep the big picture forever.</h2>
              <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-muted-foreground">Get the finished high-resolution pet mosaic in your chosen shape and size. One payment, no subscription.</p>
            </div>
            <div className="mx-auto mt-8 max-w-2xl"><BillingCard eventId={eventId} /></div>
          </div>
        )}
      </div>
    </section>
  );
}


function TrialWatermark() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden"
    >
      <div className="absolute inset-[-30%] rotate-[-22deg] opacity-[0.10] mix-blend-overlay">
        <div className="flex flex-col gap-16">
          {Array.from({ length: 8 }).map((_, row) => (
            <div
              key={row}
              className="flex justify-center gap-16 whitespace-nowrap text-[2rem] font-light tracking-[0.55em] text-foreground"
            >
              {Array.from({ length: 4 }).map((_, col) => (
                <span key={col}>MOSAIC PREVIEW</span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Empty                                                                */
/* ------------------------------------------------------------------ */



function EmptyArtwork({
  photoCount,
  isProcessing,
}: {
  slug: string;
  photoCount: number;
  isProcessing: boolean;
}) {
  return (
    <section>
      <div className="w-full overflow-hidden rounded-[2.25rem] border-2 border-sky/20 bg-mist/45">
        <div className="grid aspect-square w-full place-items-center">
          <div className="px-8 text-center">
            <div className="mx-auto grid h-24 w-24 place-items-center rounded-[2rem] bg-sunshine/35 shadow-[var(--shadow-soft)]">
              <Sparkles className="h-9 w-9 text-coral" />
            </div>
            <h2 className="text-display mt-8 text-3xl text-foreground md:text-5xl">
              Ready to see the magic?
            </h2>
            <p className="mt-5 mx-auto max-w-md text-base leading-relaxed text-foreground/70">
              Add your pet&rsquo;s favorite moments, choose the photo that looks most like them, then create your free preview.
            </p>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Link to="/create" className="btn-primary inline-flex items-center gap-2">Add photos <UploadIcon className="h-3.5 w-3.5" /></Link>
            </div>
            <p className="mt-9 text-eyebrow text-muted-foreground">
              {isProcessing
                ? "Crafting now…"
                : `${photoCount} memories collected so far`}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Story (emotional stats)                                              */
/* ------------------------------------------------------------------ */

function StorySection({
  photos,
  contributors,
}: {
  photos: number;
  contributors: number;
}) {
  const headline =
    photos >= 1000
      ? "Ideal Reached"
      : photos >= 500
        ? "Excellent Coverage"
        : photos >= 150
          ? "Nearly Ready"
          : photos > 0
            ? "Growing"
            : "Awaiting memories";

  return (
    <section>
      <SectionHeading eyebrow="The story so far" title={headline} />
      <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2">
        <StoryStat value={photos} label="memories collected" />
        <StoryStat value={contributors || 1} label="private collection" />
      </div>
      <p className="mt-8 text-script text-2xl text-foreground/75 md:text-3xl">
        Every uploaded memory becomes part of the big picture.
      </p>
    </section>
  );
}

function StoryStat({
  value,
  label,
  dim = false,
}: {
  value: number;
  label: string;
  dim?: boolean;
}) {
  return (
    <div className="rounded-3xl surface-fade p-8">
      <p
        className={`text-display text-5xl md:text-6xl ${
          dim ? "text-foreground/50" : "text-foreground"
        }`}
      >
        {value.toLocaleString()}
      </p>
      <p className="mt-4 text-sm text-foreground/70">{label}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Generations                                                          */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Generations                                                          */
/* ------------------------------------------------------------------ */

function Generations({
  items,
  onOpen,
}: {
  items: SignedMosaic[];
  onOpen: (m: SignedMosaic) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section>
      <p className="text-center text-eyebrow">Mosaic History</p>
      <ul className="mt-4 flex flex-col gap-3">
        {items.map((m) => {
          const ready = isCompletedStatus(m.row.status);
          const clickable = ready && !!m.previewSrc;
          return (
            <li key={m.row.id}>
              <button
                type="button"
                onClick={() => clickable && onOpen(m)}
                disabled={!clickable}
                className={`flex w-full items-center gap-5 rounded-3xl surface-fade p-4 text-center transition-colors md:gap-7 md:p-5 ${
                  clickable
                    ? "hover:border-primary/60"
                    : "cursor-default"
                }`}
              >
                <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-[color:var(--champagne)]/45 md:h-24 md:w-24">
                  {m.thumbSrc ? (
                    <img
                      src={m.thumbSrc}
                      alt={`Mosaic from ${formatDate(m.row.created_at)}`}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="grid h-full w-full place-items-center text-muted-foreground">
                      <Sparkles className="h-5 w-5" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-display text-lg text-foreground md:text-xl">
                    {formatDate(m.row.created_at)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {(m.row.photo_count ?? 0).toLocaleString()} photos used
                    {(() => {
                      const dur = generationDuration(m.row);
                      return dur ? ` · Crafted in ${dur}` : "";
                    })()}
                  </p>
                </div>
                <span
                  className={`text-eyebrow ${
                    ready
                      ? "text-foreground/70"
                      : m.row.status === "failed"
                        ? "text-destructive"
                        : "text-muted-foreground"
                  }`}
                >
                  {ready
                    ? "Ready"
                    : m.row.status === "failed"
                      ? "Failed"
                      : isProcessingStatus(m.row.status)
                        ? m.row.status === "queued" || m.row.status === "pending"
                          ? "Queued"
                          : "Crafting"
                        : "Queued"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Studio                                                               */
/* ------------------------------------------------------------------ */

const CRAFTING_MESSAGES = [
  "Analyzing memories…",
  "Matching colors…",
  "Building artwork…",
  "Rendering preview…",
];

type StudioProps = {
  event: Event;
  photoCount: number;
  crafting: boolean;
  isProcessing: boolean;
  hasReady: boolean;
  onStart: () => void;
};

const Studio = forwardRef<HTMLDivElement, StudioProps>(function Studio(
  { event, photoCount, crafting, isProcessing, hasReady, onStart },
  ref,
) {
  const showCrafting = crafting || isProcessing;
  const canGenerate = photoCount >= MIN_PHOTOS_FOR_MOSAIC && !showCrafting;
  const [msgIdx, setMsgIdx] = useState(0);

  useEffect(() => {
    if (!showCrafting) return;
    setMsgIdx(0);
    const id = window.setInterval(
      () => setMsgIdx((i) => (i + 1) % CRAFTING_MESSAGES.length),
      2800,
    );
    return () => window.clearInterval(id);
  }, [showCrafting]);

  return (
    <section
      ref={ref}
      id="mosaic-studio"
      className="scroll-mt-24 pb-4"
      // event reference reserved for future per-event controls
      data-event-id={event.id}
    >
      {showCrafting ? (
        // Progress is rendered by <MosaicProgress /> at the top of the page —
        // avoid duplicating a second "crafting" card here.
        null
      ) : (
        <div className="flex flex-col items-center text-center">
          <SectionHeading
            eyebrow="Studio"
            title={hasReady ? "Regenerate this mosaic" : "Generate a new version"}
            center
          />
          <p className="mt-6 max-w-md text-sm leading-relaxed text-muted-foreground">
            {hasReady
              ? "Craft a fresh version from the selected main portrait. Your photos and previous versions stay safe."
              : "Create your included preview from the main portrait and private photo collection."}
          </p>
          <button
            type="button"
            onClick={onStart}
            disabled={!canGenerate}
            className="btn-primary mt-8 inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {hasReady ? "Regenerate Mosaic" : "Generate New Version"}
          </button>
          {photoCount < MIN_PHOTOS_FOR_MOSAIC && (
            <p className="mt-4 text-xs text-muted-foreground">
              {MIN_PHOTOS_FOR_MOSAIC - photoCount} more memories needed before
              the next version can be crafted.
            </p>
          )}
        </div>
      )}
    </section>
  );
});

/* ------------------------------------------------------------------ */
/* Dialogs                                                              */
/* ------------------------------------------------------------------ */

function GenerationPreviewDialog({
  item,
  onClose,
}: {
  item: SignedMosaic | null;
  onClose: () => void;
}) {
  const open = !!item;
  const title = useMemo(
    () => (item ? formatDate(item.row.created_at) : ""),
    [item],
  );
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl border-border/60 bg-[color:var(--ivory)] p-6">
        <DialogHeader>
          <DialogTitle className="text-display text-2xl">{title}</DialogTitle>
          <DialogDescription>
            {item
              ? `${(item.row.photo_count ?? 0).toLocaleString()} photos used`
              : ""}
          </DialogDescription>
        </DialogHeader>
        {item?.previewSrc && (
          <div className="mt-4 overflow-hidden rounded-2xl bg-[color:var(--champagne)]/30">
            <img
              src={item.previewSrc}
              alt={`Mosaic from ${title}`}
              className="aspect-square w-full object-cover"
              loading="lazy"
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}



/* ------------------------------------------------------------------ */
/* Shared                                                               */
/* ------------------------------------------------------------------ */

function SectionHeading({
  eyebrow,
  title,
  center = false,
}: {
  eyebrow: string;
  title: string;
  center?: boolean;
}) {
  return (
    <div className={center ? "text-center" : ""}>
      <p className="text-eyebrow">{eyebrow}</p>
      <h2 className="text-display mt-3 text-3xl text-foreground md:text-4xl">
        {title}
      </h2>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Regenerate dialog                                                    */
/* ------------------------------------------------------------------ */

type RegenerateSource = "current" | "upload";

function RegenerateMosaicDialog({
  open,
  onClose,
  eventId,
  coverImageUrl,
  busy,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  eventId: string;
  coverImageUrl: string | null;
  busy: boolean;
  onConfirm: (opts: { tempCoverImageUrl?: string | null }) => Promise<void>;
}) {
  const [source, setSource] = useState<RegenerateSource>("current");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!open) {
      setSource("current");
      setFile(null);
      setUploading(false);
    }
  }, [open]);

  const handleConfirm = async () => {
    if (busy || uploading) return;
    try {
      let tempUrl: string | null = null;
      if (source === "upload") {
        if (!file) {
          toast.error("Please select an image to upload.");
          return;
        }
        setUploading(true);
        // Temporary path in the mosaics bucket. We append a timestamp so
        // re-uploads don't collide on the cache; the file is small and
        // ephemeral.
        const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
        const tmpPath = `${eventId}/tmp/${Date.now()}-cover.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("mosaics")
          .upload(tmpPath, file, {
            contentType: file.type || "image/jpeg",
            upsert: true,
            cacheControl: "60",
          });
        if (upErr) throw upErr;
        const { data: signed, error: signErr } = await supabase.storage
          .from("mosaics")
          .createSignedUrl(tmpPath, 60 * 60);
        if (signErr || !signed?.signedUrl) {
          throw signErr ?? new Error("Could not sign uploaded image.");
        }
        tempUrl = signed.signedUrl;
      }
      await onConfirm({ tempCoverImageUrl: tempUrl });
    } catch (e) {
      toast.error("Couldn't start regeneration", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !uploading && onClose()}>
      <DialogContent className="max-w-md border-border/60 bg-[color:var(--ivory)] p-6">
        <DialogHeader>
          <DialogTitle className="text-display text-2xl">
            Regenerate Mosaic
          </DialogTitle>
          <DialogDescription>Choose the source image</DialogDescription>
        </DialogHeader>

        <div className="mt-4 flex flex-col gap-3">
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition-colors ${
              source === "current"
                ? "border-primary/60 bg-primary/5"
                : "border-border/60 hover:border-border"
            }`}
          >
            <input
              type="radio"
              name="regen-source"
              className="mt-1"
              checked={source === "current"}
              onChange={() => setSource("current")}
              disabled={!coverImageUrl}
            />
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">
                Use current cover photo{" "}
                <span className="text-xs text-muted-foreground">(recommended)</span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Reuses the event cover. No upload needed.
              </p>
            </div>
          </label>

          <label
            className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition-colors ${
              source === "upload"
                ? "border-primary/60 bg-primary/5"
                : "border-border/60 hover:border-border"
            }`}
          >
            <input
              type="radio"
              name="regen-source"
              className="mt-1"
              checked={source === "upload"}
              onChange={() => setSource("upload")}
            />
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">
                Upload another image
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                 Used only for this version — your selected main portrait stays unchanged.
              </p>
              {source === "upload" && (
                <div className="mt-3">
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-border/70 bg-[color:var(--ivory)] px-4 py-2 text-xs text-foreground/80 hover:border-primary hover:text-primary">
                    <UploadIcon className="h-3.5 w-3.5" />
                    {file ? file.name : "Choose image"}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    />
                  </label>
                </div>
              )}
            </div>
          </label>
        </div>

        <div className="mt-5 rounded-2xl bg-[color:var(--champagne)]/30 p-4 text-xs leading-relaxed text-foreground/75">
           This will replace the current preview. Your source photos will remain unchanged.
        </div>

        <div className="mt-5 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={uploading}
            className="rounded-full border border-border/70 px-4 py-2 text-eyebrow text-foreground/80 hover:border-foreground/60 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy || uploading || (source === "upload" && !file)}
            className="btn-primary inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {uploading ? "Uploading…" : "Regenerate"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

