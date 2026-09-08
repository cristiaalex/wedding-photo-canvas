import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import type { AdminOverview } from "./admin.server";

/**
 * Client-callable admin RPCs.
 *
 * Every handler resolves the caller server-side from the bearer token and
 * verifies the configured admin allow-list before touching any data. No admin
 * flag is ever accepted from the browser, and the server-only module is
 * loaded with a dynamic import so service-role code never enters the client
 * bundle.
 */

function authHeader(): string | null {
  return getRequest()?.headers?.get("authorization") ?? null;
}

export type AdminSession = { isAdmin: boolean; email: string | null };

/** Cheap authorization probe used by the /admin route gate. */
export const getAdminSession = createServerFn({ method: "GET" }).handler(
  async (): Promise<AdminSession> => {
    const { requireAdmin } = await import("./admin.server");
    try {
      const admin = await requireAdmin(authHeader());
      return { isAdmin: true, email: admin.email };
    } catch {
      return { isAdmin: false, email: null };
    }
  },
);

export type { AdminOverview };

export const getAdminOverview = createServerFn({ method: "GET" }).handler(
  async (): Promise<AdminOverview> => {
    const { requireAdmin, computeOverview } = await import("./admin.server");
    await requireAdmin(authHeader()); // throws Unauthorized / Forbidden
    return computeOverview();
  },
);

/* ------------------------------------------------------------------ */
/* Customers / Customer 360                                             */
/* ------------------------------------------------------------------ */

export type {
  CustomerListItem,
  CustomerListResult,
  CustomerFilter,
  Customer360,
  CustomerEvent,
  TimelineEntry,
} from "./admin-customers.server";

import type {
  CustomerFilter,
  CustomerListResult,
  Customer360,
} from "./admin-customers.server";

export const listAdminCustomers = createServerFn({ method: "POST" })
  .inputValidator(
    (input: {
      search?: string;
      filter?: CustomerFilter;
      page?: number;
      pageSize?: number;
    }) => input,
  )
  .handler(async ({ data }): Promise<CustomerListResult> => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(authHeader());
    const { listCustomers } = await import("./admin-customers.server");
    return listCustomers(data ?? {});
  });

export const getAdminCustomer = createServerFn({ method: "POST" })
  .inputValidator((input: { userId: string }) => {
    if (!input?.userId || typeof input.userId !== "string") {
      throw new Error("userId is required");
    }
    return { userId: input.userId };
  })
  .handler(async ({ data }): Promise<Customer360> => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(authHeader());
    const { getCustomer360 } = await import("./admin-customers.server");
    return getCustomer360(data.userId);
  });

/* ------------------------------------------------------------------ */
/* Payments                                                             */
/* ------------------------------------------------------------------ */

export type {
  PaymentListItem,
  PaymentListResult,
  PaymentListParams,
  PaymentStatus,
  PaymentStatusFilter,
  PaymentsSummary,
  PaymentDetail,
} from "./admin-payments.server";

import type {
  PaymentListParams,
  PaymentListResult,
  PaymentsSummary,
  PaymentDetail,
} from "./admin-payments.server";

export const listAdminPayments = createServerFn({ method: "POST" })
  .inputValidator(
    (input: PaymentListParams & { range?: PaymentsSummary["range"] }) => input ?? {},
  )
  .handler(async ({ data }): Promise<PaymentListResult> => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(authHeader());
    const { listPayments } = await import("./admin-payments.server");
    return listPayments(data ?? {});
  });

export const getAdminPayment = createServerFn({ method: "POST" })
  .inputValidator((input: { paymentId: string }) => {
    if (!input?.paymentId || typeof input.paymentId !== "string") {
      throw new Error("paymentId is required");
    }
    return { paymentId: input.paymentId };
  })
  .handler(async ({ data }): Promise<PaymentDetail> => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(authHeader());
    const { getPaymentDetail } = await import("./admin-payments.server");
    return getPaymentDetail(data.paymentId);
  });


/* ------------------------------------------------------------------ */
/* Discount codes                                                       */
/* ------------------------------------------------------------------ */

export type {
  DiscountType,
  DiscountStatus,
  DiscountListItem,
  DiscountListResult,
  DiscountDetail,
  DiscountPerformance,
  CreateDiscountInput,
  UpdateDiscountInput,
} from "./admin-discounts.server";

import type {
  DiscountStatus,
  DiscountListItem,
  DiscountListResult,
  DiscountDetail,
  CreateDiscountInput,
  UpdateDiscountInput,
} from "./admin-discounts.server";

export const updateAdminDiscountCode = createServerFn({ method: "POST" })
  .inputValidator((input: UpdateDiscountInput) => {
    if (!input?.id) throw new Error("id is required");
    return input;
  })
  .handler(async ({ data }): Promise<DiscountListItem> => {
    const { requireAdmin } = await import("./admin.server");
    const actor = await requireAdmin(authHeader());
    const { updateDiscountCode } = await import("./admin-discounts.server");
    return updateDiscountCode(actor, data);
  });

export const deleteAdminDiscountCode = createServerFn({ method: "POST" })
  .inputValidator((input: { id: string }) => {
    if (!input?.id) throw new Error("id is required");
    return { id: input.id };
  })
  .handler(async ({ data }): Promise<{ deleted: true }> => {
    const { requireAdmin } = await import("./admin.server");
    const actor = await requireAdmin(authHeader());
    const { deleteDiscountCode } = await import("./admin-discounts.server");
    return deleteDiscountCode(actor, data.id);
  });

export const listAdminDiscountCodes = createServerFn({ method: "POST" })
  .inputValidator(
    (input: {
      search?: string;
      status?: DiscountStatus | "all";
      page?: number;
      pageSize?: number;
    }) => input ?? {},
  )
  .handler(async ({ data }): Promise<DiscountListResult> => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(authHeader());
    const { listDiscountCodes } = await import("./admin-discounts.server");
    return listDiscountCodes(data ?? {});
  });

export const getAdminDiscountCode = createServerFn({ method: "POST" })
  .inputValidator((input: { id: string }) => {
    if (!input?.id || typeof input.id !== "string") throw new Error("id is required");
    return { id: input.id };
  })
  .handler(async ({ data }): Promise<DiscountDetail> => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(authHeader());
    const { getDiscountDetail } = await import("./admin-discounts.server");
    return getDiscountDetail(data.id);
  });

export const createAdminDiscountCode = createServerFn({ method: "POST" })
  .inputValidator((input: CreateDiscountInput) => input)
  .handler(async ({ data }): Promise<DiscountListItem> => {
    const { requireAdmin } = await import("./admin.server");
    const actor = await requireAdmin(authHeader());
    const { createDiscountCode } = await import("./admin-discounts.server");
    return createDiscountCode(actor, data);
  });

export const setAdminDiscountStatus = createServerFn({ method: "POST" })
  .inputValidator((input: { id: string; status: "active" | "paused" }) => {
    if (!input?.id) throw new Error("id is required");
    if (input.status !== "active" && input.status !== "paused") {
      throw new Error("Invalid status");
    }
    return { id: input.id, status: input.status };
  })
  .handler(async ({ data }): Promise<DiscountListItem> => {
    const { requireAdmin } = await import("./admin.server");
    const actor = await requireAdmin(authHeader());
    const { setDiscountStatus } = await import("./admin-discounts.server");
    return setDiscountStatus(actor, data.id, data.status);
  });
