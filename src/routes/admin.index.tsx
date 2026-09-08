import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";

import { getAdminOverview, type AdminOverview } from "@/lib/admin.functions";
import { AdminCard, AdminPageTitle } from "@/components/admin/admin-shell";

export const Route = createFileRoute("/admin/")({
  head: () => ({
    meta: [
      { title: "Overview — Mosaic Admin" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminOverviewPage,
});

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function monthLabel(key: string) {
  const [y, m] = key.split("-");
  return new Date(Date.UTC(Number(y), Number(m) - 1, 1)).toLocaleString("en", {
    month: "short",
  });
}

function AdminOverviewPage() {
  const load = useServerFn(getAdminOverview);
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    load()
      .then((d) => mounted && setData(d))
      .catch((err) => mounted && setError(String(err?.message ?? err)));
    return () => {
      mounted = false;
    };
  }, [load]);

  return (
    <div className="flex flex-col gap-8 md:gap-10">
      <AdminPageTitle
        title="Overview"
        subtitle="Business health for mosaic.wedding, read live from the production database."
      />

      {error && (
        <AdminCard>
          <p className="text-eyebrow text-[color:var(--gold)]">Couldn’t load metrics</p>
          <p className="mt-3 text-sm text-muted-foreground">{error}</p>
        </AdminCard>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-3">
        <Kpi label="Total customers" value={data ? String(data.totals.customers) : null} />
        <Kpi label="Total events" value={data ? String(data.totals.events) : null} />
        <Kpi label="Pro customers" value={data ? String(data.totals.proCustomers) : null} />
        <Kpi
          label="Total revenue"
          value={data ? money(data.totals.revenueCents, data.totals.currency) : null}
        />
        <Kpi
          label="Conversion rate"
          value={data ? `${(data.totals.conversionRate * 100).toFixed(1)}%` : null}
        />
        <Kpi
          label="Photos uploaded"
          value={data ? data.totals.photos.toLocaleString("en") : null}
        />
      </div>

      {/* Trends */}
      <div className="grid gap-3 md:gap-4 lg:grid-cols-3">
        <Trend
          title="Revenue"
          points={data?.trends.revenueCents ?? null}
          format={(v) => (data ? money(v, data.totals.currency) : String(v))}
        />
        <Trend
          title="New customers"
          points={data?.trends.newCustomers ?? null}
          format={(v) => String(v)}
        />
        <Trend
          title="Pro purchases"
          points={data?.trends.proPurchases ?? null}
          format={(v) => String(v)}
        />
      </div>

      {/* Funnel */}
      <AdminCard>
        <p className="text-eyebrow text-muted-foreground">Customer conversion funnel</p>
        <div className="mt-5 flex flex-col gap-3">
          {[
            { label: "Accounts created", value: data?.funnel.accounts },
            { label: "Events created", value: data?.funnel.withEvents },
            { label: "Photos uploaded", value: data?.funnel.withPhotos },
            { label: "Pro purchased", value: data?.funnel.proPurchased },
          ].map((step) => {
            const top = data?.funnel.accounts ?? 0;
            const pct =
              data && top > 0 ? Math.max(2, ((step.value ?? 0) / top) * 100) : 0;
            return (
              <div key={step.label}>
                <div className="flex items-baseline justify-between">
                  <span className="text-sm">{step.label}</span>
                  <span className="text-display text-lg">
                    {data ? step.value : "—"}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[color:var(--ivory)]">
                  <div
                    className="h-full rounded-full bg-[color:var(--dusty)] transition-[width] duration-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </AdminCard>

      {data && (
        <p className="text-eyebrow text-muted-foreground">
          Updated {new Date(data.generatedAt).toLocaleString("en-GB")}
        </p>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string | null }) {
  return (
    <AdminCard>
      <p className="text-eyebrow text-muted-foreground">{label}</p>
      <p className="text-display mt-3 text-3xl md:text-4xl">
        {value ?? <span className="text-muted-foreground">—</span>}
      </p>
    </AdminCard>
  );
}

function Trend({
  title,
  points,
  format,
}: {
  title: string;
  points: { month: string; value: number }[] | null;
  format: (v: number) => string;
}) {
  const max = points ? Math.max(1, ...points.map((p) => p.value)) : 1;
  return (
    <AdminCard>
      <p className="text-eyebrow text-muted-foreground">{title} · last 6 months</p>
      {!points ? (
        <p className="mt-6 text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <p className="text-display mt-3 text-2xl">
            {format(points.reduce((a, p) => a + p.value, 0))}
          </p>
          <div className="mt-5 flex h-24 items-end gap-2">
            {points.map((p) => (
              <div key={p.month} className="flex flex-1 flex-col items-center gap-2">
                <div
                  className="w-full rounded-t-[0.35rem] bg-[color:var(--dusty)]/70"
                  style={{ height: `${Math.max(2, (p.value / max) * 100)}%` }}
                  title={`${p.month}: ${format(p.value)}`}
                />
                <span className="text-[0.65rem] uppercase tracking-wider text-muted-foreground">
                  {monthLabel(p.month)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </AdminCard>
  );
}
