import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  LayoutGrid,
  Images,
  Sparkles,
  Settings,
  LogOut,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { PetWordmark } from "@/components/pet-wordmark";

/**
 * AppShell — permanent application shell for every authenticated page.
 *
 * Layout
 *   Desktop : top bar  +  left rail  +  centered content
 *   Tablet  : top bar  +  collapsible left rail  +  content
 *   Mobile  : top bar  +  content  +  bottom tab bar
 *
 * Sprint 2 establishes the architecture only. Page content is provided by
 * children; no widgets, cards, or page-specific logic live here.
 */

type NavItem = {
  label: string;
  to: string;
  icon: typeof LayoutGrid;
};

const NAV: NavItem[] = [
  { label: "Studio", to: "/dashboard", icon: LayoutGrid },
  { label: "Photos", to: "/gallery", icon: Images },
  { label: "Preview", to: "/mosaic", icon: Sparkles },
  { label: "Settings", to: "/settings", icon: Settings },
];

export type AppShellProps = {
  children: ReactNode;
  /** Optional project name retained for backwards-compatible callers. */
  weddingName?: string | null;
};

export function AppShell({ children, weddingName }: AppShellProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="min-h-screen bg-[color:var(--ivory)] text-foreground">
      <TopBar weddingName={weddingName} />

      <div className="mx-auto flex w-full max-w-[1440px]">
        <LeftRail pathname={pathname} />

        <main className="min-w-0 flex-1 overflow-x-hidden pb-28 pt-16 md:pb-16 md:pt-20 md:pl-8">
          {/* Single content column for the whole app — pages must not re-cap width. */}
          <div className="mx-auto w-full max-w-5xl px-5 md:px-8 lg:px-10">
            {children}
          </div>
        </main>
      </div>

      <BottomTabs pathname={pathname} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Top bar                                                              */
/* ------------------------------------------------------------------ */

function TopBar({ weddingName: _weddingName }: { weddingName?: string | null }) {
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/", replace: true });
  }
  return (
    <header
      className={`fixed inset-x-0 top-0 z-30 transition-all duration-300 ${
        scrolled
          ? "border-b border-border/60 bg-[color:var(--ivory)]/85 backdrop-blur-md"
          : "border-b border-transparent bg-[color:var(--ivory)]"
      }`}
    >
      <div className="mx-auto grid h-14 max-w-[1440px] grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 md:h-16 md:px-8">
        <div />
        <PetWordmark className="justify-self-center" />
        <button
          type="button"
          onClick={signOut}
          aria-label="Sign out"
          className="justify-self-end grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-[color:var(--champagne)]/40 hover:text-foreground"
        >
          <LogOut className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </div>
    </header>
  );
}


/* ------------------------------------------------------------------ */
/* Left rail (desktop / tablet)                                         */
/* ------------------------------------------------------------------ */

function LeftRail({ pathname }: { pathname: string }) {
  return (
    <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-60 shrink-0 flex-col gap-1 px-4 pt-6 md:flex md:top-16 md:h-[calc(100vh-4rem)] lg:w-64 lg:px-6">
      <nav className="flex flex-col gap-1">
        {NAV.map((item) => {
          const active = isActive(pathname, item.to);
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "group flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm transition-colors",
                active
                  ? "bg-[color:var(--champagne)]/55 text-foreground"
                  : "text-muted-foreground hover:bg-[color:var(--champagne)]/30 hover:text-foreground",
              )}
            >
              <Icon
                className={cn(
                  "h-[18px] w-[18px] transition-colors",
                  active ? "text-foreground" : "text-muted-foreground group-hover:text-foreground",
                )}
                strokeWidth={1.5}
              />
              <span className="tracking-tight">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* Bottom tabs (mobile)                                                 */
/* ------------------------------------------------------------------ */

function BottomTabs({ pathname }: { pathname: string }) {
  // Hide the bottom nav while the on-screen keyboard is open so it never
  // gets duplicated above the keyboard or leaves an empty gap on dismissal.
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const isEditable = (el: Element | null): boolean => {
      if (!el) return false;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if ((el as HTMLElement).isContentEditable) return true;
      return false;
    };
    const onFocusIn = (e: FocusEvent) => {
      if (isEditable(e.target as Element)) setKeyboardOpen(true);
    };
    const onFocusOut = () => {
      // Defer so React commits the next focused element before we read it.
      window.setTimeout(() => {
        if (!isEditable(document.activeElement)) setKeyboardOpen(false);
      }, 0);
    };
    window.addEventListener("focusin", onFocusIn);
    window.addEventListener("focusout", onFocusOut);
    return () => {
      window.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  return (
    <nav
      aria-hidden={keyboardOpen}
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 border-t border-border/60 bg-[color:var(--ivory)]/95 backdrop-blur-md transition-transform duration-150 md:hidden",
        keyboardOpen && "pointer-events-none translate-y-full",
      )}
    >
      <ul className="safe-bottom mx-auto flex max-w-md items-stretch justify-between px-2 pt-2">
        {NAV.map((item) => {
          const active = isActive(pathname, item.to);
          const Icon = item.icon;
          return (
            <li key={item.to} className="flex-1">
              <Link
                to={item.to}
                tabIndex={keyboardOpen ? -1 : 0}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-[0.62rem] tracking-[0.18em] uppercase transition-colors",
                  active
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon
                  className={cn(
                    "h-5 w-5",
                    active ? "text-foreground" : "text-muted-foreground",
                  )}
                  strokeWidth={1.5}
                />
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/* ------------------------------------------------------------------ */

function isActive(pathname: string, to: string) {
  if (to === "/dashboard") return pathname === "/dashboard" || pathname === "/";
  return pathname === to || pathname.startsWith(`${to}/`);
}
