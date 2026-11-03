import { AlertCircle, CheckCircle2, LoaderCircle, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

export function Loading({ children = "Loading the market…" }: { children?: ReactNode }) {
  return <p className="feedback feedback-loading" role="status"><LoaderCircle size={18} className="spin" aria-hidden="true" />{children}</p>;
}

export function Alert({ children, onRetry, retryDisabled = false, tone = "error" }: {
  children: ReactNode; onRetry?: () => void; retryDisabled?: boolean; tone?: "error" | "success";
}) {
  const Icon = tone === "success" ? CheckCircle2 : AlertCircle;
  return (
    <div className={`feedback feedback-${tone}`} role={tone === "error" ? "alert" : "status"}>
      <Icon size={18} aria-hidden="true" />
      <span>{children}</span>
      {onRetry && <button className="text-button retry-button" onClick={onRetry} type="button" disabled={retryDisabled}><RefreshCw size={15} aria-hidden="true" />Retry</button>}
    </div>
  );
}
