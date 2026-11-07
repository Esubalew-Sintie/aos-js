import { useState, type FormEvent, type ReactNode } from "react";
import { AosError } from "@aos-auth/js";

export function Card(props: { title: string; subtitle?: ReactNode; children?: ReactNode; footer?: ReactNode }) {
  return (
    <div className="aos-card">
      <h1 className="aos-title">{props.title}</h1>
      {props.subtitle ? <p className="aos-subtitle">{props.subtitle}</p> : null}
      {props.children}
      {props.footer ? <div className="aos-footer">{props.footer}</div> : null}
    </div>
  );
}

export function Field(props: {
  label: string; name: string; type?: string; value: string; onChange: (v: string) => void;
  autoComplete?: string; required?: boolean; inputMode?: "numeric" | "email" | "text"; autoFocus?: boolean;
}) {
  return (
    <label className="aos-field">
      <span className="aos-label">{props.label}</span>
      <input
        className="aos-input" name={props.name} type={props.type ?? "text"} value={props.value}
        onChange={(e) => props.onChange(e.target.value)} autoComplete={props.autoComplete}
        required={props.required ?? true} inputMode={props.inputMode} autoFocus={props.autoFocus}
      />
    </label>
  );
}

export function Button(props: { children: ReactNode; busy?: boolean; kind?: "primary" | "secondary" | "link"; onClick?: () => void; type?: "submit" | "button" }) {
  return (
    <button className={`aos-button aos-button-${props.kind ?? "primary"}`} type={props.type ?? (props.onClick ? "button" : "submit")} disabled={props.busy} onClick={props.onClick}>
      {props.busy ? "…" : props.children}
    </button>
  );
}

export function ErrorText({ error }: { error: string }) {
  return error ? <p className="aos-error" role="alert">{error}</p> : null;
}

export function Notice({ children }: { children: ReactNode }) {
  return <p className="aos-notice" role="status">{children}</p>;
}

/** The text to show for an error. The engine's messages are written for people. */
export function messageOf(e: unknown): string {
  if (e instanceof AosError) {
    if (e.code === "rate_limited" && e.details?.retry_after) return `Too many attempts. Try again in ${e.details.retry_after} seconds.`;
    const m = e.message || "Something went wrong.";
    return m.charAt(0).toUpperCase() + m.slice(1) + (/[.!?]$/.test(m) ? "" : ".");
  }
  return "Something went wrong. Check your connection and try again.";
}

/** Form state for one submit action: busy flag, error text, and a wrapped onSubmit. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = (fn: () => Promise<void>) => async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try { await fn(); } catch (err) { setError(messageOf(err)); } finally { setBusy(false); }
  };
  return { busy, error, setError, run };
}
