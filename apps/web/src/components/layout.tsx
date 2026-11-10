import { ArrowLeft, ArrowRight, Languages, Moon, Sun } from "lucide-react"
import type { ReactNode } from "react"
import { Logo } from "@/components/Logo"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { lang, t } from "@/i18n"
import { setTheme, useTheme } from "@/lib/theme"
import { cn } from "@/lib/utils"

export function Header({ route, onLang }: { route: string; onLang: () => void }) {
  const theme = useTheme()
  const nav = [
    { href: "#/cards", label: t("navCards"), active: route === "cards" || route === "card" },
    { href: "#/official", label: t("navOfficial"), active: route === "official" || route === "guide" },
    { href: "#/live", label: t("navLive"), active: route === "live" },
  ]
  return (
    <header className="sticky top-0 z-20 border-b bg-background/75 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-2 px-4 sm:h-14 sm:flex-nowrap sm:gap-6">
        <a href="#/" aria-label="passforge" className="mr-auto shrink-0 py-3 sm:mr-0 sm:py-0">
          <Logo />
        </a>
        <nav className="order-last -mx-1 flex w-full gap-1 overflow-x-auto pb-2 text-sm sm:order-none sm:mx-0 sm:w-auto sm:flex-1 sm:pb-0">
          {nav.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className={cn(
                "whitespace-nowrap rounded-md px-2.5 py-1.5 text-muted-foreground transition-colors hover:text-foreground",
                n.active && "bg-accent text-accent-foreground",
              )}
            >
              {n.label}
            </a>
          ))}
        </nav>
        <Button variant="ghost" size="sm" onClick={onLang} aria-label={t("switchLang")}>
          <Languages /> {lang() === "ru" ? "EN" : "RU"}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("switchTheme")}
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? <Sun /> : <Moon />}
        </Button>
      </div>
    </header>
  )
}

export function Footer() {
  return (
    <footer className="mt-24 border-t">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 text-xs text-muted-foreground sm:flex-row sm:justify-between">
        <p className="max-w-2xl">{t("privacy")}</p>
        <a className="underline-offset-4 hover:underline" href={import.meta.env.BASE_URL + "brands/PROVENANCE.md"}>
          {t("provenance")}
        </a>
      </div>
    </footer>
  )
}

/** Same header on every subpage: back link to its section, title, description, optional artwork. */
export function PageHeader(props: { back: { href: string; label: string }; title: ReactNode; description?: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-8 flex items-start gap-6">
      <div className="min-w-0 flex-1">
        <a href={props.back.href} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> {props.back.label}
        </a>
        <h1 className="text-3xl font-semibold tracking-tight">{props.title}</h1>
        {props.description && <p className="mt-2 max-w-2xl text-muted-foreground">{props.description}</p>}
      </div>
      {props.aside}
    </div>
  )
}

export function SectionTitle({ title, description, id }: { title: string; description?: string; id?: string }) {
  return (
    <div id={id} className="mb-4 scroll-mt-20">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
    </div>
  )
}

export function Steps({ children }: { children: ReactNode[] }) {
  return (
    <ol className="relative space-y-6">
      {children.map((c, i) => (
        <li key={i} className="relative flex gap-4">
          {i < children.length - 1 && <span className="absolute top-9 bottom-[-1.25rem] left-[15px] w-px bg-border" aria-hidden />}
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary ring-1 ring-primary/20">
            {i + 1}
          </span>
          <div className="min-w-0 flex-1 pt-1">{c}</div>
        </li>
      ))}
    </ol>
  )
}

/** Card-shaped link tile on the home page: brand face, title, blurb, tags. */
export function Tile(props: { href: string; face: ReactNode; title: string; text: string; tags: { label: string; strong?: boolean }[] }) {
  return (
    <a href={props.href} className="group rounded-2xl border bg-card p-3 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:ring-1 hover:ring-primary/30">
      {props.face}
      <div className="px-1 pt-3 pb-1">
        <div className="flex items-center justify-between font-medium">
          {props.title} <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{props.text}</p>
        <div className="mt-3 flex flex-wrap gap-1">
          {props.tags.map((tag) => <Badge key={tag.label} variant={tag.strong ? "default" : "outline"}>{tag.label}</Badge>)}
        </div>
      </div>
    </a>
  )
}

export const TILE_GRID = "grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
