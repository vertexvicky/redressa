import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { Languages, Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTheme } from "../lib/theme.js";

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "subtle";
  size?: "sm" | "md" | "lg";
}) {
  const base =
    "inline-flex items-center justify-center gap-2 font-medium rounded-xl transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2";

  const sizes = {
    sm: "min-h-9 px-3 text-xs",
    md: "min-h-11 px-4 text-sm",
    lg: "min-h-12 px-6 text-sm"
  };

  const variants = {
    primary:
      "bg-[var(--accent)] text-[var(--accent-fg)] hover:bg-[var(--accent-hover)] shadow-[var(--shadow-sm)]",
    secondary:
      "bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-strong)] hover:bg-[var(--bg-subtle)] shadow-[var(--shadow-sm)]",
    subtle:
      "bg-[var(--accent-soft)] text-[var(--accent)] hover:opacity-90",
    ghost:
      "bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]",
    danger:
      "bg-[var(--reopened-bg)] text-[var(--reopened-fg)] border border-[var(--reopened-border)] hover:opacity-90"
  };

  return (
    <button
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Card({
  elevated = false,
  className = "",
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { elevated?: boolean; children: ReactNode }) {
  return (
    <div
      className={`${elevated ? "silk-card-elevated" : "silk-card"} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  let style =
    "bg-[var(--bg-subtle)] text-[var(--text-secondary)] border-[var(--border-hairline)]";
  let label = status.replace(/_/g, " ");

  if (normalized === "verified_resolved" || normalized === "closed_final" || normalized === "upheld") {
    style = "bg-[var(--verified-bg)] text-[var(--verified-fg)] border-[var(--verified-border)]";
  } else if (normalized === "needs_review" || normalized === "unverified" || normalized === "reply_returned") {
    style = "bg-[var(--disputed-bg)] text-[var(--disputed-fg)] border-[var(--disputed-border)]";
    if (normalized === "needs_review") label = "closure disputed";
    if (normalized === "unverified") label = "withdrawn · unverified";
  } else if (normalized === "not_resolved" || normalized === "reopened") {
    style = "bg-[var(--reopened-bg)] text-[var(--reopened-fg)] border-[var(--reopened-border)]";
  } else if (normalized === "filed" || normalized === "assigned" || normalized === "in_progress") {
    style = "bg-[var(--accent-soft)] text-[var(--accent)] border-transparent";
  }

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border capitalize ${style}`}
    >
      {label}
    </span>
  );
}

export function ActorBadge({ kind }: { kind: "ai" | "simulated" }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold tracking-wide uppercase bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--border-hairline)]">
      {kind === "ai" ? t("aiBadge") : t("simulatedBadge")}
    </span>
  );
}

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label="Toggle theme"
      className="inline-flex items-center gap-1.5 min-h-9 px-3 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] shadow-[var(--shadow-sm)] text-xs font-medium cursor-pointer transition-colors"
    >
      {theme === "light" ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
      <span className="hidden sm:inline">
        {theme === "light" ? t("themeLight") : t("themeDark")}
      </span>
    </button>
  );
}

export function LanguageToggle() {
  const { i18n } = useTranslation();
  const isTamil = i18n.language === "ta";

  const toggle = () => {
    const next = isTamil ? "en" : "ta";
    void i18n.changeLanguage(next);
    localStorage.setItem("redressa_lang", next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle language"
      className="inline-flex items-center gap-1.5 min-h-9 px-3 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] shadow-[var(--shadow-sm)] text-xs font-medium cursor-pointer transition-colors"
    >
      <Languages className="w-3.5 h-3.5" />
      <span>{isTamil ? "தமிழ்" : "EN"}</span>
    </button>
  );
}
