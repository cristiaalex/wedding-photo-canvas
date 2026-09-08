// Local-first tracking of "which memories did THIS guest contribute?"
//
// The external uploads table has no guest_uuid column, so we mirror the
// guest-identity pattern: every successful upload from this device is
// recorded in localStorage keyed by event. The Gallery and lightbox use
// this to surface "My Memories" filtering and owner-only delete affordances
// without touching the backend.

const UPLOADS_PREFIX = "my_uploads_";
const FIRST_CONTRIBUTION_PREFIX = "first_contribution_shown_";

function uploadsKey(eventId: string) {
  return `${UPLOADS_PREFIX}${eventId}`;
}

function firstContributionKey(eventId: string) {
  return `${FIRST_CONTRIBUTION_PREFIX}${eventId}`;
}

export function readMyUploadIds(eventId: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(uploadsKey(eventId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function rememberMyUpload(eventId: string, uploadId: string): void {
  if (typeof window === "undefined") return;
  try {
    const current = new Set(readMyUploadIds(eventId));
    current.add(uploadId);
    window.localStorage.setItem(uploadsKey(eventId), JSON.stringify(Array.from(current)));
    window.dispatchEvent(new CustomEvent("my-uploads-change", { detail: { eventId } }));
  } catch {
    /* storage blocked — ownership stays in-memory for this session only */
  }
}

export function forgetMyUpload(eventId: string, uploadId: string): void {
  if (typeof window === "undefined") return;
  try {
    const next = readMyUploadIds(eventId).filter((id) => id !== uploadId);
    window.localStorage.setItem(uploadsKey(eventId), JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("my-uploads-change", { detail: { eventId } }));
  } catch {
    /* noop */
  }
}

export function isMyUpload(eventId: string, uploadId: string): boolean {
  return readMyUploadIds(eventId).includes(uploadId);
}

/**
 * Has this guest already seen the first-contribution celebration for this
 * event? Returns true exactly once per device per event.
 */
export function consumeFirstContributionCelebration(eventId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const key = firstContributionKey(eventId);
    if (window.localStorage.getItem(key)) return false;
    window.localStorage.setItem(key, new Date().toISOString());
    return true;
  } catch {
    return false;
  }
}
