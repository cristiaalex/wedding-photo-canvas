import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Camera,
  Users as UsersIcon,
  MessageCircle,
  Sparkles,
  Copy,
  ExternalLink,
  Download,
  Images as ImagesIcon,
  Check,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PageStack, PageState } from "@/components/page-layout";
import { supabase } from "@/lib/supabase";
import { guestUrlForSlug, generateQrDataUrl, generateAndStoreEventQr } from "@/lib/qr";
import type { Event, MosaicStatus } from "@/lib/database.types";
import { displayGuestName } from "@/lib/guest-identity";
import { parseCoverUrl } from "@/lib/cover-position";
import { CoverHero } from "@/components/cover-hero";
import { GuestHeroContent } from "@/components/guest-hero-content";
import { BillingCard } from "@/components/billing-card";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Mosaic" },
      { name: "description", content: "Your private wedding workspace." },
    ],
  }),
  component: DashboardPage,
});

/* ------------------------------------------------------------------ */
/* Types                                                                */
/* ------------------------------------------------------------------ */

type ActivityItem = {
  id: string;
  kind: "upload" | "guestbook";
  who: string;
  detail: string;
  at: string;
};

type DashboardStats = {
  photos: number;
  guests: number;
  messages: number;
  mosaicStatus: MosaicStatus | null;
};

/* ------------------------------------------------------------------ */
/* Page                                                                 */
/* ------------------------------------------------------------------ */

function DashboardPage() {
  const navigate = useNavigate();
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<DashboardStats>({
    photos: 0,
    guests: 0,
    messages: 0,
    mosaicStatus: null,
  });
  const [activity, setActivity] = useState<ActivityItem[]>([]);

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
        navigate({ to: "/onboarding", replace: true });
        return;
      }
      const ev = events[0];
      setEvent(ev);

      const [
        { count: photoCount },
        { count: msgCount },
        { data: latestMosaic },
        { data: uploadRows },
        { data: guestbookRows },
      ] = await Promise.all([
        supabase.from("uploads").select("id", { count: "exact", head: true }).eq("event_id", ev.id),
        supabase
          .from("guestbook_messages")
          .select("id", { count: "exact", head: true })
          .eq("event_id", ev.id),
        supabase
          .from("mosaics")
          .select("status, created_at")
          .eq("event_id", ev.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("uploads")
          .select("id, guest_name, guest_uuid, uploaded_at")
          .eq("event_id", ev.id)
          .order("uploaded_at", { ascending: false })
          .limit(40),
        supabase
          .from("guestbook_messages")
          .select("id, guest_name, message, created_at")
          .eq("event_id", ev.id)
          .order("created_at", { ascending: false })
          .limit(20),
      ]);

      if (cancelled) return;

      // Build activity feed.
      const items: ActivityItem[] = [];
      const uploadsByGuest = new Map<string, { count: number; at: string; who: string }>();
      (uploadRows ?? []).forEach((u) => {
        const who = displayGuestName(u.guest_name) ?? "A guest";
        const key = `${who}::${u.uploaded_at.slice(0, 13)}`;
        const cur = uploadsByGuest.get(key);
        if (!cur || u.uploaded_at > cur.at) {
          uploadsByGuest.set(key, {
            count: (cur?.count ?? 0) + 1,
            at: cur ? (u.uploaded_at > cur.at ? u.uploaded_at : cur.at) : u.uploaded_at,
            who,
          });
        } else {
          uploadsByGuest.set(key, { count: cur.count + 1, at: cur.at, who });
        }
      });
      uploadsByGuest.forEach(({ count, at, who }, key) => {
        items.push({
          id: `up-${key}`,
          kind: "upload",
          who,
          detail: count === 1 ? "added a photo" : `added ${count} photos`,
          at,
        });
      });
      (guestbookRows ?? []).forEach((g) => {
        items.push({
          id: `gb-${g.id}`,
          kind: "guestbook",
          who: displayGuestName(g.guest_name) ?? "A guest",
          detail: "left a message",
          at: g.created_at,
        });
      });
      items.sort((a, b) => (a.at < b.at ? 1 : -1));

      // Distinct guests: uploads key on the stable per-device guest_uuid so
      // a display-name change never creates a new guest. Legacy rows and
      // guestbook messages (which have no guest_uuid column) fall back to
      // displayGuestName. Anonymous guests collapse into a single bucket.
      const guestKeys = new Set<string>();
      (uploadRows ?? []).forEach((u) => {
        const uuid = (u as { guest_uuid?: string | null }).guest_uuid?.trim();
        if (uuid) {
          guestKeys.add(`uuid:${uuid}`);
          return;
        }
        const n = displayGuestName(u.guest_name);
        if (n) guestKeys.add(`name:${n.toLowerCase()}`);
      });
      (guestbookRows ?? []).forEach((g) => {
        const n = displayGuestName(g.guest_name);
        if (n) guestKeys.add(`name:${n.toLowerCase()}`);
      });

      setStats({
        photos: photoCount ?? 0,
        guests: guestKeys.size,
        messages: msgCount ?? 0,
        mosaicStatus: (latestMosaic?.status as MosaicStatus | undefined) ?? null,
      });
      setActivity(items.slice(0, 8));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  if (loading || !event) {
    return (
      <AppShell weddingName={event?.event_name ?? undefined}>
        <PageState>
          <p className="text-eyebrow text-muted-foreground">Gathering your wedding…</p>
        </PageState>
      </AppShell>
    );
  }

  return (
    <AppShell weddingName={event.event_name}>
      <PageStack>
        <EventHero event={event} />
        <ShareCard event={event} />
        <BillingCard eventId={event.id} />
        <LiveOverview stats={stats} />
        <RecentActivity items={activity} />
        <MosaicStatusSection photos={stats.photos} status={stats.mosaicStatus} />
        <QuickActions event={event} />
      </PageStack>

    </AppShell>
  );
}

