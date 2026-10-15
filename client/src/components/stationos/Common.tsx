import type { ReactNode } from "react";
import {
  X,
  ArrowUpRight,
  LoaderCircle,
  Inbox,
  AlertCircle,
  Check,
} from "lucide-react";

const statusNames: Record<string, string> = {
  OPEN: "Açık",
  SUBMITTED: "Teslim edildi",
  IN_REVIEW: "İmza bekliyor",
  ACCEPTED: "Onaylandı",
  ACCEPTED_WITH_PENDING: "Onaylı · banka bekliyor",
  NEEDS_INFO: "Düzeltme gerekli",
  VERIFIED: "Teyitli",
  REJECTED: "Reddedildi",
  PENDING: "Bekliyor",
  PAID: "Ödendi",
  ACTIVE: "Aktif",
  CREDIT_BLOCKED: "Cari limit yetersiz",
  STOCKOUT: "Stok riski",
  READY: "Öneri hazır",
  NO_SUPPLIER: "Toptancı eşleştirin",
  NO_DEMAND: "Satış verisi yetersiz",
  DISABLED: "Bağlantı bekliyor",
};
export function Badge({ status }: { status: string }) {
  const color = ["ACCEPTED", "VERIFIED", "ACTIVE", "READY", "PAID"].includes(
    status
  )
    ? "green"
    : ["REJECTED", "CREDIT_BLOCKED", "STOCKOUT"].includes(status)
      ? "red"
      : [
            "PENDING",
            "SUBMITTED",
            "IN_REVIEW",
            "ACCEPTED_WITH_PENDING",
            "NEEDS_INFO",
          ].includes(status)
        ? "amber"
        : "gray";
  return (
    <span className={`status-pill ${color}`}>
      <i />
      {statusNames[status] || status}
    </span>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function MoneyInput({
  name,
  defaultValue,
  required = true,
}: {
  name: string;
  defaultValue?: string;
  required?: boolean;
}) {
  return (
    <div className="money-input">
      <input
        name={name}
        defaultValue={defaultValue}
        placeholder="0,00"
        inputMode="decimal"
        required={required}
        maxLength={13}
      />
      <span>TL</span>
    </div>
  );
}
export function Modal({
  title,
  subtitle,
  children,
  close,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  close: () => void;
}) {
  return (
    <div
      className="modal-overlay"
      role="presentation"
      onMouseDown={e => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            aria-label="Pencereyi kapat"
            className="icon-button"
            onClick={close}
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
export function Panel({
  title,
  subtitle,
  children,
  action,
  className = "",
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
export function Metric({
  label,
  value,
  detail,
  icon,
  tone = "",
}: {
  label: string;
  value: ReactNode;
  detail: string;
  icon: ReactNode;
  tone?: string;
}) {
  return (
    <div className={`metric ${tone}`}>
      <div className="metric-top">
        <span>{label}</span>
        <div className="metric-icon">{icon}</div>
      </div>
      <strong>{value}</strong>
      <div className="metric-detail">
        <span>{detail}</span>
        <ArrowUpRight size={13} />
      </div>
    </div>
  );
}
export function Empty({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Inbox size={26} />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
export function Notice({
  children,
  warning = false,
}: {
  children: ReactNode;
  warning?: boolean;
}) {
  return (
    <div className={`notice ${warning ? "warning" : ""}`}>
      <AlertCircle size={17} />
      <div>{children}</div>
    </div>
  );
}
export function SubmitButton({
  busy,
  children,
}: {
  busy: boolean;
  children: ReactNode;
}) {
  return (
    <button className="btn primary" type="submit" disabled={busy}>
      {busy ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}
      {children}
    </button>
  );
}
export function fmtDate(date: string | null | undefined, time = true) {
  if (!date) return "—";
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return date;
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    day: "2-digit",
    month: "short",
    ...(time ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(value);
}
export function today() {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "Europe/Istanbul",
  });
}
export function formObject(form: HTMLFormElement) {
  return Object.fromEntries(new FormData(form).entries()) as Record<
    string,
    string
  >;
}
