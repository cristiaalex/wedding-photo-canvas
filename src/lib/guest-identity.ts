import { useCallback, useEffect, useState } from "react";

export type GuestIdentity = {
  guest_uuid: string;
  guest_name: string | null;
  event_id: string;
  created_at: string;
};

const PREFIX = "guest_identity_";

export const ANON_GUEST_PREFIX = "__anon__:";
export const ANON_GUEST_LABEL = "Anonymous guest";

/**
 * Name to persist in the DB for an upload/message. Anonymous guests get a
 * stable marker derived from their local guest_uuid so counts can still
 * distinguish one anonymous guest from another.
 */
export function toStoredGuestName(identity: GuestIdentity | null): string | null {
  if (!identity) return null;
  const trimmed = identity.guest_name?.trim();
  if (trimmed) return trimmed;
  return `${ANON_GUEST_PREFIX}${identity.guest_uuid}`;
}

/** Human-friendly display of a stored guest_name (handles anonymous markers). */
export function displayGuestName(name: string | null | undefined): string | null {
  if (!name) return null;
  if (name.startsWith(ANON_GUEST_PREFIX)) return ANON_GUEST_LABEL;
  return name;
}

function keyFor(eventId: string) {
  return `${PREFIX}${eventId}`;
}

function safeUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function readGuestIdentity(eventId: string): GuestIdentity | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(keyFor(eventId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GuestIdentity;
    if (!parsed?.guest_uuid || parsed.event_id !== eventId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeGuestIdentity(eventId: string, guestName: string | null): GuestIdentity {
  const existing = readGuestIdentity(eventId);
  const next: GuestIdentity = {
    guest_uuid: existing?.guest_uuid ?? safeUuid(),
    guest_name: guestName?.trim() ? guestName.trim() : null,
    event_id: eventId,
    created_at: existing?.created_at ?? new Date().toISOString(),
  };
  try {
    window.localStorage.setItem(keyFor(eventId), JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("guest-identity-change", { detail: { eventId } }));
  } catch {
    /* storage blocked — identity stays in-memory */
  }
  return next;
}

export function useGuestIdentity(eventId: string | null) {
  const [identity, setIdentity] = useState<GuestIdentity | null>(() =>
    eventId ? readGuestIdentity(eventId) : null,
  );

  useEffect(() => {
    if (!eventId) {
      setIdentity(null);
      return;
    }
    setIdentity(readGuestIdentity(eventId));

    const currentId = eventId;
    function onChange(e: Event) {
      const detail = (e as CustomEvent<{ eventId: string }>).detail;
      if (!detail || detail.eventId === currentId) {
        setIdentity(readGuestIdentity(currentId));
      }
    }
    function onStorage(e: StorageEvent) {
      if (e.key === keyFor(currentId)) setIdentity(readGuestIdentity(currentId));
    }
    window.addEventListener("guest-identity-change", onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("guest-identity-change", onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, [eventId]);

  const save = useCallback(
    (name: string | null) => {
      if (!eventId) return null;
      const next = writeGuestIdentity(eventId, name);
      setIdentity(next);
      return next;
    },
    [eventId],
  );

  return { identity, save };
}
