import { buildPkpass } from "@passforge/core"
import { Camera, Download, ImageUp, Info, Loader2, ScanLine, Sparkles } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { PageHeader } from "@/components/layout"
import { CardFace, PassPreview } from "@/components/PassPreview"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { decode, type Decoded } from "@/barcode"
import { CameraScanner, cameraAvailable } from "@/components/CameraScanner"
import type { CardDef, Values } from "@/cards"
import { t } from "@/i18n"
import { cn, errText, saveFile } from "@/lib/utils"

type Build = { state: "idle" } | { state: "busy" } | { state: "ok"; zip: Uint8Array; warn?: string } | { state: "error"; message: string }

/** Rebuilds the pass (debounced) whenever the inputs change, so the preview is always live. */
function usePass(card: CardDef, values: Values): Build {
  const [b, setB] = useState<Build>({ state: "idle" })
  useEffect(() => {
    if (!Object.values(values).some((v) => v.trim())) return setB({ state: "idle" })
    let live = true
    setB((prev) => (prev.state === "ok" ? prev : { state: "busy" }))
    const timer = setTimeout(async () => {
      try {
        const { pass, images } = await card.build(values)
        const zip = await buildPkpass(pass, images)
        const warn = card.warn?.(values)
        if (live) setB({ state: "ok", zip, warn: warn && t(warn) })
      } catch (e) {
        if (live) setB({ state: "error", message: errText(e) })
      }
    }, 350)
    return () => { live = false; clearTimeout(timer) }
  }, [card, values])
  return b
}

/** Step 1: live camera scan (phones, plastic cards) or a screenshot (cards shown in an app on this phone). */
function ScanStep({ onFile, onFrame, status }: {
  onFile: (f: Blob) => void
  onFrame: (found: Decoded[]) => boolean
  status: { text: string; busy?: boolean } | undefined
}) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [camera, setCamera] = useState(false)
  useEffect(() => {
    // Pasting a screenshot anywhere on the page works too.
    const paste = (e: ClipboardEvent) => {
      const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith("image/"))
      if (f) onFile(f)
    }
    window.addEventListener("paste", paste)
    return () => window.removeEventListener("paste", paste)
  }, [onFile])
  const tile = "flex w-full flex-col items-center gap-2 rounded-xl border-2 px-4 py-6 text-center transition-colors"
  const icon = "flex size-11 items-center justify-center rounded-full"
  return (
    <div>
      <div className={cn("grid gap-3", cameraAvailable() && "sm:grid-cols-2")}>
        {cameraAvailable() && (
          <button type="button" onClick={() => setCamera(true)} className={cn(tile, "border-primary/30 bg-primary/5 hover:border-primary/60 hover:bg-primary/10")}>
            <span className={cn(icon, "bg-primary text-primary-foreground")}><Camera className="size-5" /></span>
            <span className="font-medium">{t("cameraTitle")}</span>
            <span className="text-xs text-muted-foreground">{t("cameraHint")}</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true) }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) onFile(f) }}
          className={cn(tile, "border-dashed", over ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/50")}
        >
          <span className={cn(icon, "bg-primary/10 text-primary")}>
            {status?.busy ? <Loader2 className="size-5 animate-spin" /> : <ImageUp className="size-5" />}
          </span>
          <span className="font-medium">{t("screenshotTitle")}</span>
          <span className="text-xs text-muted-foreground">{t("screenshotHint")}</span>
        </button>
      </div>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = "" }} />
      {camera && <CameraScanner onFrame={onFrame} onClose={() => setCamera(false)} />}
      {status && !status.busy && (
        <p className="mt-3 flex items-start gap-2 text-sm text-muted-foreground" role="status">
          <ScanLine className="mt-0.5 size-4 shrink-0 text-primary" /> {status.text}
        </p>
      )}
    </div>
  )
}

export function Generator({ card }: { card: CardDef }) {
  const [values, setValues] = useState<Values>(() => Object.fromEntries(card.inputs.map((i) => [i.name, ""])))
  const [scan, setScan] = useState<{ text: string; busy?: boolean }>()
  const build = usePass(card, values)

  const apply = (r: ReturnType<CardDef["fromScan"]>) => {
    if (r.values) setValues((v) => ({ ...v, ...r.values }))
    const text = [r.values ? t("scanned") : "", r.note ? t(r.note, r.noteArg) : ""].filter(Boolean).join(" ")
    setScan({ text })
    if (r.values) toast.success(text)
    else toast.warning(text)
  }
  const onFile = async (file: Blob) => {
    setScan({ text: t("reading"), busy: true })
    try { apply(card.fromScan(await decode(file))) } catch (e) { setScan({ text: errText(e) }) }
  }
  /** Camera frames: stop at the first barcode that means something for this card; keep looking otherwise. */
  const onFrame = (found: Decoded[]) => {
    const r = card.fromScan(found)
    if (!r.values && (!r.note || r.note === "nothingFound")) return false
    apply(r)
    return true
  }

  return (
    <>
      <PageHeader
        back={{ href: "#/cards", label: t("navCards") }}
        title={card.name}
        description={t(card.intro)}
        aside={<CardFace card={card} className="hidden w-44 rotate-3 md:block" />}
      />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Step n={1} /> {t("scanTitle")}</CardTitle>
              <CardDescription>{t("scanDesc")}</CardDescription>
            </CardHeader>
            <CardContent>
              <ScanStep onFile={onFile} onFrame={onFrame} status={scan} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Step n={2} /> {t("detailsTitle")}</CardTitle>
              <CardDescription>{t("detailsDesc")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className={cn("grid gap-4", card.inputs.length > 2 && "sm:grid-cols-2")}>
                {card.inputs.map((i) => {
                  const Field = i.long ? Textarea : Input
                  return (
                    <div key={i.name} className={cn("space-y-1.5", i.long && "sm:col-span-2")}>
                      <Label htmlFor={i.name}>{t(i.label)}</Label>
                      <Field
                        id={i.name}
                        value={values[i.name]}
                        placeholder={i.placeholder}
                        spellCheck={false}
                        autoComplete="off"
                        className={cn(i.mono && "font-mono", i.long && "min-h-16 whitespace-pre")}
                        onChange={(e) => setValues((v) => ({ ...v, [i.name]: e.target.value }))}
                      />
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        <aside className="lg:sticky lg:top-20 lg:self-start">
          <div className="rounded-[1.75rem] border bg-muted/40 p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold">{t("previewTitle")}</h2>
              <Badge variant="secondary">FossWallet 0.52</Badge>
            </div>
            {build.state === "idle" && <Empty />}
            {build.state === "busy" && <div className="h-[420px] animate-pulse rounded-2xl bg-muted" />}
            {build.state === "error" && (
              <p className="flex items-start gap-2 rounded-lg bg-background p-3 text-sm text-muted-foreground">
                <Info className="mt-0.5 size-4 shrink-0" /> {build.message}
              </p>
            )}
            {build.state === "ok" && (
              <div className="space-y-4">
                <Button size="lg" className="w-full" onClick={() => saveFile(build.zip, `${card.id}.pkpass`)}>
                  <Download /> {t("download")}
                </Button>
                {build.warn && <p className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">{build.warn}</p>}
                <PassPreview zip={build.zip} />
              </div>
            )}
          </div>
        </aside>
      </div>
    </>
  )
}

function Step({ n }: { n: number }) {
  return <span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{n}</span>
}

function Empty() {
  return (
    <div className="flex h-[300px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed bg-background/60 p-6 text-center text-sm text-muted-foreground">
      <Sparkles className="size-6 text-primary" />
      {t("previewEmpty")}
    </div>
  )
}
