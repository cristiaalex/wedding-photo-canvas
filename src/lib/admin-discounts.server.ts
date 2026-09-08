import type { SupabaseClient } from "@supabase/supabase-js";

import {
  adminSupabase,
  getStripe,
  resolveOneTimePriceId,
  type AuthedOrganizer,
} from "./billing.server";
import { recordAdminAction, type AdminIdentity } from "./admin.server";

/**
 * Server-only Discount Codes data layer (V1).
 *
 * Mosaic owns the configuration + partner/commission metadata; Stripe owns the
 * actual discount mechanism (one Coupon + one Promotion Code per Mosaic code).
 * No new Stripe Product or Price is ever created — the existing one-time price
 * is reused untouched.
 *
 * Never importable from the browser: it uses the service-role client and the
 * Stripe secret key. Every admin caller must have passed `requireAdmin()`.
 */

/* ------------------------------------------------------------------ */
/* Types                                                                */
/* ------------------------------------------------------------------ */

export type DiscountType = "percent" | "fixed";
export type DiscountStatus = "active" | "paused" | "expired";

export type DiscountRow = {
  id: string;
  code: string;
  discount_type: DiscountType;
  percent_off: number | null;
  amount_off_cents: number | null;
  currency: string;
  valid_until: string | null;
  max_redemptions: number | null;
  per_customer_limit: number | null;
  partner_name: string | null;
  commission_percent: number | null;
  internal_note: string | null;
  stripe_coupon_id: string | null;
  stripe_promotion_code_id: string | null;
  status: "active" | "paused";
  created_at: string;
  updated_at: string;
};

export type DiscountListItem = {
  id: string;
  code: string;
  discountType: DiscountType;
  percentOff: number | null;
  amountOffCents: number | null;
  currency: string;
  partnerName: string | null;
  commissionPercent: number | null;
  redemptions: number;
  maxRedemptions: number | null;
  validUntil: string | null;
  status: DiscountStatus;
  createdAt: string;
};

export type DiscountPerformance = {
  totalRedemptions: number;
  successfulPurchases: number;
  originalValueCents: number;
  totalDiscountCents: number;
  customerRevenueCents: number;
  commissionCents: number;
  netRevenueCents: number;
  currency: string;
};

export type DiscountDetail = {
  code: DiscountListItem & {
    perCustomerLimit: number | null;
    internalNote: string | null;
    stripeCouponId: string | null;
    stripePromotionCodeId: string | null;
    updatedAt: string;
  };
  performance: DiscountPerformance;
  redemptions: Array<{
    subscriptionId: string;
    userId: string;
    email: string | null;
    paidAt: string | null;
    originalAmountCents: number | null;
    discountAmountCents: number | null;
    amountPaidCents: number | null;
    commissionPercent: number | null;
    commissionAmountCents: number | null;
    currency: string | null;
  }>;
  generatedAt: string;
};

export class DiscountError extends Error {}

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

const SELECT_COLS =
  "id, code, discount_type, percent_off, amount_off_cents, currency, valid_until, max_redemptions, per_customer_limit, partner_name, commission_percent, internal_note, stripe_coupon_id, stripe_promotion_code_id, status, created_at, updated_at";

