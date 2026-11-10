// Light/dark theme: a "dark" class on <html>, chosen before first paint by the inline script in index.html.
import { useSyncExternalStore } from "react"

export type Theme = "light" | "dark"
const current = (): Theme => (document.documentElement.classList.contains("dark") ? "dark" : "light")

export function setTheme(t: Theme) {
  document.documentElement.classList.toggle("dark", t === "dark")
  localStorage.setItem("passforge.theme", t)
}

const subscribe = (cb: () => void) => {
  const o = new MutationObserver(cb)
  o.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
  return () => o.disconnect()
}
export const useTheme = () => useSyncExternalStore(subscribe, current)
