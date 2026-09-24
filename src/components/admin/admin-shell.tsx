import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import {
  LayoutGrid,
  Users,
  CalendarHeart,
  CreditCard,
  Ticket,
  BarChart3,
  Activity,
  Settings,
  LogOut,
  Menu,
  X,
} from "lucide-react";

import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import logo from "@/assets/mosaic-pet-logo-upscaled.png";

/**
 * AdminShell — persistent chrome for the internal Mosaic back-office.
 *
 * Deliberately separate from the customer AppShell: different navigation,
 * different audience. Visual language (ivory canvas, surface-fade cards,
 * serif display type, eyebrow labels) is shared with the rest of Mosaic.
 */

type AdminNavItem = { label: string; to: string; icon: typeof LayoutGrid };

export const ADMIN_NAV: AdminNavItem[] = [
  { label: "Overview", to: "/admin", icon: LayoutGrid },
  { label: "Customers", to: "/admin/customers", icon: Users },
  { label: "Events", to: "/admin/events", icon: CalendarHeart },
  { label: "Payments", to: "/admin/payments", icon: CreditCard },
  { label: "Discount Codes", to: "/admin/discount-codes", icon: Ticket },
  { label: "Analytics", to: "/admin/analytics", icon: BarChart3 },
  { label: "System Health", to: "/admin/system-health", icon: Activity },
  { label: "Settings", to: "/admin/settings", icon: Settings },
];

export function AdminShell({
  children,
  email,
}: {
  children: ReactNode;
  email?: string | null;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  async function signOut() {
    setOpen(false);
    await supabase.auth.signOut();
    navigate({ to: "/login", replace: true });
  }

  return (
    <div className="min-h-screen bg-[color:var(--ivory)] text-foreground">
      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between bg-[color:var(--ivory)]/95 px-5 py-3 backdrop-blur-md lg:hidden">
        <div className="flex items-center gap-3">
          <img src={logo} alt="Mosaic Pet" className="h-7 w-auto object-contain" />
          <span className="text-eyebrow text-[color:var(--gold)]">Admin</span>
        </div>
        <button
          type="button"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((v) => !v)}
          className="flex h-10 w-10 items-center justify-center"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </header>

      {open && (
        <nav className="lg:hidden">
          <div className="flex flex-col gap-1 px-4 pb-6">
            {ADMIN_NAV.map((item) => (
              <NavLink
                key={item.to}
                item={item}
                pathname={pathname}
                onClick={() => setOpen(false)}
              />
            ))}
            <AccountBlock email={email} onSignOut={signOut} />
          </div>
        </nav>
      )}

      <div className="mx-auto flex w-full max-w-[1440px]">
        {/* Desktop / tablet rail */}
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col justify-between px-5 py-8 lg:flex">
          <div>
            <Link to="/admin" className="flex items-center gap-3">
              <img src={logo} alt="Mosaic Pet" className="h-8 w-auto object-contain" />
            </Link>
            <p className="text-eyebrow mt-3 text-[color:var(--gold)]">
              Internal admin
            </p>

            <div className="mt-8 flex flex-col gap-1">
              {ADMIN_NAV.map((item) => (
                <NavLink key={item.to} item={item} pathname={pathname} />
              ))}
            </div>
          </div>

          <AccountBlock email={email} onSignOut={signOut} />
        </aside>

        <main className="min-w-0 flex-1 px-5 pb-24 pt-6 md:px-8 lg:px-10 lg:pt-12">
          <div className="mx-auto w-full max-w-5xl">{children}</div>
        </main>
      </div>
    </div>
  );
}

function NavLink({
  item,
  pathname,
  onClick,
}: {
  item: AdminNavItem;
  pathname: string;
  onClick?: () => void;
}) {
  const active = item.to === "/admin" ? pathname === "/admin" : pathname.startsWith(item.to);
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-[0.9rem] px-3 py-2.5 text-sm transition-colors",
        active
          ? "surface-fade text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className={cn("h-4 w-4", active && "text-[color:var(--gold)]")} />
      <span>{item.label}</span>
    </Link>
  );
}

function AccountBlock({
  email,
  onSignOut,
}: {
  email?: string | null;
  onSignOut: () => void;
}) {
  return (
    <div className="mt-6 rounded-[1rem] surface-fade px-3 py-3 lg:mt-0">
      <p className="text-eyebrow text-muted-foreground">Signed in</p>
      <p className="mt-1 truncate text-sm">{email ?? "—"}</p>
      <button
        onClick={onSignOut}
        className="mt-3 flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <LogOut className="h-4 w-4" />
        Sign out
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shared building blocks                                               */
/* ------------------------------------------------------------------ */

export function AdminPageTitle({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div>
      <h1 className="text-display text-3xl md:text-4xl">{title}</h1>
      {subtitle && (
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{subtitle}</p>
      )}
    </div>
  );
}

export function AdminCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-[1.25rem] surface-fade p-5 md:p-6", className)}>
      {children}
    </section>
  );
}

/** Honest placeholder for sections that are not implemented yet. */
export function AdminPlaceholder({
  title,
  note,
}: {
  title: string;
  note: string;
}) {
  return (
    <div className="flex flex-col gap-8">
      <AdminPageTitle title={title} />
      <AdminCard className="flex min-h-[40vh] items-center justify-center text-center">
        <div className="max-w-md">
          <p className="text-eyebrow text-[color:var(--gold)]">Not implemented yet</p>
          <p className="mt-4 text-sm text-muted-foreground">{note}</p>
        </div>
      </AdminCard>
    </div>
  );
}
