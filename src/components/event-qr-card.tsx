import { useEffect, useState } from "react";
import { generateQrDataUrl, guestUrlForSlug, generateAndStoreEventQr } from "@/lib/qr";

type Props = {
  eventId: string;
  slug: string;
  storedUrl: string | null;
};

export function EventQrCard({ eventId, slug, storedUrl }: Props) {
  const [src, setSrc] = useState<string | null>(storedUrl);
  const [copied, setCopied] = useState(false);
  const guestUrl = guestUrlForSlug(slug);

  useEffect(() => {
    if (src) return;
    let cancelled = false;
    (async () => {
      // No stored URL — generate locally for instant display, then persist.
      const dataUrl = await generateQrDataUrl(slug);
      if (!cancelled) setSrc(dataUrl);
      const { publicUrl } = await generateAndStoreEventQr(eventId, slug);
      if (!cancelled && publicUrl) setSrc(publicUrl);
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, slug, src]);

  async function downloadPng(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const href = src ?? (await generateQrDataUrl(slug));
    let blobUrl = href;
    if (href.startsWith("http")) {
      const res = await fetch(href);
      const blob = await res.blob();
      blobUrl = URL.createObjectURL(blob);
    }
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = `mosaic-${slug}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (blobUrl !== href) URL.revokeObjectURL(blobUrl);
  }

  async function copyLink(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    await navigator.clipboard.writeText(guestUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex items-center gap-4 rounded-2xl bg-[color:var(--champagne)]/28 p-3">
      {src ? (
        <img
          src={src}
          alt={`QR code for ${slug}`}
          className="h-20 w-20 rounded-2xl bg-[color:var(--ivory)] p-2 shadow-sm"
        />
      ) : (
        <div className="h-20 w-20 animate-pulse rounded-2xl bg-card" />
      )}
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={downloadPng}
          className="text-eyebrow text-left text-muted-foreground transition-colors hover:text-primary"
        >
          Download PNG
        </button>
        <button
          type="button"
          onClick={copyLink}
          className="text-eyebrow text-left text-muted-foreground transition-colors hover:text-primary"
        >
          {copied ? "Copied" : "Copy Link"}
        </button>
        <a
          href={guestUrl}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-eyebrow text-left text-muted-foreground transition-colors hover:text-primary"
        >
          Open Guest Page ↗
        </a>
      </div>
    </div>
  );
}
