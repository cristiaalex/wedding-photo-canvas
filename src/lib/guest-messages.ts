// Local-first tracking of "which guestbook notes did THIS guest write?"
//
// guestbook_messages has no per-device identity column, so — mirroring the
// guest-uploads pattern — every note submitted from this device is recorded
// in localStorage keyed by event. When the couple turns OFF "Show guestbook
// publicly", guests still see their own notes via this list.

const PREFIX = "my_guestbook_";

function key(eventId: string) {
  return `${PREFIX}${eventId}`;
}

export function readMyMessageIds(eventId: string | null): string[] {
  if (typeof window === "undefined" || !eventId) return [];
  try {
    const raw = window.localStorage.getItem(key(eventId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function rememberMyMessage(eventId: string | null, messageId: string): void {
  if (typeof window === "undefined" || !eventId || !messageId) return;
  try {
    const next = new Set(readMyMessageIds(eventId));
    next.add(messageId);
    window.localStorage.setItem(key(eventId), JSON.stringify(Array.from(next)));
    window.dispatchEvent(new CustomEvent("my-guestbook-change", { detail: { eventId } }));
  } catch {
    /* storage blocked — ownership stays in-memory for this session only */
  }
}
