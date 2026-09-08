import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Camera,
  MessageCircle,
  Search,
  X,
  Sparkles,
  Trophy,
  UserPlus,
  TrendingUp,
  Mail,
  ExternalLink,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PageStack, PageState } from "@/components/page-layout";
import { supabase } from "@/lib/supabase";
import { guestUrlForSlug } from "@/lib/qr";
import type { Event } from "@/lib/database.types";
import { displayGuestName } from "@/lib/guest-identity";
import { fetchAllUploads } from "@/lib/fetch-all-uploads";

export const Route = createFileRoute("/_authenticated/guests")({
  head: () => ({
    meta: [
      { title: "Guests — Mosaic" },
      { name: "description", content: "The people building your wedding story." },
    ],
  }),
  component: GuestsPage,
});

/* ------------------------------------------------------------------ */
/* Types                                                                */
/* ------------------------------------------------------------------ */

type UploadRow = { id: string; guest_name: string | null; guest_uuid: string | null; uploaded_at: string };
type MessageRow = {
  id: string;
  guest_name: string | null;
  message: string;
  created_at: string;
};

type Contributor = {
  name: string; // display name ("A guest" if anonymous)
  isAnonymous: boolean;
  photos: number;
  messages: number;
  firstAt: string;
  lastAt: string;
  timeline: TimelineEntry[];
};

type TimelineEntry = {
  kind: "upload" | "guestbook";
  at: string;
  detail: string;
};

type ActivityItem = {
  id: string;
  kind: "upload" | "guestbook" | "join";
  who: string;
  detail: string;
  at: string;
};

const ANON = "A guest";

/* ------------------------------------------------------------------ */
/* Page                                                                 */
/* ------------------------------------------------------------------ */

