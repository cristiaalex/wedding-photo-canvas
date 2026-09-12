import { createFileRoute, redirect } from "@tanstack/react-router";

// Legacy path. Mosaic Pet has no onboarding flow — anyone landing here is sent
// straight into the creation studio (no login, no email).
export const Route = createFileRoute("/onboarding")({
  beforeLoad: () => {
    throw redirect({ to: "/create", replace: true });
  },
});
