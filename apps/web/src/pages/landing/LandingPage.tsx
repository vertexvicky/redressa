import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Briefcase, UserCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import type { MeProfile } from "../../components/Layout.js";
import { Button, Card } from "../../components/ui.js";
import { apiFetch } from "../../lib/api.js";
import { isFirebaseConfigured, loginWithGoogle } from "../../lib/firebase.js";

interface OverviewMetrics {
  totalTickets: number;
  verifiedResolved: number;
  integrityRate: number;
  repliesReturned: number;
}

export function LandingPage({
  user,
  onAuthChanged
}: {
  user: MeProfile | null;
  onAuthChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [pickingRole, setPickingRole] = useState<"citizen" | "officer" | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const { data: overview } = useQuery({
    queryKey: ["public-overview"],
    queryFn: () => apiFetch<OverviewMetrics>("/api/v1/dashboard/overview", { skipAuth: true })
  });

  const handleGoogleLogin = async () => {
    setAuthError(null);
    setBusy(true);
    try {
      await loginWithGoogle();
      await onAuthChanged();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Google sign-in failed");
    } finally {
      setBusy(false);
    }
  };

  const handleSelectRole = async (role: "citizen" | "officer") => {
    setAuthError(null);
    setPickingRole(role);
    try {
      await apiFetch("/api/v1/me", {
        method: "PATCH",
        body: JSON.stringify({ role })
      });
      await onAuthChanged();
      navigate(role === "officer" ? "/officer" : "/citizen");
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Could not switch role");
    } finally {
      setPickingRole(null);
    }
  };

  return (
    <div className="max-w-5xl mx-auto py-6 sm:py-10 space-y-10">
      <div className="grid lg:grid-cols-12 gap-8 items-center">
        <div className="lg:col-span-7 space-y-5">
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--bg-surface)] border border-[var(--border-hairline)] text-xs font-medium text-[var(--text-secondary)]">
            <span className="w-2 h-2 rounded-full bg-[var(--accent)]" />
            <span>AI Grievance Verification</span>
          </span>

          <h1 className="text-3xl sm:text-4xl font-bold leading-tight text-[var(--text-primary)]">
            Verified grievance resolution, not empty closures.
          </h1>

          <p className="text-base text-[var(--text-secondary)] max-w-xl">
            AI defines what a valid answer looks like, audits officer replies &amp; proof, and lets you confirm if your issue is truly solved.
          </p>

          {!isFirebaseConfigured && (
            <div className="p-3 rounded-xl border border-[var(--disputed-border)] bg-[var(--disputed-bg)] text-[var(--disputed-fg)] text-xs">
              Configure Firebase keys in <span className="font-mono-code">apps/web/.env</span>.
            </div>
          )}

          {authError && (
            <div className="p-3 rounded-xl border border-[var(--reopened-border)] bg-[var(--reopened-bg)] text-[var(--reopened-fg)] text-xs">
              {authError}
            </div>
          )}

          {!user ? (
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Button
                size="lg"
                onClick={handleGoogleLogin}
                disabled={busy || !isFirebaseConfigured}
              >
                <span>{busy ? "Signing in..." : t("loginGoogle")}</span>
                <ArrowRight className="w-4 h-4" />
              </Button>

              <Link
                to="/dashboard"
                className="px-4 py-2.5 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                Public Dashboard →
              </Link>
            </div>
          ) : (
            <Card elevated className="p-5 space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-[var(--accent)]">
                Signed in as {user.name}
              </div>
              <div className="text-base font-bold">Continue as</div>
              <div className="grid sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => void handleSelectRole("citizen")}
                  disabled={pickingRole !== null}
                  className="p-4 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-subtle)] hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] transition-all cursor-pointer flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-[var(--accent)] text-[var(--accent-fg)] flex items-center justify-center shrink-0">
                      <UserCheck className="w-4 h-4" />
                    </div>
                    <div className="text-left">
                      <div className="text-sm font-semibold">
                        {pickingRole === "citizen" ? "Opening..." : "User"}
                      </div>
                      <div className="text-xs text-[var(--text-muted)]">File &amp; track cases</div>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-[var(--accent)] shrink-0" />
                </button>

                <button
                  type="button"
                  onClick={() => void handleSelectRole("officer")}
                  disabled={pickingRole !== null}
                  className="p-4 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-subtle)] hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] transition-all cursor-pointer flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-strong)] text-[var(--text-primary)] flex items-center justify-center shrink-0">
                      <Briefcase className="w-4 h-4" />
                    </div>
                    <div className="text-left">
                      <div className="text-sm font-semibold">
                        {pickingRole === "officer" ? "Opening..." : "Officer"}
                      </div>
                      <div className="text-xs text-[var(--text-muted)]">Reply &amp; upload proof</div>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-[var(--accent)] shrink-0" />
                </button>
              </div>
            </Card>
          )}
        </div>

        <div className="lg:col-span-5">
          <Card elevated className="p-5 grid grid-cols-2 gap-3">
            <div className="silk-subtle p-4">
              <div className="text-xs text-[var(--text-muted)]">Cases Filed</div>
              <div className="text-2xl font-bold tabular-nums mt-1">
                {overview?.totalTickets ?? 0}
              </div>
            </div>
            <div className="silk-subtle p-4">
              <div className="text-xs text-[var(--text-muted)]">Verified Closed</div>
              <div className="text-2xl font-bold tabular-nums text-[var(--verified-fg)] mt-1">
                {overview?.verifiedResolved ?? 0}
              </div>
            </div>
            <div className="silk-subtle p-4">
              <div className="text-xs text-[var(--text-muted)]">Integrity Rate</div>
              <div className="text-2xl font-bold tabular-nums mt-1">
                {overview?.integrityRate ?? 100}%
              </div>
            </div>
            <div className="silk-subtle p-4">
              <div className="text-xs text-[var(--text-muted)]">AI Returned</div>
              <div className="text-2xl font-bold tabular-nums text-[var(--disputed-fg)] mt-1">
                {overview?.repliesReturned ?? 0}
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
