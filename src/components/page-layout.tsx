import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * PageStack — the single vertical rhythm used by every authenticated page.
 *
 * All app pages (dashboard, gallery, guests, mosaic, settings) render their
 * top-level sections inside this stack so section spacing is identical
 * everywhere. Horizontal width/padding is owned by AppShell — never re-cap
 * the column inside a page.
 */
export function PageStack({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-10 md:gap-14", className)}>
      {children}
    </div>
  );
}

/** Centered loading / empty state that fills the page area consistently. */
export function PageState({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      {children}
    </div>
  );
}
