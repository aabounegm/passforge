import { Bookmark, Check, Copy, Download } from "lucide-react"
import { useState } from "react"
import { PageHeader, Steps, Tile, TILE_GRID } from "@/components/layout"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { bookmarklet, toolSource } from "@/bookmarklet"
import { t, type Key } from "@/i18n"
import { asset, cn } from "@/lib/utils"

// Brand faces for the official passes; logos in public/brands (see PROVENANCE.md).
export const GUIDES: { id: string; name: string; short: Key; color: string; logo: string; white?: boolean; emblem?: string; strip?: boolean }[] = [
  { id: "farsh", name: "#FARШ · PremiumBonus", short: "farshShort", color: "#0a0a0a", logo: "farsh/wordmark.png", white: true },
  { id: "aeroflot", name: "Аэрофлот Бонус", short: "aeroflotShort", color: "rgb(0, 71, 150)", logo: "aeroflot/bonus_logo.png", emblem: "aeroflot/emblem.svg" },
  { id: "surfcoffee", name: "Surf Coffee", short: "surfShort", color: "rgb(31, 31, 31)", logo: "surfcoffee/strip.png", emblem: "surfcoffee/logo.png", strip: true },
]

export function GuideFace({ g, className }: { g: (typeof GUIDES)[number]; className?: string }) {
  return (
    <div className={cn("relative flex aspect-[1.586] items-center justify-center overflow-hidden rounded-xl shadow-md ring-1 ring-black/10", className)} style={{ background: g.color }}>
      {g.emblem && <img src={asset("brands/" + g.emblem)} alt="" className={cn("absolute left-[6%] rounded-sm", g.strip ? "top-[4%] h-[20%]" : "top-[8%] h-[22%]")} />}
      <img src={asset("brands/" + g.logo)} alt={g.name} className={cn(g.strip ? "absolute inset-x-0 bottom-0 w-full" : "w-[62%] object-contain", g.white && "brightness-0 invert")} />
    </div>
  )
}

const guideTags = () => [{ label: t("tagSigned") }, { label: t("tagUpdates"), strong: true }]

export function GuideTiles() {
  return (
    <div className={TILE_GRID}>
      {GUIDES.map((g) => (
        <Tile key={g.id} href={`#/guide/${g.id}`} face={<GuideFace g={g} />} title={g.name} text={t(g.short)} tags={guideTags()} />
      ))}
    </div>
  )
}

const aside = (id: string) => <GuideFace g={GUIDES.find((g) => g.id === id)!} className="hidden w-44 rotate-3 md:flex" />

const back = () => ({ href: "#/official", label: t("navOfficial") })

export function FarshGuide() {
  const [copied, setCopied] = useState(false)
  return (
    <>
      <PageHeader back={back()} title="#FARШ · PremiumBonus" description={t("farshIntro")} aside={aside("farsh")} />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardContent className="pt-2">
            <Steps>
              <p>
                {t("farshStep1")}{" "}
                <a className="font-medium text-primary underline-offset-4 hover:underline" href="https://cards.premiumbonus.su/FARSH_volga/login" target="_blank" rel="noopener">
                  cards.premiumbonus.su/FARSH_volga
                </a>
              </p>
              <div className="space-y-3">
                <p>{t("farshStep2")}</p>
                {/* React blocks javascript: URLs in JSX, so the bookmarklet href is set on the element directly. */}
                <a
                  ref={(el) => el?.setAttribute("href", bookmarklet)}
                  onClick={(e) => { e.preventDefault(); alert(t("dragMe")) }}
                  className="inline-flex cursor-grab items-center gap-2 rounded-lg border-2 border-dashed border-primary/40 bg-primary/5 px-3 py-2 text-sm font-medium text-primary active:cursor-grabbing"
                >
                  <Bookmark className="size-4" /> passforge · PremiumBonus
                </a>
              </div>
              <div className="space-y-3">
                <p>{t("farshStep3")}</p>
                <Button variant="outline" onClick={() => navigator.clipboard.writeText(toolSource).then(() => setCopied(true))}>
                  {copied ? <Check /> : <Copy />} {copied ? t("copied") : t("copyConsole")}
                </Button>
              </div>
              <p>{t("farshStep4")}</p>
            </Steps>
          </CardContent>
        </Card>
        <Card size="sm" className="self-start bg-muted/40">
          <CardHeader>
            <CardTitle>{t("farshProfileTitle")}</CardTitle>
            <CardDescription>{t("farshProfile")}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    </>
  )
}

export function AeroflotGuide() {
  const [link, setLink] = useState("")
  const id = /\b([0-9a-f]{32})\b/i.exec(link)?.[1]?.toLowerCase()
  return (
    <>
      <PageHeader back={back()} title="Аэрофлот Бонус" description={t("aeroflotIntro")} aside={aside("aeroflot")} />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardContent className="pt-2">
            <Steps>
              <p>{t("aeroflotStep1")}</p>
              <div className="space-y-3">
                <p>{t("aeroflotStep2")}</p>
                <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://passbook.aeroflot.ru/api/client/gpay/pass/…" className="font-mono" />
                {link && !id && <p className="text-sm text-muted-foreground">{t("aeroflotBadLink")}</p>}
              </div>
              <div className="space-y-3">
                <p>{t("aeroflotStep3")}</p>
                {id ? (
                  <Button size="lg" asChild>
                    <a href={`https://passbook.aeroflot.ru/api/client/pass/${id}`}><Download /> {t("downloadOfficial")}</a>
                  </Button>
                ) : (
                  <Button size="lg" disabled><Download /> {t("downloadOfficial")}</Button>
                )}
              </div>
            </Steps>
          </CardContent>
        </Card>
        <Card size="sm" className="self-start bg-muted/40">
          <CardHeader>
            <CardTitle>{t("goodToKnow")}</CardTitle>
            <CardDescription>{t("aeroflotNote")}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    </>
  )
}


export function SurfGuide() {
  return (
    <>
      <PageHeader back={back()} title="Surf Coffee" description={t("surfIntro")} aside={aside("surfcoffee")} />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardContent className="pt-2">
            <Steps>
              <p>
                {t("surfStep1")}{" "}
                <a className="font-medium text-primary underline-offset-4 hover:underline" href="https://license.surfcoffee.ru" target="_blank" rel="noopener">
                  license.surfcoffee.ru
                </a>
              </p>
              <p>{t("surfStep2")}</p>
              <p>{t("surfStep3")}</p>
            </Steps>
          </CardContent>
        </Card>
        <Card size="sm" className="self-start bg-muted/40">
          <CardHeader>
            <CardTitle>{t("goodToKnow")}</CardTitle>
            <CardDescription className="space-y-2">
              <p>{t("surfPrivate")}</p>
              <p>{t("surfNote")}</p>
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    </>
  )
}
