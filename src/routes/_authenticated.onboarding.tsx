import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase, COVERS_BUCKET } from "@/lib/supabase";
import {
  validateCoverFile,
  prepareCoverForUpload,
  describeUploadError,
} from "@/lib/cover-image";
import { generateAndStoreEventQr, guestUrlForSlug } from "@/lib/qr";
import type { EventInsert } from "@/lib/database.types";

import logoAsset from "@/assets/mosaic-logo.png.asset.json";
import { CoverPhotoEditor } from "@/components/cover-photo-editor";
import { CoverHero } from "@/components/cover-hero";
import {
  buildCoverUrl,
  DEFAULT_COVER_POSITION,
  type CoverPosition,
} from "@/lib/cover-position";

export const Route = createFileRoute("/_authenticated/onboarding")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Set up your wedding — Mosaic" },
      {
        name: "description",
        content:
          "A guided two-minute setup to create your wedding gallery and guest upload page.",
      },
    ],
  }),
  component: OnboardingPage,
});

// ----------------------------------------------------------------------------
// Helpers

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

async function isSlugAvailable(slug: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("events")
    .select("slug")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  return !data;
}

async function buildSuggestions(base: string, weddingYear: number | null): Promise<string[]> {
  const year = weddingYear ?? new Date().getFullYear();
  const candidates = [
    `${base}-${year}`,
    `${base}-wedding`,
    `${base}-mosaic`,
    `${base}-${Math.random().toString(36).slice(2, 6)}`,
  ];
  const out: string[] = [];
  for (const c of candidates) {
    if (out.length >= 3) break;
    try {
      if (await isSlugAvailable(c)) out.push(c);
    } catch {
      // ignore individual failures
    }
  }
  return out;
}

// ----------------------------------------------------------------------------
// Types

type WizardData = {
  firstName: string;
  secondName: string;
  weddingDate: string;
  venue: string;
  coverFile: File | null;
  coverPosition: CoverPosition;
  welcomeMessage: string;
  slug: string;
  slugTouched: boolean;
};

const DEFAULT_MESSAGE =
  "We're so happy you're here. Share your favorite moments and help us relive every smile, laugh and memory from our day.";

const STEPS = [
  { key: "details", label: "Your story" },
  { key: "cover", label: "First impression" },
  { key: "message", label: "A note to your guests" },
  { key: "slug", label: "Your wedding address" },
  { key: "success", label: "Ready" },
] as const;

// ----------------------------------------------------------------------------
// Page shell

