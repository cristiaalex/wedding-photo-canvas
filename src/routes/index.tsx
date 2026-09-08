import { createFileRoute, Link } from "@tanstack/react-router";
import qrMomentRealAsset from "@/assets/qr-moment.png.asset.json";

const qrMomentReal = qrMomentRealAsset.url;
import candidC1Asset from "@/assets/candid-c1.jpg.asset.json";
import candidC2Asset from "@/assets/candid-c2.jpg.asset.json";
import candidC3Asset from "@/assets/candid-c3.jpg.asset.json";
import candidC4Asset from "@/assets/candid-c4.jpg.asset.json";
import candidG0Asset from "@/assets/candid-g0.jpg.asset.json";
import candidG1Asset from "@/assets/candid-g1.jpg.asset.json";
import candidG2Asset from "@/assets/candid-g2.jpg.asset.json";
import candidG3Asset from "@/assets/candid-g3.jpg.asset.json";
import candidG4Asset from "@/assets/candid-g4.jpg.asset.json";

const candidC1 = candidC1Asset.url;
const candidC2 = candidC2Asset.url;
const candidC3 = candidC3Asset.url;
const candidC4 = candidC4Asset.url;
const candidG0 = candidG0Asset.url;
const candidG1 = candidG1Asset.url;
const candidG2 = candidG2Asset.url;
const candidG3 = candidG3Asset.url;
const candidG4 = candidG4Asset.url;
import { SiteFooter } from "@/components/site-footer";
import { LandingHeader } from "@/components/landing/landing-header";
import { MosaicReveal } from "@/components/landing/mosaic-reveal";
import { HeroMosaic } from "@/components/landing/hero-mosaic";
import { Reveal } from "@/components/landing/reveal";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Mosaic — Every memory becomes part of something bigger" },
      {
        name: "description",
        content:
          "Your wedding is made of thousands of moments, captured by everyone who was there. Mosaic brings them together — and transforms them into something you can keep forever.",
      },
      { property: "og:type", content: "website" },
      { property: "og:title", content: "Mosaic — Every memory becomes part of something bigger" },
      {
        property: "og:description",
        content:
          "Collect every photo your guests take and transform them into one wedding Mosaic you can keep forever.",
      },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

/* ── editorial building blocks ───────────────────────────────────── */

/** A delicate diamond rule used to open sections. */
function Ornament({ className = "", align = "center" }: { className?: string; align?: "center" | "left" }) {
  return (
    <div
      aria-hidden
      className={`flex items-center gap-3 ${align === "center" ? "justify-center" : "justify-start"} ${className}`}
    >
      <span className="h-px w-7 bg-[color:var(--dusty)]/40 sm:w-10 md:w-14" />
      <span className="block h-[6px] w-[6px] rotate-45 border border-[color:var(--dusty)]/60 md:h-[7px] md:w-[7px]" />
      <span className="h-px w-7 bg-[color:var(--dusty)]/40 sm:w-10 md:w-14" />
    </div>
  );
}

/* ── page ────────────────────────────────────────────────────────── */

