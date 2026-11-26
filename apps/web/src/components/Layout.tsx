import { useState, type ReactNode } from "react";
import { Menu, ShieldCheck, Sparkles, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, NavLink } from "react-router-dom";
import type { Role } from "@redressa/shared";
import { Button, LanguageToggle, ThemeToggle } from "./ui.js";

export interface MeProfile {
  id: string;
  email: string | null;
  name: string;
  role: Role;
  baseRole: Role;
  userType?: "citizen" | "officer" | "judge" | null;
  roleLocked?: boolean;
  language: "en" | "ta";
  isDemo: boolean;
  demoSessionId: string | null;
  hasSafeWord: boolean;
  maskedPhone: string | null;
}

interface LayoutProps {
  user: MeProfile | null;
  onLogout: () => void;
  onOpenJudge?: () => void;
  children: ReactNode;
}

export function Layout({ user, onLogout, onOpenJudge, children }: LayoutProps) {
  const { t } = useTranslation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const navItems = [
    { to: "/", label: t("nav.home"), show: true },
    {
      to: "/citizen",
      label: "My Petitions",
      show: Boolean(user && (user.role === "citizen" || user.role === "admin"))
    },
    {
      to: "/records",
      label: "Records Index",
      show: Boolean(user)
    },
    {
      to: "/officer",
      label: t("nav.officer"),
      show: Boolean(user && (user.role === "officer" || user.role === "admin"))
    },
    { to: "/dashboard", label: t("nav.dashboard"), show: true },
    {
      to: "/admin",
      label: t("nav.admin"),
      show: Boolean(user && user.role === "admin")
    }
  ].filter((item) => item.show);

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-canvas)] text-[var(--text-primary)]">
      <header className="sticky top-0 z-40 border-b border-[var(--border-hairline)] bg-[var(--bg-header)] backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Link to="/" className="flex items-center gap-2.5 shrink-0">
              <div className="w-9 h-9 rounded-xl bg-[var(--accent)] text-[var(--accent-fg)] flex items-center justify-center shadow-[var(--shadow-sm)]">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div className="flex flex-col">
                <span className="font-display font-bold text-base leading-none tracking-tight">
                  {t("brand")}
                </span>
                <span className="text-[10px] text-[var(--text-muted)] tracking-wide uppercase mt-0.5 hidden sm:block">
                  Closure Integrity
                </span>
              </div>
            </Link>

            <nav className="hidden lg:flex items-center gap-1 ml-4">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/"}
                  className={({ isActive }) =>
                    `px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-[var(--shadow-sm)] border border-[var(--border-hairline)]"
                        : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]"
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-2">
            {user?.role === "judge" && onOpenJudge && (
              <Button size="sm" variant="subtle" onClick={onOpenJudge}>
                <Sparkles className="w-3.5 h-3.5" />
                <span>Judge Walkthrough</span>
              </Button>
            )}

            <LanguageToggle />
            <ThemeToggle />

            {user && (
              <div className="hidden sm:flex items-center gap-2 pl-2 border-l border-[var(--border-hairline)]">
                <div className="text-right leading-tight">
                  <div className="text-xs font-semibold truncate max-w-28">{user.name}</div>
                  <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                    {user.role === "citizen" ? "User" : user.role}
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={onLogout}>
                  Sign out
                </Button>
              </div>
            )}

            <button
              type="button"
              onClick={() => setMobileOpen((prev) => !prev)}
              aria-label="Open navigation menu"
              className="lg:hidden inline-flex items-center justify-center w-9 h-9 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-primary)]"
            >
              {mobileOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {mobileOpen && (
          <div className="lg:hidden border-t border-[var(--border-hairline)] bg-[var(--bg-surface)] px-4 py-4 space-y-3 shadow-[var(--shadow-lg)]">
            <div className="flex flex-col gap-1">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/"}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    `px-3 py-2.5 rounded-xl text-sm font-medium ${
                      isActive
                        ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                        : "text-[var(--text-secondary)]"
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
            {user?.role === "judge" && onOpenJudge && (
              <Button
                size="sm"
                className="w-full"
                onClick={() => {
                  onOpenJudge();
                  setMobileOpen(false);
                }}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Open Judge Walkthrough</span>
              </Button>
            )}
            {user && (
              <div className="pt-2 border-t border-[var(--border-hairline)] flex items-center justify-between">
                <span className="text-xs text-[var(--text-secondary)]">
                  {user.name} ({user.role === "citizen" ? "User" : user.role})
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    onLogout();
                    setMobileOpen(false);
                  }}
                >
                  Sign out
                </Button>
              </div>
            )}
          </div>
        )}
      </header>

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {children}
      </main>

      <footer className="border-t border-[var(--border-hairline)] bg-[var(--bg-surface)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-[var(--text-muted)]">
          <p className="max-w-3xl leading-relaxed">{t("disclaimer")}</p>
          <span className="font-mono-code text-[11px] shrink-0">
            Redressa · DPDP 2023 Aligned
          </span>
        </div>
      </footer>
    </div>
  );
}
