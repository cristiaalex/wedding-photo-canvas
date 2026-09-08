import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Search } from "lucide-react";

import {
  listAdminCustomers,
  type CustomerFilter,
  type CustomerListResult,
} from "@/lib/admin.functions";
import { AdminCard, AdminPageTitle } from "@/components/admin/admin-shell";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/customers/")({
  head: () => ({
    meta: [
      { title: "Customers — Mosaic Admin" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminCustomersPage,
});

const FILTERS: { key: CustomerFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pro", label: "Pro" },
  { key: "free", label: "Free" },
  { key: "has_event", label: "Has event" },
  { key: "no_event", label: "No event" },
  { key: "has_payment", label: "Has payment" },
  { key: "payment_failed", label: "Payment failed" },
];

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function AdminCustomersPage() {
  const load = useServerFn(listAdminCustomers);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [filter, setFilter] = useState<CustomerFilter>("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<CustomerListResult | null>(null);
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
    load({ data: { search: debounced, filter, page, pageSize: 20 } })
      .then(setData)
      .catch((err) => setError(String(err?.message ?? err)))
      .finally(() => setLoading(false));
  }, [load, debounced, filter, page]);

  useEffect(fetchPage, [fetchPage]);

  const pageCount = useMemo(
    () => (data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1),
    [data],
  );

  return (
    <div className="flex flex-col gap-6 md:gap-8">
      <AdminPageTitle
        title="Customers"
        subtitle="Every Mosaic account, read live from the production database."
      />

      {/* Search + filters */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 rounded-[1rem] surface-fade px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search email, name, event name, user ID or event ID"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => {
                setFilter(f.key);
                setPage(1);
              }}
              className={cn(
                "shrink-0 rounded-full px-3.5 py-1.5 text-xs transition-colors",
                filter === f.key
                  ? "bg-[color:var(--dusty)]/25 text-foreground"
                  : "surface-fade text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <AdminCard>
          <p className="text-eyebrow text-[color:var(--gold)]">Couldn’t load customers</p>
          <p className="mt-3 text-sm text-muted-foreground">{error}</p>
        </AdminCard>
      )}

      <AdminCard className="p-0 md:p-0">
        {/* Desktop table */}
        <div className="hidden md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-6 py-4 font-normal">Customer</th>
                <th className="px-3 py-4 font-normal">Joined</th>
                <th className="px-3 py-4 font-normal">Events</th>
                <th className="px-3 py-4 font-normal">Photos</th>
                <th className="px-3 py-4 font-normal">Plan</th>
                <th className="px-6 py-4 font-normal">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {(data?.items ?? []).map((c) => (
                <tr key={c.userId} className="border-t border-black/[0.04]">
                  <td className="px-6 py-4">
                    <Link
                      to="/admin/customers/$userId"
                      params={{ userId: c.userId }}
                      className="block"
                    >
                      <span className="block">{c.name ?? c.email ?? c.userId}</span>
                      {c.name && (
                        <span className="block text-xs text-muted-foreground">
                          {c.email}
                        </span>
                      )}
                    </Link>
                  </td>
                  <td className="px-3 py-4 text-muted-foreground">
                    {fmtDate(c.createdAt)}
                  </td>
                  <td className="px-3 py-4">{c.eventCount}</td>
                  <td className="px-3 py-4">{c.photoCount.toLocaleString("en")}</td>
                  <td className="px-3 py-4">
                    <PlanPill isPro={c.isPro} status={c.purchaseStatus} />
                  </td>
                  <td className="px-6 py-4 text-muted-foreground">
                    {fmtDate(c.lastActivityAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile / tablet cards */}
        <div className="flex flex-col md:hidden">
          {(data?.items ?? []).map((c) => (
            <Link
              key={c.userId}
              to="/admin/customers/$userId"
              params={{ userId: c.userId }}
              className="border-t border-black/[0.04] px-5 py-4 first:border-t-0"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm">{c.name ?? c.email ?? c.userId}</p>
                  {c.name && (
                    <p className="truncate text-xs text-muted-foreground">{c.email}</p>
                  )}
                </div>
                <PlanPill isPro={c.isPro} status={c.purchaseStatus} />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {c.eventCount} event{c.eventCount === 1 ? "" : "s"} ·{" "}
                {c.photoCount.toLocaleString("en")} photos · joined{" "}
                {fmtDate(c.createdAt)}
              </p>
            </Link>
          ))}
        </div>

        {!loading && (data?.items.length ?? 0) === 0 && (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">
            No customers match this search.
          </p>
        )}
        {loading && (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">
            Loading…
          </p>
        )}
      </AdminCard>

      {data && data.total > data.pageSize && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Page {data.page} of {pageCount} · {data.total} customers
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-full surface-fade px-4 py-2 text-xs disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= pageCount}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-full surface-fade px-4 py-2 text-xs disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PlanPill({ isPro, status }: { isPro: boolean; status: string | null }) {
  return (
    <span
      className={cn(
        "inline-block shrink-0 rounded-full px-2.5 py-1 text-[0.7rem]",
        isPro
          ? "bg-[color:var(--gold)]/15 text-[color:var(--gold)]"
          : "bg-black/[0.04] text-muted-foreground",
      )}
      title={status ?? undefined}
    >
      {isPro ? "Pro" : "Free"}
    </span>
  );
}
