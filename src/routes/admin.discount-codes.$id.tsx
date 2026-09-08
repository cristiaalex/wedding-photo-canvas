import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft } from "lucide-react";

import {
  getAdminDiscountCode,
  setAdminDiscountStatus,
  deleteAdminDiscountCode,
  type DiscountDetail,
} from "@/lib/admin.functions";
import { AdminCard, AdminPageTitle } from "@/components/admin/admin-shell";
import { DiscountCodeForm } from "@/components/admin/discount-code-form";
import { money, fmtDate } from "./admin.payments.index";
import { DiscountPill, discountLabel } from "./admin.discount-codes.index";

export const Route = createFileRoute("/admin/discount-codes/$id")({
  head: () => ({
    meta: [
      { title: "Discount Code — Mosaic Admin" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: DiscountDetailPage,
});

function DiscountDetailPage() {
  const { id } = Route.useParams();
  const get = useServerFn(getAdminDiscountCode);
  const setStatus = useServerFn(setAdminDiscountStatus);
  const del = useServerFn(deleteAdminDiscountCode);
  const navigate = useNavigate();

  const [data, setData] = useState<DiscountDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await get({ data: { id } }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load this code.");
    }
  }, [get, id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle() {
    if (!data) return;
    const next = data.code.status === "paused" ? "active" : "paused";
    setBusy(true);
    try {
      await setStatus({ data: { id, status: next } });
      await load();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Could not update the code.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!data || data.performance.totalRedemptions > 0) return;
    if (
      !window.confirm(
        `Delete ${data.code.code}? This cannot be undone. The Stripe coupon and promotion code are removed too.`,
      )
    )
      return;
    setBusy(true);
    try {
      await del({ data: { id } });
      await navigate({ to: "/admin/discount-codes" });
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Could not delete the code.");
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="flex flex-col gap-6">
        <BackLink />
        <AdminCard>
          <p className="text-sm text-red-700">{error}</p>
        </AdminCard>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col gap-6">
        <BackLink />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  const c = data.code;
  const p = data.performance;
  const used = data.performance.totalRedemptions > 0;

  return (
    <div className="flex flex-col gap-6">
      <BackLink />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <AdminPageTitle title={c.code} />
          <div className="mt-3 flex items-center gap-3">
            <DiscountPill status={c.status} />
            <span className="text-sm text-muted-foreground">
              {discountLabel(c)} off · created {fmtDate(c.createdAt)}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="rounded-full bg-black/[0.05] px-4 py-2.5 text-sm transition-colors hover:bg-black/[0.09]"
          >
            {editing ? "Cancel edit" : "Edit"}
          </button>
          <button
            type="button"
            onClick={toggle}
            disabled={busy || c.status === "expired"}
            className="rounded-full bg-foreground px-4 py-2.5 text-sm text-[color:var(--ivory)] transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {c.status === "paused" ? "Reactivate code" : "Pause code"}
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={busy || used}
            title={
              used
                ? "Used codes cannot be deleted because they are linked to historical transactions."
                : undefined
            }
            className="rounded-full px-4 py-2.5 text-sm text-red-700 transition-colors hover:bg-red-700/10 disabled:opacity-40 disabled:hover:bg-transparent"
          >
            Delete
          </button>
        </div>
      </div>

      {used && (
        <p className="text-xs text-muted-foreground">
          Used codes cannot be deleted because they are linked to historical
          transactions. Pause the code instead — past purchases keep their recorded
          amounts and commission.
        </p>
      )}

      {editing && (
        <DiscountCodeForm
          productPriceCents={0}
          currency={p.currency}
          initial={{
            id: c.id,
            code: c.code,
            discountType: c.discountType,
            percentOff: c.percentOff,
            amountOffCents: c.amountOffCents,
            validUntil: c.validUntil,
            maxRedemptions: c.maxRedemptions,
            perCustomerLimit: c.perCustomerLimit,
            partnerName: c.partnerName,
            commissionPercent: c.commissionPercent,
            internalNote: c.internalNote,
          }}
          onCancel={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            await load();
          }}
        />
      )}


      <div className="grid gap-5 lg:grid-cols-2">
        <AdminCard>
          <p className="text-eyebrow text-[color:var(--gold)]">Configuration</p>
          <dl className="mt-4 flex flex-col gap-3 text-sm">
            <Row label="Type" value={c.discountType === "percent" ? "Percentage" : "Fixed amount"} />
            <Row label="Value" value={discountLabel(c)} />
            <Row label="Valid until" value={c.validUntil ? fmtDate(c.validUntil) : "Forever"} />
            <Row
              label="Usage limit"
              value={c.maxRedemptions != null ? String(c.maxRedemptions) : "Unlimited"}
            />
            <Row
              label="Per customer"
              value={c.perCustomerLimit != null ? String(c.perCustomerLimit) : "Unlimited"}
            />
            <Row label="Partner" value={c.partnerName ?? "—"} />
            <Row
              label="Commission"
              value={c.commissionPercent != null ? `${c.commissionPercent}%` : "—"}
            />
            <Row label="Internal note" value={c.internalNote ?? "—"} />
            <Row label="Stripe coupon" value={c.stripeCouponId ?? "—"} mono />
            <Row label="Stripe promo code" value={c.stripePromotionCodeId ?? "—"} mono />
          </dl>
        </AdminCard>

        <AdminCard>
          <p className="text-eyebrow text-[color:var(--gold)]">Performance</p>
          <dl className="mt-4 flex flex-col gap-3 text-sm">
            <Row label="Redemptions" value={String(p.totalRedemptions)} />
            <Row label="Successful purchases" value={String(p.successfulPurchases)} />
            <Row label="Original value" value={money(p.originalValueCents, p.currency)} />
            <Row label="Discount given" value={money(p.totalDiscountCents, p.currency)} />
            <Row label="Customer revenue" value={money(p.customerRevenueCents, p.currency)} />
            <Row label="Partner commission" value={money(p.commissionCents, p.currency)} />
            <Row label="Mosaic net revenue" value={money(p.netRevenueCents, p.currency)} />
          </dl>
        </AdminCard>
      </div>

      <AdminCard>
        <p className="text-eyebrow text-[color:var(--gold)]">Redemptions</p>
        {data.redemptions.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            This code has not been used yet.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-eyebrow text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3 font-normal">Customer</th>
                  <th className="py-2 pr-3 font-normal">Date</th>
                  <th className="py-2 pr-3 font-normal">Original</th>
                  <th className="py-2 pr-3 font-normal">Discount</th>
                  <th className="py-2 pr-3 font-normal">Paid</th>
                  <th className="py-2 font-normal">Commission</th>
                </tr>
              </thead>
              <tbody>
                {data.redemptions.map((r) => (
                  <tr key={r.subscriptionId} className="border-t border-black/[0.06]">
                    <td className="py-3 pr-3">
                      <Link
                        to="/admin/customers/$userId"
                        params={{ userId: r.userId }}
                        className="underline-offset-4 hover:underline"
                      >
                        {r.email ?? r.userId.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="py-3 pr-3">{fmtDate(r.paidAt)}</td>
                    <td className="py-3 pr-3">{money(r.originalAmountCents, r.currency)}</td>
                    <td className="py-3 pr-3">{money(r.discountAmountCents, r.currency)}</td>
                    <td className="py-3 pr-3">{money(r.amountPaidCents, r.currency)}</td>
                    <td className="py-3">
                      {money(r.commissionAmountCents, r.currency)}
                      {r.commissionPercent != null && (
                        <span className="text-muted-foreground"> ({r.commissionPercent}%)</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminCard>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/admin/discount-codes"
      className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      All discount codes
    </Link>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? "break-all text-right font-mono text-xs" : "text-right"}>
        {value}
      </dd>
    </div>
  );
}
