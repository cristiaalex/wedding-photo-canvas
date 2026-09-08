import type { SupabaseClient } from "@supabase/supabase-js";

import { adminSupabase } from "./billing.server";

/**
 * Server-only Payments data layer for the Mosaic back-office.
 *
 * Reporting layer ONLY: it reads the existing `public.subscriptions` rows that
 * the Stripe webhook already writes (one-time €149 Pro purchases), joined
 * against auth.users and public.events. No new tables, no schema changes, no
 * RLS changes, no Stripe API calls, no mutations.
 *
 * Never importable from the browser (service-role client). Callers in
 * admin.functions.ts must have passed `requireAdmin()` first.
 *
 * What the current schema does NOT store, and therefore is never invented here:
 *   - failed / expired / abandoned checkout attempts (webhook logs them only)
 *   - refunds
 *   - refund detail
 * Discount snapshots (code, discount amount, partner, commission) ARE stored
 * per purchase by the webhook and are reported as-is; never recomputed.
 */

/* ------------------------------------------------------------------ */
/* Types                                                                */
/* ------------------------------------------------------------------ */

export type PaymentStatus = "paid" | "pending" | "failed" | "expired" | "unknown";

export type PaymentListItem = {
  id: string;
  userId: string;
  customerName: string | null;
  customerEmail: string | null;
  eventId: string | null;
  eventName: string | null;
  amountTotal: number | null;
  currency: string | null;
  status: PaymentStatus;
  rawStatus: string | null;
  paidAt: string | null;
  createdAt: string;
  stripePaymentIntentId: string | null;
  stripeCheckoutSessionId: string | null;
  discountCode: string | null;
  discountAmountCents: number | null;
  partnerName: string | null;
  commissionAmountCents: number | null;
};

export type PaymentStatusFilter =
  | "all"
  | "paid"
  | "pending"
  | "failed"
  | "with_discount"
  | "without_discount";

export type PaymentListParams = {
  search?: string;
  status?: PaymentStatusFilter;
  from?: string | null;
  to?: string | null;
  currency?: string | null;
  minAmount?: number | null; // major units (e.g. euros)
  maxAmount?: number | null;
  userId?: string | null;
  eventId?: string | null;
  page?: number;
  pageSize?: number;
};

export type PaymentsSummary = {
  range: "7d" | "30d" | "90d" | "all";
  revenueCents: number;
  successfulPurchases: number;
  averageOrderValueCents: number;
  currency: string;
  totalCustomers: number;
  proCustomers: number;
  conversionRate: number; // 0..1
  revenuePerCustomerCents: number;
  pendingPayments: number;
  currencies: string[];
  // Explicitly not tracked in the current schema.
  refundsTracked: false;
  failedAttemptsTracked: false;
  discountsTracked: true;
  partnersTracked: true;
  discountedPurchases: number;
  discountGivenCents: number;
  partnerCommissionCents: number;
};

export type PaymentListResult = {
  items: PaymentListItem[];
  total: number;
  page: number;
  pageSize: number;
  summary: PaymentsSummary;
  generatedAt: string;
};

export type PaymentDetail = {
  payment: {
    id: string;
    status: PaymentStatus;
    rawStatus: string | null;
    amountTotal: number | null;
    currency: string | null;
    paidAt: string | null;
    createdAt: string;
    updatedAt: string | null;
    mode: "payment";
    stripeCustomerId: string | null;
    stripePaymentIntentId: string | null;
    stripeCheckoutSessionId: string | null;
    stripePriceId: string | null;
  };
  /** Immutable snapshot written at purchase time; null when no code was used. */
  discount: {
    code: string | null;
    discountCodeId: string | null;
    originalAmountCents: number | null;
    discountAmountCents: number | null;
    partnerName: string | null;
    commissionPercent: number | null;
    commissionAmountCents: number | null;
  } | null;
  customer: {
    userId: string;
    name: string | null;
    email: string | null;
    createdAt: string | null;
  };
  event: {
    id: string;
    name: string | null;
    slug: string | null;
    weddingDate: string | null;
    venue: string | null;
  } | null;
  history: Array<{
    id: string;
    paidAt: string | null;
    createdAt: string;
    amountTotal: number | null;
    currency: string | null;
    status: PaymentStatus;
    stripePaymentIntentId: string | null;
  }>;
  generatedAt: string;
};

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

