import { createMiddleware } from "@tanstack/react-start";
import { supabase } from "@/lib/supabase";

/**
 * Attaches the bearer token from the external (user-managed) Supabase project
 * to every serverFn RPC. The auto-generated `integrations/supabase/auth-attacher`
 * reads from the Lovable Cloud client, which is NOT where this app stores its
 * session — so we must attach from the external client used by the app.
 */
export const attachExternalSupabaseAuth = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return next({
      // Always override Authorization. Another global middleware attaches the
      // Lovable Cloud session first; returning an empty object here would not
      // remove that unrelated token when the external organizer session is
      // still hydrating, causing it to be verified against the wrong project.
      headers: { Authorization: token ? `Bearer ${token}` : "" },
    });
  },
);
