import { useEffect, useLayoutEffect, useRef, useState } from "react";

type Props = {
  open: boolean;
  eventName: string | null;
  initialName?: string | null;
  onSubmit: (name: string | null) => void;
};

export function GuestWelcomeDialog({ open, eventName: _eventName, initialName, onSubmit }: Props) {
  const [name, setName] = useState(initialName ?? "");
  const [viewport, setViewport] = useState<{ height: number; offsetTop: number } | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setName(initialName ?? "");
  }, [open, initialName]);

  // Lock background scroll using the fixed-body technique (works reliably on iOS Safari,
  // prevents overscroll, drag, and rubber-banding while modal is open).
  useLayoutEffect(() => {
    if (!open) return;
    const scrollY = window.scrollY;
    const body = document.body;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
    };
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    body.style.overflow = "hidden";
    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.left = prev.left;
      body.style.right = prev.right;
      body.style.width = prev.width;
      body.style.overflow = prev.overflow;
      window.scrollTo(0, scrollY);
    };
  }, [open]);

  // Track the visual viewport so the dialog stays centered above the iOS keyboard.
  useEffect(() => {
    if (!open) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setViewport({ height: vv.height, offsetTop: vv.offsetTop });
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      setViewport(null);
    };
  }, [open]);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    onSubmit(trimmed.length ? trimmed : null);
  };

  // Dialog card is positioned within the visual viewport so it stays centered
  // above the iOS keyboard. The backdrop stays full-screen so nothing behind it
  // can ever be seen or tapped, even during the keyboard show/hide animation.
  const dialogWrapperStyle: React.CSSProperties = viewport
    ? {
        position: "fixed",
        top: viewport.offsetTop,
        left: 0,
        width: "100%",
        height: viewport.height,
      }
    : {};

  return (
    <>
      {/* Full-screen backdrop — covers layout viewport entirely, blocks all taps. */}
      <div
        className="fixed inset-0 z-[60] bg-foreground/55 backdrop-blur-md"
        aria-hidden
        onClick={(e) => e.preventDefault()}
        onTouchMove={(e) => e.preventDefault()}
        style={{ height: "100dvh" }}
      />
      {/* Dialog wrapper — tracks the visual viewport so it stays above the keyboard. */}
      <div
        className="fixed inset-0 z-[61] flex items-center justify-center px-4 py-6 overflow-hidden"
        style={dialogWrapperStyle}
        onTouchMove={(e) => {
          if (!dialogRef.current?.contains(e.target as Node)) e.preventDefault();
        }}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="guest-welcome-title"
          className="relative z-10 w-full max-w-lg overflow-y-auto overscroll-contain rounded-[1.75rem] border border-border/60 bg-[color:var(--ivory)] shadow-[var(--shadow-soft)]"
          style={{
            maxHeight: viewport ? `${viewport.height - 32}px` : "calc(100dvh - 3rem)",
            paddingBottom: "env(safe-area-inset-bottom)",
          }}
        >
        <form onSubmit={handleSubmit} className="px-7 py-10 sm:px-10 sm:py-12">
          <h2 id="guest-welcome-title" className="text-display text-3xl sm:text-4xl">
            Welcome
          </h2>

          <p className="mt-6 text-base leading-relaxed text-foreground/85">
            We’d love to know who’s sharing these memories.
          </p>

          <div className="mt-10">
            <input
              id="guest-welcome-name"
              autoFocus
              className="field"
              placeholder="Enter your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
            />
          </div>

          <div className="mt-10 flex flex-col gap-4">
            <button
              type="submit"
              className="inline-flex w-full items-center justify-center rounded-full border border-primary/30 bg-transparent px-6 py-3.5 font-sans text-sm font-medium uppercase tracking-[0.2em] text-primary transition-colors hover:bg-primary/[0.04] active:bg-primary/[0.08]"
            >
              Continue
            </button>
            <button
              type="button"
              onClick={() => onSubmit(null)}
              className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Continue anonymously
            </button>
          </div>
        </form>
        </div>
      </div>
    </>
  );
}

