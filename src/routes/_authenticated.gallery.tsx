import { createFileRoute, redirect } from "@tanstack/react-router";

// Mosaic Pet has no standalone photo library — the mosaic is the product.
// This legacy path forwards to the customer's mosaic.
export const Route = createFileRoute("/_authenticated/gallery")({
  ssr: false,
  beforeLoad: () => {
    throw redirect({ to: "/mosaic", replace: true });
  },
});
