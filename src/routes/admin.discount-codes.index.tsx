import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Search, X } from "lucide-react";

import {
  listAdminDiscountCodes,
  setAdminDiscountStatus,
  deleteAdminDiscountCode,
  type DiscountListResult,
  type DiscountListItem,
  type DiscountStatus,
} from "@/lib/admin.functions";
import { AdminCard, AdminPageTitle } from "@/components/admin/admin-shell";
import { DiscountCodeForm } from "@/components/admin/discount-code-form";
import { money, fmtDate } from "./admin.payments.index";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/discount-codes/")({
  head: () => ({
    meta: [
      { title: "Discount Codes — Mosaic Admin" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: DiscountCodesPage,
});

const FILTERS: { key: DiscountStatus | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "paused", label: "Paused" },
  { key: "expired", label: "Expired" },
];

export function DiscountPill({ status }: { status: DiscountStatus }) {
  const map: Record<DiscountStatus, string> = {
    active: "bg-[color:var(--dusty)]/25 text-foreground",
    paused: "bg-[color:var(--peach)]/40 text-foreground",
    expired: "bg-black/[0.06] text-muted-foreground",
  };
  const label: Record<DiscountStatus, string> = {
    active: "Active",
    paused: "Paused",
    expired: "Expired",
  };
  return (
    <span className={cn("rounded-full px-2.5 py-1 text-xs", map[status])}>
      {label[status]}
    </span>
  );
}

export function discountLabel(item: {
  discountType: string;
  percentOff: number | null;
  amountOffCents: number | null;
  currency: string;
}) {
  return item.discountType === "percent"
    ? `${item.percentOff}%`
    : money(item.amountOffCents, item.currency);
}

/* ------------------------------------------------------------------ */

function DiscountCodesPage() {
  const list = useServerFn(listAdminDiscountCodes);
  const setStatus = useServerFn(setAdminDiscountStatus);
  const del = useServerFn(deleteAdminDiscountCode);

  const [search, setSearch] = useState("");
  const [status, setStatusFilter] = useState<DiscountStatus | "all">("all");
  const [data, setData] = useState<DiscountListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await list({ data: { search, status, page: 1, pageSize: 50 } });
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load discount codes.");
    } finally {
      setLoading(false);
    }
  }, [list, search, status]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  async function remove(item: DiscountListItem) {
    if (item.redemptions > 0) return;
    if (
      !window.confirm(
        `Delete ${item.code}? This cannot be undone. The Stripe coupon and promotion code are removed too.`,
      )
    )
      return;
    setBusyId(item.id);
    try {
      await del({ data: { id: item.id } });
      await load();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Could not delete the code.");
    } finally {
      setBusyId(null);
    }
  }

  async function toggle(item: DiscountListItem) {
    const next = item.status === "paused" ? "active" : "paused";
    if (
      !window.confirm(
        next === "paused"
          ? `Pause ${item.code}? It can no longer be used at checkout.`
          : `Reactivate ${item.code}?`,
      )
    )
      return;
    setBusyId(item.id);
    try {
      await setStatus({ data: { id: item.id, status: next } });
      await load();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Could not update the code.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <AdminPageTitle
          title="Discount Codes"
          subtitle="Create and manage Mosaic discount codes. Each one is backed by a Stripe coupon and promotion code created automatically."
        />
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          className="flex items-center justify-center gap-2 rounded-full bg-foreground px-4 py-2.5 text-sm text-[color:var(--ivory)] transition-opacity hover:opacity-90"
        >
          {creating ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {creating ? "Cancel" : "Create discount code"}
        </button>
      </div>

      {creating && (
        <DiscountCodeForm
          productPriceCents={data?.productPriceCents ?? 0}
          currency={data?.currency ?? "eur"}
          onCancel={() => setCreating(false)}
          onSaved={async () => {
            setCreating(false);
            await load();
          }}
        />
      )}

      <AdminCard className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <label className="relative flex w-full items-center md:max-w-xs">
            <Search className="pointer-events-none absolute left-3 h-4 w-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search code or partner"
              className="w-full rounded-full bg-black/[0.04] py-2.5 pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setStatusFilter(f.key)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs transition-colors",
                  status === f.key
                    ? "bg-foreground text-[color:var(--ivory)]"
                    : "bg-black/[0.04] text-muted-foreground hover:text-foreground",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-red-700">{error}</p>}
        {loading && !data && <p className="text-sm text-muted-foreground">Loading…</p>}

        {data && data.items.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No discount codes yet.
          </p>
        )}

        {data && data.items.length > 0 && (
          <>
            {/* Mobile: cards */}
            <ul className="flex flex-col gap-3 md:hidden">
              {data.items.map((item) => (
                <li key={item.id} className="rounded-[1rem] bg-black/[0.03] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <Link
                      to="/admin/discount-codes/$id"
                      params={{ id: item.id }}
                      className="font-mono text-sm tracking-wide underline-offset-4 hover:underline"
                    >
                      {item.code}
                    </Link>
                    <DiscountPill status={item.status} />
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-y-2 text-xs text-muted-foreground">
                    <dt>Discount</dt>
                    <dd className="text-right text-foreground">{discountLabel(item)}</dd>
                    <dt>Partner</dt>
                    <dd className="text-right text-foreground">
                      {item.partnerName ?? "—"}
                    </dd>
                    <dt>Commission</dt>
                    <dd className="text-right text-foreground">
                      {item.commissionPercent != null ? `${item.commissionPercent}%` : "—"}
                    </dd>
                    <dt>Usage</dt>
                    <dd className="text-right text-foreground">
                      {item.redemptions}
                      {item.maxRedemptions != null ? ` / ${item.maxRedemptions}` : ""}
                    </dd>
                    <dt>Valid until</dt>
                    <dd className="text-right text-foreground">
                      {item.validUntil ? fmtDate(item.validUntil) : "Forever"}
                    </dd>
                  </dl>
                  <RowActions
                    item={item}
                    busy={busyId === item.id}
                    onToggle={() => toggle(item)}
                    onDelete={() => remove(item)}
                    className="mt-3"
                  />
                </li>
              ))}
            </ul>

            {/* Desktop: table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-sm">
                <thead className="text-eyebrow text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-3 font-normal">Code</th>
                    <th className="py-2 pr-3 font-normal">Discount</th>
                    <th className="py-2 pr-3 font-normal">Partner</th>
                    <th className="py-2 pr-3 font-normal">Commission</th>
                    <th className="py-2 pr-3 font-normal">Usage</th>
                    <th className="py-2 pr-3 font-normal">Valid until</th>
                    <th className="py-2 pr-3 font-normal">Status</th>
                    <th className="py-2 font-normal" />
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr key={item.id} className="border-t border-black/[0.06]">
                      <td className="py-3 pr-3">
                        <Link
                          to="/admin/discount-codes/$id"
                          params={{ id: item.id }}
                          className="font-mono tracking-wide underline-offset-4 hover:underline"
                        >
                          {item.code}
                        </Link>
                      </td>
                      <td className="py-3 pr-3">{discountLabel(item)}</td>
                      <td className="py-3 pr-3">{item.partnerName ?? "—"}</td>
                      <td className="py-3 pr-3">
                        {item.commissionPercent != null
                          ? `${item.commissionPercent}%`
                          : "—"}
                      </td>
                      <td className="py-3 pr-3">
                        {item.redemptions}
                        {item.maxRedemptions != null ? ` / ${item.maxRedemptions}` : ""}
                      </td>
                      <td className="py-3 pr-3">
                        {item.validUntil ? fmtDate(item.validUntil) : "Forever"}
                      </td>
                      <td className="py-3 pr-3">
                        <DiscountPill status={item.status} />
                      </td>
                      <td className="py-3">
                        <RowActions
                          item={item}
                          busy={busyId === item.id}
                          onToggle={() => toggle(item)}
                          onDelete={() => remove(item)}
                          className="justify-end"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </AdminCard>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Row actions                                                          */
/* ------------------------------------------------------------------ */

const actionCls =
  "text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-40";

function RowActions({
  item,
  busy,
  onToggle,
  onDelete,
  className,
}: {
  item: DiscountListItem;
  busy: boolean;
  onToggle: () => void;
  onDelete: () => void;
  className?: string;
}) {
  const used = item.redemptions > 0;
  return (
    <div className={cn("flex flex-wrap items-center gap-3", className)}>
      <Link
        to="/admin/discount-codes/$id"
        params={{ id: item.id }}
        className={actionCls}
      >
        Edit
      </Link>
      <button type="button" disabled={busy || item.status === "expired"} onClick={onToggle} className={actionCls}>
        {item.status === "paused" ? "Reactivate" : "Pause"}
      </button>
      <button
        type="button"
        disabled={busy || used}
        onClick={onDelete}
        title={
          used
            ? "Used codes cannot be deleted because they are linked to historical transactions."
            : undefined
        }
        className={cn(actionCls, !used && "text-red-700 hover:text-red-800")}
      >
        Delete
      </button>
    </div>
  );
}