function OnboardingPage() {
  const navigate = useNavigate();
  const [stepIndex, setStepIndex] = useState(0);
  const [data, setData] = useState<WizardData>({
    firstName: "",
    secondName: "",
    weddingDate: "",
    venue: "",
    coverFile: null,
    coverPosition: DEFAULT_COVER_POSITION,
    welcomeMessage: "",
    slug: "",
    slugTouched: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [createdEvent, setCreatedEvent] = useState<{ id: string; slug: string } | null>(null);
  const [checkingExisting, setCheckingExisting] = useState(true);

  // Stable object URL for the picked cover file so <img>/editor don't
  // re-create a fresh blob URL on every render.
  const [coverObjectUrl, setCoverObjectUrl] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  useEffect(() => {
    if (!data.coverFile) {
      setCoverObjectUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setEditorOpen(false);
      return;
    }
    const url = URL.createObjectURL(data.coverFile);
    setCoverObjectUrl(url);
    // Reset framing for a freshly-picked file and open the editor.
    setData((d) => ({ ...d, coverPosition: DEFAULT_COVER_POSITION }));
    setEditorOpen(true);
    return () => URL.revokeObjectURL(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.coverFile]);

  // Redirect away if the user already owns an event.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: userRes } = await supabase.auth.getUser();
      if (!userRes.user) return;
      const { data: existing } = await supabase
        .from("events")
        .select("id")
        .eq("organizer_id", userRes.user.id)
        .limit(1);
      if (cancelled) return;
      if (existing && existing.length > 0) {
        navigate({ to: "/dashboard", replace: true });
        return;
      }
      setCheckingExisting(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const total = STEPS.length;
  const SWIPEABLE = 4; // steps 0..3 are swipeable; 4 = success
  const [maxVisited, setMaxVisited] = useState(0);

  const canContinue = useMemo(() => {
    if (stepIndex === 0)
      return Boolean(data.firstName.trim() && data.secondName.trim() && data.weddingDate);
    if (stepIndex === 3) return Boolean(data.slug);
    return true;
  }, [stepIndex, data]);

  function update<K extends keyof WizardData>(key: K, value: WizardData[K]) {
    setData((d) => ({ ...d, [key]: value }));
  }

  function goNext() {
    setStepIndex((i) => {
      const next = Math.min(i + 1, total - 1);
      setMaxVisited((m) => Math.max(m, next));
      return next;
    });
  }

  // --- Swipe navigation ----------------------------------------------------
  const swipeRef = useRef<HTMLDivElement | null>(null);
  const slideRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [drag, setDrag] = useState(0);
  const [animating, setAnimating] = useState(true);
  const [carouselHeight, setCarouselHeight] = useState<number | null>(null);
  const gesture = useRef<{
    id: number;
    startX: number;
    startY: number;
    width: number;
    axis: null | "x" | "y";
  } | null>(null);

  useEffect(() => {
    if (stepIndex >= SWIPEABLE) return;
    const activeSlide = slideRefs.current[stepIndex];
    if (!activeSlide) return;

    const measure = () => {
      setCarouselHeight(Math.ceil(activeSlide.getBoundingClientRect().height));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(activeSlide);
    window.addEventListener("resize", measure);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [stepIndex]);

  function onSwipeDown(e: React.PointerEvent<HTMLDivElement>) {
    if (stepIndex >= SWIPEABLE) return;
    gesture.current = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      width: swipeRef.current?.clientWidth ?? window.innerWidth,
      axis: null,
    };
  }
  function onSwipeMove(e: React.PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (!g.axis) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      g.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? "x" : "y";
      if (g.axis === "x") setAnimating(false);
    }
    if (g.axis !== "x") return;
    let d = dx;
    if (dx > 0 && stepIndex === 0) d = dx * 0.25;
    if (dx < 0 && stepIndex >= maxVisited) d = dx * 0.25;
    setDrag(d);
  }
  function onSwipeUp(e: React.PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    const wasHorizontal = g.axis === "x";
    gesture.current = null;
    if (!wasHorizontal) return;
    const threshold = Math.min(90, g.width * 0.18);
    setAnimating(true);
    if (drag <= -threshold && stepIndex < maxVisited) {
      setStepIndex(stepIndex + 1);
    } else if (drag >= threshold && stepIndex > 0) {
      setStepIndex(stepIndex - 1);
    }
    setDrag(0);
  }

  async function createEvent() {
    setSubmitError(null);
    setSubmitting(true);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      if (!userRes.user) throw new Error("Not signed in.");
      const eventName = `${data.firstName.trim()} & ${data.secondName.trim()}`;

      let coverImageUrl: string | null = null;
      if (data.coverFile) {
        const check = validateCoverFile(data.coverFile);
        if (!check.ok) throw new Error(check.message);
        const { file, contentType, ext } = prepareCoverForUpload(data.coverFile);
        const path = `${data.slug}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from(COVERS_BUCKET)
          .upload(path, file, { contentType, upsert: true, cacheControl: "86400" });
        if (upErr) throw new Error(`Cover upload failed: ${describeUploadError(upErr)}`);
        const { data: pub } = supabase.storage.from(COVERS_BUCKET).getPublicUrl(path);
        coverImageUrl = buildCoverUrl(pub.publicUrl, data.coverPosition);
      }

      let finalSlug = data.slug;
      if (!(await isSlugAvailable(finalSlug))) {
        const year = data.weddingDate ? new Date(data.weddingDate).getFullYear() : null;
        const suggestions = await buildSuggestions(
          slugify(`${data.firstName}-${data.secondName}`) || finalSlug,
          year,
        );
        finalSlug = suggestions[0] ?? `${finalSlug}-${Math.random().toString(36).slice(2, 6)}`;
      }

      const insertPayload: EventInsert = {
        slug: finalSlug,
        event_name: eventName,
        wedding_date: data.weddingDate || null,
        cover_image_url: coverImageUrl,
        organizer_id: userRes.user.id,
        plan: "free",
        venue: data.venue.trim() || null,
        welcome_message: data.welcomeMessage.trim() || DEFAULT_MESSAGE,
      };

      const inserted = await supabase
        .from("events")
        .insert(insertPayload)
        .select("id, slug")
        .single();

      if (inserted.error || !inserted.data) {
        throw new Error(inserted.error?.message ?? "Could not create your wedding.");
      }

      await generateAndStoreEventQr(inserted.data.id, inserted.data.slug).catch(() => {});

      setCreatedEvent({ id: inserted.data.id, slug: inserted.data.slug });
      setStepIndex(4);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  if (checkingExisting) {
    return (
      <div className="min-h-svh bg-[color:var(--ivory)] flex items-center justify-center">
        <p className="text-eyebrow text-muted-foreground">Loading…</p>
      </div>
    );
  }

  // Step 5: full-bleed success — keep existing behaviour
  if (stepIndex === 4 && createdEvent) {
    return (
      <SuccessScreen
        slug={createdEvent.slug}
        coverSrc={coverObjectUrl}
        coverPosition={data.coverPosition}
      />
    );
  }

  const showCoverHero = stepIndex === 1 && data.coverFile;

  return (
    <div className="min-h-svh bg-[color:var(--ivory)] text-foreground flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between gap-4 px-6 py-4 md:px-12 md:py-6">
        <Link to="/" className="inline-flex items-center">
          <img
            src={logoAsset.url}
            alt="Mosaic Wedding"
            className="h-7 w-auto sm:h-8 md:h-8 lg:h-10"
          />
        </Link>
        <div className="flex items-center gap-1.5">
          {STEPS.slice(0, 4).map((s, i) => (
            <span
              key={s.key}
              className={
                "h-1.5 rounded-full transition-all duration-500 " +
                (i === stepIndex
                  ? "w-6 bg-[color:var(--gold)]"
                  : "w-1.5 bg-border/60")
              }
            />
          ))}
        </div>
      </header>

      {/* Cover hero on Step 2 when a photo is chosen */}
      {showCoverHero && coverObjectUrl && (
        <CoverHero
          src={coverObjectUrl}
          position={data.coverPosition}
          alt="Cover preview"
          eager
          fadeTo="var(--ivory)"
          className="w-full shrink-0 animate-in fade-in duration-700 h-[42vh]"
        >
          <button
            type="button"
            onClick={() => setEditorOpen(true)}
            className="absolute right-4 top-4 rounded-full border border-white/40 bg-black/35 px-4 py-2 text-[0.68rem] font-medium uppercase tracking-[0.22em] text-white backdrop-blur-md transition hover:bg-black/50"
          >
            Adjust framing
          </button>
        </CoverHero>
      )}


      {/* Main decision area — swipeable carousel */}
      <main
        ref={swipeRef}
        onPointerDown={onSwipeDown}
        onPointerMove={onSwipeMove}
        onPointerUp={onSwipeUp}
        onPointerCancel={onSwipeUp}
        className="overflow-hidden transition-[height] duration-300 ease-[cubic-bezier(0.22,0.61,0.36,1)]"
        style={{
          touchAction: "pan-y",
          height: carouselHeight ? `${carouselHeight}px` : undefined,
        }}
      >
        <div
          className="flex w-full items-start"
          style={{
            transform: `translate3d(calc(${-stepIndex * 100}% + ${drag}px), 0, 0)`,
            transition: animating
              ? "transform 380ms cubic-bezier(0.22, 0.61, 0.36, 1)"
              : "none",
            willChange: "transform",
          }}
        >
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              ref={(el) => {
                slideRefs.current[i] = el;
              }}
              className="w-full shrink-0 px-6 pt-4 pb-2 md:px-12 md:pt-6 md:pb-3"
              aria-hidden={i !== stepIndex}
              inert={i !== stepIndex ? true : undefined}
            >
              <div className="mx-auto w-full max-w-xl">
                {i === 0 && <StepDetails data={data} update={update} />}
                {i === 1 && <StepCover data={data} update={update} />}
                {i === 2 && <StepMessage data={data} update={update} />}
                {i === 3 && <StepSlug data={data} update={update} />}
                {i === stepIndex && submitError && (
                  <p className="mt-8 text-sm text-destructive" role="alert">
                    {submitError}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </main>


      {/* Footer actions */}
      <div className="px-6 pt-4 pb-8 md:px-12 md:pt-6 md:pb-10">
        <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-4">
          {stepIndex < 3 && (
            <button
              type="button"
              onClick={goNext}
              disabled={!canContinue}
              className="btn-ghost disabled:opacity-40"
            >
              Continue
            </button>
          )}
          {stepIndex === 3 && (
            <button
              type="button"
              onClick={createEvent}
              disabled={!canContinue || submitting}
              className="btn-ghost disabled:opacity-40"
            >
              {submitting ? "Creating…" : "Create my wedding"}
            </button>
          )}
          {(stepIndex === 1 || stepIndex === 2) && (
            <button
              type="button"
              onClick={goNext}
              className="text-eyebrow text-muted-foreground hover:text-foreground"
            >
              Skip
            </button>
          )}
        </div>
      </div>

      {editorOpen && coverObjectUrl && (
        <CoverPhotoEditor
          open
          imageSrc={coverObjectUrl}
          initialPosition={data.coverPosition}
          stepIndex={1}
          stepCount={4}
          eventName={
            data.firstName && data.secondName
              ? `${data.firstName.trim()} & ${data.secondName.trim()}`
              : data.firstName || data.secondName || null
          }
          weddingDateLabel={
            data.weddingDate
              ? new Date(data.weddingDate).toLocaleDateString(undefined, {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })
              : null
          }
          venue={data.venue || null}
          welcomeMessage={data.welcomeMessage || null}

          onCancel={() => setEditorOpen(false)}
          onSave={(position) => {
            update("coverPosition", position);
            setEditorOpen(false);
          }}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Shared field styles — borderless editorial inputs

const bigInput =
  "w-full bg-transparent border-0 border-b border-border/70 px-0 py-3 text-2xl md:text-3xl font-light tracking-tight text-foreground placeholder:text-muted-foreground/45 focus:outline-none focus:border-[color:var(--gold)] transition-colors";

const captionRow = "mt-2 text-xs text-muted-foreground";

// ----------------------------------------------------------------------------
// Step 1: Wedding details

function StepDetails({
  data,
  update,
}: {
  data: WizardData;
  update: <K extends keyof WizardData>(k: K, v: WizardData[K]) => void;
}) {
  return (
    <div>
      <h1 className="text-display text-5xl leading-[1.05] md:text-7xl">
        Tell us about <span className="text-script text-[color:var(--gold)]">you two</span>
      </h1>
      <p className="mt-6 max-w-md text-base leading-7 text-muted-foreground">
        Just the essentials, gathered gently.
        <br />
        Everything else can be shaped as your story unfolds.
      </p>

      <div className="mt-14 space-y-12">
        <div className="grid gap-12 sm:grid-cols-2">
          <div>
            <input
              className={bigInput}
              placeholder="Partner one"
              value={data.firstName}
              onChange={(e) => update("firstName", e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <input
              className={bigInput}
              placeholder="Partner two"
              value={data.secondName}
              onChange={(e) => update("secondName", e.target.value)}
            />
          </div>
        </div>

        <div className="relative">
          <input
            type="date"
            className={`${bigInput} ${!data.weddingDate ? "text-transparent [&::-webkit-datetime-edit]:opacity-0" : ""}`}
            value={data.weddingDate}
            onChange={(e) => update("weddingDate", e.target.value)}
          />
          {!data.weddingDate && (
            <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center text-2xl md:text-3xl font-light tracking-tight text-muted-foreground/45">
              dd/mm/yyyy
            </span>
          )}
          <p className={captionRow}>The day you say &quot;I do&quot;.</p>
        </div>

        <div>
          <input
            className={bigInput}
            placeholder="Where, if you know already"
            value={data.venue}
            onChange={(e) => update("venue", e.target.value)}
          />
          <p className={captionRow}>Venue — optional.</p>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Step 2: Cover photo

function StepCover({
  data,
  update,
}: {
  data: WizardData;
  update: <K extends keyof WizardData>(k: K, v: WizardData[K]) => void;
}) {
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function onPick(file: File | null) {
    setErr(null);
    if (!file) {
      update("coverFile", null);
      return;
    }
    const v = validateCoverFile(file);
    if (!v.ok) {
      setErr(v.message);
      return;
    }
    update("coverFile", file);
  }

  return (
    <div>
      <h1 className="text-display mt-4 text-5xl leading-[1.05] md:text-7xl">
        Set the <span className="text-script text-[color:var(--gold)]">scene</span>
      </h1>
      <p className="mt-6 max-w-md text-base leading-7 text-muted-foreground">
        The cover photo is the first thing your guests will see. Choose a photo that captures the feeling of your day.
      </p>

      {!data.coverFile ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="group mt-14 block w-full rounded-2xl border border-dashed border-border/70 bg-[color:var(--champagne)]/30 px-8 py-14 text-left transition hover:border-[color:var(--gold)] hover:bg-[color:var(--champagne)]/50"
        >
          <p className="text-eyebrow text-[color:var(--gold)]">Upload</p>
          <p className="text-display mt-3 text-2xl text-foreground">
            Choose a photo from your device
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            JPG · PNG · WEBP · HEIC · HEIF — up to any reasonable size
          </p>
        </button>
      ) : (
        <div className="mt-10 flex items-center gap-6">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="text-eyebrow text-muted-foreground hover:text-foreground"
          >
            Replace photo
          </button>
          <button
            type="button"
            onClick={() => update("coverFile", null)}
            className="text-eyebrow text-muted-foreground hover:text-foreground"
          >
            Remove photo
          </button>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        className="hidden"
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
      />

      {err && <p className="mt-4 text-sm text-destructive">{err}</p>}

      <p className="mt-10 text-xs text-muted-foreground">
        Don&apos;t have one yet? You can add a cover any time from your dashboard.
      </p>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Step 3: Guest message

function StepMessage({
  data,
  update,
}: {
  data: WizardData;
  update: <K extends keyof WizardData>(k: K, v: WizardData[K]) => void;
}) {
  const value = data.welcomeMessage;
  const remaining = 180 - value.length;
  return (
    <div>
      <h1 className="text-display text-5xl leading-[1.05] md:text-7xl">
        A <span className="text-script text-[color:var(--gold)]">note</span> from you
      </h1>
      <p className="mt-6 max-w-md text-base leading-7 text-muted-foreground">
        This message appears beneath your cover photo. Welcome your guests and invite them to share the memories they'll help create.
      </p>

      <div className="mt-14 border-b border-border/70 focus-within:border-[color:var(--gold)] transition-colors">
        <textarea
          className="w-full resize-none bg-transparent px-0 py-3 text-2xl md:text-3xl font-light leading-[1.4] tracking-tight text-foreground placeholder:text-muted-foreground/45 focus:outline-none"
          rows={4}
          maxLength={180}
          placeholder={DEFAULT_MESSAGE}
          value={value}
          onChange={(e) => update("welcomeMessage", e.target.value)}
        />
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        {remaining} characters left · leave blank to use our suggestion
      </p>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Step 4: Slug

function StepSlug({
  data,
  update,
}: {
  data: WizardData;
  update: <K extends keyof WizardData>(k: K, v: WizardData[K]) => void;
}) {
  const base = useMemo(
    () => slugify(`${data.firstName}-${data.secondName}`) || "your-wedding",
    [data.firstName, data.secondName],
  );
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  // Auto-sync slug from couple's names while the user hasn't manually edited it.
  useEffect(() => {
    if (data.slugTouched) return;
    if (data.slug !== base) update("slug", base);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, data.slugTouched]);

  // Re-check availability whenever the effective slug changes.
  const effective = data.slug || base;
  useEffect(() => {
    let cancelled = false;
    setChecking(true);
    (async () => {
      try {
        const ok = await isSlugAvailable(effective);
        if (cancelled) return;
        setAvailable(ok);
        if (!ok) {
          const year = data.weddingDate ? new Date(data.weddingDate).getFullYear() : null;
          const sugg = await buildSuggestions(base, year);
          if (!cancelled) setSuggestions(sugg);
        } else {
          setSuggestions([]);
        }
      } catch {
        if (!cancelled) setAvailable(null);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effective, data.weddingDate]);

  const selected = effective;

  function pickSuggestion(s: string) {
    update("slug", s);
    update("slugTouched", true);
  }

  function onSlugInput(raw: string) {
    const cleaned = slugify(raw);
    update("slug", cleaned);
    update("slugTouched", true);
  }

  return (
    <div>
      <h1 className="text-display text-5xl leading-[1.05] md:text-7xl">
        Where guests will <span className="text-script text-[color:var(--gold)]">find you</span>
      </h1>
      <p className="mt-6 max-w-md text-base leading-7 text-muted-foreground">
        Your wedding link is how guests will join your private gallery. Choose something simple, memorable and uniquely yours.
      </p>

      <div className="mt-10">
        <p className="text-eyebrow text-muted-foreground">Your URL</p>
        <div className="mt-3 flex flex-wrap items-baseline gap-x-1 border-b border-[color:var(--gold)]/60 pb-3">
          <span className="text-2xl md:text-3xl font-light text-muted-foreground">
            mosaic.wedding/e/
          </span>
          <input
            type="text"
            value={selected}
            onChange={(e) => onSlugInput(e.target.value)}
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            className="flex-1 min-w-[6ch] bg-transparent text-2xl md:text-3xl font-light text-foreground focus:outline-none"
          />
        </div>

        {checking ? (
          <p className="mt-4 text-sm text-muted-foreground">Checking availability…</p>
        ) : available ? (
          <p className="mt-4 text-sm text-foreground">
            <span className="text-[color:var(--gold)]">✓</span>{" "}
            <span className="text-muted-foreground">Available — this will be yours.</span>
          </p>
        ) : (
          <div className="mt-6">
            <p className="text-sm text-muted-foreground">
              &quot;{selected}&quot; is already taken. Choose one of these:
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {suggestions.map((s) => {
                const active = s === selected;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => pickSuggestion(s)}
                    className={
                      "rounded-full border px-4 py-2 text-sm transition " +
                      (active
                        ? "border-[color:var(--gold)] bg-[color:var(--gold)]/15 text-foreground"
                        : "border-border/60 bg-[color:var(--ivory)]/40 text-muted-foreground hover:text-foreground")
                    }
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <p className="mt-10 flex items-center gap-2 text-xs text-muted-foreground">
        <span aria-hidden>🔒</span>
        Permanent — locked once your wedding is created so QR codes and guest links stay valid forever.
      </p>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Step 5: Success — full-bleed editorial celebration

function SuccessScreen({
  slug,
  coverSrc,
  coverPosition,
}: {
  slug: string;
  coverSrc: string | null;
  coverPosition: CoverPosition;
}) {
  const guestUrl = guestUrlForSlug(slug);
  const displayUrl = guestUrl.replace(/^https?:\/\//, "");
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(guestUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* noop */
    }
  };

  return (
    <div className="relative min-h-svh overflow-hidden bg-[color:var(--ivory)] text-foreground">
      {/* Couple's own cover photo — light and airy, dissolves into ivory */}
      <div className="absolute inset-x-0 top-0 h-[62svh] md:h-[68svh]">
        <CoverHero
          src={coverSrc}
          position={coverPosition}
          alt=""
          eager
          fadeTo="var(--ivory)"
          fadeCoverage={1}
          className="h-full w-full animate-in fade-in duration-[1400ms]"
        />
      </div>

      <div className="relative z-10 mx-auto flex min-h-svh w-full max-w-2xl flex-col items-center justify-end px-6 pb-14 pt-[env(safe-area-inset-top)] text-center md:pb-20">
        <div className="w-full animate-in fade-in slide-in-from-bottom-6 duration-1000">
          <h1 className="text-display text-4xl leading-[1.05] text-foreground md:text-6xl">
            Your wedding is
            <br />
            <span className="text-script text-[color:var(--gold)]">ready.</span>
          </h1>

          <p className="mx-auto mt-6 max-w-md text-sm leading-relaxed text-foreground/70 md:text-base">
            Your private Guest Page is ready to share.
            <br />
            Now it's time to start collecting the memories of your day.
          </p>

          {/* Wedding link — presented like an engraved invitation line */}
          <div className="mx-auto mt-10 max-w-md">
            <p className="text-[0.6rem] font-medium uppercase tracking-[0.3em] text-foreground/55">
              Your wedding link
            </p>
            <button
              type="button"
              onClick={handleCopy}
              className="group mt-3 flex w-full items-center justify-center gap-3 border-b border-foreground/20 pb-3 text-center transition hover:border-[color:var(--gold)]"
              aria-label="Copy wedding link"
            >
              <span className="text-display truncate text-lg text-foreground md:text-xl">
                {displayUrl}
              </span>
              <span className="shrink-0 text-[0.6rem] font-medium uppercase tracking-[0.25em] text-foreground/55 transition group-hover:text-[color:var(--gold)]">
                {copied ? "Copied" : "Copy"}
              </span>
            </button>
          </div>

          <div className="mt-12 flex flex-col items-center gap-6">
            <a
              href="/dashboard"
              className="inline-flex min-w-[220px] items-center justify-center rounded-full border border-foreground bg-foreground px-10 py-3.5 text-[0.7rem] font-medium uppercase tracking-[0.28em] text-[color:var(--ivory)] transition hover:bg-transparent hover:text-foreground"
            >
              Go to Dashboard
            </a>
            <a
              href={`/e/${slug}`}
              target="_blank"
              rel="noreferrer"
              className="text-[0.65rem] font-medium uppercase tracking-[0.28em] text-foreground/65 underline-offset-[6px] transition hover:text-foreground hover:underline"
            >
              Open Guest Page
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
