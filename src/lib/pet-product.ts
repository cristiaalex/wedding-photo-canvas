import type { PetOrientation } from "@/lib/database.types";

export type PetPrintOption = {
  id: string;
  label: string;
  dimensions: string;
  pixels: string;
};

export const PET_PRINT_OPTIONS: Record<PetOrientation, PetPrintOption[]> = {
  landscape: [
    { id: "landscape-studio", label: "Studio", dimensions: "12 × 8 in", pixels: "3600 × 2400 px" },
    { id: "landscape-gallery", label: "Gallery", dimensions: "18 × 12 in", pixels: "5400 × 3600 px" },
    { id: "landscape-grand", label: "Grand", dimensions: "30 × 20 in", pixels: "9000 × 6000 px" },
  ],
  portrait: [
    { id: "portrait-studio", label: "Studio", dimensions: "8 × 12 in", pixels: "2400 × 3600 px" },
    { id: "portrait-gallery", label: "Gallery", dimensions: "12 × 18 in", pixels: "3600 × 5400 px" },
    { id: "portrait-grand", label: "Grand", dimensions: "20 × 30 in", pixels: "6000 × 9000 px" },
  ],
  square: [
    { id: "square-studio", label: "Studio", dimensions: "10 × 10 in", pixels: "3000 × 3000 px" },
    { id: "square-gallery", label: "Gallery", dimensions: "16 × 16 in", pixels: "4800 × 4800 px" },
    { id: "square-grand", label: "Grand", dimensions: "24 × 24 in", pixels: "7200 × 7200 px" },
  ],
};

export const PET_PRICE_LABEL = "Price shown at checkout";

export function petProjectName(name: string | null | undefined) {
  return name?.trim() || "Your pet";
}