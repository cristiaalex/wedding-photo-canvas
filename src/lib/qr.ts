import QRCode from "qrcode";
import { supabase, COVERS_BUCKET } from "./supabase";

export function guestUrlForSlug(slug: string) {
  const origin =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://id-preview--7d3d9e25-bde9-4302-b5fd-592a0b476509.lovable.app";
  return `${origin}/e/${slug}`;
}

export async function generateQrDataUrl(slug: string): Promise<string> {
  return QRCode.toDataURL(guestUrlForSlug(slug), {
    margin: 1,
    width: 768,
    color: { dark: "#0b0b0b", light: "#ffffff" },
  });
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

/**
 * Generate a QR code PNG for the guest URL, upload it to the public covers
 * bucket, and persist the public URL on the event row. Best-effort: returns
 * the data URL even if upload/update fails so the UI can still render it.
 */
export async function generateAndStoreEventQr(
  eventId: string,
  slug: string,
): Promise<{ dataUrl: string; publicUrl: string | null }> {
  const dataUrl = await generateQrDataUrl(slug);
  let publicUrl: string | null = null;
  const path = `qr/${slug}-${eventId}.png`;

  try {
    // Check if QR already exists in storage — avoid re-uploading on every load.
    const { data: existing } = await supabase.storage
      .from(COVERS_BUCKET)
      .list("qr", { search: `${slug}-${eventId}.png`, limit: 1 });

    if (existing && existing.length > 0) {
      const { data } = supabase.storage.from(COVERS_BUCKET).getPublicUrl(path);
      publicUrl = data.publicUrl;
      return { dataUrl, publicUrl };
    }

    const blob = await dataUrlToBlob(dataUrl);
    const { error: upErr } = await supabase.storage
      .from(COVERS_BUCKET)
      .upload(path, blob, { contentType: "image/png", upsert: false, cacheControl: "31536000, immutable" });
    if (upErr) {
      console.error("[QR] upload failed", { path, error: upErr });
    } else {
      const { data } = supabase.storage.from(COVERS_BUCKET).getPublicUrl(path);
      publicUrl = data.publicUrl;
      await supabase
        .from("events")
        .update({ qr_image_url: publicUrl })
        .eq("id", eventId);
    }
  } catch (err) {
    console.error("[QR] unexpected error", err);
  }

  return { dataUrl, publicUrl };
}
