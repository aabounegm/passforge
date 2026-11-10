type Child = Node | string | false | null | undefined;

/** Tiny DOM builder: h("button", { onclick }, "text"). Attributes starting with "on" become listeners. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, unknown> = {}, ...kids: Child[]) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v as EventListener);
    else if (k in el) (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, String(v));
  }
  el.append(...(kids.filter(Boolean) as (Node | string)[]));
  return el;
}

export function saveFile(data: Uint8Array | Blob, name: string) {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type: "application/vnd.apple.pkpass" });
  const a = h("a", { href: URL.createObjectURL(blob), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
