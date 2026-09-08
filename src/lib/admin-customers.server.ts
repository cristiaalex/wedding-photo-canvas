import type { SupabaseClient } from "@supabase/supabase-js";

import { adminSupabase } from "./billing.server";

/**
 * Server-only Customers / Customer 360 data layer for the Mosaic back-office.
 *
 * Never importable from the browser: it uses the service-role client. Callers
 * (admin.functions.ts) must have passed `requireAdmin()` first — this module
 * performs no authorization of its own by design, exactly like admin.server.ts.
 *
 * Everything here is derived from EXISTING tables:
 *   auth.users, public.events, public.uploads, public.guestbook_messages,
 *   public.mosaics, public.download_batches, public.subscriptions
 * No new tables, no schema changes, no RLS changes.
 */

/* ------------------------------------------------------------------ */
/* Types                                                                */
/* ------------------------------------------------------------------ */

export type CustomerListItem = {
  userId: string;
  email: string | null;
  name: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  eventCount: number;
  photoCount: number;
  isPro: boolean;
  purchaseStatus: string | null;
  paidAt: string | null;
  lastActivityAt: string | null;
};

export type CustomerFilter =
  | "all"
  | "pro"
  | "free"
  | "has_event"
  | "no_event"
  | "has_payment"
  | "payment_failed";

export type CustomerListResult = {
  items: CustomerListItem[];
  total: number;
  page: number;
  pageSize: number;
  generatedAt: string;
};

export type CustomerEvent = {
  id: string;
  name: string | null;
  slug: string;
  weddingDate: string | null;
  venue: string | null;
  createdAt: string;
  plan: string | null;
  photoCount: number;
  ownerPhotoCount: number;
  guestPhotoCount: number;
  guestCount: number;
  guestbookEnabled: boolean;
  guestbookPublic: boolean;
  guestbookCount: number;
  galleryVisibleToGuests: boolean;
  mosaicStatus: string | null;
  mosaicProgress: number | null;
  mosaicCompletedAt: string | null;
  zipStatus: string | null;
  zipCount: number;
  zipBytes: number | null;
};

export type CustomerBilling = {
  plan: "free" | "pro";
  records: Array<{
    id: string;
    status: string | null;
    paidAt: string | null;
    amountTotal: number | null;
    currency: string | null;
    stripeCustomerId: string | null;
    stripePaymentIntentId: string | null;
    stripeCheckoutSessionId: string | null;
    stripePriceId: string | null;
    eventId: string | null;
    createdAt: string;
    updatedAt: string | null;
  }>;
};

export type TimelineEntry = {
  at: string;
  kind: string;
  label: string;
  detail?: string | null;
};

export type Customer360 = {
  account: {
    userId: string;
    email: string | null;
    name: string | null;
    createdAt: string;
    lastSignInAt: string | null;
    emailConfirmedAt: string | null;
    bannedUntil: string | null;
  };
  events: CustomerEvent[];
  usage: {
    events: number;
    photos: number;
    ownerPhotos: number;
    guestPhotos: number;
    guests: number;
    guestbookEntries: number;
    mosaicsReady: number;
    zipsCompleted: number;
    zipBytes: number;
  };
  billing: CustomerBilling;
  timeline: TimelineEntry[];
  generatedAt: string;
};

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

type AuthUser = {
  id: string;
  email: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
  banned_until: string | null;
  name: string | null;
};

