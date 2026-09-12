import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Camera, Check, Download, Heart, Images, MessageCircleHeart, MousePointer2, Sparkles, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Reveal } from "@/components/landing/reveal";
import petDuo from "@/assets/joyful-pet-duo.png";
import dogMemory from "@/assets/joyful-dog-memory.jpg";
import catMemory from "@/assets/joyful-cat-memory.jpg";
import mosaicClose from "@/assets/mosaic-close.jpg.asset.json";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    { title: "Pet Photo Mosaic — Mosaic Pet" },
    { name: "description", content: "Turn all your favorite dog or cat photos into one joyful, high-resolution pet mosaic." },
    { property: "og:type", content: "website" },
    { property: "og:title", content: "Your pet. All their little moments. One big picture." },
    { property: "og:description", content: "Upload the photos you love, preview the magic, and download one unforgettable pet mosaic." },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: Landing,
});

const steps = [
  { icon: Upload, n: "1", title: "Upload your photos", text: "Bring the cuddles, adventures, naps and wonderfully weird moments.", tone: "bg-blush" },
  { icon: MousePointer2, n: "2", title: "Choose & preview", text: "Pick the shape, size and one favorite photo for the big picture.", tone: "bg-mist" },
  { icon: Heart, n: "3", title: "Make it yours", text: "Explore every tiny memory, then choose your one-time purchase.", tone: "bg-mint/40" },
  { icon: Download, n: "4", title: "Download & cherish", text: "Save the high-resolution mosaic, ready to print and love forever.", tone: "bg-sunshine/25" },
];

