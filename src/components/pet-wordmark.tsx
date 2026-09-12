import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export function PetWordmark({ className }: { className?: string }) {
  return (
    <Link to="/" className={cn("group inline-flex items-center gap-2.5", className)} aria-label="Mosaic Pet home">
      <span className="relative grid h-9 w-9 place-items-center rounded-[1rem] bg-sky text-primary-foreground shadow-[0_3px_0_color-mix(in_oklab,var(--sky)_55%,var(--navy))] transition-transform group-hover:-rotate-6">
        <svg viewBox="0 0 32 32" className="h-6 w-6" aria-hidden="true" fill="currentColor">
          <circle cx="8" cy="10" r="3"/><circle cx="15" cy="7" r="3"/><circle cx="23" cy="10" r="3"/><circle cx="26" cy="17" r="3"/><path d="M16 13c-5.3 0-9 4-9 8.1 0 3.6 3.2 5.2 6 3.8 1.9-1 4.1-1 6 0 2.8 1.4 6-.2 6-3.8C25 17 21.3 13 16 13Z"/>
        </svg>
      </span>
      <span className="text-display text-[1.35rem] font-extrabold text-navy md:text-[1.55rem]">Mosaic<span className="text-coral">Pet</span></span>
    </Link>
  );
}