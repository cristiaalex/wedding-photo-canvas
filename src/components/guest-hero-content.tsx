import { Calendar, Heart, MapPin } from "lucide-react";

// ---------------------------------------------------------------------------
// GuestHeroContent
// The info block that overlays the cover photo on the Guest Page hero.
// This is the single source of truth for the hero's typography, spacing,
// divider, date/venue layout, and welcome message. It is used both on the
// live Guest Page and inside the Cover Photo Editor preview so what the
// couple frames is exactly what guests see.
// ---------------------------------------------------------------------------

export type GuestHeroContentProps = {
  eventName: string | null;
  weddingDateLabel?: string | null;
  venue?: string | null;
  welcomeMessage?: string | null;
};

export function GuestHeroContent({
  eventName,
  weddingDateLabel,
  venue,
  welcomeMessage,
}: GuestHeroContentProps) {
  const rawName = eventName ?? "You're invited";
  const nameMatch = rawName.match(/^\s*(.+?)\s+(&|and)\s+(.+?)\s*$/i);
  const partner1 = nameMatch?.[1] ?? null;
  const partner2 = nameMatch?.[3] ?? null;
  const dateLabel = weddingDateLabel ?? null;

  return (
    <div className="absolute inset-x-0 bottom-0 flex justify-center px-[6%] pb-[4%] pt-[env(safe-area-inset-top)]">
      <div className="w-[92%] max-w-3xl text-foreground">
        <p className="text-center text-[0.55rem] font-medium tracking-[0.28em] uppercase text-foreground/70 sm:text-[0.6rem] md:text-xs">
          The wedding of
        </p>

        <h1 className="text-display mt-1 grid w-full grid-cols-[1fr_auto_1fr] items-center gap-x-2 text-2xl font-medium leading-tight text-foreground sm:text-3xl md:mt-2 md:gap-x-4 md:text-5xl lg:text-6xl">
          {partner1 && partner2 ? (
            <>
              <span className="flex items-center justify-end text-right">{partner1}</span>
              <span className="flex items-center justify-center px-1 text-foreground/80">&amp;</span>
              <span className="flex items-center justify-start text-left">{partner2}</span>
            </>
          ) : (
            <>
              <span aria-hidden />
              <span className="flex items-center justify-center whitespace-nowrap">{rawName}</span>
              <span aria-hidden />
            </>
          )}
        </h1>

        <div className="mt-3 grid w-full grid-cols-[1fr_auto_1fr] items-center gap-x-3 md:mt-4 md:gap-x-4">
          <span className="h-px w-full bg-foreground/25" aria-hidden />
          <span className="relative flex h-3 w-3 items-center justify-center md:h-3.5 md:w-3.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[color:var(--dusty)] opacity-75" />
            <Heart className="relative h-3 w-3 text-destructive md:h-3.5 md:w-3.5" strokeWidth={1.5} fill="currentColor" />
          </span>
          <span className="h-px w-full bg-foreground/25" aria-hidden />
        </div>

        {(dateLabel || venue) && (
          <div className="mt-3 grid w-full grid-cols-[1fr_auto_1fr] items-center gap-x-3 text-xs font-medium text-foreground/85 md:mt-4 md:gap-x-4 md:text-sm lg:text-base">
            <span className="flex items-center justify-end gap-1.5">
              {dateLabel && (
                <>
                  <Calendar className="h-3 w-3 md:h-4 md:w-4" strokeWidth={1.6} />
                  <span>{dateLabel}</span>
                </>
              )}
            </span>
            <span aria-hidden className="select-none opacity-0">|</span>
            <span className="flex items-center justify-start gap-1.5">
              {venue && (
                <>
                  <MapPin className="h-3 w-3 md:h-4 md:w-4" strokeWidth={1.6} />
                  <span>{venue}</span>
                </>
              )}
            </span>
          </div>
        )}

        <p
          className="mx-auto mt-3 max-w-xl text-balance text-center text-sm leading-relaxed text-foreground/80 md:mt-4 md:text-base"
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {welcomeMessage?.trim() ||
            "We can't wait to celebrate with you. Share the moments you capture so we can relive the day through your eyes."}
        </p>
      </div>
    </div>
  );
}