export function effectiveStatus(row: {
  status: string;
  valid_until: string | null;
}): DiscountStatus {
  if (row.status === "paused") return "paused";
  if (row.valid_until && new Date(row.valid_until).getTime() <= Date.now()) {
    return "expired";
  }
  return "active";
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Current one-time product price, straight from Stripe. */
export async function currentProductPrice(): Promise<{
  priceId: string;
  unitAmountCents: number;
  currency: string;
}> {
  const priceId = await resolveOneTimePriceId();
  const price = await getStripe().prices.retrieve(priceId);
  return {
    priceId,
    unitAmountCents: price.unit_amount ?? 0,
    currency: (price.currency ?? "eur").toLowerCase(),
  };
}

/** Counts paid purchases attributed to a discount code. */
async function countRedemptions(
  admin: SupabaseClient,
  discountId: string,
  userId?: string,
): Promise<number> {
  let q = admin
    .from("subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("discount_code_id", discountId)
    .eq("status", "paid");
  if (userId) q = q.eq("user_id", userId);
  const { count, error } = await q;
  if (error) throw new DiscountError(error.message);
  return count ?? 0;
}

function toListItem(row: DiscountRow, redemptions: number): DiscountListItem {
  return {
    id: row.id,
    code: row.code,
    discountType: row.discount_type,
    percentOff: num(row.percent_off),
    amountOffCents: row.amount_off_cents,
    currency: row.currency ?? "eur",
    partnerName: row.partner_name,
    commissionPercent: num(row.commission_percent),
    redemptions,
    maxRedemptions: row.max_redemptions,
    validUntil: row.valid_until,
    status: effectiveStatus(row),
    createdAt: row.created_at,
  };
}

/* ------------------------------------------------------------------ */
/* Create                                                               */
/* ------------------------------------------------------------------ */

export type CreateDiscountInput = {
  code: string;
  discountType: DiscountType;
  percentOff?: number | null;
  amountOffCents?: number | null;
  validUntil?: string | null;
  maxRedemptions?: number | null;
  perCustomerLimit?: number | null;
  partnerName?: string | null;
  commissionPercent?: number | null;
  internalNote?: string | null;
};

export async function createDiscountCode(
  actor: AdminIdentity,
  input: CreateDiscountInput,
): Promise<DiscountListItem> {
  const admin = adminSupabase();
  const stripe = getStripe();

  const code = input.code.trim().toUpperCase();
  if (!/^[A-Z0-9._-]{3,40}$/.test(code)) {
    throw new DiscountError(
      "Code must be 3–40 characters: letters, numbers, dot, dash or underscore.",
    );
  }

  const price = await currentProductPrice();

  let percentOff: number | null = null;
  let amountOffCents: number | null = null;

  if (input.discountType === "percent") {
    percentOff = num(input.percentOff);
    if (percentOff === null || percentOff <= 0 || percentOff > 100) {
      throw new DiscountError("Percentage must be between 1 and 100.");
    }
    percentOff = Math.round(percentOff * 100) / 100;
  } else {
    amountOffCents = num(input.amountOffCents);
    if (amountOffCents === null || !Number.isInteger(amountOffCents) || amountOffCents <= 0) {
      throw new DiscountError("Fixed amount must be a positive EUR amount.");
    }
    if (price.unitAmountCents > 0 && amountOffCents > price.unitAmountCents) {
      throw new DiscountError(
        `Discount cannot exceed the current product price (${(price.unitAmountCents / 100).toFixed(2)} ${price.currency.toUpperCase()}).`,
      );
    }
  }

  const validUntil = input.validUntil ? new Date(input.validUntil) : null;
  if (validUntil && (Number.isNaN(validUntil.getTime()) || validUntil.getTime() <= Date.now())) {
    throw new DiscountError("Valid-until must be a future date.");
  }

  const maxRedemptions = num(input.maxRedemptions);
  if (maxRedemptions !== null && (!Number.isInteger(maxRedemptions) || maxRedemptions < 1)) {
    throw new DiscountError("Usage limit must be a whole number of at least 1.");
  }
  const perCustomerLimit = num(input.perCustomerLimit);
  if (perCustomerLimit !== null && (!Number.isInteger(perCustomerLimit) || perCustomerLimit < 1)) {
    throw new DiscountError("Per-customer limit must be a whole number of at least 1.");
  }
  const commissionPercent = num(input.commissionPercent);
  if (commissionPercent !== null && (commissionPercent < 0 || commissionPercent > 100)) {
    throw new DiscountError("Commission must be between 0 and 100 percent.");
  }
  const partnerName = input.partnerName?.trim() || null;

  // Uniqueness check before touching Stripe, so we don't orphan objects.
  const { data: existing } = await admin
    .from("discount_codes")
    .select("id")
    .ilike("code", code)
    .maybeSingle();
  if (existing) throw new DiscountError(`Code ${code} already exists.`);

  // 1. Stripe coupon (one-time purchase → duration "once").
  const coupon = await stripe.coupons.create({
    name: code,
    duration: "once",
    ...(percentOff !== null
      ? { percent_off: percentOff }
      : { amount_off: amountOffCents!, currency: price.currency }),
    ...(maxRedemptions !== null ? { max_redemptions: maxRedemptions } : {}),
    ...(validUntil ? { redeem_by: Math.floor(validUntil.getTime() / 1000) } : {}),
    metadata: {
      mosaic: "discount_code",
      ...(partnerName ? { partner: partnerName } : {}),
    },
  });

  // 2. Stripe promotion code (the string the customer types).
  let promo;
  try {
    promo = await stripe.promotionCodes.create({
      promotion: { type: "coupon", coupon: coupon.id },
      code,
      active: true,
      ...(maxRedemptions !== null ? { max_redemptions: maxRedemptions } : {}),
      ...(validUntil ? { expires_at: Math.floor(validUntil.getTime() / 1000) } : {}),
      metadata: { mosaic: "discount_code" },
    });
  } catch (err) {
    await stripe.coupons.del(coupon.id).catch(() => {});
    throw new DiscountError(
      err instanceof Error ? err.message : "Stripe rejected the promotion code.",
    );
  }

  const { data, error } = await admin
    .from("discount_codes")
    .insert({
      code,
      discount_type: input.discountType,
      percent_off: percentOff,
      amount_off_cents: amountOffCents,
      currency: price.currency,
      valid_until: validUntil ? validUntil.toISOString() : null,
      max_redemptions: maxRedemptions,
      per_customer_limit: perCustomerLimit,
      partner_name: partnerName,
      commission_percent: commissionPercent,
      internal_note: input.internalNote?.trim() || null,
      stripe_coupon_id: coupon.id,
      stripe_promotion_code_id: promo.id,
      status: "active",
    })
    .select(SELECT_COLS)
    .single();

  if (error || !data) {
    // Roll the Stripe side back so the two systems stay consistent.
    await stripe.promotionCodes.update(promo.id, { active: false }).catch(() => {});
    await stripe.coupons.del(coupon.id).catch(() => {});
    throw new DiscountError(error?.message ?? "Could not save the discount code.");
  }

  await recordAdminAction(actor, "discount_code.created", {
    type: "discount_code",
    id: data.id,
    detail: {
      code,
      discountType: input.discountType,
      percentOff,
      amountOffCents,
      partnerName,
      commissionPercent,
      stripeCouponId: coupon.id,
      stripePromotionCodeId: promo.id,
    },
  });

  return toListItem(data as DiscountRow, 0);
}

/* ------------------------------------------------------------------ */
/* Pause / reactivate                                                   */
/* ------------------------------------------------------------------ */

export async function setDiscountStatus(
  actor: AdminIdentity,
  id: string,
  status: "active" | "paused",
): Promise<DiscountListItem> {
  const admin = adminSupabase();

  const { data: row, error } = await admin
    .from("discount_codes")
    .select(SELECT_COLS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new DiscountError(error.message);
  if (!row) throw new DiscountError("Discount code not found.");

  const current = row as DiscountRow;

  // Mirror the state onto Stripe so a paused code is unusable at checkout,
  // even if someone bypasses the Mosaic UI entirely.
  if (current.stripe_promotion_code_id) {
    try {
      await getStripe().promotionCodes.update(current.stripe_promotion_code_id, {
        active: status === "active",
      });
    } catch (err) {
      // A promotion code past its expiry cannot be re-activated in Stripe.
      if (status === "active") {
        throw new DiscountError(
          err instanceof Error
            ? `Stripe could not reactivate this code: ${err.message}`
            : "Stripe could not reactivate this code.",
        );
      }
      throw new DiscountError("Stripe could not pause this code. Nothing was changed.");
    }
  }

  const { data: updated, error: upErr } = await admin
    .from("discount_codes")
    .update({ status })
    .eq("id", id)
    .select(SELECT_COLS)
    .single();
  if (upErr || !updated) throw new DiscountError(upErr?.message ?? "Update failed.");

  await recordAdminAction(
    actor,
    status === "paused" ? "discount_code.paused" : "discount_code.reactivated",
    { type: "discount_code", id, detail: { code: current.code } },
  );

  const redemptions = await countRedemptions(admin, id);
  return toListItem(updated as DiscountRow, redemptions);
}

/* ------------------------------------------------------------------ */
/* Edit                                                                 */
/* ------------------------------------------------------------------ */

export type UpdateDiscountInput = {
  id: string;
  discountType: DiscountType;
  percentOff?: number | null;
  amountOffCents?: number | null;
  validUntil?: string | null;
  maxRedemptions?: number | null;
  perCustomerLimit?: number | null;
  partnerName?: string | null;
  commissionPercent?: number | null;
  internalNote?: string | null;
};

/**
 * Edits a discount code. The code string itself is never editable: it is bound
 * to the Stripe promotion code and to historical purchase snapshots.
 *
 * Stripe coupons and promotion codes are immutable apart from `active`,
 * `name` and `metadata`. So whenever a Stripe-relevant field changes (type,
 * value, expiry, usage limit) we deactivate the old promotion code and create
 * a fresh coupon + promotion code carrying the same customer-facing string.
 * Historical purchases keep pointing at the Mosaic row, and their snapshots
 * (original amount, discount, partner, commission) are never rewritten.
 */
export async function updateDiscountCode(
  actor: AdminIdentity,
  input: UpdateDiscountInput,
): Promise<DiscountListItem> {
  const admin = adminSupabase();
  const stripe = getStripe();

  const { data: existing, error: readErr } = await admin
    .from("discount_codes")
    .select(SELECT_COLS)
    .eq("id", input.id)
    .maybeSingle();
  if (readErr) throw new DiscountError(readErr.message);
  if (!existing) throw new DiscountError("Discount code not found.");
  const row = existing as DiscountRow;

  const price = await currentProductPrice();

  let percentOff: number | null = null;
  let amountOffCents: number | null = null;
  if (input.discountType === "percent") {
    percentOff = num(input.percentOff);
    if (percentOff === null || percentOff <= 0 || percentOff > 100) {
      throw new DiscountError("Percentage must be between 1 and 100.");
    }
    percentOff = Math.round(percentOff * 100) / 100;
  } else {
    amountOffCents = num(input.amountOffCents);
    if (amountOffCents === null || !Number.isInteger(amountOffCents) || amountOffCents <= 0) {
      throw new DiscountError("Fixed amount must be a positive EUR amount.");
    }
    if (price.unitAmountCents > 0 && amountOffCents > price.unitAmountCents) {
      throw new DiscountError(
        `Discount cannot exceed the current product price (${(price.unitAmountCents / 100).toFixed(2)} ${price.currency.toUpperCase()}).`,
      );
    }
  }

  const validUntil = input.validUntil ? new Date(input.validUntil) : null;
  if (validUntil && Number.isNaN(validUntil.getTime())) {
    throw new DiscountError("Valid-until is not a valid date.");
  }

  const maxRedemptions = num(input.maxRedemptions);
  if (maxRedemptions !== null && (!Number.isInteger(maxRedemptions) || maxRedemptions < 1)) {
    throw new DiscountError("Usage limit must be a whole number of at least 1.");
  }
  const perCustomerLimit = num(input.perCustomerLimit);
  if (perCustomerLimit !== null && (!Number.isInteger(perCustomerLimit) || perCustomerLimit < 1)) {
    throw new DiscountError("Per-customer limit must be a whole number of at least 1.");
  }
  const commissionPercent = num(input.commissionPercent);
  if (commissionPercent !== null && (commissionPercent < 0 || commissionPercent > 100)) {
    throw new DiscountError("Commission must be between 0 and 100 percent.");
  }
  const partnerName = input.partnerName?.trim() || null;

  const redeemed = await countRedemptions(admin, row.id);
  if (maxRedemptions !== null && maxRedemptions < redeemed) {
    throw new DiscountError(
      `This code has already been used ${redeemed} time(s); the usage limit cannot be lower than that.`,
    );
  }

  const newValidUntilIso = validUntil ? validUntil.toISOString() : null;
  const stripeRelevantChanged =
    row.discount_type !== input.discountType ||
    num(row.percent_off) !== percentOff ||
    (row.amount_off_cents ?? null) !== amountOffCents ||
    (row.valid_until ?? null) !== newValidUntilIso ||
    (row.max_redemptions ?? null) !== maxRedemptions;

  let couponId = row.stripe_coupon_id;
  let promoId = row.stripe_promotion_code_id;
  const oldCouponId = row.stripe_coupon_id;
  const oldPromoId = row.stripe_promotion_code_id;

  if (stripeRelevantChanged) {
    if (validUntil && validUntil.getTime() <= Date.now()) {
      throw new DiscountError(
        "Valid-until must be in the future when changing the Stripe configuration.",
      );
    }

    // Free the code string before recreating it: Stripe only enforces
    // uniqueness across ACTIVE promotion codes.
    if (oldPromoId) {
      try {
        await stripe.promotionCodes.update(oldPromoId, { active: false });
      } catch (err) {
        throw new DiscountError(
          err instanceof Error
            ? `Stripe could not update this code: ${err.message}. Nothing was changed.`
            : "Stripe could not update this code. Nothing was changed.",
        );
      }
    }

    let newCoupon;
    let newPromo;
    try {
      newCoupon = await stripe.coupons.create({
        name: row.code,
        duration: "once",
        ...(percentOff !== null
          ? { percent_off: percentOff }
          : { amount_off: amountOffCents!, currency: price.currency }),
        ...(maxRedemptions !== null ? { max_redemptions: maxRedemptions } : {}),
        ...(validUntil ? { redeem_by: Math.floor(validUntil.getTime() / 1000) } : {}),
        metadata: {
          mosaic: "discount_code",
          ...(partnerName ? { partner: partnerName } : {}),
        },
      });
      newPromo = await stripe.promotionCodes.create({
        promotion: { type: "coupon", coupon: newCoupon.id },
        code: row.code,
        active: row.status === "active",
        ...(maxRedemptions !== null ? { max_redemptions: maxRedemptions } : {}),
        ...(validUntil ? { expires_at: Math.floor(validUntil.getTime() / 1000) } : {}),
        metadata: { mosaic: "discount_code" },
      });
    } catch (err) {
      // Roll Stripe back to the previous, still-consistent state.
      if (newCoupon) await stripe.coupons.del(newCoupon.id).catch(() => {});
      if (oldPromoId && row.status === "active") {
        await stripe.promotionCodes.update(oldPromoId, { active: true }).catch(() => {});
      }
      throw new DiscountError(
        err instanceof Error
          ? `Stripe rejected this change: ${err.message}. Nothing was changed.`
          : "Stripe rejected this change. Nothing was changed.",
      );
    }

    couponId = newCoupon.id;
    promoId = newPromo.id;
  }

  const { data: updated, error: upErr } = await admin
    .from("discount_codes")
    .update({
      discount_type: input.discountType,
      percent_off: percentOff,
      amount_off_cents: amountOffCents,
      currency: price.currency,
      valid_until: newValidUntilIso,
      max_redemptions: maxRedemptions,
      per_customer_limit: perCustomerLimit,
      partner_name: partnerName,
      commission_percent: commissionPercent,
      internal_note: input.internalNote?.trim() || null,
      stripe_coupon_id: couponId,
      stripe_promotion_code_id: promoId,
    })
    .eq("id", row.id)
    .select(SELECT_COLS)
    .single();

  if (upErr || !updated) {
    if (stripeRelevantChanged && promoId) {
      await stripe.promotionCodes.update(promoId, { active: false }).catch(() => {});
      if (couponId) await stripe.coupons.del(couponId).catch(() => {});
      if (oldPromoId && row.status === "active") {
        await stripe.promotionCodes.update(oldPromoId, { active: true }).catch(() => {});
      }
    }
    throw new DiscountError(upErr?.message ?? "Could not save the discount code.");
  }

  // Old coupon is retired only after Mosaic is committed. Deleting a coupon in
  // Stripe never alters already-completed payments.
  if (stripeRelevantChanged && oldCouponId && oldCouponId !== couponId) {
    await stripe.coupons.del(oldCouponId).catch(() => {});
  }

  await recordAdminAction(actor, "discount_code.updated", {
    type: "discount_code",
    id: row.id,
    detail: {
      code: row.code,
      stripeRecreated: stripeRelevantChanged,
      before: {
        discountType: row.discount_type,
        percentOff: num(row.percent_off),
        amountOffCents: row.amount_off_cents,
        validUntil: row.valid_until,
        maxRedemptions: row.max_redemptions,
        perCustomerLimit: row.per_customer_limit,
        partnerName: row.partner_name,
        commissionPercent: num(row.commission_percent),
      },
      after: {
        discountType: input.discountType,
        percentOff,
        amountOffCents,
        validUntil: newValidUntilIso,
        maxRedemptions,
        perCustomerLimit,
        partnerName,
        commissionPercent,
      },
    },
  });

  return toListItem(updated as DiscountRow, redeemed);
}

/* ------------------------------------------------------------------ */
/* Delete (unused codes only)                                           */
/* ------------------------------------------------------------------ */

export async function deleteDiscountCode(
  actor: AdminIdentity,
  id: string,
): Promise<{ deleted: true }> {
  const admin = adminSupabase();
  const stripe = getStripe();

  const { data, error } = await admin
    .from("discount_codes")
    .select(SELECT_COLS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new DiscountError(error.message);
  if (!data) throw new DiscountError("Discount code not found.");
  const row = data as DiscountRow;

  // Any attribution at all — paid or not — makes this historical data.
  const { count, error: cErr } = await admin
    .from("subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("discount_code_id", id);
  if (cErr) throw new DiscountError(cErr.message);
  if ((count ?? 0) > 0) {
    throw new DiscountError(
      "Used codes cannot be deleted because they are linked to historical transactions. Pause the code instead.",
    );
  }

  if (row.stripe_promotion_code_id) {
    try {
      await stripe.promotionCodes.update(row.stripe_promotion_code_id, { active: false });
    } catch {
      // Already inactive or expired in Stripe: nothing further to disable.
    }
  }
  if (row.stripe_coupon_id) {
    await stripe.coupons.del(row.stripe_coupon_id).catch(() => {});
  }

  const { error: delErr } = await admin.from("discount_codes").delete().eq("id", id);
  if (delErr) throw new DiscountError(delErr.message);

  await recordAdminAction(actor, "discount_code.deleted", {
    type: "discount_code",
    id,
    detail: {
      code: row.code,
      discountType: row.discount_type,
      percentOff: num(row.percent_off),
      amountOffCents: row.amount_off_cents,
      partnerName: row.partner_name,
      stripeCouponId: row.stripe_coupon_id,
      stripePromotionCodeId: row.stripe_promotion_code_id,
    },
  });

  return { deleted: true };
}

/* ------------------------------------------------------------------ */
/* Read                                                                 */
/* ------------------------------------------------------------------ */

export type DiscountListResult = {
  items: DiscountListItem[];
  total: number;
  page: number;
  pageSize: number;
  productPriceCents: number;
  currency: string;
  generatedAt: string;
};

export async function listDiscountCodes(params: {
  search?: string;
  status?: DiscountStatus | "all";
  page?: number;
  pageSize?: number;
}): Promise<DiscountListResult> {
  const admin = adminSupabase();
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(5, params.pageSize ?? 25));

  let q = admin
    .from("discount_codes")
    .select(SELECT_COLS, { count: "exact" })
    .order("created_at", { ascending: false });

  const search = params.search?.trim();
  if (search) {
    q = q.or(`code.ilike.%${search}%,partner_name.ilike.%${search}%`);
  }

  const { data, count, error } = await q;
  if (error) throw new DiscountError(error.message);

  const rows = (data ?? []) as DiscountRow[];

  // Redemption counts, aggregated server-side in one query.
  const { data: subs, error: subErr } = await admin
    .from("subscriptions")
    .select("discount_code_id")
    .eq("status", "paid")
    .not("discount_code_id", "is", null);
  if (subErr) throw new DiscountError(subErr.message);
  const counts = new Map<string, number>();
  for (const s of (subs ?? []) as Array<{ discount_code_id: string }>) {
    counts.set(s.discount_code_id, (counts.get(s.discount_code_id) ?? 0) + 1);
  }

  let items = rows.map((r) => toListItem(r, counts.get(r.id) ?? 0));
  if (params.status && params.status !== "all") {
    items = items.filter((i) => i.status === params.status);
  }

  const total = params.status && params.status !== "all" ? items.length : (count ?? items.length);
  const start = (page - 1) * pageSize;

  let price = { unitAmountCents: 0, currency: "eur" };
  try {
    price = await currentProductPrice();
  } catch {
    /* price lookup is informational only */
  }

  return {
    items: items.slice(start, start + pageSize),
    total,
    page,
    pageSize,
    productPriceCents: price.unitAmountCents,
    currency: price.currency,
    generatedAt: new Date().toISOString(),
  };
}

export async function getDiscountDetail(id: string): Promise<DiscountDetail> {
  const admin = adminSupabase();

  const { data, error } = await admin
    .from("discount_codes")
    .select(SELECT_COLS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new DiscountError(error.message);
  if (!data) throw new DiscountError("Discount code not found.");
  const row = data as DiscountRow;

  const { data: subs, error: subErr } = await admin
    .from("subscriptions")
    .select(
      "id, user_id, status, paid_at, amount_total, currency, original_amount_cents, discount_amount_cents, commission_percent, commission_amount_cents",
    )
    .eq("discount_code_id", id)
    .order("paid_at", { ascending: false });
  if (subErr) throw new DiscountError(subErr.message);

  const all = (subs ?? []) as Array<{
    id: string;
    user_id: string;
    status: string | null;
    paid_at: string | null;
    amount_total: number | null;
    currency: string | null;
    original_amount_cents: number | null;
    discount_amount_cents: number | null;
    commission_percent: number | null;
    commission_amount_cents: number | null;
  }>;
  const paid = all.filter((s) => s.status === "paid");

  // Emails, resolved one by one (redemption volumes are small in V1).
  const emails = new Map<string, string | null>();
  for (const s of all.slice(0, 100)) {
    if (emails.has(s.user_id)) continue;
    try {
      const { data: u } = await admin.auth.admin.getUserById(s.user_id);
      emails.set(s.user_id, u?.user?.email ?? null);
    } catch {
      emails.set(s.user_id, null);
    }
  }

  const sum = (f: (s: (typeof paid)[number]) => number) =>
    paid.reduce((acc, s) => acc + f(s), 0);

  const customerRevenueCents = sum((s) => s.amount_total ?? 0);
  const totalDiscountCents = sum((s) => s.discount_amount_cents ?? 0);
  const originalValueCents = sum(
    (s) => s.original_amount_cents ?? (s.amount_total ?? 0) + (s.discount_amount_cents ?? 0),
  );
  const commissionCents = sum((s) => s.commission_amount_cents ?? 0);

  return {
    code: {
      ...toListItem(row, paid.length),
      perCustomerLimit: row.per_customer_limit,
      internalNote: row.internal_note,
      stripeCouponId: row.stripe_coupon_id,
      stripePromotionCodeId: row.stripe_promotion_code_id,
      updatedAt: row.updated_at,
    },
    performance: {
      totalRedemptions: all.length,
      successfulPurchases: paid.length,
      originalValueCents,
      totalDiscountCents,
      customerRevenueCents,
      commissionCents,
      netRevenueCents: customerRevenueCents - commissionCents,
      currency: (paid[0]?.currency ?? row.currency ?? "eur").toLowerCase(),
    },
    redemptions: all.map((s) => ({
      subscriptionId: s.id,
      userId: s.user_id,
      email: emails.get(s.user_id) ?? null,
      paidAt: s.paid_at,
      originalAmountCents: s.original_amount_cents,
      discountAmountCents: s.discount_amount_cents,
      amountPaidCents: s.amount_total,
      commissionPercent: num(s.commission_percent),
      commissionAmountCents: s.commission_amount_cents,
      currency: s.currency,
    })),
    generatedAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Checkout-time validation (customer flow)                             */
/* ------------------------------------------------------------------ */

export type ResolvedDiscount = {
  row: DiscountRow;
  promotionCodeId: string;
};

/**
 * Server-side gate for a customer-supplied code. The browser only ever sends
 * the raw string; the discount value, partner and commission are read here.
 */
export async function resolveDiscountForCheckout(
  rawCode: string,
  organizer: AuthedOrganizer,
): Promise<ResolvedDiscount> {
  const admin = adminSupabase();
  const code = rawCode.trim().toUpperCase();
  if (!code) throw new DiscountError("Enter a discount code.");

  const { data, error } = await admin
    .from("discount_codes")
    .select(SELECT_COLS)
    .ilike("code", code)
    .maybeSingle();
  if (error) throw new DiscountError(error.message);
  if (!data) throw new DiscountError("That discount code is not valid.");

  const row = data as DiscountRow;
  const status = effectiveStatus(row);
  if (status === "paused") throw new DiscountError("That discount code is not active.");
  if (status === "expired") throw new DiscountError("That discount code has expired.");
  if (!row.stripe_promotion_code_id) {
    throw new DiscountError("That discount code is not usable yet.");
  }

  if (row.max_redemptions !== null) {
    const used = await countRedemptions(admin, row.id);
    if (used >= row.max_redemptions) {
      throw new DiscountError("That discount code has reached its usage limit.");
    }
  }

  if (row.per_customer_limit !== null) {
    const mine = await countRedemptions(admin, row.id, organizer.userId);
    if (mine >= row.per_customer_limit) {
      throw new DiscountError("You have already used this discount code.");
    }
  }

  return { row, promotionCodeId: row.stripe_promotion_code_id };
}

/**
 * Builds the immutable purchase snapshot for a completed discounted payment.
 * Commission is a percentage of the amount the customer ACTUALLY paid.
 */
export async function buildDiscountSnapshot(input: {
  promotionCodeId: string | null;
  amountPaidCents: number | null;
  amountDiscountCents: number | null;
  amountSubtotalCents: number | null;
}): Promise<Record<string, unknown> | null> {
  if (!input.promotionCodeId) return null;
  const admin = adminSupabase();
  const { data } = await admin
    .from("discount_codes")
    .select(SELECT_COLS)
    .eq("stripe_promotion_code_id", input.promotionCodeId)
    .maybeSingle();
  if (!data) return null;
  const row = data as DiscountRow;

  const paid = input.amountPaidCents ?? 0;
  const discount = input.amountDiscountCents ?? 0;
  const original = input.amountSubtotalCents ?? paid + discount;
  const commissionPercent = num(row.commission_percent);
  const commissionCents =
    row.partner_name && commissionPercent !== null
      ? Math.round((paid * commissionPercent) / 100)
      : null;

  return {
    discount_code_id: row.id,
    discount_code: row.code,
    original_amount_cents: original,
    discount_amount_cents: discount,
    partner_name: row.partner_name,
    commission_percent: commissionPercent,
    commission_amount_cents: commissionCents,
  };
}
