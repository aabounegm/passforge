// Live cards: only when the update server is configured and the user is signed in via Authentik.
import { zipSync } from "@passforge/core"
import { Download, KeyRound, Loader2, LogIn, LogOut, Phone, Plus, RefreshCw, ServerOff, Trash2, Zap } from "lucide-react"
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react"
import { toast } from "sonner"
import { aptekiArt, magnitArt, x5Art } from "@/art"
import { accessToken, api, liveEnabled, signIn, signOut, userName } from "@/auth"
import { PageHeader } from "@/components/layout"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { t } from "@/i18n"
import { errText, saveFile } from "@/lib/utils"

interface LivePass { serial: string; provider: string; card?: string; status: "ok" | "login_needed" | "error"; updatedAt: string; balance?: number; lastError?: string }
interface Provider { id: string; name: string; paste: "token" | "curl"; phone: boolean }
type Prompt = { kind: "sms"; length: number } | { kind: "call"; number: string }

const ART: Record<string, () => Promise<Record<string, Uint8Array>>> = { aptekiplus: aptekiArt, x5club: x5Art, magnit: magnitArt }
const post = (path: string, body: unknown) =>
  api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json())

async function download(serial: string) {
  saveFile(await (await api(`/api/passes/${serial}/pkpass`)).blob(), `${serial}.pkpass`)
}

/** Uploads the artwork (rendered here; the server has no canvas), then downloads the live pass. */
async function finish(provider: string, serial: string) {
  await api(`/api/passes/${serial}/images`, { method: "PUT", headers: { "Content-Type": "application/zip" }, body: zipSync(await ART[provider]()) as BodyInit })
  await download(serial)
  toast.success(t("liveDone"))
}

type Connected = (serial: string) => Promise<void>

/** Paste a refresh token or a "Copy as cURL (bash)" of the balance request. */
function PasteForm({ p, serial, onConnected }: { p: Provider; serial?: string; onConnected: Connected }) {
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const r = await post("/api/passes", { provider: p.id, paste: text, serial })
      setText("")
      await onConnected(r.serial)
    } catch (err) { toast.error(errText(err)) } finally { setBusy(false) }
  }
  const Field = p.paste === "curl" ? Textarea : Input
  return (
    <form className="space-y-3" onSubmit={submit}>
      <p className="text-sm text-muted-foreground">{t(`pasteHelp_${p.id}` as never)}</p>
      <Field value={text} onChange={(e) => setText(e.target.value)} placeholder={p.paste === "curl" ? "curl 'https://…' -H …" : "refreshToken"}
        autoComplete="off" spellCheck={false} className={p.paste === "curl" ? "h-24 font-mono text-xs" : "font-mono"} />
      <Button disabled={busy || !text.trim()}>{busy ? <Loader2 className="animate-spin" /> : <KeyRound />} {t("liveConnect")}</Button>
    </form>
  )
}

