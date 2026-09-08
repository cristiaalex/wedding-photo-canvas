import type { SupabaseClient } from "@supabase/supabase-js";

import { adminSupabase, requireOrganizer } from "./billing.server";
import { petEnv, PET_SERVER_ENV } from "./pet-env.server";

/**
 * Server-only admin authorization + metrics.
 *
 * Nothing here may be imported from the browser: it reaches the Pet
 * Supabase service-role client. The `.server.ts` suffix keeps it out of
 * client bundles, and `admin.functions.ts` loads it with a dynamic import.
 *
 * Admin identity is configuration, not data: the Pet-specific allow-list
 * lives in the server-only env var PET_ADMIN_EMAILS (comma separated). There
 * is no admin registration flow and no client-trusted admin flag.
 */

function allowedAdminEmails(): string[] {
  const raw = petEnv("ADMIN_EMAILS") ?? "";
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export class AdminForbiddenError extends Error {
  constructor() {
    super("Forbidden");
  }
}

export type AdminIdentity = { userId: string; email: string };

/**
 * Resolves the caller from the request bearer token and verifies that they
 * are the configured Mosaic administrator. Throws otherwise.
 */
export async function requireAdmin(
  authHeader: string | null | undefined,
): Promise<AdminIdentity> {
  const organizer = await requireOrganizer(authHeader); // throws Unauthorized
  const email = (organizer.email ?? "").toLowerCase();
  const allowed = allowedAdminEmails();

  if (allowed.length === 0) {
    console.error(`[admin] ${PET_SERVER_ENV.ADMIN_EMAILS} is not configured`);
    throw new AdminForbiddenError();
  }
  if (!email || !allowed.includes(email)) {
    throw new AdminForbiddenError();
  }
  return { userId: organizer.userId, email };
}

/**
 * Audit-log seam. Future admin mutations call this so every privileged action
 * is recorded. Writes are best-effort: if the `admin_audit_log` table has not
 * been provisioned yet, the action still succeeds and we only log locally.
 */
export async function recordAdminAction(
  actor: AdminIdentity,
  action: string,
  target?: { type?: string; id?: string | null; detail?: unknown },
): Promise<void> {
  try {
    const { error } = await adminSupabase()
      .from("admin_audit_log")
      .insert({
        actor_user_id: actor.userId,
        actor_email: actor.email,
        action,
        target_type: target?.type ?? null,
        target_id: target?.id ?? null,
        detail: target?.detail ?? null,
      });
    if (error) throw new Error(error.message);
  } catch (err) {
    console.warn("[admin] audit log unavailable", action, err);
  }
}

/* ------------------------------------------------------------------ */
/* Metrics                                                              */
/* ------------------------------------------------------------------ */

export type MonthPoint = { month: string; value: number };

export type AdminOverview = {
  totals: {
    customers: number;
    events: number;
    proCustomers: number;
    revenueCents: number;
    currency: string;
    conversionRate: number; // 0..1
    photos: number;
  };
  trends: {
    revenueCents: MonthPoint[];
    newCustomers: MonthPoint[];
    proPurchases: MonthPoint[];
  };
  funnel: {
    accounts: number;
    withEvents: number;
    withPhotos: number;
    proPurchased: number;
  };
  generatedAt: string;
};

function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

function lastMonths(count: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

function bucket(months: string[], entries: Array<{ at: string; value: number }>) {
  const map = new Map(months.map((m) => [m, 0]));
  for (const e of entries) {
    const k = monthKey(e.at);
    if (map.has(k)) map.set(k, (map.get(k) ?? 0) + e.value);
  }
  return months.map((month) => ({ month, value: map.get(month) ?? 0 }));
}

async function listAllUsers(admin: SupabaseClient) {
  const users: Array<{ id: string; created_at: string }> = [];
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    const batch = data?.users ?? [];
    users.push(
      ...batch.map((u) => ({ id: u.id, created_at: u.created_at ?? new Date(0).toISOString() })),
    );
    if (batch.length < 1000) break;
  }
  return users;
}

async function countUploadsForEvent(admin: SupabaseClient, eventId: string) {
  const { count, error } = await admin
    .from("uploads")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** Computes the Overview KPIs straight from the live database. */
export async function computeOverview(): Promise<AdminOverview> {
  const admin = adminSupabase();
  const months = lastMonths(6);

  const [users, eventsRes, subsRes] = await Promise.all([
    listAllUsers(admin),
    admin.from("events").select("id, organizer_id, created_at"),
    admin
      .from("subscriptions")
      .select("user_id, status, paid_at, amount_total, currency"),
  ]);

  if (eventsRes.error) throw new Error(eventsRes.error.message);
  if (subsRes.error) throw new Error(subsRes.error.message);

  const events = (eventsRes.data ?? []) as Array<{
    id: string;
    organizer_id: string | null;
    created_at: string;
  }>;
  const subs = (subsRes.data ?? []) as Array<{
    user_id: string;
    status: string | null;
    paid_at: string | null;
    amount_total: number | null;
    currency: string | null;
  }>;

  // Photo counts per event (events are few; one HEAD count each, batched).
  const perEvent = new Map<string, number>();
  const BATCH = 8;
  for (let i = 0; i < events.length; i += BATCH) {
    const slice = events.slice(i, i + BATCH);
    const counts = await Promise.all(
      slice.map((e) => countUploadsForEvent(admin, e.id)),
    );
    slice.forEach((e, idx) => perEvent.set(e.id, counts[idx] ?? 0));
  }

  const photos = [...perEvent.values()].reduce((a, b) => a + b, 0);

  const paid = subs.filter((s) => s.status === "paid" || !!s.paid_at);
  const revenueCents = paid.reduce((sum, s) => sum + (s.amount_total ?? 0), 0);
  const currency = (paid.find((s) => s.currency)?.currency ?? "eur").toUpperCase();

  const organizersWithEvents = new Set(
    events.map((e) => e.organizer_id).filter((v): v is string => !!v),
  );
  const organizersWithPhotos = new Set(
    events
      .filter((e) => (perEvent.get(e.id) ?? 0) > 0)
      .map((e) => e.organizer_id)
      .filter((v): v is string => !!v),
  );

  const customers = users.length;
  const proCustomers = new Set(paid.map((s) => s.user_id)).size;

  return {
    totals: {
      customers,
      events: events.length,
      proCustomers,
      revenueCents,
      currency,
      conversionRate: customers > 0 ? proCustomers / customers : 0,
      photos,
    },
    trends: {
      revenueCents: bucket(
        months,
        paid
          .filter((s) => s.paid_at)
          .map((s) => ({ at: s.paid_at!, value: s.amount_total ?? 0 })),
      ),
      newCustomers: bucket(
        months,
        users.map((u) => ({ at: u.created_at, value: 1 })),
      ),
      proPurchases: bucket(
        months,
        paid.filter((s) => s.paid_at).map((s) => ({ at: s.paid_at!, value: 1 })),
      ),
    },
    funnel: {
      accounts: customers,
      withEvents: organizersWithEvents.size,
      withPhotos: organizersWithPhotos.size,
      proPurchased: proCustomers,
    },
    generatedAt: new Date().toISOString(),
  };
}
