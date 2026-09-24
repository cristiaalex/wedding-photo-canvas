import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import logo from "@/assets/mosaic-pet-logo-upscaled.png";

export function PetWordmark({ className }: { className?: string }) {
  return (
    <Link to="/" className={cn("inline-flex items-center", className)} aria-label="Mosaic Pet home">
      <img
        src={logo}
        alt="Mosaic Pet"
        className="h-9 w-auto object-contain md:h-10"
      />
    </Link>
  );
}