export { cn } from "cn"

export function saveFile(data: Uint8Array | Blob, name: string) {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type: "application/vnd.apple.pkpass" })
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name })
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000)
}

export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))
export const asset = (path: string) => import.meta.env.BASE_URL + path
