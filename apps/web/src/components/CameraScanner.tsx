// Full-screen live barcode scanner: rear camera -> canvas frames -> zxing, until `onFrame` accepts a result.
// Needs a secure context (HTTPS or localhost), which GitHub Pages provides.
import { Flashlight, Loader2, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { decode, type Decoded } from "@/barcode"
import { Button } from "@/components/ui/button"
import { t } from "@/i18n"
import { errText } from "@/lib/utils"

export const cameraAvailable = () => Boolean(navigator.mediaDevices?.getUserMedia)

const MAX_W = 1280 // decode at most this wide: big enough for PDF417/EAN at arm's length, fast enough in wasm

export function CameraScanner({ onFrame, onClose }: { onFrame: (found: Decoded[]) => boolean; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string>()
  const [ready, setReady] = useState(false)
  const [torch, setTorch] = useState<{ on: boolean; track: MediaStreamTrack }>()
  // Callbacks via refs, so a parent re-render never restarts the camera.
  const accept = useRef(onFrame)
  accept.current = onFrame
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    let stream: MediaStream | undefined
    let stopped = false
    const canvas = document.createElement("canvas")
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!

    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        })
        if (stopped) return stream.getTracks().forEach((tr) => tr.stop())
        const v = video.current!
        v.srcObject = stream
        await v.play()
        setReady(true)
        const track = stream.getVideoTracks()[0]
        if ((track.getCapabilities?.() as { torch?: boolean } | undefined)?.torch) setTorch({ on: false, track })

        while (!stopped) {
          if (v.videoWidth) {
            const s = Math.min(1, MAX_W / v.videoWidth)
            canvas.width = Math.round(v.videoWidth * s)
            canvas.height = Math.round(v.videoHeight * s)
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
            const found = await decode(ctx.getImageData(0, 0, canvas.width, canvas.height))
            if (!stopped && found.length && accept.current(found)) {
              navigator.vibrate?.(60)
              return close.current()
            }
          }
          await new Promise((r) => setTimeout(r, 120))
        }
      } catch (e) {
        if (!stopped) setError(e instanceof DOMException && e.name === "NotAllowedError" ? t("cameraDenied") : t("cameraError", errText(e)))
      }
    })()

    return () => {
      stopped = true
      stream?.getTracks().forEach((tr) => tr.stop())
    }
  }, [])

  // Esc closes, like a dialog.
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && close.current()
    window.addEventListener("keydown", key)
    return () => window.removeEventListener("keydown", key)
  }, [])

  const toggleTorch = async () => {
    if (!torch) return
    await torch.track.applyConstraints({ advanced: [{ torch: !torch.on } as MediaTrackConstraintSet] }).catch(() => {})
    setTorch({ ...torch, on: !torch.on })
  }

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={t("cameraTitle")} className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      <video ref={video} playsInline muted className="absolute inset-0 size-full object-cover" />
      {/* Viewfinder: a clear window with a dimmed surround (the huge shadow) and corner marks. */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
        <div className="relative aspect-[1.586] w-full max-w-md rounded-2xl shadow-[0_0_0_100vmax_rgba(0,0,0,0.55)]">
          {["top-0 left-0 border-t-4 border-l-4 rounded-tl-2xl", "top-0 right-0 border-t-4 border-r-4 rounded-tr-2xl",
            "bottom-0 left-0 border-b-4 border-l-4 rounded-bl-2xl", "right-0 bottom-0 border-r-4 border-b-4 rounded-br-2xl"].map((c) => (
            <span key={c} className={`absolute size-8 border-white ${c}`} />
          ))}
          {ready && <span className="absolute inset-x-6 top-1/2 h-0.5 animate-pulse rounded-full bg-primary shadow-[0_0_12px_2px] shadow-primary" />}
        </div>
      </div>

      <div className="relative flex items-center justify-between p-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <span className="rounded-full bg-black/50 px-3 py-1.5 text-sm font-medium backdrop-blur">{t("cameraTitle")}</span>
        <Button size="icon-lg" variant="secondary" className="rounded-full" onClick={onClose} aria-label={t("close")}><X /></Button>
      </div>

      <div className="relative mt-auto flex flex-col items-center gap-4 p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-center">
        {error ? (
          <p className="max-w-sm rounded-xl bg-black/70 p-4 text-sm">{error}</p>
        ) : ready ? (
          <p className="max-w-sm text-sm text-white/90 drop-shadow">{t("cameraAim")}</p>
        ) : (
          <Loader2 className="size-6 animate-spin" />
        )}
        {torch && (
          <Button variant="secondary" className="rounded-full" onClick={toggleTorch} aria-pressed={torch.on}>
            <Flashlight /> {t("torch")}
          </Button>
        )}
      </div>
    </div>,
    document.body,
  )
}
