import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export function PetWordmark({ className }: { className?: string }) {
  return (
    <Link to="/" className={cn("inline-flex items-baseline gap-2", className)} aria-label="Mosaic Pet home">
      <span className="text-display text-2xl text-foreground md:text-3xl">Mosaic</span>
      <span className="text-eyebrow text-gold">Pet</span>
    </Link>
  );
}