function displayName(meta: Record<string, unknown> | null | undefined): string | null {
  if (!meta) return null;
  for (const key of ["full_name", "name", "display_name"]) {
    const v = meta[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

async function listAllAuthUsers(admin: SupabaseClient): Promise<AuthUser[]> {
  const out: AuthUser[] = [];
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    const batch = data?.users ?? [];
    for (const u of batch) {
      out.push({
        id: u.id,
        email: u.email ?? null,
        created_at: u.created_at ?? new Date(0).toISOString(),
        last_sign_in_at: u.last_sign_in_at ?? null,
        email_confirmed_at: (u as { email_confirmed_at?: string }).email_confirmed_at ?? null,
        banned_until: (u as { banned_until?: string }).banned_until ?? null,
        name: displayName(u.user_metadata as Record<string, unknown>),
      });
    }
    if (batch.length < 1000) break;
  }
  return out;
}

type EventRow = {
  id: string;
  organizer_id: string | null;
  event_name: string | null;
  slug: string;
  wedding_date: string | null;
  venue: string | null;
  created_at: string;
  plan: string | null;
  guestbook_enabled: boolean | null;
  guestbook_public: boolean | null;
  guests_can_view_gallery: boolean | null;
};

async function fetchEvents(admin: SupabaseClient, organizerId?: string) {
  let q = admin
    .from("events")
    .select(
      "id, organizer_id, event_name, slug, wedding_date, venue, created_at, plan, guestbook_enabled, guestbook_public, guests_can_view_gallery",
    );
  if (organizerId) q = q.eq("organizer_id", organizerId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as EventRow[];
}

/** HEAD count — never pulls rows. */
async function countRows(
  admin: SupabaseClient,
  table: string,
  apply: (q: ReturnType<SupabaseClient["from"]>) => unknown,
): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = admin.from(table).select("*", { count: "exact", head: true });
  q = (apply as unknown as (x: unknown) => unknown)(q);
  const { count, error } = await q;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function inBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>) {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Customers list                                                       */
/* ------------------------------------------------------------------ */

export async function listCustomers(params: {
  search?: string;
  filter?: CustomerFilter;
  page?: number;
  pageSize?: number;
}): Promise<CustomerListResult> {
  const admin = adminSupabase();
  const pageSize = Math.min(50, Math.max(5, params.pageSize ?? 20));
  const page = Math.max(1, params.page ?? 1);
  const search = (params.search ?? "").trim().toLowerCase();
  const filter = params.filter ?? "all";

  const [users, events, subsRes] = await Promise.all([
    listAllAuthUsers(admin),
    fetchEvents(admin),
    admin.from("subscriptions").select("*"),
  ]);
  if (subsRes.error) throw new Error(subsRes.error.message);

  const subs = (subsRes.data ?? []) as Array<Record<string, unknown>>;
  const subsByUser = new Map<string, Array<Record<string, unknown>>>();
  for (const s of subs) {
    const uid = String(s["user_id"] ?? "");
    if (!uid) continue;
    const list = subsByUser.get(uid) ?? [];
    list.push(s);
    subsByUser.set(uid, list);
  }

  const eventsByUser = new Map<string, EventRow[]>();
  for (const e of events) {
    if (!e.organizer_id) continue;
    const list = eventsByUser.get(e.organizer_id) ?? [];
    list.push(e);
    eventsByUser.set(e.organizer_id, list);
  }

  // Search across email / name / user id / event name / event id — resolved
  // to a user-id set before any expensive per-customer work happens.
  let candidates = users;
  if (search) {
    const matchedByEvent = new Set(
      events
        .filter(
          (e) =>
            e.id.toLowerCase() === search ||
            (e.event_name ?? "").toLowerCase().includes(search) ||
            e.slug.toLowerCase().includes(search),
        )
        .map((e) => e.organizer_id)
        .filter((v): v is string => !!v),
    );
    candidates = users.filter(
      (u) =>
        (u.email ?? "").toLowerCase().includes(search) ||
        (u.name ?? "").toLowerCase().includes(search) ||
        u.id.toLowerCase() === search ||
        matchedByEvent.has(u.id),
    );
  }

  const isPaid = (s: Record<string, unknown>) =>
    s["status"] === "paid" || !!s["paid_at"];
  const isFailed = (s: Record<string, unknown>) =>
    typeof s["status"] === "string" &&
    ["failed", "payment_failed", "canceled", "incomplete_expired"].includes(
      s["status"] as string,
    );

  candidates = candidates.filter((u) => {
    const evs = eventsByUser.get(u.id) ?? [];
    const userSubs = subsByUser.get(u.id) ?? [];
    switch (filter) {
      case "pro":
        return userSubs.some(isPaid);
      case "free":
        return !userSubs.some(isPaid);
      case "has_event":
        return evs.length > 0;
      case "no_event":
        return evs.length === 0;
      case "has_payment":
        return userSubs.length > 0;
      case "payment_failed":
        return userSubs.some(isFailed);
      default:
        return true;
    }
  });

  candidates.sort((a, b) => b.created_at.localeCompare(a.created_at));

  const total = candidates.length;
  const slice = candidates.slice((page - 1) * pageSize, page * pageSize);

  // Photo counts only for the visible page — HEAD counts, never row loads.
  const pageEventIds = slice.flatMap((u) =>
    (eventsByUser.get(u.id) ?? []).map((e) => e.id),
  );
  const counts = new Map<string, number>();
  await inBatches(pageEventIds, 8, async (eventId) => {
    counts.set(
      eventId,
      await countRows(admin, "uploads", (q) =>
        (q as unknown as { eq: (a: string, b: string) => unknown }).eq(
          "event_id",
          eventId,
        ),
      ),
    );
  });

  // Newest upload per visible customer = the only reliable "last activity".
  const lastUploads = new Map<string, string | null>();
  await inBatches(slice, 6, async (u) => {
    const ids = (eventsByUser.get(u.id) ?? []).map((e) => e.id);
    if (ids.length === 0) {
      lastUploads.set(u.id, null);
      return;
    }
    const { data, error } = await admin
      .from("uploads")
      .select("uploaded_at")
      .in("event_id", ids)
      .order("uploaded_at", { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    lastUploads.set(u.id, data?.[0]?.uploaded_at ?? null);
  });

  const items: CustomerListItem[] = slice.map((u) => {
    const evs = eventsByUser.get(u.id) ?? [];
    const userSubs = subsByUser.get(u.id) ?? [];
    const paidSub = userSubs.find(isPaid) ?? null;
    const anySub = paidSub ?? userSubs[0] ?? null;
    const photos = evs.reduce((sum, e) => sum + (counts.get(e.id) ?? 0), 0);
    const activityCandidates = [
      u.last_sign_in_at,
      lastUploads.get(u.id) ?? null,
      ...evs.map((e) => e.created_at),
    ].filter((v): v is string => !!v);

    return {
      userId: u.id,
      email: u.email,
      name: u.name,
      createdAt: u.created_at,
      lastSignInAt: u.last_sign_in_at,
      eventCount: evs.length,
      photoCount: photos,
      isPro: !!paidSub,
      purchaseStatus: anySub ? ((anySub["status"] as string) ?? null) : null,
      paidAt: paidSub ? ((paidSub["paid_at"] as string) ?? null) : null,
      lastActivityAt:
        activityCandidates.length > 0
          ? activityCandidates.sort((a, b) => b.localeCompare(a))[0]!
          : null,
    };
  });

  return {
    items,
    total,
    page,
    pageSize,
    generatedAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Customer 360                                                         */
/* ------------------------------------------------------------------ */

export async function getCustomer360(userId: string): Promise<Customer360> {
  const admin = adminSupabase();

  const { data: userRes, error: userErr } = await admin.auth.admin.getUserById(userId);
  if (userErr || !userRes?.user) throw new Error("Customer not found");
  const u = userRes.user;

  const events = await fetchEvents(admin, userId);
  const eventIds = events.map((e) => e.id);

  const [subsRes, mosaicsRes, zipsRes, guestbookRes] = await Promise.all([
    admin.from("subscriptions").select("*").eq("user_id", userId),
    eventIds.length
      ? admin
          .from("mosaics")
          .select("id, event_id, status, stage, progress, created_at, completed_at")
          .in("event_id", eventIds)
      : Promise.resolve({ data: [], error: null }),
    eventIds.length
      ? admin
          .from("download_batches")
          .select("id, event_id, status, size_bytes, photo_count, created_at, completed_at")
          .in("event_id", eventIds)
      : Promise.resolve({ data: [], error: null }),
    eventIds.length
      ? admin
          .from("guestbook_messages")
          .select("id, event_id, created_at")
          .in("event_id", eventIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const r of [subsRes, mosaicsRes, zipsRes, guestbookRes]) {
    if ((r as { error?: { message: string } | null }).error) {
      throw new Error((r as { error: { message: string } }).error.message);
    }
  }

  const subs = (subsRes.data ?? []) as Array<Record<string, unknown>>;
  const mosaics = (mosaicsRes.data ?? []) as Array<{
    id: string;
    event_id: string;
    status: string | null;
    stage: string | null;
    progress: number | null;
    created_at: string;
    completed_at: string | null;
  }>;
  const zips = (zipsRes.data ?? []) as Array<{
    id: string;
    event_id: string;
    status: string | null;
    size_bytes: number | null;
    photo_count: number | null;
    created_at: string;
    completed_at: string | null;
  }>;
  const guestbook = (guestbookRes.data ?? []) as Array<{
    id: string;
    event_id: string;
    created_at: string;
  }>;

  // Per-event upload aggregates: three HEAD counts + distinct-guest sample.
  const perEvent = await inBatches(events, 4, async (e) => {
    const [total, owner] = await Promise.all([
      countRows(admin, "uploads", (q) =>
        (q as unknown as { eq: (a: string, b: string) => unknown }).eq("event_id", e.id),
      ),
      countRows(admin, "uploads", (q) =>
        (
          q as unknown as {
            eq: (a: string, b: string | boolean) => { eq: (a: string, b: boolean) => unknown };
          }
        )
          .eq("event_id", e.id)
          .eq("uploaded_by_owner", true),
      ),
    ]);

    // Distinct guests: guest_uuid is the identity key used by the guest app.
    const guestIds = new Set<string>();
    for (let from = 0; from < 20000; from += 1000) {
      const { data, error } = await admin
        .from("uploads")
        .select("guest_uuid")
        .eq("event_id", e.id)
        .not("guest_uuid", "is", null)
        .range(from, from + 999);
      if (error) throw new Error(error.message);
      for (const row of data ?? []) {
        const g = (row as { guest_uuid: string | null }).guest_uuid;
        if (g) guestIds.add(g);
      }
      if ((data?.length ?? 0) < 1000) break;
    }

    const m = mosaics
      .filter((x) => x.event_id === e.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    const eventZips = zips.filter((z) => z.event_id === e.id);
    const zipBytes = eventZips.reduce((s, z) => s + (z.size_bytes ?? 0), 0);

    const ev: CustomerEvent = {
      id: e.id,
      name: e.event_name,
      slug: e.slug,
      weddingDate: e.wedding_date,
      venue: e.venue,
      createdAt: e.created_at,
      plan: e.plan,
      photoCount: total,
      ownerPhotoCount: owner,
      guestPhotoCount: Math.max(0, total - owner),
      guestCount: guestIds.size,
      guestbookEnabled: e.guestbook_enabled !== false,
      guestbookPublic: e.guestbook_public !== false,
      guestbookCount: guestbook.filter((g) => g.event_id === e.id).length,
      galleryVisibleToGuests: e.guests_can_view_gallery !== false,
      mosaicStatus: m?.status ?? null,
      mosaicProgress: m?.progress ?? null,
      mosaicCompletedAt: m?.completed_at ?? null,
      zipStatus: eventZips.length
        ? (eventZips.sort((a, b) => b.created_at.localeCompare(a.created_at))[0]?.status ??
          null)
        : null,
      zipCount: eventZips.length,
      zipBytes: eventZips.length ? zipBytes : null,
    };
    return ev;
  });

  perEvent.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const usage = {
    events: perEvent.length,
    photos: perEvent.reduce((s, e) => s + e.photoCount, 0),
    ownerPhotos: perEvent.reduce((s, e) => s + e.ownerPhotoCount, 0),
    guestPhotos: perEvent.reduce((s, e) => s + e.guestPhotoCount, 0),
    guests: perEvent.reduce((s, e) => s + e.guestCount, 0),
    guestbookEntries: guestbook.length,
    mosaicsReady: mosaics.filter((m) => m.status === "ready").length,
    zipsCompleted: zips.filter((z) => z.status === "completed").length,
    zipBytes: zips.reduce((s, z) => s + (z.size_bytes ?? 0), 0),
  };

  const billing: CustomerBilling = {
    plan: subs.some((s) => s["status"] === "paid" || !!s["paid_at"]) ? "pro" : "free",
    records: subs
      .map((s) => ({
        id: String(s["id"]),
        status: (s["status"] as string) ?? null,
        paidAt: (s["paid_at"] as string) ?? null,
        amountTotal: (s["amount_total"] as number) ?? null,
        currency: (s["currency"] as string) ?? null,
        stripeCustomerId: (s["stripe_customer_id"] as string) ?? null,
        stripePaymentIntentId: (s["stripe_payment_intent_id"] as string) ?? null,
        stripeCheckoutSessionId: (s["stripe_checkout_session_id"] as string) ?? null,
        stripePriceId: (s["stripe_price_id"] as string) ?? null,
        eventId: (s["event_id"] as string) ?? null,
        createdAt: String(s["created_at"] ?? ""),
        updatedAt: (s["updated_at"] as string) ?? null,
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };

  /* Timeline — every entry is a real timestamp from a real row. */
  const timeline: TimelineEntry[] = [];
  timeline.push({
    at: u.created_at ?? new Date(0).toISOString(),
    kind: "account",
    label: "Account created",
    detail: u.email ?? null,
  });
  for (const e of perEvent) {
    timeline.push({
      at: e.createdAt,
      kind: "event",
      label: "Event created",
      detail: e.name ?? e.slug,
    });
  }
  // Photo activity is summarised per event by first/last upload (no fabrication).
  await inBatches(events, 4, async (e) => {
    const first = await admin
      .from("uploads")
      .select("uploaded_at")
      .eq("event_id", e.id)
      .order("uploaded_at", { ascending: true })
      .limit(1);
    const last = await admin
      .from("uploads")
      .select("uploaded_at")
      .eq("event_id", e.id)
      .order("uploaded_at", { ascending: false })
      .limit(1);
    const f = first.data?.[0]?.uploaded_at as string | undefined;
    const l = last.data?.[0]?.uploaded_at as string | undefined;
    if (f) {
      timeline.push({
        at: f,
        kind: "upload",
        label: "First photo uploaded",
        detail: e.event_name ?? e.slug,
      });
    }
    if (l && l !== f) {
      timeline.push({
        at: l,
        kind: "upload",
        label: "Most recent photo uploaded",
        detail: e.event_name ?? e.slug,
      });
    }
  });
  for (const m of mosaics) {
    timeline.push({
      at: m.created_at,
      kind: "mosaic",
      label: "Mosaic generation started",
      detail: m.status ?? null,
    });
    if (m.completed_at) {
      timeline.push({ at: m.completed_at, kind: "mosaic", label: "Mosaic completed" });
    }
  }
  for (const z of zips) {
    timeline.push({
      at: z.created_at,
      kind: "zip",
      label: "Archive requested",
      detail: `${z.photo_count ?? 0} photos`,
    });
    if (z.completed_at && z.status === "completed") {
      timeline.push({ at: z.completed_at, kind: "zip", label: "Archive ready" });
    }
  }
  for (const s of billing.records) {
    if (s.createdAt) {
      timeline.push({
        at: s.createdAt,
        kind: "payment",
        label: "Checkout started",
        detail: s.stripeCustomerId,
      });
    }
    if (s.paidAt) {
      timeline.push({ at: s.paidAt, kind: "payment", label: "Payment succeeded" });
      timeline.push({ at: s.paidAt, kind: "pro", label: "Pro activated" });
    }
  }
  if (u.last_sign_in_at) {
    timeline.push({ at: u.last_sign_in_at, kind: "account", label: "Last sign-in" });
  }
  timeline.sort((a, b) => b.at.localeCompare(a.at));

  return {
    account: {
      userId: u.id,
      email: u.email ?? null,
      name: displayName(u.user_metadata as Record<string, unknown>),
      createdAt: u.created_at ?? new Date(0).toISOString(),
      lastSignInAt: u.last_sign_in_at ?? null,
      emailConfirmedAt:
        (u as { email_confirmed_at?: string }).email_confirmed_at ?? null,
      bannedUntil: (u as { banned_until?: string }).banned_until ?? null,
    },
    events: perEvent,
    usage,
    billing,
    timeline,
    generatedAt: new Date().toISOString(),
  };
}
