import { useRef, useState } from "react";
import { unzip } from "fflate";
import { FileArchive, Images, Upload } from "lucide-react";
import { GuestUploadSheet } from "@/components/guest-upload-sheet";
import { Button } from "@/components/ui/button";

const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|heic|heif|dng)$/i;
const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  heic: "image/heic", heif: "image/heif", dng: "image/x-adobe-dng",
};

type Props = {
  eventId: string;
  petName?: string | null;
  compact?: boolean;
};

function extractZip(file: File): Promise<File[]> {
  return new Promise((resolve, reject) => {
    file.arrayBuffer().then((buffer) => {
      unzip(new Uint8Array(buffer), (error, entries) => {
        if (error) return reject(error);
        const files = Object.entries(entries)
          .filter(([name, bytes]) => !name.startsWith("__MACOSX/") && IMAGE_EXTENSIONS.test(name) && bytes.length > 0)
          .map(([name, bytes]) => {
            const filename = name.split("/").pop() || name;
            const extension = filename.split(".").pop()?.toLowerCase() ?? "";
            return new File([bytes], filename, { type: MIME_BY_EXTENSION[extension] ?? "application/octet-stream" });
          });
        resolve(files);
      });
    }).catch(reject);
  });
}

export function PetPhotoUploader({ eventId, petName, compact = false }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[] | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unpacking, setUnpacking] = useState(false);

  async function acceptSelection(selection: File[] | FileList) {
    setError(null);
    setUnpacking(true);
    try {
      const expanded: File[] = [];
      for (const file of Array.from(selection)) {
        if (/\.zip$/i.test(file.name) || file.type === "application/zip") {
          expanded.push(...(await extractZip(file)));
        } else {
          expanded.push(file);
        }
      }
      if (expanded.length === 0) {
        setError("No supported photos were found in that selection.");
        return;
      }
      setFiles(expanded);
      setOpen(true);
    } catch {
      setError("That ZIP file could not be opened. Try creating a new ZIP and upload it again.");
    } finally {
      setUnpacking(false);
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*,.heic,.heif,.dng,.zip,application/zip"
        className="hidden"
        onChange={(event) => {
          if (event.target.files) void acceptSelection(event.target.files);
          event.target.value = "";
        }}
      />
      <div
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void acceptSelection(event.dataTransfer.files);
        }}
        className={compact
          ? "flex flex-col items-center gap-3 text-center"
          : `rounded-[2rem] border-2 border-dashed p-7 text-center transition-all md:p-12 ${dragging ? "scale-[1.01] border-coral bg-blush" : "border-sky/50 bg-card shadow-[var(--shadow-soft)]"}`}
      >
        {!compact && (
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[1.4rem] bg-mist text-sky shadow-[0_4px_0_color-mix(in_oklab,var(--sky)_25%,transparent)]">
            <Images className="h-5 w-5" />
          </div>
        )}
        <div className={compact ? "" : "mt-5"}>
          <p className="text-display text-2xl">Let&rsquo;s collect all their little moments.</p>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
            Pick as many favorites as you like, or add a ZIP. More adventures, cuddles and funny faces make the mosaic even better.
          </p>
        </div>
        <Button
          type="button"
          size="lg"
          onClick={() => inputRef.current?.click()}
          disabled={unpacking}
          className={compact ? "mt-1" : "mt-6"}
        >
          {unpacking ? <FileArchive className="animate-pulse" /> : <Upload />}
          {unpacking ? "Opening ZIP…" : "Choose photos"}
        </Button>
        {!compact && <p className="mt-4 rounded-full bg-mist px-3 py-2 text-xs font-bold text-muted-foreground">Works with photos from your phone, camera, or a ZIP</p>}
        {error && <p className="mt-3 text-sm text-destructive" role="alert">{error}</p>}
      </div>
      <GuestUploadSheet
        open={open}
        onClose={() => setOpen(false)}
        eventId={eventId}
        eventName={petName}
        guestName={null}
        guestUuid={null}
        initialFiles={files}
      />
    </>
  );
}