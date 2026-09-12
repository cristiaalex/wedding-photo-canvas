import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { PetWordmark } from "@/components/pet-wordmark";

export function SiteHeader() {
  const navigate = useNavigate();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(({ data }) => {
      if (mounted) setAuthed(!!data.user);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        setAuthed(!!session?.user);
      }
    });
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  async function handleSignOut() {
    setMenuOpen(false);
    await supabase.auth.signOut();
    navigate({ to: "/", replace: true });
  }

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-30 transition-all duration-300 ${
        scrolled || menuOpen
          ? "bg-background/95 backdrop-blur-md border-b-2 border-sky/15 shadow-sm"
          : "bg-transparent"
      }`}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 md:px-12 md:py-5">
        <div onClick={() => setMenuOpen(false)}><PetWordmark /></div>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-8 md:flex">
          <a href="/#how-it-works" className="text-eyebrow text-foreground/70 hover:text-foreground">
            How it works
          </a>
          <a href="/#pricing" className="text-eyebrow text-foreground/70 hover:text-foreground">
            Examples
          </a>
          <a href="/#reviews" className="text-eyebrow text-foreground/70 hover:text-foreground">Reviews</a>
          <a href="/#faq" className="text-eyebrow text-foreground/70 hover:text-foreground">FAQ</a>
          {authed ? (
            <>
              <Link to="/dashboard" className="text-eyebrow text-foreground/70 hover:text-foreground">
                My artwork
              </Link>
              <button onClick={handleSignOut} className="text-eyebrow text-foreground/70 hover:text-foreground">
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="text-eyebrow text-foreground/70 hover:text-foreground">
                Sign in
              </Link>
              <Link to="/onboarding" className="btn-primary">
                Create yours
              </Link>
            </>
          )}
        </nav>

        {/* Mobile burger */}
        <button
          type="button"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
          className="-mr-2 flex h-11 w-11 items-center justify-center md:hidden"
        >
          <span className="relative block h-3 w-6">
            <span
              className={`absolute left-0 top-0 h-px w-6 bg-foreground transition-transform ${
                menuOpen ? "translate-y-[6px] rotate-45" : ""
              }`}
            />
            <span
              className={`absolute bottom-0 left-0 h-px w-6 bg-foreground transition-transform ${
                menuOpen ? "-translate-y-[6px] -rotate-45" : ""
              }`}
            />
          </span>
        </button>
      </div>

      {/* Mobile drawer */}
      {menuOpen && (
        <div className="md:hidden">
          <nav className="flex flex-col gap-1 border-t-2 border-sky/15 bg-background px-5 pb-8 pt-4">
            {authed ? (
              <>
                <Link
                  to="/dashboard"
                  onClick={() => setMenuOpen(false)}
                  className="text-display py-3 text-2xl"
                >
                  My artwork
                </Link>
                <button
                  onClick={handleSignOut}
                  className="text-display py-3 text-left text-2xl text-muted-foreground"
                >
                  Sign out
                </button>
              </>
            ) : (
              <>
                <a
                  href="/#how-it-works"
                  onClick={() => setMenuOpen(false)}
                  className="text-display py-3 text-2xl"
                >
                  How it works
                </a>
                <a
                  href="/#examples"
                  onClick={() => setMenuOpen(false)}
                  className="text-display py-3 text-2xl"
                >
                  Examples
                </a>
                <a href="/#reviews" onClick={() => setMenuOpen(false)} className="text-display py-3 text-2xl">Reviews</a>
                <a href="/#faq" onClick={() => setMenuOpen(false)} className="text-display py-3 text-2xl">FAQ</a>
                <Link
                  to="/login"
                  onClick={() => setMenuOpen(false)}
                  className="text-display py-3 text-2xl"
                >
                  Sign in
                </Link>
                <Link
                  to="/onboarding"
                  onClick={() => setMenuOpen(false)}
                  className="btn-primary mt-4 w-full"
                >
                  Create your mosaic
                </Link>
              </>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
