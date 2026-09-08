import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";

import {
  createAdminDiscountCode,
  updateAdminDiscountCode,
  type DiscountListItem,
} from "@/lib/admin.functions";
import { AdminCard } from "@/components/admin/admin-shell";
import { cn } from "@/lib/utils";

/**
 * One form for both creating and editing a discount code. In edit mode the
 * code string is shown read-only: it is bound to the Stripe promotion code and
 * to historical purchase snapshots, so it can never change.
 */

const inputCls =
  "w-full rounded-[0.75rem] bg-black/[0.04] px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground";
const labelCls = "text-eyebrow text-muted-foreground";

export type DiscountFormInitial = {
  id: string;
  code: string;
  discountType: "percent" | "fixed";
  percentOff: number | null;
  amountOffCents: number | null;
  validUntil: string | null;
  maxRedemptions: number | null;
  perCustomerLimit: number | null;
  partnerName: string | null;
  commissionPercent: number | null;
  internalNote: string | null;
};

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtMoney(cents: number, currency: string) {
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: (currency || "eur").toUpperCase(),
  }).format(cents / 100);
}

export function DiscountCodeForm({
  productPriceCents,
  currency,
  initial,
  onSaved,
  onCancel,
}: {
  productPriceCents: number;
  currency: string;
  /** Present = edit mode. */
  initial?: DiscountFormInitial;
  onSaved: (item: DiscountListItem) => void | Promise<void>;
  onCancel?: () => void;
}) {
  const create = useServerFn(createAdminDiscountCode);
  const update = useServerFn(updateAdminDiscountCode);
  const editing = Boolean(initial);

  const [code, setCode] = useState(initial?.code ?? "");
  const [type, setType] = useState<"percent" | "fixed">(
    initial?.discountType ?? "percent",
  );
  const [value, setValue] = useState(
    initial
      ? initial.discountType === "percent"
        ? String(initial.percentOff ?? "")
        : ((initial.amountOffCents ?? 0) / 100).toFixed(2)
      : "",
  );
  const [forever, setForever] = useState(initial ? !initial.validUntil : true);
  const [validUntil, setValidUntil] = useState(toLocalInput(initial?.validUntil ?? null));
  const [unlimitedUse, setUnlimitedUse] = useState(
    initial ? initial.maxRedemptions == null : true,
  );
  const [maxRedemptions, setMaxRedemptions] = useState(
    initial?.maxRedemptions != null ? String(initial.maxRedemptions) : "",
  );
  const [unlimitedPerCustomer, setUnlimitedPerCustomer] = useState(
    initial ? initial.perCustomerLimit == null : false,
  );
  const [perCustomer, setPerCustomer] = useState(
    initial?.perCustomerLimit != null ? String(initial.perCustomerLimit) : "1",
  );
  const [partner, setPartner] = useState(initial?.partnerName ?? "");
  const [commission, setCommission] = useState(
    initial?.commissionPercent != null ? String(initial.commissionPercent) : "",
  );
  const [note, setNote] = useState(initial?.internalNote ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const payload = {
      discountType: type,
      percentOff: type === "percent" ? Number(value) : null,
      amountOffCents: type === "fixed" ? Math.round(Number(value) * 100) : null,
      validUntil: forever || !validUntil ? null : new Date(validUntil).toISOString(),
      maxRedemptions: unlimitedUse ? null : Number(maxRedemptions),
      perCustomerLimit: unlimitedPerCustomer ? null : Number(perCustomer),
      partnerName: partner || null,
      commissionPercent: commission ? Number(commission) : null,
      internalNote: note || null,
    };
    try {
      const item = initial
        ? await update({ data: { id: initial.id, ...payload } })
        : await create({ data: { code, ...payload } });
      await onSaved(item);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : editing
            ? "Could not save the code."
            : "Could not create the code.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminCard>
      <form onSubmit={submit} className="flex flex-col gap-5">
        <p className="text-eyebrow text-[color:var(--gold)]">
          {editing ? `Edit ${initial!.code}` : "New discount code"}
        </p>

        <div className="grid gap-5 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <label className={labelCls} htmlFor="dc-code">
              Code
            </label>
            <input
              id="dc-code"
              required
              readOnly={editing}
              value={editing ? initial!.code : code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="MARIANA20"
              className={cn(
                inputCls,
                "font-mono tracking-wide",
                editing && "text-muted-foreground",
              )}
            />
            {editing && (
              <p className="text-xs text-muted-foreground">
                The code cannot be changed — it is linked to Stripe and to past
                purchases.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <span className={labelCls}>Discount</span>
            <div className="flex gap-2">
              <div className="flex rounded-[0.75rem] bg-black/[0.04] p-1">
                {(["percent", "fixed"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    className={cn(
                      "rounded-[0.55rem] px-3 py-1.5 text-xs",
                      type === t
                        ? "bg-foreground text-[color:var(--ivory)]"
                        : "text-muted-foreground",
                    )}
                  >
                    {t === "percent" ? "%" : "€"}
                  </button>
                ))}
              </div>
              <input
                required
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={type === "percent" ? "20" : "30.00"}
                className={inputCls}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {type === "percent"
                ? "Between 1 and 100."
                : productPriceCents > 0
                  ? `Cannot exceed the current price (${fmtMoney(productPriceCents, currency)}).`
                  : "Cannot exceed the current product price."}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <span className={labelCls}>Valid until</span>
            <div className="flex flex-wrap items-center gap-3">
              <Toggle on={forever} onClick={() => setForever(true)} label="Forever" />
              <Toggle on={!forever} onClick={() => setForever(false)} label="Until date" />
            </div>
            {!forever && (
              <input
                type="datetime-local"
                required
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
                className={inputCls}
              />
            )}
          </div>

          <div className="flex flex-col gap-2">
            <span className={labelCls}>Usage limit</span>
            <div className="flex flex-wrap items-center gap-3">
              <Toggle
                on={unlimitedUse}
                onClick={() => setUnlimitedUse(true)}
                label="Unlimited"
              />
              <Toggle
                on={!unlimitedUse}
                onClick={() => setUnlimitedUse(false)}
                label="Limited"
              />
            </div>
            {!unlimitedUse && (
              <input
                required
                inputMode="numeric"
                value={maxRedemptions}
                onChange={(e) => setMaxRedemptions(e.target.value)}
                placeholder="50"
                className={inputCls}
              />
            )}
          </div>

          <div className="flex flex-col gap-2">
            <span className={labelCls}>Per-customer limit</span>
            <div className="flex flex-wrap items-center gap-3">
              <Toggle
                on={!unlimitedPerCustomer}
                onClick={() => setUnlimitedPerCustomer(false)}
                label="Limited"
              />
              <Toggle
                on={unlimitedPerCustomer}
                onClick={() => setUnlimitedPerCustomer(true)}
                label="Unlimited"
              />
            </div>
            {!unlimitedPerCustomer && (
              <input
                required
                inputMode="numeric"
                value={perCustomer}
                onChange={(e) => setPerCustomer(e.target.value)}
                className={inputCls}
              />
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label className={labelCls} htmlFor="dc-partner">
              Partner (optional)
            </label>
            <input
              id="dc-partner"
              value={partner}
              onChange={(e) => setPartner(e.target.value)}
              placeholder="Maria"
              className={inputCls}
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className={labelCls} htmlFor="dc-commission">
              Commission % (optional)
            </label>
            <input
              id="dc-commission"
              inputMode="decimal"
              value={commission}
              onChange={(e) => setCommission(e.target.value)}
              placeholder="20"
              className={inputCls}
            />
            <p className="text-xs text-muted-foreground">
              Calculated on the amount the customer actually pays. Past purchases
              keep the commission recorded at the time of payment.
            </p>
          </div>

          <div className="flex flex-col gap-2 md:col-span-2">
            <label className={labelCls} htmlFor="dc-note">
              Internal note (optional)
            </label>
            <input
              id="dc-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Instagram influencer campaign"
              className={inputCls}
            />
          </div>
        </div>

        {error && <p className="text-sm text-red-700">{error}</p>}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-full bg-foreground px-5 py-2.5 text-sm text-[color:var(--ivory)] transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : editing ? "Save changes" : "Create"}
          </button>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Cancel
            </button>
          )}
        </div>
      </form>
    </AdminCard>
  );
}

function Toggle({
  on,
  onClick,
  label,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-3 py-1.5 text-xs transition-colors",
        on
          ? "bg-foreground text-[color:var(--ivory)]"
          : "bg-black/[0.04] text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}