function GuestsPage() {
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [query, setQuery] = useState("");
  const [openGuest, setOpenGuest] = useState<Contributor | null>(null);

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
        setLoading(false);
        return;
      }
      const ev = events[0];
      setEvent(ev);

      const [uploadRows, { data: messageRows }] = await Promise.all([
        fetchAllUploads<UploadRow>(ev.id, {
          columns: "id, guest_name, guest_uuid, uploaded_at",
          order: { column: "uploaded_at", ascending: false },
          logTag: "guests",
        }),
        supabase
          .from("guestbook_messages")
          .select("id, guest_name, message, created_at")
          .eq("event_id", ev.id)
          .order("created_at", { ascending: false }),
      ]);


      if (cancelled) return;
      setUploads(uploadRows ?? []);
      setMessages(messageRows ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Build contributors from uploads + messages.
  // Anonymous guests (stored as `__anon__:<uuid>`) collapse into a single
  // "Anonymous guest" bucket via `displayGuestName()` so owners never see
  // the raw technical marker.
  const contributors = useMemo(() => {
    // Uploads are grouped by the stable per-device guest_uuid so renaming
    // (Anonymous → Madalin) does NOT create a new contributor. Legacy rows
    // and guestbook messages (no guest_uuid column) fall back to the
    // display name. We also build uuid→displayName so a message whose name
    // matches a known contributor merges into the same bucket.
    const map = new Map<string, Contributor>();
    const nameToKey = new Map<string, string>();
    const displayOf = (name: string | null) => {
      const d = displayGuestName(name);
      return d && d.trim() ? d.trim() : ANON;
    };

    for (const u of uploads) {
      const uuid = u.guest_uuid?.trim();
      const display = displayOf(u.guest_name);
      const key = uuid ? `uuid:${uuid}` : `name:${display.toLowerCase()}`;
      const c = map.get(key) ?? emptyContributor(display);
      c.name = display; // latest name wins
      c.photos += 1;
      c.timeline.push({ kind: "upload", at: u.uploaded_at, detail: "Uploaded a photo" });
      if (!c.firstAt || u.uploaded_at < c.firstAt) c.firstAt = u.uploaded_at;
      if (!c.lastAt || u.uploaded_at > c.lastAt) c.lastAt = u.uploaded_at;
      map.set(key, c);
      nameToKey.set(display.toLowerCase(), key);
    }
    for (const m of messages) {
      const display = displayOf(m.guest_name);
      const key = nameToKey.get(display.toLowerCase()) ?? `name:${display.toLowerCase()}`;
      const c = map.get(key) ?? emptyContributor(display);
      c.messages += 1;
      c.timeline.push({ kind: "guestbook", at: m.created_at, detail: "Left a message" });
      if (!c.firstAt || m.created_at < c.firstAt) c.firstAt = m.created_at;
      if (!c.lastAt || m.created_at > c.lastAt) c.lastAt = m.created_at;
      map.set(key, c);
      nameToKey.set(display.toLowerCase(), key);
    }

    // Collapse same-hour uploads into "Uploaded N photos" entries per contributor.
    map.forEach((c) => {
      c.timeline = collapseTimeline(c.timeline);
    });

    return Array.from(map.values()).sort(
      (a, b) =>
        b.photos + b.messages - (a.photos + a.messages) ||
        (a.lastAt < b.lastAt ? 1 : -1),
    );
  }, [uploads, messages]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contributors;
    return contributors.filter((c) => c.name.toLowerCase().includes(q));
  }, [contributors, query]);

  // Activity feed: same shape as Dashboard, but a bit richer.
  const activity = useMemo<ActivityItem[]>(() => {
    const items: ActivityItem[] = [];
    // Group uploads by guest + hour bucket.
    const bucket = new Map<string, { count: number; at: string; who: string }>();
    for (const u of uploads) {
      const who = displayGuestName(u.guest_name) || ANON;
      const hour = u.uploaded_at.slice(0, 13);
      const key = `${who}::${hour}`;
      const cur = bucket.get(key);
      if (cur) {
        cur.count += 1;
        if (u.uploaded_at > cur.at) cur.at = u.uploaded_at;
      } else {
        bucket.set(key, { count: 1, at: u.uploaded_at, who });
      }
    }
    bucket.forEach(({ count, at, who }, key) => {
      items.push({
        id: `up-${key}`,
        kind: "upload",
        who,
        detail: count === 1 ? "uploaded a photo" : `uploaded ${count} photos`,
        at,
      });
    });
    for (const m of messages) {
      items.push({
        id: `gb-${m.id}`,
        kind: "guestbook",
        who: displayGuestName(m.guest_name) || ANON,
        detail: "left a guestbook message",
        at: m.created_at,
      });
    }
    // "Joined" — first contribution per named guest.
    for (const c of contributors) {
      if (!c.isAnonymous) {
        items.push({
          id: `join-${c.name}`,
          kind: "join",
          who: c.name,
          detail: "joined the event",
          at: c.firstAt,
        });
      }
    }
    return items.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 12);
  }, [uploads, messages, contributors]);

  const totals = useMemo(() => {
    // Match the contributors grouping: uploads keyed by guest_uuid (stable
    // across name changes), messages keyed by display name.
    return {
      guests: contributors.length,
      photos: uploads.length,
      messages: messages.length,
    };
  }, [contributors.length, uploads.length, messages.length]);

  // Insights.
  const insights = useMemo(() => {
    if (contributors.length === 0) {
      return {
        mostActive: null as Contributor | null,
        newest: null as Contributor | null,
        avg: 0,
        withMessages: 0,
      };
    }
    const mostActive = contributors[0];
    const newest = [...contributors]
      .filter((c) => !c.isAnonymous)
      .sort((a, b) => (a.firstAt < b.firstAt ? 1 : -1))[0];
    const totalMems = contributors.reduce(
      (n, c) => n + c.photos + c.messages,
      0,
    );
    return {
      mostActive,
      newest: newest ?? null,
      avg: Math.round((totalMems / contributors.length) * 10) / 10,
      withMessages: contributors.filter((c) => c.messages > 0).length,
    };
  }, [contributors]);

  if (loading) {
    return (
      <AppShell weddingName={event?.event_name ?? undefined}>
        <PageState>
          <p className="text-eyebrow text-muted-foreground">Gathering your guests…</p>
        </PageState>
      </AppShell>
    );
  }

  const noGuests = contributors.length === 0;

  return (
    <AppShell weddingName={event?.event_name ?? undefined}>
      <PageStack>
        <Hero totals={totals} />

        {noGuests ? (
          <EmptyGuests event={event} />
        ) : (
          <>
            <ActivityFeed items={activity} />
            <ContributorsSection
              contributors={filtered}
              query={query}
              setQuery={setQuery}
              onOpen={setOpenGuest}
            />
            <Insights insights={insights} />
          </>
        )}
      </PageStack>

      {openGuest && (
        <GuestDrawer guest={openGuest} onClose={() => setOpenGuest(null)} />
      )}
    </AppShell>
  );
}

