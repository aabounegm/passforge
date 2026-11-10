import { asset, cn } from "@/lib/utils"

/** The passforge mark (public/favicon.svg): a wallet pass on a violet tile, with a forge spark. */
export function LogoMark({ className }: { className?: string }) {
  return <img src={asset("favicon.svg")} alt="" className={cn("size-8", className)} />
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <LogoMark />
      <span className="text-lg">
        pass<span className="text-primary">forge</span>
      </span>
    </span>
  )
}
