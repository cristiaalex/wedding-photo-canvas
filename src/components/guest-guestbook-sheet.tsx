import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { rememberMyMessage } from "@/lib/guest-messages";

const MAX_MESSAGE = 1000;

type Props = {
  open: boolean;
  onClose: () => void;
  eventId: string | null;
  guestName?: string | null;
  onSubmitted: () => void;
};

export function GuestGuestbookSheet({ open, onClose, eventId, guestName, onSubmitted }: Props) {
  const [name, setName] = useState(guestName ?? "");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setName(guestName ?? "");
  }, [open, guestName]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!eventId) return;
    const trimmed = message.trim();
    if (trimmed.length === 0) {
      setError("Please write a message.");
      return;
    }
    if (trimmed.length > MAX_MESSAGE) {
      setError(`Please keep it under ${MAX_MESSAGE} characters.`);
      return;
    }
    setSubmitting(true);
    setError(null);
    const { data: inserted, error: insErr } = await supabase
      .from("guestbook_messages")
      .insert({
        event_id: eventId,
        guest_name: name.trim() || null,
        message: trimmed,
      })
      .select("id")
      .maybeSingle();
    setSubmitting(false);
    if (insErr) {
      setError(insErr.message);
      return;
    }
    // Remember authorship so this guest keeps access to their own note even
    // when the couple hides other guests' messages.
    if (inserted?.id) rememberMyMessage(eventId, inserted.id);
    setName("");
    setMessage("");
    onSubmitted();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-foreground/45 backdrop-blur-sm"
        onClick={submitting ? undefined : onClose}
      />
      <div className="relative z-10 flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-t-[1.75rem] border border-border/60 bg-[color:var(--ivory)] shadow-[var(--shadow-soft)] sm:rounded-[1.75rem]">
        <div className="flex items-center justify-between border-b border-border/50 px-5 py-4">
          <h2 className="text-display text-2xl">Write a note</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-full p-2 text-foreground/70 hover:text-foreground disabled:opacity-40"
            aria-label="Close"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <form onSubmit={onSubmit} className="flex-1 overflow-y-auto px-5 py-6">
          <div>
            <label className="text-eyebrow text-muted-foreground">Your name (optional)</label>
            <input
              className="field mt-2"
              placeholder="So they know who it's from"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
            />
          </div>

          <div className="mt-6">
            <label className="text-eyebrow text-muted-foreground">Note *</label>
            <textarea
              className="field mt-2 min-h-[160px] resize-y"
              placeholder="Wishing you both a lifetime of joy…"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={MAX_MESSAGE}
              required
            />
            <p className="mt-1 text-right text-xs text-muted-foreground">
              {message.length}/{MAX_MESSAGE}
            </p>
          </div>

          {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
        </form>

        <div className="safe-bottom border-t border-border/50 bg-[color:var(--ivory)] px-5 py-4">
          <button
            type="submit"
            onClick={onSubmit}
            disabled={submitting || !eventId || message.trim().length === 0}
            className="btn-primary w-full disabled:opacity-60"
          >
            {submitting ? "Sending…" : "Leave your note"}
          </button>
        </div>
      </div>
    </div>
  );
}
