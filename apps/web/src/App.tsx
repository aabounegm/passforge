import { ArrowRight, Radio, ScanLine, ShieldCheck, WifiOff } from "lucide-react"
import { useEffect, useState } from "react"
import { Footer, Header, SectionTitle, Tile, TILE_GRID } from "@/components/layout"
import { LogoMark } from "@/components/Logo"
import { CardFace } from "@/components/PassPreview"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CARDS } from "@/cards"
import { lang, setLang, t } from "@/i18n"
import { Generator } from "@/pages/Generator"
import { AeroflotGuide, FarshGuide, GuideTiles } from "@/pages/Guides"
import { Live } from "@/pages/Live"

function useHashRoute() {
  const [hash, setHash] = useState(location.hash)
  useEffect(() => {
    const on = () => { setHash(location.hash); window.scrollTo(0, 0) }
    window.addEventListener("hashchange", on)
    return () => window.removeEventListener("hashchange", on)
  }, [])
  const [, kind = "", id = ""] = hash.split("/")
  return { kind, id }
}

function Home() {
  return (
    <div className="space-y-16">
      <section className="grid items-center gap-10 pt-6 md:grid-cols-[1.1fr_1fr]">
        <div>
          <Badge variant="secondary" className="mb-4">{t("heroBadge")}</Badge>
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">{t("heroTitle")}</h1>
          <p className="mt-4 max-w-xl text-lg text-muted-foreground text-pretty">{t("tagline")}</p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button size="lg" asChild><a href="#/cards">{t("heroCta")} <ArrowRight /></a></Button>
            <Button size="lg" variant="outline" asChild><a href="#/official">{t("navOfficial")}</a></Button>
          </div>
          <ul className="mt-8 grid gap-3 text-sm text-muted-foreground sm:grid-cols-3">
            <li className="flex items-center gap-2"><WifiOff className="size-4 text-primary" /> {t("featOffline")}</li>
            <li className="flex items-center gap-2"><ScanLine className="size-4 text-primary" /> {t("featScan")}</li>
            <li className="flex items-center gap-2"><ShieldCheck className="size-4 text-primary" /> {t("featOpen")}</li>
          </ul>
        </div>
        {/* A fanned stack of the supported cards */}
        <div className="relative mx-auto hidden h-72 w-full max-w-sm md:block" aria-hidden>
          {CARDS.map((c, i) => (
            <CardFace
              key={c.id}
              card={c}
              className="absolute left-1/2 w-64 transition-transform duration-500 hover:-translate-y-2"
              style={{ top: `${i * 2.4}rem`, transform: `translateX(-50%) rotate(${(i - 1.5) * 5}deg) translateX(${(i - 1.5) * 1.2}rem)` }}
            />
          ))}
        </div>
      </section>

      <section>
        <SectionTitle id="cards" title={t("generate")} description={t("generateDesc")} />
        <div className={TILE_GRID}>
          {CARDS.map((c) => (
            <Tile key={c.id} href={`#/card/${c.id}`} face={<CardFace card={c} />} title={c.name} text={t(c.short)}
              tags={c.tags.map((label) => ({ label }))} />
          ))}
        </div>
      </section>

      <section>
        <SectionTitle id="official" title={t("official")} description={t("officialDesc")} />
        <GuideTiles />
      </section>

      <section className="relative overflow-hidden rounded-3xl border bg-gradient-to-br from-primary/10 via-card to-card p-8 sm:p-10">
        <LogoMark className="absolute -right-6 -bottom-8 size-48 opacity-10" />
        <div className="relative max-w-xl">
          <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Radio className="size-5" /></div>
          <h2 className="text-2xl font-semibold tracking-tight">{t("liveTitle")}</h2>
          <p className="mt-2 text-muted-foreground">{t("liveIntro")}</p>
          <Button className="mt-5" variant="outline" asChild><a href="#/live">{t("liveLink")} <ArrowRight /></a></Button>
        </div>
      </section>
    </div>
  )
}

export default function App() {
  const { kind, id } = useHashRoute()
  const [, rerender] = useState(0)
  useEffect(() => { document.documentElement.lang = lang() })
  // #/cards and #/official are sections of the home page: scroll to them.
  useEffect(() => { if (kind === "cards" || kind === "official") document.getElementById(kind)?.scrollIntoView() }, [kind])

  const card = kind === "card" ? CARDS.find((c) => c.id === id) : undefined
  const page =
    card ? <Generator key={card.id} card={card} />
    : kind === "guide" && id === "farsh" ? <FarshGuide />
    : kind === "guide" && id === "aeroflot" ? <AeroflotGuide />
    : kind === "live" ? <Live />
    : <Home />

  return (
    <>
      <Header route={kind} onLang={() => { setLang(lang() === "ru" ? "en" : "ru"); rerender((n) => n + 1) }} />
      <main className="mx-auto max-w-6xl px-4 pt-8">{page}</main>
      <Footer />
    </>
  )
}
