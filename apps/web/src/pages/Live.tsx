// Live cards: only when the update server is configured and the user is signed in via Authentik.
import { zipSync } from "@passforge/core"
import { Download, KeyRound, Loader2, LogIn, LogOut, Plus, RefreshCw, ServerOff, Trash2, Zap } from "lucide-react"
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react"
import { toast } from "sonner"
import { aptekiArt } from "@/art"
import { accessToken, api, liveEnabled, signIn, signOut, userName } from "@/auth"
import { PageHeader } from "@/components/layout"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { t } from "@/i18n"
import { errText, saveFile } from "@/lib/utils"

interface LivePass { serial: string; provider: string; card?: string; status: "ok" | "login_needed" | "error"; updatedAt: string; balance?: number; lastError?: string }
interface Provider { id: string; name: string; sms: boolean }

const ART: Record<string, () => Promise<Record<string, Uint8Array>>> = { aptekiplus: aptekiArt }
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

function LoginForm({ p, serial, onDone }: { p: Provider; serial?: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [token, setToken] = useState("")
  const [phone, setPhone] = useState("")
  const [code, setCode] = useState<string>()
  const run = (fn: () => Promise<void>) => async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try { await fn() } catch (err) { toast.error(errText(err)) } finally { setBusy(false) }
  }
  const tokenForm = (
    <form className="space-y-3" onSubmit={run(async () => {
      const r = await post("/api/passes", { provider: p.id, refreshToken: token.trim(), serial })
      setToken("")
      await finish(p.id, r.serial)
      onDone()
    })}>
      <p className="text-sm text-muted-foreground">{t(`tokenHelp_${p.id}` as never)}</p>
      <div className="flex gap-2">
        <Input value={token} onChange={(e) => setToken(e.target.value)} placeholder="refreshToken" autoComplete="off" spellCheck={false} className="font-mono" />
        <Button disabled={busy || !token.trim()}>{busy ? <Loader2 className="animate-spin" /> : <KeyRound />} {t("liveConnect")}</Button>
      </div>
    </form>
  )
  if (!p.sms) return tokenForm
  return (
    <div className="space-y-4">
      <form className="flex flex-wrap gap-2" onSubmit={run(async () => {
        if (code === undefined) {
          await post(`/api/login/${p.id}/start`, { phone })
          setCode("")
          toast(t("smsSent"))
          return
        }
        const r = await post(`/api/login/${p.id}/verify`, { code, serial })
        await finish(p.id, r.serial)
        onDone()
      })}>
        <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+7 900 000-00-00" autoComplete="tel" className="w-48" />
        {code !== undefined && <Input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="SMS" className="w-28" />}
        <Button disabled={busy}>{busy && <Loader2 className="animate-spin" />} {t("liveConnect")}</Button>
      </form>
      <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">{t("orToken")}</summary><div className="mt-3">{tokenForm}</div></details>
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
      {relogin && provider && <CardContent><LoginForm p={provider} serial={p.serial} onDone={() => { setRelogin(false); onChange() }} /></CardContent>}
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
                <CardContent><LoginForm p={p} onDone={load} /></CardContent>
              </Card>
            ))}
          </section>
        </div>
      )}
    </>
  )
}
