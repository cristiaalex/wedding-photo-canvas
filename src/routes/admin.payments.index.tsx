import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Search } from "lucide-react";

import {
  listAdminPayments,
  type PaymentListResult,
  type PaymentStatus,
  type PaymentStatusFilter,
  type PaymentsSummary,
} from "@/lib/admin.functions";
import { AdminCard, AdminPageTitle } from "@/components/admin/admin-shell";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/payments/")({
  head: () => ({
    meta: [
      { title: "Payments — Mosaic Admin" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminPaymentsPage,
});

const FILTERS: { key: PaymentStatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "paid", label: "Successful" },
  { key: "pending", label: "Pending" },
  { key: "failed", label: "Failed" },
  { key: "with_discount", label: "With discount" },
  { key: "without_discount", label: "Without discount" },
];

const RANGES: { key: PaymentsSummary["range"]; label: string }[] = [
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
  { key: "all", label: "All time" },
];

export function money(cents: number | null | undefined, currency?: string | null) {
  if (cents == null) return "—";
  try {
    return new Intl.NumberFormat("en-IE", {
      style: "currency",
      currency: (currency ?? "EUR").toUpperCase(),
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${(currency ?? "EUR").toUpperCase()}`;
  }
}

export function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function StatusPill({ status }: { status: PaymentStatus }) {
  const map: Record<PaymentStatus, string> = {
    paid: "bg-[color:var(--dusty)]/25 text-foreground",
    pending: "bg-[color:var(--peach)]/40 text-foreground",
    failed: "bg-black/[0.06] text-muted-foreground",
    expired: "bg-black/[0.06] text-muted-foreground",
    unknown: "bg-black/[0.06] text-muted-foreground",
  };
  const label: Record<PaymentStatus, string> = {
    paid: "Paid",
    pending: "Pending",
    failed: "Failed",
    expired: "Expired",
    unknown: "Unknown",
  };
  return (
    <span className={cn("rounded-full px-2.5 py-1 text-xs", map[status])}>
      {label[status]}
    </span>
  );
}

function Kpi({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-[1rem] surface-fade px-4 py-4">
      <p className="text-eyebrow text-muted-foreground">{label}</p>
      <p className="mt-2 text-display text-2xl">{value}</p>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

function Mono({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="font-mono text-[11px] text-muted-foreground">
      {value.length > 20 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value}
    </span>
  );
}

function AdminPaymentsPage() {
  const load = useServerFn(listAdminPayments);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState<PaymentStatusFilter>("all");
  const [range, setRange] = useState<PaymentsSummary["range"]>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [currency, setCurrency] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PaymentListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const fetchPage = useCallback(() => {
    setLoading(true);
    setError(null);
    load({
      data: {
        search: debounced,
        status,
        range,
        from: from || null,
        to: to || null,
        currency: currency || null,
        minAmount: minAmount ? Number(minAmount) : null,
        maxAmount: maxAmount ? Number(maxAmount) : null,
        page,
        pageSize: 20,
      },
    })
      .then(setData)
      .catch((err) => setError(String(err?.message ?? err)))
      .finally(() => setLoading(false));
  }, [load, debounced, status, range, from, to, currency, minAmount, maxAmount, page]);

  useEffect(fetchPage, [fetchPage]);

  const pageCount = useMemo(
    () => (data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1),
    [data],
  );
  const s = data?.summary ?? null;

  return (
    <div className="flex flex-col gap-6 md:gap-8">
      <AdminPageTitle
        title="Payments"
        subtitle="Every recorded Mosaic Pro purchase, read live from the production database. Reporting only — no payment actions are available here."
      />

      {/* Range */}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1">
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => setRange(r.key)}
            className={cn(
              "shrink-0 rounded-full px-3.5 py-1.5 text-xs transition-colors",
              range === r.key
                ? "bg-[color:var(--dusty)]/25 text-foreground"
                : "surface-fade text-muted-foreground hover:text-foreground",
            )}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Kpi
          label="Revenue"
          value={money(s?.revenueCents ?? 0, s?.currency)}
          note="Successful payments only"
        />
        <Kpi
          label="Successful purchases"
          value={String(s?.successfulPurchases ?? 0)}
        />
        <Kpi
          label="Average order value"
          value={money(s?.averageOrderValueCents ?? 0, s?.currency)}
        />
        <Kpi label="Pro customers" value={String(s?.proCustomers ?? 0)} />
        <Kpi
          label="Pro conversion"
          value={`${(((s?.conversionRate ?? 0) * 100) || 0).toFixed(1)}%`}
          note={`${s?.totalCustomers ?? 0} accounts`}
        />
        <Kpi
          label="Revenue per customer"
          value={money(s?.revenuePerCustomerCents ?? 0, s?.currency)}
          note="All time"
        />
      </div>

      <AdminCard>
        <p className="text-eyebrow text-[color:var(--gold)]">Not tracked yet</p>
        <p className="mt-3 text-sm text-muted-foreground">
          Only confirmed Stripe payments are stored today. Failed, expired and
          abandoned checkout attempts and refunds are not persisted, so they are
          shown as unavailable rather than estimated. Discount codes, discount
          amounts, partner and commission are recorded from the purchase onwards —
          purchases made before discount codes existed simply have none.
        </p>
      </AdminCard>

      {/* Search + filters */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 rounded-[1rem] surface-fade px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customer, email, user ID, event, payment intent or session ID"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => {
                setStatus(f.key);
                setPage(1);
              }}
              className={cn(
                "shrink-0 rounded-full px-3.5 py-1.5 text-xs transition-colors",
                status === f.key
                  ? "bg-[color:var(--dusty)]/25 text-foreground"
                  : "surface-fade text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          {[
            { label: "From", value: from, set: setFrom, type: "date" },
            { label: "To", value: to, set: setTo, type: "date" },
            { label: "Currency", value: currency, set: setCurrency, type: "text" },
            { label: "Min €", value: minAmount, set: setMinAmount, type: "number" },
            { label: "Max €", value: maxAmount, set: setMaxAmount, type: "number" },
          ].map((f) => (
            <label key={f.label} className="rounded-[0.9rem] surface-fade px-3 py-2">
              <span className="text-eyebrow block text-muted-foreground">{f.label}</span>
              <input
                type={f.type}
                value={f.value}
                onChange={(e) => {
                  f.set(e.target.value);
                  setPage(1);
                }}
                className="w-full bg-transparent text-sm outline-none"
              />
            </label>
          ))}
        </div>
      </div>


      {error && (
        <AdminCard>
          <p className="text-eyebrow text-[color:var(--gold)]">Couldn’t load payments</p>
          <p className="mt-3 text-sm text-muted-foreground">{error}</p>
        </AdminCard>
      )}

      <AdminCard className="p-0 md:p-0">
        {/* Desktop table */}
        <div className="hidden lg:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-6 py-4 font-normal">Date</th>
                <th className="px-3 py-4 font-normal">Customer</th>
                <th className="px-3 py-4 font-normal">Event</th>
                <th className="px-3 py-4 font-normal">Amount</th>
                <th className="px-3 py-4 font-normal">Status</th>
                <th className="px-3 py-4 font-normal">Payment intent</th>
                <th className="px-6 py-4 font-normal">Session</th>
              </tr>
            </thead>
            <tbody>
              {(data?.items ?? []).map((p) => (
                <tr key={p.id} className="border-t border-black/[0.04]">
                  <td className="px-6 py-4 text-muted-foreground">
                    <Link to="/admin/payments/$paymentId" params={{ paymentId: p.id }}>
                      {fmtDate(p.paidAt ?? p.createdAt)}
                    </Link>
                  </td>
                  <td className="px-3 py-4">
                    <Link to="/admin/payments/$paymentId" params={{ paymentId: p.id }}>
                      <span className="block">
                        {p.customerName ?? p.customerEmail ?? p.userId}
                      </span>
                      {p.customerName && (
                        <span className="block text-xs text-muted-foreground">
                          {p.customerEmail}
                        </span>
                      )}
                    </Link>
                  </td>
                  <td className="px-3 py-4 text-muted-foreground">
                    {p.eventName ?? "—"}
                  </td>
                  <td className="px-3 py-4">
                    {money(p.amountTotal, p.currency)}{" "}
                    <span className="text-xs text-muted-foreground">
                      {(p.currency ?? "").toUpperCase()}
                    </span>
                  </td>
                  <td className="px-3 py-4">
                    <StatusPill status={p.status} />
                  </td>
                  <td className="px-3 py-4">
                    <Mono value={p.stripePaymentIntentId} />
                  </td>
                  <td className="px-6 py-4">
                    <Mono value={p.stripeCheckoutSessionId} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Tablet / mobile cards */}
        <div className="flex flex-col lg:hidden">
          {(data?.items ?? []).map((p) => (
            <Link
              key={p.id}
              to="/admin/payments/$paymentId"
              params={{ paymentId: p.id }}
              className="border-t border-black/[0.04] px-5 py-4 first:border-t-0"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm">
                    {p.customerName ?? p.customerEmail ?? p.userId}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {p.eventName ?? "No event"} · {fmtDate(p.paidAt ?? p.createdAt)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm">{money(p.amountTotal, p.currency)}</p>
                  <div className="mt-1">
                    <StatusPill status={p.status} />
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>

        {!loading && (data?.items.length ?? 0) === 0 && (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">
            No payments match these filters.
          </p>
        )}
        {loading && (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">
            Loading…
          </p>
        )}
      </AdminCard>

      {/* Pagination */}
      {data && data.total > data.pageSize && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {data.total} payment{data.total === 1 ? "" : "s"}
          </span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-full surface-fade px-3.5 py-1.5 text-xs disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-xs text-muted-foreground">
              {page} / {pageCount}
            </span>
            <button
              type="button"
              disabled={page >= pageCount}
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              className="rounded-full surface-fade px-3.5 py-1.5 text-xs disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
