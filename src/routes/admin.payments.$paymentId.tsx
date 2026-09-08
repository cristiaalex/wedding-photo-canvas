import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft } from "lucide-react";

import { getAdminPayment, type PaymentDetail } from "@/lib/admin.functions";
import { AdminCard, AdminPageTitle } from "@/components/admin/admin-shell";
import { StatusPill, fmtDate, money } from "./admin.payments.index";

export const Route = createFileRoute("/admin/payments/$paymentId")({
  head: () => ({
    meta: [
      { title: "Payment — Mosaic Admin" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminPaymentDetailPage,
});

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-eyebrow text-muted-foreground">{label}</p>
      <p
        className={
          mono ? "mt-1 break-all font-mono text-xs" : "mt-1 break-words text-sm"
        }
      >
        {value ?? "—"}
      </p>
    </div>
  );
}

function AdminPaymentDetailPage() {
  const { paymentId } = Route.useParams();
  const load = useServerFn(getAdminPayment);
  const [data, setData] = useState<PaymentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    load({ data: { paymentId } })
      .then(setData)
      .catch((err) => setError(String(err?.message ?? err)));
  }, [load, paymentId]);

  if (error) {
    return (
      <div className="flex flex-col gap-6">
        <BackLink />
        <AdminCard>
          <p className="text-eyebrow text-[color:var(--gold)]">Couldn’t load payment</p>
          <p className="mt-3 text-sm text-muted-foreground">{error}</p>
        </AdminCard>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col gap-6">
        <BackLink />
        <AdminCard>
          <p className="text-sm text-muted-foreground">Loading…</p>
        </AdminCard>
      </div>
    );
  }

  const p = data.payment;

  return (
    <div className="flex flex-col gap-6 md:gap-8">
      <BackLink />

      <div className="flex flex-wrap items-center gap-4">
        <AdminPageTitle
          title={money(p.amountTotal, p.currency)}
          subtitle={`Mosaic Pro — one-time payment · ${fmtDate(p.paidAt ?? p.createdAt)}`}
        />
        <StatusPill status={p.status} />
      </div>

      {/* 1. Customer */}
      <AdminCard>
        <p className="text-eyebrow text-muted-foreground">Customer</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Name" value={data.customer.name} />
          <Field label="Email" value={data.customer.email} />
          <Field label="User ID" value={data.customer.userId} mono />
          <Field label="Account created" value={fmtDate(data.customer.createdAt)} />
        </div>
        <Link
          to="/admin/customers/$userId"
          params={{ userId: data.customer.userId }}
          className="mt-5 inline-flex rounded-full surface-fade px-3.5 py-1.5 text-xs"
        >
          Open Customer 360
        </Link>
      </AdminCard>

      {/* 2. Event */}
      <AdminCard>
        <p className="text-eyebrow text-muted-foreground">Event</p>
        {data.event ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Event" value={data.event.name} />
            <Field label="Event ID" value={data.event.id} mono />
            <Field label="Wedding date" value={fmtDate(data.event.weddingDate)} />
            <Field label="Venue" value={data.event.venue} />
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            No event is associated with this payment.
          </p>
        )}
      </AdminCard>

      {/* 3. Payment */}
      <AdminCard>
        <p className="text-eyebrow text-muted-foreground">Payment</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Status" value={p.rawStatus ?? p.status} />
          <Field label="Amount" value={money(p.amountTotal, p.currency)} />
          <Field label="Currency" value={(p.currency ?? "").toUpperCase() || null} />
          <Field label="Paid at" value={fmtDate(p.paidAt)} />
          <Field label="Record created" value={fmtDate(p.createdAt)} />
          <Field label="Last updated" value={fmtDate(p.updatedAt)} />
          <Field label="Mode" value="payment (one-time)" />
          <Field label="Stripe customer" value={p.stripeCustomerId} mono />
          <Field label="Payment intent" value={p.stripePaymentIntentId} mono />
          <Field label="Checkout session" value={p.stripeCheckoutSessionId} mono />
          <Field label="Price ID" value={p.stripePriceId} mono />
        </div>
      </AdminCard>

      {/* 4. Discount & partner (immutable snapshot taken at purchase time) */}
      <AdminCard>
        <p className="text-eyebrow text-muted-foreground">Discount &amp; partner</p>
        {data.discount ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Code" value={data.discount.code} mono />
            <Field
              label="Original amount"
              value={money(data.discount.originalAmountCents, p.currency)}
            />
            <Field
              label="Discount given"
              value={money(data.discount.discountAmountCents, p.currency)}
            />
            <Field label="Amount paid" value={money(p.amountTotal, p.currency)} />
            <Field label="Partner" value={data.discount.partnerName} />
            <Field
              label="Commission"
              value={
                data.discount.commissionAmountCents != null
                  ? `${money(data.discount.commissionAmountCents, p.currency)}${
                      data.discount.commissionPercent != null
                        ? ` (${data.discount.commissionPercent}%)`
                        : ""
                    }`
                  : null
              }
            />
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            No discount code was used for this purchase.
          </p>
        )}
      </AdminCard>

      {/* 6. Purchase history */}
      <AdminCard>
        <p className="text-eyebrow text-muted-foreground">Purchase history</p>
        <div className="mt-4 flex flex-col">
          {data.history.map((h) => (
            <div
              key={h.id}
              className="flex flex-wrap items-center justify-between gap-3 border-t border-black/[0.04] py-3 first:border-t-0 first:pt-0"
            >
              <div className="min-w-0">
                <p className="text-sm">{money(h.amountTotal, h.currency)}</p>
                <p className="font-mono text-[11px] text-muted-foreground">
                  {h.stripePaymentIntentId ?? "—"}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">
                  {fmtDate(h.paidAt ?? h.createdAt)}
                </span>
                <StatusPill status={h.status} />
              </div>
            </div>
          ))}
          {data.history.length === 0 && (
            <p className="text-sm text-muted-foreground">No other purchases.</p>
          )}
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Only confirmed payments are stored. Unsuccessful or abandoned checkout
          attempts are not persisted today, so they cannot appear here.
        </p>
      </AdminCard>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/admin/payments"
      className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      All payments
    </Link>
  );
}
