import { PetWordmark } from "@/components/pet-wordmark";

export function SiteFooter() {
  return (
    <footer className="border-t border-border/60 bg-[color:var(--champagne)]/40">
      <div className="mx-auto max-w-7xl px-6 py-16 md:px-12">
        <div className="flex flex-col items-center gap-4 text-center">
          <PetWordmark />
          <p className="text-script text-lg text-muted-foreground">
            every little moment, all in one picture
          </p>
          <div className="mt-6 hairline" />
          <div className="mt-6 flex flex-wrap items-center justify-center gap-6 text-eyebrow">
            <a href="#" className="hover:text-foreground transition-colors">Privacy</a>
            <a href="#" className="hover:text-foreground transition-colors">Terms</a>
            <a href="mailto:hello@mosaic.pet" className="hover:text-foreground transition-colors">
              Contact
            </a>
          </div>
          <p className="mt-8 text-xs text-muted-foreground/70">
            © {new Date().getFullYear()} Mosaic Pet. Made for the ones we love.
          </p>
        </div>
      </div>
    </footer>
  );
}
