import { ArrowRight, Bookmark, Check, Copy, Download, Plane, UtensilsCrossed } from "lucide-react"
import { useState, type ReactNode } from "react"
import { PageHeader, Steps } from "@/components/layout"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { bookmarklet, toolSource } from "@/bookmarklet"
import { t, type Key } from "@/i18n"

export const GUIDES: { id: string; name: string; short: Key; icon: ReactNode; tint: string }[] = [
  { id: "farsh", name: "#FARШ · PremiumBonus", short: "farshShort", icon: <UtensilsCrossed />, tint: "bg-orange-500/10 text-orange-600 dark:text-orange-400" },
  { id: "aeroflot", name: "Аэрофлот Бонус", short: "aeroflotShort", icon: <Plane />, tint: "bg-sky-500/10 text-sky-600 dark:text-sky-400" },
]

/** List of official-pass guides (its own page, so every guide has a parent to go back to). */
export function OfficialIndex() {
  return (
    <>
      <PageHeader back={{ href: "#/", label: "passforge" }} title={t("official")} description={t("officialDesc")} />
      <GuideTiles />
    </>
  )
}

export function GuideTiles() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {GUIDES.map((g) => (
        <a key={g.id} href={`#/guide/${g.id}`} className="group">
          <Card className="h-full transition-shadow group-hover:shadow-md group-hover:ring-primary/30">
            <CardHeader>
              <div className={`mb-2 flex size-10 items-center justify-center rounded-lg ${g.tint}`}>{g.icon}</div>
              <CardTitle className="flex items-center justify-between">
                {g.name} <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </CardTitle>
              <CardDescription>{t(g.short)}</CardDescription>
            </CardHeader>
          </Card>
        </a>
      ))}
    </div>
  )
}

const back = () => ({ href: "#/official", label: t("official") })

export function FarshGuide() {
  const [copied, setCopied] = useState(false)
  return (
    <>
      <PageHeader back={back()} title="#FARШ · PremiumBonus" description={t("farshIntro")} />
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
      <PageHeader back={back()} title="Аэрофлот Бонус" description={t("aeroflotIntro")} />
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