function Landing() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <LandingHeader />

      {/* 01 — HERO */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[70vh]"
          style={{
            background:
              "linear-gradient(180deg, color-mix(in oklab, var(--mist) 62%, transparent) 0%, transparent 100%)",
          }}
        />
        <div className="relative mx-auto max-w-7xl px-5 pt-16 pb-10 sm:px-6 md:px-8 md:pt-20 md:pb-16 lg:px-12 lg:pt-28 lg:pb-24">
          <div className="grid items-center gap-9 md:grid-cols-12 md:gap-10 lg:gap-16">
            <div className="md:col-span-6">
              <Reveal>
                <Ornament align="left" className="hidden md:flex" />
                <Ornament className="md:hidden" />
                <h1 className="text-display mt-5 text-center text-[2.15rem] leading-[1.1] sm:text-[3rem] md:mt-7 md:text-left md:text-[3rem] lg:text-[4.6rem]">
                  Every memory becomes part of{" "}
                  <span className="text-script italic text-[color:var(--dusty)]">
                    something bigger.
                  </span>
                </h1>
              </Reveal>
              <Reveal delay={120}>
                <p className="mx-auto mt-4 max-w-[30rem] text-balance text-center text-[0.95rem] leading-[1.75] text-muted-foreground md:mx-0 md:mt-6 md:max-w-[34rem] md:text-left md:text-base md:leading-[1.85] lg:mt-8 lg:text-lg">
                  Your wedding is made of thousands of moments, captured by everyone who was
                  there. Mosaic brings them together — and transforms them into something you
                  can keep forever.
                </p>
                <div className="mt-7 flex justify-center md:mt-8 md:justify-start lg:mt-10">
                  <Link
                    to="/login"
                    className="btn-primary w-full max-w-[18rem] py-3.5 text-[0.72rem] sm:w-auto sm:max-w-none sm:px-8 sm:py-4 sm:text-[0.76rem] md:px-8 md:py-3.5 lg:px-10 lg:py-[1.05rem]"
                  >
                    Create your wedding
                  </Link>
                </div>
              </Reveal>
            </div>

            <div className="md:col-span-6">
              <Reveal delay={200}>
                <div className="relative overflow-hidden rounded-[1rem]">
                  <div
                    aria-hidden
                    className="absolute -z-10 hidden border border-[color:var(--dusty)]/20 md:-inset-3 md:block lg:-inset-5"
                  />
                  <HeroMosaic className="aspect-square w-full sm:aspect-[4/5] md:aspect-square lg:aspect-[5/6]" />
                </div>
              </Reveal>
            </div>
          </div>
        </div>
      </section>

      {/* 02 — MORE THAN A WEDDING GALLERY */}
      <section className="py-11 md:py-24">
        <div className="mx-auto max-w-7xl px-5 sm:px-6 md:px-12">
          <div className="grid gap-8 md:grid-cols-12 md:gap-14">
            <div className="md:col-span-5">
              <Reveal>
                <h2 className="text-display text-[1.85rem] leading-[1.15] sm:text-[2.1rem] md:text-[3rem]">
                  More than a wedding gallery.
                </h2>
                <div className="mt-5 h-px w-12 bg-[color:var(--gold)]/50 md:mt-7 md:w-16" />
                <p className="mt-5 max-w-md text-[0.93rem] leading-[1.8] text-muted-foreground md:mt-7 md:text-[0.95rem] md:leading-[1.9]">
                  Your guests will capture moments you could never see yourself — the
                  laughter, the tears, the dance floor, the little moments in between.
                  Mosaic brings all those perspectives together and transforms them into
                  something uniquely yours.
                </p>
              </Reveal>
            </div>
            <div className="md:col-span-7">
              <div className="grid grid-cols-2 gap-3 sm:gap-4 md:gap-6">
                {[
                  { src: candidC1, alt: "The couple laughing as guests cheer", cls: "aspect-[3/4]" },
                  { src: candidC2, alt: "Friends toasting at the reception table", cls: "aspect-[3/4] md:mt-12" },
                  { src: candidC3, alt: "The bride embracing her mother", cls: "aspect-[3/4] md:-mt-6" },
                  { src: candidC4, alt: "The couple dancing surrounded by friends", cls: "aspect-[3/4] md:mt-6" },
                ].map((img, i) => (
                  <Reveal key={img.alt} delay={i * 80} className={`overflow-hidden rounded-[1rem] ${img.cls}`}>
                    <img
                      src={img.src}
                      alt={img.alt}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  </Reveal>
                ))}
              </div>

            </div>
          </div>
        </div>
      </section>

      {/* 03 — HOW IT WORKS (the complete journey) */}
      <section
        id="how-it-works"
        className="py-11 md:py-24"
        style={{
          background:
            "linear-gradient(180deg, transparent 0%, color-mix(in oklab, var(--mist) 45%, transparent) 14%, color-mix(in oklab, var(--mist) 45%, transparent) 86%, transparent 100%)",
        }}
      >
        <div className="mx-auto max-w-6xl px-5 sm:px-6 md:px-12">
          <Reveal>
            <div className="mx-auto max-w-2xl text-center">
              <Ornament />
              <h2 className="text-display mt-5 text-[1.85rem] leading-[1.16] sm:text-[2.1rem] md:mt-7 md:text-[3rem]">
                From one scan to something you’ll keep forever.
              </h2>
            </div>
          </Reveal>

          <div className="mt-6 grid gap-8 md:mt-14 md:grid-cols-12 md:gap-11">
            <div className="flex items-center md:col-span-5">
              <Reveal className="relative w-full">
                <div
                  aria-hidden
                  className="absolute -bottom-5 -left-5 hidden h-32 w-32 border-b border-l border-[color:var(--gold)]/40 md:block"
                />
                <img
                  src={qrMomentReal}
                  alt="A guest scanning the wedding QR code from the table"
                  loading="lazy"
                  className="aspect-[5/4] w-full rounded-[1rem] object-cover sm:aspect-[4/3] md:aspect-[4/5]"
                />
              </Reveal>
            </div>

            <div className="md:col-span-7">
              {/* one continuous vertical thread through the four steps */}
              <ol className="relative">
                <span
                  aria-hidden
                  className="absolute left-[0.42rem] top-2 bottom-8 w-px bg-[color:var(--dusty)]/25 md:left-[0.5rem]"
                />
                {[
                  ["01", "Scan", "Your guests scan your wedding QR code.", "No app. No account. Just one scan."],
                  ["02", "Share", "They upload the moments they captured.", "Straight from their phones, while the celebration is happening."],
                  ["03", "Collect", "Every photo comes together in your private wedding gallery.", "This is where all the different perspectives of your day meet."],
                  ["04", "Transform", "Mosaic brings those memories together and turns them into your unique wedding Mosaic.", ""],
                ].map(([n, t, d, sub], i) => (
                  <Reveal as="li" key={n} delay={i * 90} className="relative pl-8 pb-7 last:pb-0 md:pl-12 md:pb-11">
                    <span
                      aria-hidden
                      className="absolute left-0 top-[0.45rem] block h-[7px] w-[7px] rotate-45 border border-[color:var(--gold)]/70 bg-[color:var(--mist)] md:left-[0.09rem]"
                    />
                    <span className="text-eyebrow text-[color:var(--gold)]">{n} — {t}</span>
                    <p className="text-display mt-2 text-[1.15rem] leading-[1.35] md:mt-3 md:text-[1.6rem]">
                      {d}
                    </p>
                    {sub ? (
                      <p className="mt-2 text-[0.88rem] leading-[1.75] text-muted-foreground md:mt-3 md:text-[0.95rem] md:leading-[1.9]">
                        {sub}
                      </p>
                    ) : null}
                  </Reveal>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </section>

      {/* 04 — THE GALLERY */}
      <section className="py-11 md:py-24">
        <div className="mx-auto max-w-7xl px-5 sm:px-6 md:px-12">
          <Reveal>
            <div className="mx-auto max-w-2xl text-center">
              <Ornament />
              <h2 className="text-display mt-5 text-[1.85rem] leading-[1.16] sm:text-[2.1rem] md:mt-7 md:text-[3rem]">
                Every moment, in one place.
              </h2>
              <p className="mx-auto mt-4 max-w-lg text-[0.93rem] leading-[1.8] text-muted-foreground md:mt-6 md:text-[0.95rem] md:leading-[1.9]">
                Every photo your guests share becomes part of your private wedding gallery —
                ready to browse, revisit and download in full quality, long after the day is
                over.
              </p>
              <p className="text-eyebrow mt-5 md:mt-6">Private · Full quality · Yours</p>
            </div>
          </Reveal>

          <div className="mt-5 md:mt-14">
            <Reveal className="overflow-hidden rounded-[1rem]">
              <img
                src={candidG0}
                alt="Guests throwing confetti as the newlyweds walk past"
                loading="lazy"
                className="aspect-[5/4] w-full object-cover sm:aspect-[4/3] md:aspect-[16/9]"
              />
            </Reveal>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:gap-4 md:mt-6 md:grid-cols-4 md:gap-6">
              {[
                [candidG1, "Bridesmaids laughing together"],
                [candidG2, "Children playing during the reception"],
                [candidG3, "The groom hugging a friend"],
                [candidG4, "The couple sharing a laugh at dinner"],

              ].map(([src, alt], i) => (
                <Reveal key={i} delay={i * 70} className="overflow-hidden rounded-[1rem]">
                  <img
                    src={src}
                    alt={alt}
                    loading="lazy"
                    className="aspect-square w-full object-cover"
                  />
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </section>


      {/* 06 — GUESTBOOK */}
      <section
        className="py-11 md:py-24"
        style={{
          background:
            "linear-gradient(180deg, transparent 0%, color-mix(in oklab, var(--mist) 45%, transparent) 14%, color-mix(in oklab, var(--mist) 45%, transparent) 86%, transparent 100%)",
        }}
      >
        <div className="mx-auto max-w-5xl px-5 sm:px-6 md:px-12">
          <Reveal>
            <div className="mx-auto max-w-xl text-center">
              <Ornament />
              <h2 className="text-display mt-5 text-[1.85rem] leading-[1.16] sm:text-[2.1rem] md:mt-7 md:text-[3rem]">
                Some memories aren’t photographs.
              </h2>
              <p className="mt-4 text-[0.93rem] leading-[1.8] text-muted-foreground md:mt-6 md:text-[0.95rem] md:leading-[1.9]">
                Give your guests a place to leave the words, wishes and stories you’ll want
                to read again.
              </p>
            </div>
          </Reveal>
          <div className="mt-5 grid gap-4 md:mt-14 md:grid-cols-3 md:gap-6">
            {[
              ["“I have never seen you look at anyone the way you looked at each other today.”", "from a seat at table four"],
              ["“Thank you for the dance. I will be humming that song for a week.”", "written just before midnight"],
              ["“Your mother cried before the vows even started. So did I.”", "left the morning after"],
            ].map(([q, m], i) => (
              <Reveal as="figure" key={i} delay={i * 100}>
                <div className="h-full rounded-[2px] border border-[color:var(--dusty)]/20 bg-[color:var(--ivory)] p-6 md:p-9">
                  <blockquote className="text-display text-[1.08rem] leading-[1.5] text-foreground/90 md:text-[1.15rem]">
                    {q}
                  </blockquote>
                  <div className="mt-4 h-px w-8 bg-[color:var(--gold)]/50 md:mt-6" />
                  <figcaption className="text-script mt-3 text-[0.95rem] text-muted-foreground md:mt-4">
                    {m}
                  </figcaption>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* 07 — THE MOSAIC REVEAL */}
      <section id="the-mosaic" style={{ background: "var(--ink)" }}>
        <div className="mx-auto max-w-7xl px-5 pt-11 pb-5 text-center sm:px-6 md:px-12 md:pt-24 md:pb-8">
          <Reveal>
            <h2 className="text-display text-[1.95rem] leading-[1.14] text-[color:var(--ivory)] sm:text-[2.2rem] md:text-[3.6rem]">
              Thousands of moments.{" "}
              <span className="text-script italic">One Mosaic.</span>
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-[0.93rem] leading-[1.8] text-[color:var(--ivory)]/65 md:mt-6 md:text-[0.95rem] md:leading-[1.9]">
              Your wedding day becomes a piece of art made from the memories that filled it.
            </p>
          </Reveal>
        </div>

        <div className="px-5 sm:px-6 md:px-16">
          <MosaicReveal className="mx-auto aspect-square w-full max-w-4xl md:aspect-[4/3]" />
        </div>


        <div className="mx-auto max-w-7xl px-5 pt-5 pb-11 text-center sm:px-6 md:px-12 md:pt-8 md:pb-24">
          <Reveal>
            <p className="text-script text-lg text-[color:var(--ivory)]/75 md:text-2xl">
              Every photo has a place in the bigger picture.
            </p>
          </Reveal>
        </div>
      </section>

      {/* 08 — EVERYTHING INCLUDED */}
      <section className="py-11 md:py-24">
        <div className="mx-auto max-w-7xl px-5 sm:px-6 md:px-12">
          <div className="grid gap-7 md:grid-cols-12 md:gap-20">
            <div className="md:col-span-5">
              <Reveal>
                <h2 className="text-display text-[1.85rem] leading-[1.15] sm:text-[2.1rem] md:text-[3rem]">
                  Everything you need to keep the memories of your day.
                </h2>
                <div className="mt-5 h-px w-12 bg-[color:var(--gold)]/50 md:mt-7 md:w-16" />
              </Reveal>
            </div>
            <div className="md:col-span-7">
              <dl>
                {[
                  ["QR sharing", "A QR code for tables, signage and save-the-dates."],
                  ["Private wedding page", "Your own page, shared only with the people you invite."],
                  ["Guest photo collection", "Guests upload straight from their phones, no app required."],
                  ["Wedding gallery", "Every shared photo, gathered in one place."],
                  ["Guestbook", "Words, wishes and stories from the people who were there."],
                  ["Wedding Mosaic", "All those memories, transformed into one artwork."],
                  ["High-quality photo downloads", "Keep the originals your guests shared."],
                  ["Couple dashboard", "Manage your wedding, guests and privacy settings."],
                ].map(([t, d], i) => (
                  <Reveal key={t} delay={i * 50}>
                    <div className="grid grid-cols-12 gap-x-4 gap-y-1 border-t border-[color:var(--dusty)]/20 py-4 md:gap-x-10 md:py-6">
                      <dt className="text-display col-span-12 text-[1.05rem] md:col-span-5 md:text-xl">{t}</dt>
                      <dd className="col-span-12 text-[0.88rem] leading-[1.7] text-muted-foreground md:col-span-7 md:text-[0.9rem] md:leading-[1.85]">
                        {d}
                      </dd>
                    </div>
                  </Reveal>
                ))}
              </dl>
            </div>
          </div>
        </div>
      </section>

      {/* 09 — PRICING */}
      <section id="pricing" className="relative overflow-hidden py-11 md:py-24">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, transparent, color-mix(in oklab, var(--peach) 55%, transparent) 45%, transparent)",
          }}
        />
        <div className="relative mx-auto max-w-3xl px-5 text-center sm:px-6 md:px-12">
          <Reveal>
            <Ornament />
            <h2 className="text-display mt-5 text-[1.85rem] leading-[1.16] sm:text-[2.1rem] md:mt-7 md:text-[3.2rem]">
              One wedding. Everything included.
            </h2>
            <div className="mt-8 rounded-[3px] border border-[color:var(--dusty)]/25 bg-[color:var(--ivory)] px-6 py-9 shadow-[var(--shadow-soft)] md:mt-10 md:px-16 md:py-16">
              <p className="text-eyebrow">Launch price</p>
              <p className="text-display mt-3 text-[3.4rem] leading-none sm:text-[4.2rem] md:mt-5 md:text-[5.5rem]">€149</p>
              <div className="mx-auto mt-6 h-px w-12 bg-[color:var(--gold)]/60 md:mt-8" />
              <p className="mx-auto mt-6 max-w-md text-[0.93rem] leading-[1.8] text-muted-foreground md:mt-8 md:text-[0.95rem] md:leading-[1.9]">
                Everything you need to collect, relive and transform the memories of your
                wedding. One complete Mosaic wedding experience — nothing to add on later.
              </p>
              <div className="mt-8 md:mt-10">
                <Link to="/login" className="btn-primary w-full sm:w-auto">
                  Create your wedding
                </Link>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* 10 — FAQ */}
      <section id="faq" className="py-11 md:py-24">
        <div className="mx-auto max-w-4xl px-5 sm:px-6 md:px-12">
          <Reveal>
            <div className="text-center">
              <Ornament />
              <h2 className="text-display mt-5 text-[1.85rem] leading-[1.16] sm:text-[2.1rem] md:mt-7 md:text-[3rem]">
                Everything else, answered.
              </h2>
            </div>
          </Reveal>
          <div className="mt-5 md:mt-14">
            {[
              ["Do guests need to download an app?", "No. Your guests open your wedding page in their browser — nothing to install, no account to create."],
              ["How do guests upload photos?", "They scan your QR code or open your wedding link, then upload straight from their phone."],
              ["Can guests see each other’s photos?", "That is up to you. When the gallery is visible, guests can browse everything shared. When it is private, each guest still sees the photos they uploaded themselves."],
              ["Can I control gallery visibility?", "Yes. Gallery visibility and guestbook visibility are switches in your dashboard, and you can change them at any time."],
              ["Can guests leave messages?", "Yes. The guestbook lets guests write a note for you, and you decide whether those notes are shown publicly."],
              ["Can I download the photos?", "Yes. You can download the photos your guests shared in high quality from your gallery."],
              ["What is the Mosaic?", "Your wedding photos, arranged into a single artwork: from across the room it reads as one portrait, up close it is made of the moments your guests captured."],
              ["What is included in the €149 price?", "Everything: your private wedding page, guest photo collection, the gallery, the guestbook, QR sharing, high-quality downloads, the couple dashboard and your wedding Mosaic."],
            ].map(([q, a], i) => (
              <Reveal key={q} delay={i * 40}>
                <details className="group border-t border-[color:var(--dusty)]/20 py-4 md:py-6">
                  <summary className="text-display flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 text-[1.05rem] md:gap-6 md:text-xl">
                    <span>{q}</span>
                    <span className="relative h-3 w-3 shrink-0">
                      <span className="absolute top-1/2 left-0 h-px w-3 bg-[color:var(--dusty)]" />
                      <span className="absolute top-1/2 left-0 h-px w-3 rotate-90 bg-[color:var(--dusty)] transition-transform duration-300 group-open:rotate-0" />
                    </span>
                  </summary>
                  <p className="mt-3 max-w-2xl text-[0.88rem] leading-[1.75] text-muted-foreground md:mt-4 md:text-[0.95rem] md:leading-[1.9]">
                    {a}
                  </p>
                </details>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* 11 — FINAL CTA */}
      <section className="relative overflow-hidden py-10 md:py-20">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, transparent, color-mix(in oklab, var(--peach) 45%, transparent) 50%, transparent)",
          }}
        />
        <div className="relative mx-auto max-w-3xl px-5 text-center sm:px-6 md:px-12">
          <Reveal>
            <Ornament />
            <h2 className="text-display mt-5 text-[1.85rem] leading-[1.15] sm:text-[2.1rem] md:mt-7 md:text-[3rem]">
              Your wedding is made of thousands of moments.
            </h2>
            <p className="text-script mx-auto mt-4 max-w-xl text-lg text-muted-foreground md:mt-6 md:text-2xl">
              Bring them together. Make them yours.
            </p>
            <div className="mt-7 md:mt-10">
              <Link to="/login" className="btn-primary w-full sm:w-auto">
                Create your wedding
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