/* ------------------------------------------------------------------ */
/* 1. Event Hero — shared with Guest Page (single source of truth)      */
/* ------------------------------------------------------------------ */

function formatEventDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function EventHero({ event }: { event: Event }) {
  const dateLabel = formatEventDate(event.wedding_date ?? null);
  const { src: coverSrc, position: coverPos } = parseCoverUrl(event.cover_image_url);
  return (
    // Event cover card — the dashboard's visual identity for this wedding.
    // Same rendering engine as the Guest Page hero (CoverHero + GuestHeroContent),
    // framed as a contained, rounded editorial card. Mobile-first aspect ratios.
    <section className="motion-safe:animate-[fade-in_240ms_ease-out_both]">
      <article className="overflow-hidden rounded-[1.25rem] surface-fade shadow-[var(--shadow-soft)]">
        <CoverHero
          src={coverSrc}
          position={coverPos}
          alt={event.event_name ?? "Wedding cover"}
          eager
          fadeTo="var(--ivory)"
          fadeCoverage={0.62}
          fallbackLetter={event.event_name?.[0] ?? "M"}
          className="aspect-[4/5] w-full sm:aspect-[3/2] lg:aspect-[16/7]"
        >
          <GuestHeroContent
            eventName={event.event_name ?? null}
            weddingDateLabel={dateLabel}
            venue={event.venue ?? null}
            welcomeMessage={event.welcome_message ?? null}
          />
        </CoverHero>
      </article>
    </section>
  );
}


/* ------------------------------------------------------------------ */
/* 1b. Share card — dashboard-only controls, kept out of the hero       */
/* ------------------------------------------------------------------ */

