import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { rememberMyMessage } from "@/lib/guest-messages";

export const Route = createFileRoute("/e/$slug/guestbook")({
  head: ({ params }) => ({
    meta: [
      { title: `Guestbook — ${params.slug} on Mosaic` },
      {
        name: "description",
        content: "Leave a private note for the couple in their guestbook.",
      },
      { property: "og:title", content: "Sign the couple's guestbook" },
      {
        property: "og:description",
        content: "Share a kind word — only the couple will read it.",
      },
    ],
  }),
  component: GuestbookPage,
});

const MAX_MESSAGE = 1000;

function GuestbookPage() {
  const { slug } = Route.useParams();
  const [eventId, setEventId] = useState<string | null>(null);
  const [eventName, setEventName] = useState<string | null>(null);
  const [guestbookEnabled, setGuestbookEnabled] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("events")
        .select("id, event_name, guestbook_enabled")
        .eq("slug", slug)
        .maybeSingle();
      if (cancelled) return;
      if (error) setLoadError(error.message);
      else if (!data) setNotFound(true);
      else {
        setEventId(data.id);
        setEventName(data.event_name);
        setGuestbookEnabled((data as { guestbook_enabled?: boolean | null }).guestbook_enabled !== false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!eventId) return;
    if (!guestbookEnabled) {
      setSubmitError("The couple has closed new guestbook messages for now.");
      return;
    }
    const trimmed = message.trim();
    if (trimmed.length === 0) {
      setSubmitError("Please write a message.");
      return;
    }
    if (trimmed.length > MAX_MESSAGE) {
      setSubmitError(`Please keep it under ${MAX_MESSAGE} characters.`);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    const { data: inserted, error } = await supabase
      .from("guestbook_messages")
      .insert({
        event_id: eventId,
        guest_name: name.trim() || null,
        message: trimmed,
      })
      .select("id")
      .maybeSingle();
    setSubmitting(false);
    if (error) {
      setSubmitError(error.message);
      return;
    }
    if (inserted?.id) rememberMyMessage(eventId, inserted.id);
    setDone(true);
    setMessage("");
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,var(--ivory),oklch(0.965_0.018_72))]">
      <header className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-5 sm:px-6 sm:py-8">
        <Link to="/" className="text-display text-xl sm:text-2xl">
          Mosaic
        </Link>
        <nav className="flex items-center gap-2">
          <Link
            to="/e/$slug"
            params={{ slug }}
            className="text-eyebrow rounded-full border border-border/60 bg-[color:var(--ivory)]/60 px-3 py-2 text-foreground/80 hover:border-primary hover:text-primary"
          >
            ← Share photos
          </Link>
          <Link
            to="/e/$slug/timeline"
            params={{ slug }}
            className="text-eyebrow rounded-full bg-[color:var(--champagne)]/45 px-3 py-2 text-primary hover:bg-[color:var(--champagne)]/70"
          >
            Live timeline →
          </Link>
        </nav>
      </header>

      <main className="mx-auto max-w-2xl px-4 pb-28 pt-3 text-center sm:px-6 sm:pt-8">
        <p className="text-eyebrow text-primary">
          {eventName ? `For ${eventName}` : "Guestbook"}
        </p>
        <div className="mx-auto mt-6 gold-rule" />
        <h1 className="text-display mt-6 text-4xl sm:mt-8 sm:text-5xl md:text-7xl">
          Sign the{" "}
          <span className="text-script text-[color:var(--dusty)]">guestbook</span>
        </h1>
        <p className="mt-5 text-sm text-muted-foreground max-w-md mx-auto sm:mt-6 sm:text-base">
          Share a note for the couple — only they will read it.
        </p>

        {notFound ? (
          <p className="mt-16 text-eyebrow text-muted-foreground">
            This event link isn't active.
          </p>
        ) : !guestbookEnabled ? (
          <div className="mt-12 rounded-[1.75rem] border border-border/60 bg-[color:var(--ivory)]/78 p-8 shadow-[var(--shadow-soft)] text-center">
            <p className="text-eyebrow text-primary">Guestbook closed</p>
            <h2 className="text-display mt-3 text-3xl">Thanks for stopping by</h2>
            <p className="mt-4 text-sm text-muted-foreground">
              The couple has closed new guestbook messages for now.
            </p>
          </div>
        ) : done ? (
          <div className="mt-12 rounded-[1.75rem] border border-border/60 bg-[color:var(--ivory)]/78 p-8 shadow-[var(--shadow-soft)]">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-primary/35 bg-[color:var(--dusty)]/12">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="text-primary"
              >
                <path
                  d="M5 13l4 4L19 7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <p className="text-eyebrow mt-6 text-primary">Thank you</p>
            <h2 className="text-display mt-3 text-3xl">Your note is on its way</h2>
            <p className="mt-3 text-sm text-muted-foreground">
              The couple will see it in their private dashboard.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
              <button
                type="button"
                onClick={() => setDone(false)}
                className="btn-primary"
              >
                Leave another note
              </button>
              <Link
                to="/e/$slug"
                params={{ slug }}
                className="rounded-2xl border border-border/60 bg-[color:var(--ivory)]/70 px-4 py-3 text-eyebrow text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              >
                Share photos
              </Link>
            </div>
          </div>
        ) : (
          <form className="mt-10 sm:mt-16 text-left" onSubmit={onSubmit}>
            <div className="rounded-[1.75rem] border border-border/60 bg-[color:var(--ivory)]/78 p-6 shadow-[var(--shadow-soft)] sm:p-8">
              <label className="text-eyebrow text-muted-foreground">
                Your message
              </label>
              <textarea
                className="field mt-2 min-h-[180px] resize-y"
                placeholder="Wishing you both a lifetime of joy…"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={MAX_MESSAGE}
                required
              />
              <p className="mt-2 text-right text-xs text-muted-foreground">
                {message.length}/{MAX_MESSAGE}
              </p>

              <div className="mt-6">
                <label className="text-eyebrow text-muted-foreground">
                  Your name (optional)
                </label>
                <input
                  className="field mt-2"
                  placeholder="So the couple know who it's from"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={80}
                />
              </div>
            </div>

            {loadError && (
              <p className="mt-6 text-sm text-destructive">{loadError}</p>
            )}
            {submitError && (
              <p className="mt-6 text-sm text-destructive">{submitError}</p>
            )}

            <div className="sticky bottom-4 mt-8 flex flex-col gap-3 sm:static sm:mt-10">
              <button
                type="submit"
                disabled={submitting || !eventId || message.trim().length === 0}
                className="btn-primary w-full disabled:opacity-60"
              >
                {submitting ? "Sending…" : "Send to the couple"}
              </button>
            </div>

            <p className="mt-10 text-center text-xs text-muted-foreground">
              Your note is private — only the couple will see it.
            </p>
          </form>
        )}
      </main>
    </div>
  );
}