type SubRow = Record<string, unknown>;

function str(row: SubRow, key: string): string | null {
  const v = row[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(row: SubRow, key: string): number | null {
  const v = row[key];
  return typeof v === "number" ? v : null;
}

/** Maps whatever the webhook stored onto a status we can actually defend. */
export function deriveStatus(row: SubRow): PaymentStatus {
  const raw = (str(row, "status") ?? "").toLowerCase();
  if (raw === "paid" || str(row, "paid_at")) return "paid";
  if (["failed", "payment_failed"].includes(raw)) return "failed";
  if (["expired", "incomplete_expired", "canceled"].includes(raw)) return "expired";
  if (["incomplete", "pending", "processing"].includes(raw)) return "pending";
  return raw ? "unknown" : "pending";
}

function displayName(meta: Record<string, unknown> | null | undefined): string | null {
  if (!meta) return null;
  for (const key of ["full_name", "name", "display_name"]) {
    const v = meta[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

type AuthUserLite = {
  id: string;
  email: string | null;
  name: string | null;
  created_at: string;
};

async function listAllAuthUsers(admin: SupabaseClient): Promise<AuthUserLite[]> {
  const out: AuthUserLite[] = [];
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    const batch = data?.users ?? [];
    for (const u of batch) {
      out.push({
        id: u.id,
        email: u.email ?? null,
        name: displayName(u.user_metadata as Record<string, unknown>),
        created_at: u.created_at ?? new Date(0).toISOString(),
      });
    }
    if (batch.length < 1000) break;
  }
  return out;
}

type EventLite = {
  id: string;
  organizer_id: string | null;
  event_name: string | null;
  slug: string;
  wedding_date: string | null;
  venue: string | null;
};

async function fetchEvents(admin: SupabaseClient): Promise<EventLite[]> {
  const { data, error } = await admin
    .from("events")
    .select("id, organizer_id, event_name, slug, wedding_date, venue");
  if (error) throw new Error(error.message);
  return (data ?? []) as EventLite[];
}

function rangeStart(range: PaymentsSummary["range"]): Date | null {
  const days = range === "7d" ? 7 : range === "30d" ? 30 : range === "90d" ? 90 : null;
  if (days === null) return null;
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

/* ------------------------------------------------------------------ */
/* List + summary                                                       */
/* ------------------------------------------------------------------ */

export async function listPayments(
  params: PaymentListParams & { range?: PaymentsSummary["range"] },
): Promise<PaymentListResult> {
  const admin = adminSupabase();
  const pageSize = Math.min(50, Math.max(5, params.pageSize ?? 20));
  const page = Math.max(1, params.page ?? 1);
  const search = (params.search ?? "").trim().toLowerCase();
  const status = params.status ?? "all";
  const range = params.range ?? "all";

  const [subsRes, users, events] = await Promise.all([
    admin.from("subscriptions").select("*"),
    listAllAuthUsers(admin),
    fetchEvents(admin),
  ]);
  if (subsRes.error) throw new Error(subsRes.error.message);

  const subs = (subsRes.data ?? []) as SubRow[];
  const userById = new Map(users.map((u) => [u.id, u]));
  const eventById = new Map(events.map((e) => [e.id, e]));
  const eventsByOrganizer = new Map<string, EventLite[]>();
  for (const e of events) {
    if (!e.organizer_id) continue;
    const list = eventsByOrganizer.get(e.organizer_id) ?? [];
    list.push(e);
    eventsByOrganizer.set(e.organizer_id, list);
  }

  const all: PaymentListItem[] = subs.map((s) => {
    const userId = String(s["user_id"] ?? "");
    const user = userById.get(userId) ?? null;
    const explicitEventId = str(s, "event_id");
    const event =
      (explicitEventId ? eventById.get(explicitEventId) : null) ??
      (eventsByOrganizer.get(userId) ?? [])[0] ??
      null;

    return {
      id: String(s["id"] ?? ""),
      userId,
      customerName: user?.name ?? null,
      customerEmail: user?.email ?? null,
      eventId: event?.id ?? explicitEventId,
      eventName: event?.event_name ?? null,
      amountTotal: num(s, "amount_total"),
      currency: str(s, "currency"),
      status: deriveStatus(s),
      rawStatus: str(s, "status"),
      paidAt: str(s, "paid_at"),
      createdAt: str(s, "created_at") ?? new Date(0).toISOString(),
      stripePaymentIntentId: str(s, "stripe_payment_intent_id"),
      stripeCheckoutSessionId: str(s, "stripe_checkout_session_id"),
      discountCode: str(s, "discount_code"),
      discountAmountCents: num(s, "discount_amount_cents"),
      partnerName: str(s, "partner_name"),
      commissionAmountCents: num(s, "commission_amount_cents"),
    };
  });

  const when = (p: PaymentListItem) => p.paidAt ?? p.createdAt;

  // --- Summary (aggregated server-side, over the selected time range) ------
  const start = rangeStart(range);
  const inRange = (p: PaymentListItem) => !start || new Date(when(p)) >= start;
  const paidAll = all.filter((p) => p.status === "paid");
  const paidInRange = paidAll.filter(inRange);
  const revenueCents = paidInRange.reduce((sum, p) => sum + (p.amountTotal ?? 0), 0);
  const currencies = [
    ...new Set(all.map((p) => (p.currency ?? "").toUpperCase()).filter(Boolean)),
  ];
  const proCustomers = new Set(paidAll.map((p) => p.userId)).size;

  const summary: PaymentsSummary = {
    range,
    revenueCents,
    successfulPurchases: paidInRange.length,
    averageOrderValueCents:
      paidInRange.length > 0 ? Math.round(revenueCents / paidInRange.length) : 0,
    currency: currencies[0] ?? "EUR",
    totalCustomers: users.length,
    proCustomers,
    conversionRate: users.length > 0 ? proCustomers / users.length : 0,
    revenuePerCustomerCents:
      users.length > 0
        ? Math.round(paidAll.reduce((s, p) => s + (p.amountTotal ?? 0), 0) / users.length)
        : 0,
    pendingPayments: all.filter((p) => p.status === "pending").length,
    currencies,
    refundsTracked: false,
    failedAttemptsTracked: false,
    discountsTracked: true,
    partnersTracked: true,
    discountedPurchases: paidInRange.filter((p) => p.discountCode).length,
    discountGivenCents: paidInRange.reduce(
      (sum, p) => sum + (p.discountAmountCents ?? 0),
      0,
    ),
    partnerCommissionCents: paidInRange.reduce(
      (sum, p) => sum + (p.commissionAmountCents ?? 0),
      0,
    ),
  };

  // --- Filtering ------------------------------------------------------------
  let rows = all;

  if (status === "paid") rows = rows.filter((p) => p.status === "paid");
  else if (status === "pending") rows = rows.filter((p) => p.status === "pending");
  else if (status === "failed")
    rows = rows.filter((p) => p.status === "failed" || p.status === "expired");
  else if (status === "with_discount") rows = rows.filter((p) => p.discountCode);
  else if (status === "without_discount") rows = rows.filter((p) => !p.discountCode);

  if (params.userId) rows = rows.filter((p) => p.userId === params.userId);
  if (params.eventId) rows = rows.filter((p) => p.eventId === params.eventId);
  if (params.currency)
    rows = rows.filter(
      (p) => (p.currency ?? "").toUpperCase() === params.currency!.toUpperCase(),
    );
  if (params.from) {
    const f = new Date(params.from).getTime();
    rows = rows.filter((p) => new Date(when(p)).getTime() >= f);
  }
  if (params.to) {
    const t = new Date(params.to).getTime() + 24 * 60 * 60 * 1000 - 1;
    rows = rows.filter((p) => new Date(when(p)).getTime() <= t);
  }
  if (typeof params.minAmount === "number")
    rows = rows.filter((p) => (p.amountTotal ?? 0) >= params.minAmount! * 100);
  if (typeof params.maxAmount === "number")
    rows = rows.filter((p) => (p.amountTotal ?? 0) <= params.maxAmount! * 100);

  if (search) {
    rows = rows.filter((p) =>
      [
        p.customerName,
        p.customerEmail,
        p.userId,
        p.eventName,
        p.eventId,
        p.stripePaymentIntentId,
        p.stripeCheckoutSessionId,
      ]
        .filter((v): v is string => !!v)
        .some((v) => v.toLowerCase().includes(search)),
    );
  }

  rows.sort((a, b) => when(b).localeCompare(when(a)));

  return {
    items: rows.slice((page - 1) * pageSize, page * pageSize),
    total: rows.length,
    page,
    pageSize,
    summary,
    generatedAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Detail                                                               */
/* ------------------------------------------------------------------ */

export async function getPaymentDetail(paymentId: string): Promise<PaymentDetail> {
  const admin = adminSupabase();

  const { data, error } = await admin
    .from("subscriptions")
    .select("*")
    .eq("id", paymentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Payment not found");

  const row = data as SubRow;
  const userId = String(row["user_id"] ?? "");

  const [userRes, eventsRes, historyRes] = await Promise.all([
    admin.auth.admin.getUserById(userId),
    admin
      .from("events")
      .select("id, organizer_id, event_name, slug, wedding_date, venue")
      .eq("organizer_id", userId),
    admin.from("subscriptions").select("*").eq("user_id", userId),
  ]);
  if (historyRes.error) throw new Error(historyRes.error.message);

  const u = userRes.data?.user ?? null;
  const events = (eventsRes.data ?? []) as EventLite[];
  const explicitEventId = str(row, "event_id");
  const event =
    events.find((e) => e.id === explicitEventId) ?? events[0] ?? null;

  const history = ((historyRes.data ?? []) as SubRow[])
    .map((s) => ({
      id: String(s["id"] ?? ""),
      paidAt: str(s, "paid_at"),
      createdAt: str(s, "created_at") ?? new Date(0).toISOString(),
      amountTotal: num(s, "amount_total"),
      currency: str(s, "currency"),
      status: deriveStatus(s),
      stripePaymentIntentId: str(s, "stripe_payment_intent_id"),
    }))
    .sort((a, b) => (b.paidAt ?? b.createdAt).localeCompare(a.paidAt ?? a.createdAt));

  return {
    payment: {
      id: String(row["id"] ?? ""),
      status: deriveStatus(row),
      rawStatus: str(row, "status"),
      amountTotal: num(row, "amount_total"),
      currency: str(row, "currency"),
      paidAt: str(row, "paid_at"),
      createdAt: str(row, "created_at") ?? new Date(0).toISOString(),
      updatedAt: str(row, "updated_at"),
      mode: "payment",
      stripeCustomerId: str(row, "stripe_customer_id"),
      stripePaymentIntentId: str(row, "stripe_payment_intent_id"),
      stripeCheckoutSessionId: str(row, "stripe_checkout_session_id"),
      stripePriceId: str(row, "stripe_price_id"),
    },
    discount: str(row, "discount_code")
      ? {
          code: str(row, "discount_code"),
          discountCodeId: str(row, "discount_code_id"),
          originalAmountCents: num(row, "original_amount_cents"),
          discountAmountCents: num(row, "discount_amount_cents"),
          partnerName: str(row, "partner_name"),
          commissionPercent: num(row, "commission_percent"),
          commissionAmountCents: num(row, "commission_amount_cents"),
        }
      : null,
    customer: {
      userId,
      name: displayName(u?.user_metadata as Record<string, unknown>),
      email: u?.email ?? null,
      createdAt: u?.created_at ?? null,
    },
    event: event
      ? {
          id: event.id,
          name: event.event_name,
          slug: event.slug,
          weddingDate: event.wedding_date,
          venue: event.venue,
        }
      : null,
    history,
    generatedAt: new Date().toISOString(),
  };
}