function ShareCard({ event }: { event: Event }) {
  const guestUrl = guestUrlForSlug(event.slug);
  const [copied, setCopied] = useState(false);
  const [qrSrc, setQrSrc] = useState<string | null>(event.qr_image_url);

  useEffect(() => {
    if (qrSrc) return;
    let cancelled = false;
    (async () => {
      const dataUrl = await generateQrDataUrl(event.slug);
      if (!cancelled) setQrSrc(dataUrl);
      const { publicUrl } = await generateAndStoreEventQr(event.id, event.slug);
      if (!cancelled && publicUrl) setQrSrc(publicUrl);
    })();
    return () => {
      cancelled = true;
    };
  }, [event.id, event.slug, qrSrc]);

  async function copyLink() {
    let ok = false;
    try {
      if (navigator.clipboard?.writeText && window.isSecureContext) {
        await navigator.clipboard.writeText(guestUrl);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok) {
      try {
        // iOS Safari fallback: needs a visible, non-readonly field + range selection.
        const ta = document.createElement("textarea");
        ta.value = guestUrl;
        ta.setAttribute("readonly", "");
        ta.contentEditable = "true";
        ta.style.position = "fixed";
        ta.style.top = "0";
        ta.style.left = "0";
        ta.style.width = "1px";
        ta.style.height = "1px";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        const range = document.createRange();
        range.selectNodeContents(ta);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        ta.setSelectionRange(0, guestUrl.length);
        ok = document.execCommand("copy");
        sel?.removeAllRanges();
        document.body.removeChild(ta);
      } catch {
        ok = false;
      }
    }
    if (!ok && typeof navigator.share === "function") {
      try {
        await navigator.share({ url: guestUrl });
        ok = true;
      } catch {
        /* user cancelled */
      }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  async function downloadQr() {
    const safeName = (event.event_name ?? "wedding")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "wedding";
    const filename = `mosaic_${safeName}_qr.png`;

    // Always build a fresh, self-contained PNG blob (data: URLs and cross-origin
    // links don't honour the download attribute on iOS Safari).
    let blob: Blob | null = null;
    try {
      const dataUrl = qrSrc?.startsWith("data:") ? qrSrc : await generateQrDataUrl(event.slug);
      blob = await (await fetch(dataUrl)).blob();
    } catch {
      blob = null;
    }
    if (!blob) return;

    // iOS/Android: the share sheet is the only reliable "save image" path.
    const file = new File([blob], filename, { type: "image/png" });
    const canShareFile =
      typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });
    if (canShareFile && typeof navigator.share === "function") {
      try {
        await navigator.share({ files: [file], title: filename });
        return;
      } catch {
        /* fall through to download */
      }
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }


  return (
    <section>
      <article className="overflow-hidden rounded-[1rem] surface-fade shadow-[var(--shadow-soft)]">
        <div className="flex flex-col items-center gap-4 px-5 py-5 text-center md:flex-row md:items-center md:justify-between md:gap-8 md:px-7 md:py-6 md:text-left">
          <div className="w-full md:flex-1">
            <p className="text-eyebrow md:text-left">Guest page</p>
            <p className="mt-2 truncate text-sm text-foreground/80 md:text-base">
              {guestUrl.replace(/^https?:\/\//, "")}
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5 md:mt-4 md:justify-start">
              <button
                type="button"
                onClick={copyLink}
                className="inline-flex min-w-[7.5rem] items-center justify-center gap-2 whitespace-nowrap rounded-full border border-border/70 bg-[color:var(--ivory)] px-5 py-[3px] text-[0.6rem] font-medium tracking-[0.18em] uppercase text-foreground/80 transition-colors hover:border-primary hover:text-primary md:py-1.5"
              >
                {copied ? <Check className="h-3 w-3" strokeWidth={1.6} /> : <Copy className="h-3 w-3" strokeWidth={1.6} />}
                {copied ? "Copied" : "Copy link"}
              </button>
              <a
                href={guestUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-[color:var(--primary)] px-6 py-[3px] text-[0.6rem] font-medium tracking-[0.18em] uppercase text-[color:var(--ivory)] transition-opacity hover:opacity-90 md:py-1.5"
              >
                Visit ↗
              </a>
            </div>
          </div>

          <div className="h-px w-16 bg-border/60 md:hidden" />

          <div className="flex flex-row items-center gap-5 md:shrink-0 md:gap-5">
            {qrSrc ? (
              <img
                src={qrSrc}
                alt={`QR code for ${event.event_name ?? "wedding"}`}
                className="h-28 w-28 rounded-xl bg-[color:var(--ivory)] p-1.5 shadow-sm md:h-32 md:w-32 md:p-2"
              />
            ) : (
              <div className="h-28 w-28 animate-pulse rounded-xl bg-card md:h-32 md:w-32" />
            )}
            <div className="flex flex-col items-center gap-2 md:items-start md:gap-2.5">
              <p className="text-eyebrow">Scan to share</p>
              <button
                type="button"
                onClick={downloadQr}
                className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-[color:var(--ivory)] px-4 py-[3px] text-[0.6rem] font-medium tracking-[0.18em] uppercase text-foreground/75 transition-colors hover:border-primary hover:text-primary md:py-1.5"
              >
                <Download className="h-3 w-3" strokeWidth={1.6} />
                Download QR
              </button>
            </div>
          </div>
        </div>
      </article>
    </section>
  );
}


/* ------------------------------------------------------------------ */
/* 2. Live Overview                                                     */
/* ------------------------------------------------------------------ */

function LiveOverview({ stats }: { stats: DashboardStats }) {
  const items = [
    { label: "Photos", value: stats.photos, icon: Camera },
    { label: "Guests", value: stats.guests, icon: UsersIcon },
    { label: "Messages", value: stats.messages, icon: MessageCircle },
    {
      label: "Mosaic",
      value: mosaicStatusLabel(stats.mosaicStatus, stats.photos),
      icon: Sparkles,
      isText: true,
    },
  ];
  return (
    <section>
      <p className="text-eyebrow text-center">Live overview</p>
      <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-5">
        {items.map((it) => {
          const Icon = it.icon;
          return (
            <div
              key={it.label}
              className="rounded-2xl surface-fade p-5 md:p-6"
            >
              <Icon className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
              <p
                className={`mt-4 text-display ${
                  it.isText ? "text-2xl md:text-[1.75rem]" : "text-4xl md:text-5xl"
                } text-foreground`}
              >
                {it.value}
              </p>
              <p className="text-eyebrow mt-2 text-[0.6rem]">{it.label}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function mosaicStatusLabel(status: MosaicStatus | null, photos: number): string {
  if (status === "ready") return "Ready";
  if (status === "processing") return "Crafting";
  if (status === "pending") return "Queued";
  return photos >= 50 ? "Ready to craft" : "Growing";
}

/* ------------------------------------------------------------------ */
/* 3. Recent Activity                                                   */
/* ------------------------------------------------------------------ */

function RecentActivity({ items }: { items: ActivityItem[] }) {
  return (
    <section>
      <p className="text-eyebrow text-center">Recent activity</p>
      <div className="mt-8 overflow-hidden rounded-3xl surface-fade">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <div className="hairline" />
            <p className="text-script mt-6 text-2xl text-foreground/70">
              The story is about to begin
            </p>
            <p className="mt-3 max-w-xs text-sm text-muted-foreground">
              Share your guest page and watch the first memories arrive here.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border/50">
            {items.map((it) => (
              <li
                key={it.id}
                className="flex items-center gap-4 px-5 py-4 md:px-7 md:py-5"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[color:var(--champagne)]/50 text-display text-base text-foreground/70">
                  {it.who.charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">
                    <span className="font-medium">{it.who}</span>{" "}
                    <span className="text-muted-foreground">{it.detail}.</span>
                  </p>
                  <p className="text-eyebrow mt-1 text-[0.55rem]">
                    {formatRelative(it.at)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/* ------------------------------------------------------------------ */
/* 4. Mosaic Status                                                     */
/* ------------------------------------------------------------------ */

function MosaicStatusSection({
  photos,
  status,
}: {
  photos: number;
  status: MosaicStatus | null;
}) {
  const headline =
    status === "ready"
      ? "Ready"
      : status === "processing"
        ? "Crafting"
        : photos >= 1000
          ? "Flourishing"
          : photos >= 250
            ? "Blooming"
            : photos >= 50
              ? "Taking shape"
              : "Growing";

  const progress = Math.min(100, Math.round((photos / 1000) * 100));

  return (
    <section>
      <p className="text-eyebrow text-center">Your Mosaic</p>
      <div className="mt-8 overflow-hidden rounded-[2rem] surface-fade p-8 md:p-12">
        <p className="text-display text-3xl text-foreground md:text-4xl">{headline}</p>
        <p className="mt-3 text-display text-4xl text-foreground md:text-6xl">
          {photos} <span className="text-script text-2xl text-foreground/60 md:text-4xl">memories collected</span>
        </p>


        <div className="mt-8 max-w-xl">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--ink)]/8">
            <div
              className="h-full rounded-full bg-[color:var(--primary)] transition-all duration-700"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="mt-3 flex justify-between text-eyebrow text-[0.55rem]">
            <span>{photos} so far</span>
            <span>{photos >= 1000 ? "Ideal reached" : "1,000 ideal"}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 5. Quick Actions                                                     */
/* ------------------------------------------------------------------ */

function QuickActions({ event }: { event: Event }) {
  const guestUrl = guestUrlForSlug(event.slug);
  const [copied, setCopied] = useState(false);

  const actions = useMemo(
    () => [
      {
        label: "Open guest page",
        icon: ExternalLink,
        href: guestUrl,
        external: true,
      },
      {
        label: copied ? "Copied" : "Copy guest link",
        icon: copied ? Check : Copy,
        onClick: async () => {
          await navigator.clipboard.writeText(guestUrl);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        },
      },
      {
        label: "View gallery",
        icon: ImagesIcon,
        to: "/gallery" as const,
      },
      {
        label: "Download originals",
        icon: Download,
        to: "/gallery" as const,
        hash: "download-all",
      },
    ],
    [copied, guestUrl],
  );

  return (
    <section className="pb-4">
      <p className="text-eyebrow text-center">Quick actions</p>
      <div className="mt-6 grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-3">
        {actions.map((a) => {
          const Icon = a.icon;
          const inner = (
            <>
              <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.5} />
              <span className="truncate text-[0.6rem] font-medium tracking-[0.16em] uppercase text-foreground/75">{a.label}</span>
            </>
          );
          const className =
            "flex items-center gap-2 rounded-full border border-border/60 bg-[color:var(--ivory)] px-4 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-[color:var(--champagne)]/35";
          if ("onClick" in a && a.onClick) {
            return (
              <button key={a.label} type="button" onClick={a.onClick} className={className}>
                {inner}
              </button>
            );
          }
          if ("href" in a && a.href) {
            return (
              <a
                key={a.label}
                href={a.href}
                target={a.external ? "_blank" : undefined}
                rel={a.external ? "noreferrer" : undefined}
                className={className}
              >
                {inner}
              </a>
            );
          }
          return (
            <Link key={a.label} to={a.to!} hash={"hash" in a ? a.hash : undefined} className={className}>
              {inner}
            </Link>
          );
        })}
      </div>
    </section>
  );
}