function Landing() {
  return <div className="min-h-screen overflow-hidden bg-background text-foreground">
    <SiteHeader />
    <main>
      <section className="relative mx-auto min-h-[91svh] max-w-[1500px] px-5 pb-12 pt-24 sm:px-8 md:px-12 md:pt-28">
        <div className="grid min-h-[calc(91svh-7rem)] items-center gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:gap-14">
          <Reveal className="relative z-10 order-2 pb-5 lg:order-1 lg:pb-0">
            <span className="sticker inline-flex items-center gap-2 bg-sunshine/35 px-4 py-2 text-xs font-extrabold text-navy"><Heart className="h-4 w-4 fill-coral text-coral" /> Made from the moments you love</span>
            <h1 className="mt-6 max-w-2xl text-display text-[2.85rem] leading-[1.04] sm:text-6xl lg:text-7xl">
              Your pet. A lifetime of <span className="relative inline-block text-coral">memories.<span className="absolute -bottom-2 left-0 h-2 w-full rounded-full bg-sunshine/70" /></span> One big picture.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-muted-foreground md:text-lg">Turn the photos filling your camera roll into one unforgettable mosaic of your furry best friend.</p>
            <div className="mt-8 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
              <Button asChild size="lg"><Link to="/login">Create your mosaic <ArrowRight /></Link></Button>
              <a href="#how-it-works" className="inline-flex items-center gap-2 px-2 text-sm font-extrabold text-navy">See how it works <span aria-hidden>↓</span></a>
            </div>
            <div className="mt-8 flex flex-wrap gap-2 text-xs font-bold text-muted-foreground">
              {["Easy to create", "Preview first", "High-resolution download"].map((text) => <span key={text} className="inline-flex items-center gap-1.5 rounded-full bg-card px-3 py-2 shadow-sm"><Check className="h-3.5 w-3.5 text-mint" />{text}</span>)}
            </div>
          </Reveal>

          <Reveal delay={100} className="relative order-1 min-h-[390px] lg:order-2 lg:min-h-[630px]">
            <div className="absolute inset-x-4 bottom-3 top-5 rotate-2 rounded-[3.5rem] bg-sunshine/25 lg:inset-8" />
            <div className="absolute -left-5 top-10 h-40 w-40 rounded-[45%_55%_50%_50%] bg-mint/40 lg:h-56 lg:w-56" />
            <div className="absolute -right-12 bottom-16 h-48 w-48 rounded-[60%_40%_55%_45%] bg-sky/30 lg:h-72 lg:w-72" />
            <img src={petDuo} alt="Happy golden retriever and affectionate tabby cat" width={1200} height={1104} className="absolute inset-x-2 bottom-8 z-10 mx-auto w-[94%] rounded-[2.75rem] object-cover shadow-[var(--shadow-soft)] lg:bottom-16" />
            <div className="photo-float absolute bottom-0 left-1 z-20 w-28 -rotate-6 rounded-2xl bg-card p-2 shadow-[var(--shadow-soft)] sm:w-36 lg:left-0 lg:w-44" style={{ "--photo-tilt": "-6deg" } as React.CSSProperties}><img src={dogMemory} alt="Happy dog running in the park" width={900} height={1100} className="aspect-[4/5] rounded-xl object-cover" /><p className="px-1 pb-1 pt-2 text-center text-[0.65rem] font-bold">Best day ever!</p></div>
            <div className="photo-float absolute right-1 top-0 z-20 w-28 rotate-6 rounded-2xl bg-card p-2 shadow-[var(--shadow-soft)] sm:w-36 lg:right-0 lg:w-44" style={{ "--photo-tilt": "6deg", animationDelay: "-2s" } as React.CSSProperties}><img src={catMemory} alt="Affectionate tabby cat at home" width={900} height={1100} className="aspect-[4/5] rounded-xl object-cover" /><p className="px-1 pb-1 pt-2 text-center text-[0.65rem] font-bold">Professional cuddler</p></div>
            <div className="sticker absolute bottom-14 right-2 z-30 rotate-6 bg-coral px-4 py-3 text-center text-xs font-extrabold text-primary-foreground lg:right-4 lg:px-6">More photos<br/>More memories!</div>
            <Sparkles className="absolute left-5 top-3 z-30 h-8 w-8 text-sunshine" />
          </Reveal>
        </div>
      </section>

      <section id="how-it-works" className="bg-card py-16 md:py-24">
        <div className="mx-auto max-w-7xl px-5 sm:px-8 md:px-12">
          <Reveal className="max-w-2xl"><p className="text-eyebrow text-coral">Four happy little steps</p><h2 className="mt-3 text-display text-4xl md:text-6xl">From camera roll to happy tears.</h2><p className="mt-5 text-muted-foreground">Simple to make. Very hard not to show everyone.</p></Reveal>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{steps.map(({icon: Icon,n,title,text,tone},i)=><Reveal key={title} delay={i*80} className={`${tone} rounded-[1.75rem] border-2 border-navy/8 p-6`}><div className="flex items-center justify-between"><span className="grid h-10 w-10 place-items-center rounded-full bg-card text-sm font-extrabold shadow-sm">{n}</span><Icon className="h-6 w-6 text-navy" /></div><h3 className="mt-8 text-display text-xl">{title}</h3><p className="mt-3 text-sm leading-6 text-muted-foreground">{text}</p></Reveal>)}</div>
        </div>
      </section>

      <section id="examples" className="py-16 md:py-24"><div className="mx-auto grid max-w-7xl gap-5 px-5 sm:px-8 lg:grid-cols-12 md:px-12">
        <Reveal className="relative overflow-hidden rounded-[2rem] bg-sky/20 p-7 lg:col-span-7 lg:p-10"><p className="text-eyebrow text-sky">One big picture</p><h2 className="mt-3 max-w-lg text-display text-4xl md:text-5xl">Step back and see your best friend.</h2><img src={petDuo} alt="Happy dog and cat portrait example" width={1200} height={1104} loading="lazy" className="mt-8 aspect-[16/10] w-full rounded-[1.5rem] object-cover" /></Reveal>
        <div className="grid gap-5 lg:col-span-5"><Reveal delay={80} className="rounded-[2rem] bg-blush p-7 lg:p-9"><Camera className="h-7 w-7 text-coral"/><h3 className="mt-10 text-display text-3xl">Every little moment belongs.</h3><p className="mt-4 text-sm leading-7 text-muted-foreground">The muddy paws, sleepy Sundays and faces that always make you laugh.</p></Reveal><Reveal delay={140} className="rounded-[2rem] bg-mint/35 p-7 lg:p-9"><Images className="h-7 w-7 text-navy"/><h3 className="mt-8 text-display text-3xl">Zoom in. There they all are.</h3><p className="mt-4 text-sm leading-7 text-muted-foreground">Every tiny tile is one of your photos, tucked inside the portrait you chose.</p></Reveal></div>
      </div></section>

      <section id="reviews" className="bg-mist py-16 md:py-24"><div className="mx-auto max-w-7xl px-5 sm:px-8 md:px-12"><div className="grid gap-5 md:grid-cols-3"><div className="rounded-[2rem] bg-card p-7 md:col-span-2"><MessageCircleHeart className="h-7 w-7 text-coral"/><blockquote className="mt-5 text-display text-3xl md:text-4xl">“It feels like every walk, cuddle and silly face is right there in one picture.”</blockquote><p className="mt-5 text-sm font-bold text-muted-foreground">A keepsake made for pet people</p></div><div className="rounded-[2rem] bg-sunshine/35 p-7"><Heart className="h-7 w-7 fill-coral text-coral"/><p className="mt-8 text-display text-3xl">All their little moments. Together forever.</p></div></div></div></section>

      <section id="faq" className="py-16 md:py-24"><div className="mx-auto max-w-4xl px-5 sm:px-8"><Reveal className="text-center"><p className="text-eyebrow text-coral">Good to know</p><h2 className="mt-3 text-display text-4xl md:text-5xl">Questions, answered.</h2></Reveal><div className="mt-10 grid gap-4 md:grid-cols-2">{[["Can I preview it first?","Yes. Create and explore your mosaic before deciding to buy."],["What photos can I add?","Choose many at once, including JPEG, PNG, HEIC, RAW/DNG, or a ZIP."],["What do I download?","Your finished high-resolution pet mosaic—not a bundle of the original photos."],["Is it a subscription?","Never. Your final mosaic is a simple one-time purchase."]].map(([q,a])=><div key={q} className="joyful-card p-6"><h3 className="text-display text-lg">{q}</h3><p className="mt-3 text-sm leading-6 text-muted-foreground">{a}</p></div>)}</div><div className="mt-12 text-center"><Button asChild size="lg"><Link to="/login">Create your mosaic <ArrowRight /></Link></Button></div></div></section>
    </main>
    <SiteFooter />
  </div>;
}