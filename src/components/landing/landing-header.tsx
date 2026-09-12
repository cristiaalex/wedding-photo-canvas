import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import logoAsset from "@/assets/mosaic-logo.png.asset.json";

const LINKS = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#the-mosaic", label: "The Mosaic" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

export function LandingHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  /* keep the overlay mounted while it fades out */
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const id = window.setTimeout(() => setMounted(false), 340);
    return () => window.clearTimeout(id);
  }, [open]);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-40 transition-all duration-500 ${
        scrolled || open
          ? "border-b border-border/60 bg-[color:var(--ivory)]/92 backdrop-blur-md"
          : "border-b border-transparent bg-transparent"
      }`}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3 md:px-6 md:py-4 lg:px-12 lg:py-6">
        <Link to="/" className="flex items-center" onClick={() => setOpen(false)}>
          <img src={logoAsset.url} alt="Mosaic Wedding" className="h-7 w-auto sm:h-8 md:h-8 lg:h-10" />
        </Link>

        <nav className="hidden items-center gap-5 md:flex lg:gap-9">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-eyebrow text-foreground/60 transition-colors hover:text-foreground md:text-[0.65rem] lg:text-xs"
            >
              {l.label}
            </a>
          ))}
          <Link to="/onboarding" className="btn-primary md:px-5 md:py-2.5 md:text-[0.62rem] lg:px-6 lg:py-3 lg:text-[0.68rem]">
            Create your mosaic
          </Link>
        </nav>

        <button
          type="button"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="relative z-50 -mr-2 flex h-11 w-11 items-center justify-center md:hidden"
        >
          <span className="relative block h-3 w-6">
            <span
              className={`absolute left-0 top-0 h-px w-6 bg-foreground transition-transform duration-300 ${
                open ? "translate-y-[6px] rotate-45" : ""
              }`}
            />
            <span
              className={`absolute bottom-0 left-0 h-px w-6 bg-foreground transition-transform duration-300 ${
                open ? "-translate-y-[6px] -rotate-45" : ""
              }`}
            />
          </span>
        </button>
      </div>

      {mounted && (
        <div
          className="fixed inset-x-0 top-0 z-40 flex h-screen flex-col bg-[color:var(--ivory)] pt-[60px] md:hidden"
          onClick={() => setOpen(false)}
          style={{
            opacity: open ? 1 : 0,
            transition: "opacity 320ms ease",
          }}
        >
          <nav
            className="flex flex-1 flex-col justify-center px-8 pb-10 pt-2"
            onClick={(e) => e.stopPropagation()}
          >
            {LINKS.map((l, i) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="text-display border-b border-border/40 py-5 text-center text-3xl"
                style={{
                  opacity: open ? 1 : 0,
                  transform: open ? "translateY(0)" : "translateY(10px)",
                  transition: `opacity 400ms ease ${open ? 90 + i * 60 : 0}ms, transform 400ms cubic-bezier(0.22,1,0.36,1) ${open ? 90 + i * 60 : 0}ms`,
                }}
              >
                {l.label}
              </a>
            ))}
            <Link
              to="/onboarding"
              onClick={() => setOpen(false)}
              className="btn-primary mx-auto mt-10 w-full max-w-xs py-4 text-[0.76rem]"
              style={{
                opacity: open ? 1 : 0,
                transform: open ? "translateY(0)" : "translateY(10px)",
                transition: `opacity 400ms ease ${open ? 90 + LINKS.length * 60 : 0}ms, transform 400ms cubic-bezier(0.22,1,0.36,1) ${open ? 90 + LINKS.length * 60 : 0}ms`,
              }}
            >
              Create your mosaic
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}
