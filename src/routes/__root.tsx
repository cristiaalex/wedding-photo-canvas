import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { Toaster } from "sonner";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <p className="text-eyebrow text-primary">404</p>
        <h1 className="mt-5 text-display text-5xl">Oops, this trail went cold.</h1>
        <p className="mt-4 text-sm text-muted-foreground">
          Even the best noses miss a turn sometimes. Let&rsquo;s head home.
        </p>
        <div className="mt-8">
          <Link to="/" className="btn-primary">Return home</Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <p className="text-eyebrow text-primary">Small hiccup</p>
        <h1 className="mt-6 text-display text-4xl">Something got its paws crossed.</h1>
        <p className="mt-4 text-sm text-muted-foreground">
          Try refreshing or head back home.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <button
            onClick={() => { router.invalidate(); reset(); }}
            className="btn-primary"
          >
            Try again
          </button>
          <a href="/" className="btn-ghost">Go home</a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Mosaic Pet — Your memories, one beautiful mosaic" },
      { name: "description", content: "Turn your favorite pet photographs into one timeless, high-resolution mosaic artwork." },
      { name: "author", content: "Mosaic" },
      { property: "og:title", content: "Mosaic Pet — Your memories, one beautiful mosaic" },
      { property: "og:description", content: "Turn your favorite pet photographs into one timeless, high-resolution mosaic artwork." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Mosaic Pet — Your memories, one beautiful mosaic" },
      { name: "twitter:description", content: "Turn your favorite pet photographs into one timeless, high-resolution mosaic artwork." },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Sora:wght@500;600;700;800&display=swap" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        <script
          dangerouslySetInnerHTML={{
            __html:
              "if(location.pathname==='/auth/callback'){document.documentElement.classList.add('auth-callback-page')}",
          }}
        />
        <style
          dangerouslySetInnerHTML={{
            __html:
              "html.auth-callback-page pre,html.auth-callback-page code,body.auth-callback-page pre,body.auth-callback-page code,[data-auth-callback-screen] pre,[data-auth-callback-screen] code{display:none!important;visibility:hidden!important;opacity:0!important;width:0!important;height:0!important;overflow:hidden!important;position:absolute!important;pointer-events:none!important}",
          }}
        />
      </head>
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "if(location.pathname==='/auth/callback'){document.body.classList.add('auth-callback-page');document.querySelectorAll('pre,code').forEach(function(el){el.remove()});new MutationObserver(function(ms){ms.forEach(function(m){m.addedNodes.forEach(function(n){if(n.nodeType!==1)return;if(n.matches&&n.matches('pre,code'))n.remove();if(n.querySelectorAll)n.querySelectorAll('pre,code').forEach(function(el){el.remove()})})})}).observe(document.body,{childList:true,subtree:true})}",
          }}
        />
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
      <Toaster
        position="bottom-center"
        toastOptions={{
          classNames: {
            toast:
              "!bg-card !text-foreground !border-2 !border-sky/20 !shadow-[var(--shadow-soft)] !rounded-3xl",
            description: "!text-muted-foreground",
          },
        }}
      />
    </QueryClientProvider>
  );
}
