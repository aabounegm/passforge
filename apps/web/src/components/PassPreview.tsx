// Mock of FossWallet's store-card layout (1 CSS px ≈ 1 dp), rendered from the generated .pkpass itself, so it
// doubles as an integrity check: manifest hashes, and the drawn barcode decodes back to the payload.
import { readPkpass, type Field, type PassJson } from "@passforge/core"
import { CheckCircle2, ChevronDown, TriangleAlert } from "lucide-react"
import { useEffect, useState, type CSSProperties, type ReactNode } from "react"
import { render } from "@/barcode"
import type { CardDef } from "@/cards"
import { t } from "@/i18n"
import { asset, cn, errText } from "@/lib/utils"

/** Small card face for tiles and page headers (brand colour, card art, white logo). */
export function CardFace({ card, className, style }: { card: CardDef; className?: string; style?: CSSProperties }) {
  const { color, art, gradient, logo } = card.look
  // The band logo is the pass's own logo (only the parts that need it are whitened, e.g. the 5ka wordmark but not
  // its emblem), so a CSS white silhouette would be wrong.
  const [passLogo, setPassLogo] = useState<string>()
  useEffect(() => {
    if (!art) return
    let url: string | undefined
    card.images().then((f) => {
      const png = f["logo@2x.png"] ?? f["logo.png"]
      if (png) setPassLogo((url = URL.createObjectURL(new Blob([png as BlobPart], { type: "image/png" }))))
    }).catch(() => {})
    return () => { if (url) URL.revokeObjectURL(url) }
  }, [card, art])
  return (
    <div
      className={cn("relative aspect-[1.586] overflow-hidden rounded-xl shadow-md ring-1 ring-black/10", className)}
      style={{ background: gradient ?? color, ...style }}
    >
      {/* Art fills the area above the logo band, like a strip; cards without art show their wordmark there. */}
      <div className="absolute inset-x-0 top-0 bottom-1/4 flex items-center justify-center">
        {art ? (
          <img src={asset("brands/" + art)} alt="" className="size-full object-cover" />
        ) : (
          <img src={asset("brands/" + logo)} alt="" className="w-4/5 brightness-0 invert" />
        )}
      </div>
      <div className="absolute inset-x-0 bottom-0 flex h-1/4 items-center px-[6%]" style={{ background: color }}>
        {passLogo && <img src={passLogo} alt="" className="h-1/2 max-w-[60%] object-contain object-left" />}
      </div>
    </div>
  )
}

interface Parsed {
  pass: PassJson
  names: string[]
  logo?: string
  strip?: string
  bc: Awaited<ReturnType<typeof render>>
}

const url = (files: Record<string, Uint8Array>, base: string) => {
  const png = ["@3x", "@2x", ""].map((s) => files[`${base}${s}.png`]).find(Boolean)
  return png && URL.createObjectURL(new Blob([png as BlobPart], { type: "image/png" }))
}

function FieldView({ f, big }: { f: Field; big?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="fw-label">{f.label}</div>
      <div className={cn("truncate", big ? "text-[28px] leading-tight" : "text-[16px]")}>{String(f.value)}</div>
    </div>
  )
}

export function PassPreview({ zip }: { zip: Uint8Array }) {
  const [p, setP] = useState<Parsed | { error: string }>()
  useEffect(() => {
    let live = true
    const urls: string[] = []
    readPkpass(zip)
      .then(async ({ pass, files }) => {
        const b = pass.barcodes[0]
        const parsed = { pass, names: Object.keys(files).sort(), logo: url(files, "logo"), strip: url(files, "strip"), bc: await render(b.format, b.message) }
        urls.push(...([parsed.logo, parsed.strip].filter(Boolean) as string[]))
        if (live) setP(parsed)
      })
      .catch((e) => live && setP({ error: errText(e) }))
    return () => {
      live = false
      urls.forEach(URL.revokeObjectURL)
    }
  }, [zip])

  if (!p) return <div className="h-[420px] w-[340px] max-w-full animate-pulse rounded-2xl bg-muted" />
  if ("error" in p) return <ul className="text-sm"><Check ok={false}>{p.error}</Check></ul>
  const { pass, bc } = p
  const sc = pass.storeCard ?? {}
  const b = pass.barcodes[0]
  return (
    <div className="space-y-4">
      <div
        className="w-[340px] max-w-full overflow-hidden rounded-2xl shadow-xl ring-1 ring-black/10"
        style={{ background: pass.backgroundColor, color: pass.foregroundColor, ["--fw-label" as string]: pass.labelColor }}
      >
        <div className="flex h-[54px] items-center gap-2 px-3">
          {p.logo && <img src={p.logo} alt="" className="max-h-[38px] max-w-[40%] object-contain" />}
          {pass.logoText && <span className="text-[18px]">{pass.logoText}</span>}
          <div className="ml-auto flex gap-3 text-right">
            {(sc.headerFields ?? []).map((f) => <FieldView key={f.key} f={f} />)}
          </div>
        </div>
        {p.strip && (
          <div className="flex h-[150px] items-center bg-cover bg-center px-3" style={{ backgroundImage: `url(${p.strip})` }}>
            {(sc.primaryFields ?? []).map((f) => <FieldView key={f.key} f={f} big />)}
          </div>
        )}
        <div className="flex flex-wrap gap-5 px-3 py-2.5">
          {[...(sc.secondaryFields ?? []), ...(sc.auxiliaryFields ?? [])].map((f) => <FieldView key={f.key} f={f} />)}
        </div>
        <div className="mx-3 mb-3.5 rounded-lg bg-white p-2.5 text-center text-black">
          <div
            className={cn("mx-auto [&_svg]:size-full", bc.square ? "size-40" : "h-20 w-full")}
            dangerouslySetInnerHTML={{ __html: bc.svg }}
          />
          {b.altText && <div className="mt-1 text-[13px]">{b.altText}</div>}
        </div>
      </div>

      <ul className="space-y-1.5 text-sm">
        <Check ok>{t("checkManifest")}</Check>
        <Check ok={bc.roundTrip}>
          {bc.roundTrip ? t("checkOk") : t("checkFail")} <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs break-all whitespace-pre-wrap">{b.message}</code>
        </Check>
        {bc.drawnAs !== b.format && <Check ok={false}>{t("drawnAsQr")}</Check>}
      </ul>

      {(sc.backFields?.length ?? 0) > 0 && (
        <details className="group rounded-lg border bg-card text-sm">
          <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 font-medium">
            {t("back")} <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
          </summary>
          <dl className="space-y-2 border-t px-3 py-2.5">
            {sc.backFields!.map((f) => (
              <div key={f.key}>
                <dt className="text-xs text-muted-foreground">{f.label}</dt>
                <dd>{String(f.value)}</dd>
              </div>
            ))}
            <div>
              <dt className="text-xs text-muted-foreground">{t("files")}</dt>
              <dd className="font-mono text-xs">{p.names.join(" · ")}</dd>
            </div>
          </dl>
        </details>
      )}
    </div>
  )
}

function Check({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li className="flex list-none items-start gap-2">
      {ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" /> : <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />}
      <span className="min-w-0">{children}</span>
    </li>
  )
}