/** Phone login run by the server: the shop either asks for a call from this phone or sends an SMS code. */
function PhoneLogin({ p, serial, onConnected }: { p: Provider; serial?: string; onConnected: Connected }) {
  const [phone, setPhone] = useState("")
  const [prompt, setPrompt] = useState<Prompt>()
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [finishing, setFinishing] = useState(false) // signed in; artwork upload + download still running
  const verify = useCallback(async (c?: string) => {
    const r = await post(`/api/login/${p.id}/verify`, { code: c, serial })
    if (r.serial) {
      setFinishing(true)
      try { await onConnected(r.serial) } finally { setFinishing(false); setPrompt(undefined); setCode("") }
      return
    }
    setPrompt(r.prompt)
    if (r.error) { toast.error(r.error); setCode("") }
  }, [p.id, serial, onConnected])

  // Call verification: ask the server every few seconds whether the shop has seen the call (for up to 3 minutes).
  const calling = prompt?.kind === "call" && !finishing
  useEffect(() => {
    if (!calling) return
    let stop = false, inFlight = false
    const until = Date.now() + 3 * 60_000
    const timer = setInterval(async () => {
      if (stop || inFlight) return
      if (Date.now() > until) { setPrompt(undefined); toast.error(t("liveCallTimeout")); return }
      inFlight = true
      try { await verify() } catch (err) { stop = true; setPrompt(undefined); toast.error(errText(err)) } finally { inFlight = false }
    }, 2500)
    return () => { stop = true; clearInterval(timer) }
  }, [calling, verify])

  const run = (fn: () => Promise<void>) => async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try { await fn() } catch (err) { toast.error(errText(err)) } finally { setBusy(false) }
  }

  if (finishing) {
    return (
      <p className="flex items-center justify-center gap-2 rounded-lg border bg-muted/40 p-4 text-sm" role="status">
        <Loader2 className="size-4 animate-spin" /> {t("livePreparing")}
      </p>
    )
  }
  if (prompt?.kind === "call") {
    return (
      <div className="space-y-3 rounded-lg border bg-muted/40 p-4 text-center">
        <p className="text-sm">{t("liveCallText")}</p>
        <a href={`tel:${prompt.number}`} className="block text-2xl font-semibold tracking-tight text-primary">{prompt.number}</a>
        <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {t("liveWaitingCall")}</p>
        <Button variant="ghost" size="sm" onClick={() => setPrompt(undefined)}>{t("liveCancel")}</Button>
      </div>
    )
  }
  if (prompt?.kind === "sms") {
    return (
      <form className="space-y-3" onSubmit={run(() => verify(code))}>
        <p className="text-sm text-muted-foreground">{t("liveSmsText")}</p>
        <div className="flex gap-2">
          <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} inputMode="numeric" autoComplete="one-time-code"
            maxLength={prompt.length} placeholder={"•".repeat(prompt.length)} className="w-32 text-center font-mono text-lg tracking-widest" autoFocus />
          <Button disabled={busy || code.length !== prompt.length}>{busy && <Loader2 className="animate-spin" />} {t("liveConnect")}</Button>
          <Button type="button" variant="ghost" onClick={() => { setPrompt(undefined); setCode("") }}>{t("liveCancel")}</Button>
        </div>
      </form>
    )
  }
  return (
    <form className="space-y-3" onSubmit={run(async () => setPrompt((await post(`/api/login/${p.id}/start`, { phone })).prompt))}>
      <p className="text-sm text-muted-foreground">{t(`phoneHelp_${p.id}` as never)}</p>
      <div className="flex gap-2">
        <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+7 900 000-00-00" autoComplete="tel" className="w-48" />
        <Button disabled={busy || phone.replace(/\D/g, "").length < 10}>{busy ? <Loader2 className="animate-spin" /> : <Phone />} {t("liveContinue")}</Button>
      </div>
    </form>
  )
}

function ConnectForm({ p, serial, onDone }: { p: Provider; serial?: string; onDone: () => void }) {
  const onConnected = useCallback(async (s: string) => { await finish(p.id, s); onDone() }, [p.id, onDone])
  if (!p.phone) return <PasteForm p={p} serial={serial} onConnected={onConnected} />
  return (
    <div className="space-y-4">
      <PhoneLogin p={p} serial={serial} onConnected={onConnected} />
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">{t("orPaste")}</summary>
        <div className="mt-3"><PasteForm p={p} serial={serial} onConnected={onConnected} /></div>
      </details>
    </div>
  )
}

const STATUS = { ok: "secondary", login_needed: "destructive", error: "outline" } as const