/* ------------------------------------------------------------------ */
/* Hero                                                                 */
/* ------------------------------------------------------------------ */

function Hero({ totals }: { totals: { guests: number; photos: number; messages: number } }) {
  return (
    <header>
      <h1 className="text-display text-4xl md:text-6xl">Guests</h1>
      <div className="mt-6 hairline" />
      <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-3">
        <SummaryStat label="Total guests" value={totals.guests} />
        <SummaryStat label="Total memories" value={totals.photos} />
        <SummaryStat label="Guestbook messages" value={totals.messages} />
      </div>
    </header>
  );
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl surface-fade p-6">
      <p className="text-eyebrow text-muted-foreground">{label}</p>
      <p className="text-display mt-3 text-4xl">{value}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Activity feed                                                        */
/* ------------------------------------------------------------------ */

function ActivityFeed({ items }: { items: ActivityItem[] }) {
  return (
    <section>
      <SectionHeading title="Recent guest activity" />
      {items.length === 0 ? (
        <div className="mt-10 rounded-3xl surface-fade p-12 text-center shadow-[var(--shadow-soft)] md:p-16">
          <p className="text-display text-2xl md:text-3xl">No memories have arrived yet.</p>
          <p className="mx-auto mt-4 max-w-md text-sm leading-6 text-muted-foreground">
            When your guests begin sharing moments, they'll appear here.
          </p>
        </div>
      ) : (
        <ol className="mt-10 space-y-5">
          {items.map((it) => (
            <li
              key={it.id}
              className="flex items-start gap-4 rounded-2xl surface-fade p-5 md:p-6"
            >
              <Avatar name={it.who} />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-foreground">
                  <span className="font-medium">{it.who}</span>{" "}
                  <span className="text-muted-foreground">{it.detail}</span>
                </p>
                <p className="text-eyebrow mt-1 text-muted-foreground">
                  {humanTime(it.at)}
                </p>
              </div>
              <ActivityIcon kind={it.kind} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function ActivityIcon({ kind }: { kind: ActivityItem["kind"] }) {
  const Icon =
    kind === "upload" ? Camera : kind === "guestbook" ? MessageCircle : UserPlus;
  return (
    <span className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border/50 text-muted-foreground sm:inline-flex">
      <Icon className="h-4 w-4" />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Contributors                                                         */
/* ------------------------------------------------------------------ */

function ContributorsSection({
  contributors,
  query,
  setQuery,
  onOpen,
}: {
  contributors: Contributor[];
  query: string;
  setQuery: (v: string) => void;
  onOpen: (c: Contributor) => void;
}) {
  return (
    <section>
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <SectionHeading title="Your guests" />
        <label className="relative block w-full sm:w-72">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name"
            className="field pl-11"
          />
        </label>
      </div>

      {contributors.length === 0 ? (
        <p className="mt-10 text-sm text-muted-foreground">
          No guests match "{query}".
        </p>
      ) : (
        <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {contributors.map((c) => (
            <button
              key={c.name}
              onClick={() => onOpen(c)}
              className="group text-left rounded-3xl surface-fade p-6 shadow-[var(--shadow-soft)] transition hover:border-[color:var(--dusty)]/50 hover:surface-fade"
            >
              <div className="flex items-center gap-4">
                <Avatar name={c.name} size="lg" />
                <div className="min-w-0">
                  <p className="truncate text-base font-medium text-foreground">
                    {c.name}
                  </p>
                  <p className="text-eyebrow mt-1 text-muted-foreground">
                    Last seen {humanTime(c.lastAt)}
                  </p>
                </div>
              </div>
              <div className="mt-6 flex items-center gap-6 border-t border-border/40 pt-4 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Camera className="h-4 w-4" />
                  {c.photos}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <MessageCircle className="h-4 w-4" />
                  {c.messages}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Insights                                                             */
/* ------------------------------------------------------------------ */

function Insights({
  insights,
}: {
  insights: {
    mostActive: Contributor | null;
    newest: Contributor | null;
    avg: number;
    withMessages: number;
  };
}) {
  return (
    <section>
      <SectionHeading title="Insights" />
      <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <InsightCard
          icon={Trophy}
          label="Most active guest"
          value={insights.mostActive?.name ?? "—"}
          caption={
            insights.mostActive
              ? `${insights.mostActive.photos + insights.mostActive.messages} memories`
              : "Waiting for the first guest"
          }
        />
        <InsightCard
          icon={Sparkles}
          label="Newest contributor"
          value={insights.newest?.name ?? "—"}
          caption={
            insights.newest ? humanTime(insights.newest.firstAt) : "No one yet"
          }
        />
        <InsightCard
          icon={TrendingUp}
          label="Average memories"
          value={`${insights.avg}`}
          caption="per guest"
        />
        <InsightCard
          icon={Mail}
          label="Wrote a message"
          value={`${insights.withMessages}`}
          caption="guests"
        />
      </div>
    </section>
  );
}

function InsightCard({
  icon: Icon,
  label,
  value,
  caption,
}: {
  icon: typeof Trophy;
  label: string;
  value: string;
  caption: string;
}) {
  return (
    <div className="rounded-3xl surface-fade p-6 shadow-[var(--shadow-soft)]">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
        <p className="text-eyebrow">{label}</p>
      </div>
      <p className="text-display mt-4 truncate text-2xl">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{caption}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Guest drawer                                                         */
/* ------------------------------------------------------------------ */

function GuestDrawer({
  guest,
  onClose,
}: {
  guest: Contributor;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-foreground/40 backdrop-blur-sm"
      />
      <aside
        className="
          relative ml-auto flex h-full w-full flex-col bg-[color:var(--ivory)]
          shadow-[var(--shadow-soft)]
          sm:w-[440px] sm:border-l sm:border-border/60
          max-sm:mt-auto max-sm:h-[88%] max-sm:rounded-t-[1.75rem]
        "
      >
        <header className="flex items-start justify-between gap-4 border-b border-border/50 p-6 md:p-8">
          <div className="flex items-center gap-4">
            <Avatar name={guest.name} size="lg" />
            <div>
              <p className="text-eyebrow text-muted-foreground">Guest</p>
              <p className="text-display mt-1 text-2xl">{guest.name}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-border/60 p-2 text-muted-foreground transition hover:text-foreground"
            aria-label="Close panel"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-6 md:p-8">
          <div className="grid grid-cols-2 gap-4">
            <DrawerStat label="Photos" value={guest.photos} icon={Camera} />
            <DrawerStat label="Messages" value={guest.messages} icon={MessageCircle} />
          </div>

          <div className="mt-8 grid grid-cols-1 gap-3 text-sm">
            <DrawerLine label="First contribution" value={humanTime(guest.firstAt)} />
            <DrawerLine label="Latest contribution" value={humanTime(guest.lastAt)} />
          </div>

          <div className="mt-10">
            <p className="text-eyebrow text-muted-foreground">Timeline</p>
            <ol className="mt-4 space-y-3">
              {guest.timeline
                .slice()
                .sort((a, b) => (a.at < b.at ? 1 : -1))
                .map((t, idx) => (
                  <li
                    key={idx}
                    className="flex items-start gap-3 rounded-2xl surface-fade p-4"
                  >
                    <span className="mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border/50 text-muted-foreground">
                      {t.kind === "upload" ? (
                        <Camera className="h-3.5 w-3.5" />
                      ) : (
                        <MessageCircle className="h-3.5 w-3.5" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-foreground">{t.detail}</p>
                      <p className="text-eyebrow mt-1 text-muted-foreground">
                        {humanTime(t.at)}
                      </p>
                    </div>
                  </li>
                ))}
            </ol>
          </div>
        </div>
      </aside>
    </div>
  );
}

function DrawerStat({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: typeof Camera;
}) {
  return (
    <div className="rounded-2xl surface-fade p-5">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
        <p className="text-eyebrow">{label}</p>
      </div>
      <p className="text-display mt-3 text-3xl">{value}</p>
    </div>
  );
}

function DrawerLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border/40 py-2 last:border-0">
      <span className="text-eyebrow text-muted-foreground">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Empty state                                                          */
/* ------------------------------------------------------------------ */

function EmptyGuests({ event }: { event: Event | null }) {
  const url = event ? guestUrlForSlug(event.slug) : null;
  return (
    <section className="rounded-[1.75rem] surface-fade p-10 text-center shadow-[var(--shadow-soft)] md:p-16">
      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-border/50 bg-[color:var(--ivory)]">
        <Sparkles className="h-7 w-7 text-[color:var(--dusty)]" />
      </div>
      <h2 className="text-display mt-8 text-3xl md:text-4xl">
        Your first guests will appear here.
      </h2>
      <p className="mx-auto mt-5 max-w-lg text-sm leading-6 text-muted-foreground">
        As friends and family begin sharing memories, you'll see everyone who
        contributes to your wedding story.
      </p>
      {url && (
        <Link
          to="/e/$slug"
          params={{ slug: event!.slug }}
          className="btn-primary mt-8 inline-flex items-center gap-2"
        >
          <ExternalLink className="h-4 w-4" />
          Open guest page
        </Link>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Shared bits                                                          */
/* ------------------------------------------------------------------ */

function SectionHeading({ title }: { title: string }) {
  return (
    <div>
      <h2 className="text-display text-2xl md:text-3xl">{title}</h2>
      <div className="mt-4 h-px w-12 bg-[color:var(--dusty)]/50" />
    </div>
  );
}

function Avatar({
  name,
  size = "md",
}: {
  name: string;
  size?: "md" | "lg";
}) {
  const dims = size === "lg" ? "h-12 w-12 text-base" : "h-10 w-10 text-sm";
  const initial =
    name === ANON ? "?" : name.trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full border border-border/50 bg-[color:var(--ivory)] font-medium text-foreground ${dims}`}
    >
      {initial}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

function emptyContributor(name: string): Contributor {
  return {
    name,
    isAnonymous: name === ANON,
    photos: 0,
    messages: 0,
    firstAt: "",
    lastAt: "",
    timeline: [],
  };
}

function collapseTimeline(entries: TimelineEntry[]): TimelineEntry[] {
  // Group uploads by hour bucket; keep messages individual.
  const out: TimelineEntry[] = [];
  const buckets = new Map<string, { count: number; at: string }>();
  for (const e of entries) {
    if (e.kind === "guestbook") {
      out.push(e);
      continue;
    }
    const key = e.at.slice(0, 13);
    const cur = buckets.get(key);
    if (cur) {
      cur.count += 1;
      if (e.at > cur.at) cur.at = e.at;
    } else {
      buckets.set(key, { count: 1, at: e.at });
    }
  }
  buckets.forEach(({ count, at }) => {
    out.push({
      kind: "upload",
      at,
      detail: count === 1 ? "Uploaded a photo" : `Uploaded ${count} photos`,
    });
  });
  return out;
}

function humanTime(iso: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const sec = Math.round(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.round(hr / 24);
  if (day === 1) return "Yesterday";
  if (day < 7) return `${day} days ago`;
  const wk = Math.round(day / 7);
  if (wk < 5) return `${wk} week${wk === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
