import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/guests")({
  head: () => ({ meta: [
    { title: "Your Studio — Mosaic Pet" },
    { name: "description", content: "Continue creating your private pet mosaic artwork." },
    { property: "og:title", content: "Your Studio — Mosaic Pet" },
    { property: "og:description", content: "Continue creating your private pet mosaic artwork." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: () => <Navigate to="/dashboard" replace />,
});