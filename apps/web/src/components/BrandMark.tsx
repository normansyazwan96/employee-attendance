import { Clock3 } from "lucide-react";

export function BrandMark({ inverse = false, compact = false }: { inverse?: boolean; compact?: boolean }): JSX.Element {
  return <div className={`brand-lockup ${inverse ? "brand-lockup-inverse" : ""}`} aria-label="attend+">
    <span className="brand-symbol" aria-hidden="true"><Clock3 size={compact ? 17 : 20} strokeWidth={2.2} /></span>
    <span aria-hidden="true" className={compact ? "text-base font-semibold" : "text-lg font-semibold"}>attend<span className="brand-dot">+</span></span>
  </div>;
}
