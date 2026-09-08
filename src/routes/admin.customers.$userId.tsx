import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, ExternalLink } from "lucide-react";

import { getAdminCustomer, type Customer360 } from "@/lib/admin.functions";
import { AdminCard, AdminPageTitle } from "@/components/admin/admin-shell";

export const Route = createFileRoute("/admin/customers/$userId")({
  head: () => ({
    meta: [
      { title: "Customer — Mosaic Admin" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: Customer360Page,
});

function fmt(iso: string | null | undefined, withTime = false) {
  if (!iso) return "—";
  const d = new Date(iso);
  return withTime
    ? d.toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : d.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
}

function money(cents: number | null, currency: string | null) {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: (currency ?? "eur").toUpperCase(),
  }).format(cents / 100);
}

function Customer360Page() {
  const { userId } = Route.useParams();
  const load = useServerFn(getAdminCustomer);
  const [data, setData] = useState<Customer360 | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setData(null);
    setError(null);
    load({ data: { userId } })
      .then((d) => mounted && setData(d))
      .catch((err) => mounted && setError(String(err?.message ?? err)));
    return () => {
      mounted = false;
    };
  }, [load, userId]);

  return (
    <div className="flex flex-col gap-6 md:gap-8">
      <Link
        to="/admin/customers"
        className="flex items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        All customers
      </Link>

      <AdminPageTitle
        title={data?.account.name ?? data?.account.email ?? "Customer"}
        subtitle={data ? `Customer 360 · ${data.account.email ?? "no email"}` : undefined}
      />

      {error && (
        <AdminCard>
          <p className="text-eyebrow text-[color:var(--gold)]">Couldn’t load customer</p>
          <p className="mt-3 text-sm text-muted-foreground">{error}</p>
        </AdminCard>
      )}
      {!data && !error && (
        <AdminCard>
          <p className="text-sm text-muted-foreground">Loading…</p>
        </AdminCard>
      )}

      {data && (
        <>
          {/* 1. Account */}
          <AdminCard>
            <p className="text-eyebrow text-muted-foreground">Account</p>
            <dl className="mt-5 grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Name" value={data.account.name ?? "Not provided"} />
              <Field label="Email" value={data.account.email ?? "—"} />
              <Field label="User ID" value={data.account.userId} mono />
              <Field label="Account created" value={fmt(data.account.createdAt, true)} />
              <Field label="Last sign-in" value={fmt(data.account.lastSignInAt, true)} />
              <Field
                label="Status"
                value={
                  data.account.bannedUntil
                    ? "Suspended"
                    : data.account.emailConfirmedAt
                      ? "Active · email confirmed"
                      : "Pending email confirmation"
                }
              />
            </dl>
          </AdminCard>

          {/* 2. Events */}
          <AdminCard>
            <p className="text-eyebrow text-muted-foreground">
              Events · {data.events.length}
            </p>
            {data.events.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">
                This customer has not created an event yet.
              </p>
            ) : (
              <div className="mt-5 flex flex-col gap-4">
                {data.events.map((e) => (
                  <div
                    key={e.id}
                    className="rounded-[1rem] bg-[color:var(--ivory)]/70 p-4 md:p-5"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="text-display text-lg">{e.name ?? e.slug}</h3>
                      <a
                        href={`/e/${e.slug}`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                      >
                        Open guest page <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                    <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                      <Field label="Event ID" value={e.id} mono />
                      <Field label="Event date" value={fmt(e.weddingDate)} />
                      <Field label="Venue" value={e.venue ?? "Not provided"} />
                      <Field label="Created" value={fmt(e.createdAt)} />
                      <Field label="Plan" value={e.plan ?? "—"} />
                      <Field label="Photos" value={e.photoCount.toLocaleString("en")} />
                      <Field
                        label="Owner / guest photos"
                        value={`${e.ownerPhotoCount} / ${e.guestPhotoCount}`}
                      />
                      <Field label="Distinct guests" value={String(e.guestCount)} />
                      <Field
                        label="Guestbook"
                        value={`${e.guestbookEnabled ? "On" : "Off"} · ${e.guestbookCount} entries`}
                      />
                      <Field
                        label="Gallery for guests"
                        value={e.galleryVisibleToGuests ? "Visible" : "Hidden"}
                      />
                      <Field
                        label="Mosaic"
                        value={
                          e.mosaicStatus
                            ? `${e.mosaicStatus}${e.mosaicProgress != null ? ` · ${e.mosaicProgress}%` : ""}`
                            : "Not generated"
                        }
                      />
                      <Field
                        label="Archives (ZIP)"
                        value={
                          e.zipCount
                            ? `${e.zipStatus} · ${e.zipCount} batch${e.zipCount === 1 ? "" : "es"}`
                            : "None"
                        }
                      />
                    </dl>
                  </div>
                ))}
              </div>
            )}
          </AdminCard>

          {/* 3. Usage */}
          <AdminCard>
            <p className="text-eyebrow text-muted-foreground">Usage</p>
            <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Stat label="Events" value={data.usage.events} />
              <Stat label="Total photos" value={data.usage.photos} />
              <Stat label="Owner uploads" value={data.usage.ownerPhotos} />
              <Stat label="Guest uploads" value={data.usage.guestPhotos} />
              <Stat label="Distinct guests" value={data.usage.guests} />
              <Stat label="Guestbook entries" value={data.usage.guestbookEntries} />
              <Stat label="Mosaics ready" value={data.usage.mosaicsReady} />
              <Stat label="Archives completed" value={data.usage.zipsCompleted} />
            </div>
            <p className="mt-5 text-xs text-muted-foreground">
              Archive storage: {(data.usage.zipBytes / 1024 ** 3).toFixed(2)} GB. Photo
              storage size and download counts are not tracked by Mosaic today, so they
              are intentionally not shown.
            </p>
          </AdminCard>

          {/* 4. Billing */}
          <AdminCard>
            <p className="text-eyebrow text-muted-foreground">Billing</p>
            <p className="text-display mt-3 text-2xl">
              {data.billing.plan === "pro" ? "Pro — Active" : "Free"}
            </p>
            {data.billing.records.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">
                No purchase records for this customer.
              </p>
            ) : (
              <div className="mt-5 flex flex-col gap-4">
                {data.billing.records.map((r) => (
                  <div
                    key={r.id}
                    className="rounded-[1rem] bg-[color:var(--ivory)]/70 p-4 md:p-5"
                  >
                    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                      <Field label="Payment status" value={r.status ?? "—"} />
                      <Field label="Paid at" value={fmt(r.paidAt, true)} />
                      <Field
                        label="Amount paid"
                        value={money(r.amountTotal, r.currency)}
                      />
                      <Field label="Currency" value={(r.currency ?? "—").toUpperCase()} />
                      <Field label="Stripe customer" value={r.stripeCustomerId ?? "—"} mono />
                      <Field
                        label="Payment intent"
                        value={r.stripePaymentIntentId ?? "—"}
                        mono
                      />
                      <Field
                        label="Checkout session"
                        value={r.stripeCheckoutSessionId ?? "—"}
                        mono
                      />
                      <Field label="Price ID" value={r.stripePriceId ?? "—"} mono />
                      <Field label="Record created" value={fmt(r.createdAt, true)} />
                    </dl>
                    <Link
                      to="/admin/payments/$paymentId"
                      params={{ paymentId: r.id }}
                      className="mt-4 inline-flex rounded-full surface-fade px-3.5 py-1.5 text-xs"
                    >
                      View payment
                    </Link>
                  </div>

                ))}
              </div>
            )}
            <p className="mt-5 text-xs text-muted-foreground">
              Mosaic Pro is a one-time purchase. Original amount and discount amount are
              not stored separately today — only the final amount charged by Stripe.
            </p>
          </AdminCard>

          {/* 5. Discount / partner attribution */}
          <AdminCard>
            <p className="text-eyebrow text-muted-foreground">Discount & attribution</p>
            <p className="mt-4 text-sm text-muted-foreground">
              No discount code or partner attribution is recorded for this purchase.
              Mosaic does not track discount codes or partners yet; when that system
              exists, the code, discount amount and partner will appear here as a
              snapshot of the transaction.
            </p>
          </AdminCard>

          {/* 6. Timeline */}
          <AdminCard>
            <p className="text-eyebrow text-muted-foreground">Activity timeline</p>
            <div className="mt-5 flex flex-col gap-4">
              {data.timeline.map((t, i) => (
                <div key={`${t.at}-${i}`} className="flex gap-4">
                  <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--dusty)]" />
                  <div className="min-w-0">
                    <p className="text-sm">{t.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {fmt(t.at, true)}
                      {t.detail ? ` · ${t.detail}` : ""}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-5 text-xs text-muted-foreground">
              Every entry is derived from a real stored timestamp. Individual page views,
              downloads and payment attempts that never reached Stripe are not tracked.
            </p>
          </AdminCard>

          {/* 7/8. Admin actions — visual placeholder only */}
          <AdminCard>
            <p className="text-eyebrow text-muted-foreground">Admin actions</p>
            <div className="mt-5 flex flex-wrap gap-2">
              {["Grant Pro", "Revoke Pro", "Send payment reminder", "Refund"].map((a) => (
                <button
                  key={a}
                  type="button"
                  disabled
                  className="cursor-not-allowed rounded-full surface-fade px-4 py-2 text-xs text-muted-foreground opacity-60"
                >
                  {a}
                </button>
              ))}
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Coming in a later step. Every action will be written to the existing admin
              audit log.
            </p>
          </AdminCard>

          <p className="text-eyebrow text-muted-foreground">
            Updated {new Date(data.generatedAt).toLocaleString("en-GB")}
          </p>
        </>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-1 truncate text-sm ${mono ? "font-mono text-xs" : ""}`} title={value}>
        {value}
      </dd>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-display mt-1 text-2xl">{value.toLocaleString("en")}</p>
    </div>
  );
}