function PassRow({ p, provider, onChange }: { p: LivePass; provider?: Provider; onChange: () => void }) {
  const [relogin, setRelogin] = useState(false)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {provider?.name ?? p.provider} <span className="font-mono text-sm font-normal text-muted-foreground">{p.card}</span>
          <Badge variant={STATUS[p.status]} className="ml-auto">{t(`status_${p.status}`)}</Badge>
        </CardTitle>
        <CardDescription>
          {p.balance !== undefined && <span className="mr-3 text-base font-semibold text-foreground">{p.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>}
          {t("checked")} {new Date(p.updatedAt).toLocaleString()}
          {p.lastError && <span className="mt-1 block text-xs">{p.lastError}</span>}
        </CardDescription>
      </CardHeader>
      {relogin && provider && <CardContent><ConnectForm p={provider} serial={p.serial} onDone={() => { setRelogin(false); onChange() }} /></CardContent>}
      <CardFooter className="flex flex-wrap gap-2 border-t bg-muted/30 py-3">
        <Button variant="outline" size="sm" onClick={() => download(p.serial).catch((e) => toast.error(errText(e)))}><Download /> {t("download")}</Button>
        <Button variant="outline" size="sm" onClick={() => setRelogin(!relogin)}><RefreshCw /> {t("relogin")}</Button>
        <Button variant="destructive" size="sm" className="ml-auto" onClick={async () => {
          if (!confirm(t("confirmDelete"))) return
          await api(`/api/passes/${p.serial}`, { method: "DELETE" }).catch((e) => toast.error(errText(e)))
          onChange()
        }}><Trash2 /> {t("delete")}</Button>
      </CardFooter>
    </Card>
  )
}

function State({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }) {
  return (
    <Card className="mx-auto max-w-lg text-center">
      <CardHeader className="items-center">
        <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">{icon}</div>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{text}</CardDescription>
      </CardHeader>
      {action && <CardContent className="flex justify-center">{action}</CardContent>}
    </Card>
  )
}

export function Live() {
  const [data, setData] = useState<{ passes: LivePass[]; providers: Provider[] } | { error: string }>()
  const load = useCallback(() => {
    Promise.all([
      api("/api/passes").then((r) => r.json() as Promise<LivePass[]>),
      api("/api/providers").then((r) => r.json() as Promise<Provider[]>),
    ]).then(([passes, providers]) => setData({ passes, providers }), (e) => setData({ error: errText(e) }))
  }, [])
  const signedIn = liveEnabled && Boolean(accessToken())
  useEffect(() => { if (signedIn) load() }, [signedIn, load])

  const header = (
    <PageHeader
      back={{ href: "#/", label: "passforge" }}
      title={t("liveTitle")}
      description={t("liveIntro")}
      aside={signedIn && (
        <div className="hidden items-center gap-3 rounded-full border bg-card py-1 pr-1 pl-1 sm:flex">
          <span className="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{(userName() ?? "?")[0].toUpperCase()}</span>
          <span className="text-sm">{userName()}</span>
          <Button variant="ghost" size="icon-sm" onClick={signOut} aria-label={t("signOut")}><LogOut /></Button>
        </div>
      )}
    />
  )
  if (!liveEnabled) return <>{header}<State icon={<ServerOff />} title={t("liveOffTitle")} text={t("liveOff")} /></>
  if (!signedIn) return <>{header}<State icon={<Zap />} title={t("liveSignInTitle")} text={t("liveSignInText")} action={<Button size="lg" onClick={signIn}><LogIn /> {t("signIn")}</Button>} /></>

  return (
    <>
      {header}
      {!data && <div className="h-40 animate-pulse rounded-xl bg-muted" />}
      {data && "error" in data && <State icon={<ServerOff />} title={t("liveErrorTitle")} text={data.error} action={<Button variant="outline" onClick={load}><RefreshCw /> {t("retry")}</Button>} />}
      {data && "passes" in data && (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
          <section className="space-y-4">
            <h2 className="text-xl font-semibold tracking-tight">{t("livePasses")}</h2>
            {data.passes.length === 0 && <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">{t("liveNone")}</p>}
            {data.passes.map((p) => <PassRow key={p.serial} p={p} provider={data.providers.find((x) => x.id === p.provider)} onChange={load} />)}
          </section>
          <section className="space-y-4">
            <h2 className="text-xl font-semibold tracking-tight">{t("liveAdd")}</h2>
            {data.providers.map((p) => (
              <Card key={p.id}>
                <CardHeader><CardTitle className="flex items-center gap-2"><Plus className="size-4" /> {p.name}</CardTitle></CardHeader>
                <CardContent><ConnectForm p={p} onDone={load} /></CardContent>
              </Card>
            ))}
          </section>
        </div>
      )}
    </>
  )
}
