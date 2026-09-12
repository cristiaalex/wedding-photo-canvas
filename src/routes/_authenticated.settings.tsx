import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [
    { title: "Your Studio — Mosaic Pet" },
    { name: "description", content: "Manage your private pet mosaic from the Mosaic Pet studio." },
    { property: "og:title", content: "Your Studio — Mosaic Pet" },
    { property: "og:description", content: "Manage your private pet mosaic from the Mosaic Pet studio." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: () => <Navigate to="/dashboard" replace />,
});