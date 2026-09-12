import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/e/$slug/timeline")({
  head: () => ({ meta: [
    { title: "Mosaic Pet" },
    { name: "description", content: "Create a personal pet photo mosaic from the moments you treasure." },
    { property: "og:title", content: "Mosaic Pet" },
    { property: "og:description", content: "Create a personal pet photo mosaic from the moments you treasure." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: () => <Navigate to="/" replace />,
});