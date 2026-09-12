import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Check, Frame, Images, Search, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Reveal } from "@/components/landing/reveal";
import heroAsset from "@/assets/pet-mosaic-hero.jpg.asset.json";
import memoriesAsset from "@/assets/pet-memories.jpg.asset.json";
import galleryAsset from "@/assets/pet-mosaic-gallery.jpg.asset.json";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Pet Photo Mosaic — Mosaic Pet" },
      { name: "description", content: "Transform your pet photos into a timeless, high-resolution mosaic artwork to preview, zoom and print." },
      { property: "og:type", content: "website" },
      { property: "og:title", content: "Your pet. One beautiful mosaic." },
      { property: "og:description", content: "Upload a lifetime of pet memories and turn them into one gallery-worthy portrait." },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

const steps = [
  { icon: Upload, number: "01", title: "Gather the memories", text: "Choose photos from your phone or computer, or add a ZIP archive. Candid, playful and quiet moments all belong." },
  { icon: Frame, number: "02", title: "Shape the artwork", text: "Choose landscape, portrait or square, select one of three print sizes, then pick the main portrait to recreate." },
  { icon: Search, number: "03", title: "Preview every detail", text: "See the mosaic before you buy. Zoom from the full portrait into the tiny photographs that make it yours." },
];

function Landing() {
  return (
    <div className="min-h-screen overflow-hidden bg-background text-foreground">
      <SiteHeader />
      <main>
        <section className="relative min-h-[92svh] overflow-hidden bg-ink">
          <img src={heroAsset.url} alt="Golden retriever beside a framed mosaic portrait made from pet photos" width={1536} height={1280} className="absolute inset-0 h-full w-full object-cover object-[58%_center]" />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,color-mix(in_oklab,var(--ink)_90%,transparent)_0%,color-mix(in_oklab,var(--ink)_62%,transparent)_44%,transparent_78%)]" />
          <div className="relative mx-auto flex min-h-[92svh] max-w-7xl items-end px-5 pb-16 pt-32 sm:px-8 md:items-center md:px-12 md:pb-24">
            <div className="max-w-2xl text-ivory">
              <Reveal>
                <p className="text-eyebrow text-gold">A portrait made from a lifetime</p>
                <h1 className="mt-5 text-display text-[3.25rem] leading-[0.98] text-ivory sm:text-6xl md:text-7xl lg:text-[5.5rem]">
                  Your pet. A lifetime of memories. One beautiful mosaic.
                </h1>
                <p className="mt-6 max-w-lg text-base leading-7 text-ivory/80 md:text-lg">
                  Your favorite photographs become one remarkable portrait—an intimate, print-ready artwork made entirely from moments you shared.
                </p>
                <Button asChild size="lg" className="mt-8 h-12 px-7 shadow-elegant">
                  <Link to="/login">Create your mosaic <ArrowRight /></Link>
                </Button>
              </Reveal>
            </div>
          </div>
        </section>

        <section className="py-20 md:py-32">
          <div className="mx-auto grid max-w-7xl gap-12 px-5 sm:px-8 md:grid-cols-12 md:items-center md:px-12">
            <Reveal className="md:col-span-6">
              <img src={memoriesAsset.url} alt="A collection of joyful everyday photographs of a golden retriever" width={1280} height={1280} loading="lazy" className="aspect-square w-full object-cover shadow-elegant" />
            </Reveal>
            <Reveal delay={100} className="md:col-span-5 md:col-start-8">
              <p className="text-eyebrow text-gold">Every little moment</p>
              <h2 className="mt-4 text-display text-4xl leading-tight md:text-6xl">All in one picture.</h2>
              <div className="mt-7 h-px w-16 bg-gold/60" />
              <p className="mt-7 text-base leading-8 text-muted-foreground">
                The muddy paws. The birthday hat. The look that always made you laugh. Mosaic Pet brings hundreds of those small moments together to recreate the face you know by heart.
              </p>
              <p className="mt-5 text-sm leading-7 text-muted-foreground">
                From a distance, it is their portrait. Up close, it is your story together.
              </p>
            </Reveal>
          </div>
        </section>

        <section id="how-it-works" className="border-y border-border bg-surface py-20 md:py-28">
          <div className="mx-auto max-w-7xl px-5 sm:px-8 md:px-12">
            <Reveal className="max-w-2xl">
              <p className="text-eyebrow text-gold">Made simply</p>
              <h2 className="mt-4 text-display text-4xl md:text-6xl">From camera roll to gallery wall.</h2>
            </Reveal>
            <div className="mt-14 grid gap-px bg-border md:grid-cols-3">
              {steps.map(({ icon: Icon, number, title, text }, index) => (
                <Reveal key={title} delay={index * 100} className="bg-surface px-1 py-8 md:px-8 md:py-10">
                  <div className="flex items-center justify-between"><Icon className="h-5 w-5 text-gold" /><span className="text-eyebrow">{number}</span></div>
                  <h3 className="mt-8 text-display text-3xl">{title}</h3>
                  <p className="mt-4 text-sm leading-7 text-muted-foreground">{text}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-ink py-20 text-ivory md:py-32">
          <div className="mx-auto grid max-w-7xl gap-12 px-5 sm:px-8 md:grid-cols-12 md:items-center md:px-12">
            <Reveal className="md:col-span-5">
              <p className="text-eyebrow text-gold">Look closer</p>
              <h2 className="mt-4 text-display text-4xl text-ivory md:text-6xl">One portrait. Hundreds of memories.</h2>
              <p className="mt-6 max-w-md text-base leading-8 text-ivory/65">Explore the finished mosaic at extraordinary detail. Every tile reveals a photograph from your life together.</p>
              <ul className="mt-8 space-y-4 text-sm text-ivory/80">
                {["Preview before purchase", "Pinch and zoom on any device", "High-resolution, print-ready final file"].map((item) => <li key={item} className="flex items-center gap-3"><Check className="h-4 w-4 text-gold" />{item}</li>)}
              </ul>
            </Reveal>
            <Reveal delay={100} className="md:col-span-6 md:col-start-7">
              <img src={galleryAsset.url} alt="Large framed cat mosaic displayed in a quiet gallery" width={1280} height={1536} loading="lazy" className="aspect-[5/6] w-full object-cover shadow-elegant" />
            </Reveal>
          </div>
        </section>

        <section id="pricing" className="py-20 text-center md:py-32">
          <div className="mx-auto max-w-3xl px-5 sm:px-8">
            <Reveal>
              <Images className="mx-auto h-6 w-6 text-gold" />
              <h2 className="mt-6 text-display text-4xl md:text-6xl">A lasting portrait of the love they gave you.</h2>
              <p className="mx-auto mt-6 max-w-xl text-base leading-8 text-muted-foreground">Upload and preview first. Choose from exactly three ready-to-print sizes in landscape, portrait or square. Purchase only when it feels right.</p>
              <Button asChild size="lg" className="mt-9 h-12 px-8"><Link to="/login">Start with your photos <ArrowRight /></Link></Button>
              <p className="mt-5 text-xs text-muted-foreground">One-time purchase · No subscription</p>
            </Reveal>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}