// Central Plan configuration.
//
// All plan-related limits and feature gates are derived from this object so
// that switching between Development / Trial / Premium is a one-line change.
//
// `maxUploads: null` means "unlimited".

export type PlanId = "development" | "trial" | "premium";

export type PlanConfig = {
  /** Maximum guest photos that can be uploaded across the whole event. */
  maxUploads: number | null;
  /** Mosaic generation availability. */
  mosaicGenerationEnabled: boolean;
  /** Interactive preview availability. */
  mosaicPreviewEnabled: boolean;
  /** Full-resolution print download. */
  mosaicDownloadOriginal: boolean;
  /** Low-resolution preview download. */
  mosaicDownloadPreview: boolean;
  /** Guestbook messages cap (null = unlimited). */
  guestbookUnlimited: boolean;
};

export const PLAN_CONFIGS: Record<PlanId, PlanConfig> = {
  development: {
    maxUploads: null,
    mosaicGenerationEnabled: true,
    mosaicPreviewEnabled: true,
    mosaicDownloadOriginal: true,
    mosaicDownloadPreview: true,
    guestbookUnlimited: true,
  },
  trial: {
    maxUploads: null,
    mosaicGenerationEnabled: true,
    mosaicPreviewEnabled: true,
    mosaicDownloadOriginal: false,
    mosaicDownloadPreview: true,
    guestbookUnlimited: true,
  },
  premium: {
    maxUploads: null,
    mosaicGenerationEnabled: true,
    mosaicPreviewEnabled: true,
    mosaicDownloadOriginal: true,
    mosaicDownloadPreview: true,
    guestbookUnlimited: true,
  },
};

/** Resolve the active plan id for a given event plan string. */
export function resolvePlanId(plan: string | null | undefined): PlanId {
  // Development environment overrides plan gating so the team can demo
  // without hitting trial caps.
  if (import.meta.env.DEV) return "development";
  const normalized = (plan ?? "").toLowerCase();
  if (normalized === "premium") return "premium";
  return "trial";
}

/** Active configuration for a given event plan string. */
export function getPlanConfig(plan: string | null | undefined): PlanConfig {
  return PLAN_CONFIGS[resolvePlanId(plan)];
}

/** Back-compat alias — current default config for unknown plans. */
export const TRIAL_CONFIG: PlanConfig = PLAN_CONFIGS.trial;

export type TrialPlanState = {
  uploadsUsed: number;
  uploadsRemaining: number;
  uploadsReached: boolean;
  /** True when the active plan has no upload cap. */
  unlimited: boolean;
};

export function getTrialState(
  uploadsUsed: number,
  plan: string | null | undefined = null,
): TrialPlanState {
  const cfg = getPlanConfig(plan);
  if (cfg.maxUploads == null) {
    return {
      uploadsUsed,
      uploadsRemaining: Number.POSITIVE_INFINITY,
      uploadsReached: false,
      unlimited: true,
    };
  }
  const remaining = Math.max(0, cfg.maxUploads - uploadsUsed);
  return {
    uploadsUsed,
    uploadsRemaining: remaining,
    uploadsReached: uploadsUsed >= cfg.maxUploads,
    unlimited: false,
  };
}

export function isTrialPlan(plan: string | null | undefined): boolean {
  return resolvePlanId(plan) === "trial";
}
