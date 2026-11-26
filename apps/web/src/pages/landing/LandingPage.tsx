import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Briefcase, ShieldCheck, UserCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import type { MeProfile } from "../../components/Layout.js";
import { Button, Card } from "../../components/ui.js";
import { apiFetch } from "../../lib/api.js";
import { isFirebaseConfigured, loginAnonymously, loginWithGoogle } from "../../lib/firebase.js";

interface OverviewMetrics {
  totalTickets: number;
  verifiedResolved: number;
  integrityRate: number;
  repliesReturned: number;
}

export function LandingPage({
  user,
  onAuthChanged,
  onOpenJudge
}: {
  user: MeProfile | null;
  onAuthChanged: () => Promise<void>;
  onOpenJudge: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [judgeBusy, setJudgeBusy] = useState(false);
  const [pickingRole, setPickingRole] = useState<"citizen" | "officer" | "judge" | null>(null);
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

  const handleJudgeGuest = async () => {
    setAuthError(null);
    if (user?.role === "judge") {
      onOpenJudge();
      return;
    }
    setJudgeBusy(true);
    try {
      await loginAnonymously();
      await onAuthChanged();
      onOpenJudge();
    } catch (err) {
      setAuthError(
        err instanceof Error
          ? err.message
          : "Enable Anonymous sign-in or sign in with Google and select Judge."
      );
    } finally {
      setJudgeBusy(false);
    }
  };

  const handleSelectUserType = async (userType: "citizen" | "officer" | "judge") => {
    setAuthError(null);
    setPickingRole(userType);
    try {
      await apiFetch("/api/v1/me", {
        method: "PATCH",
        body: JSON.stringify({ user_type: userType })
      });
      await onAuthChanged();
      if (userType === "judge") {
        onOpenJudge();
      } else {
        navigate(userType === "officer" ? "/officer" : "/citizen");
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Could not save account type");
    } finally {
      setPickingRole(null);
    }
  };

  const needsOnboarding = Boolean(user && !user.userType);

  return (
    <div className="max-w-5xl mx-auto py-8 sm:py-12 space-y-10">
      <div className="grid lg:grid-cols-12 gap-8 items-center">
        <div className="lg:col-span-7 space-y-5">
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--bg-surface)] border border-[var(--border-hairline)] text-xs font-medium text-[var(--text-secondary)]">
            <span className="w-2 h-2 rounded-full bg-[var(--accent)]" />
            <span>Grievance Resolution Integrity</span>
          </span>

          <h1 className="text-3xl sm:text-4xl font-bold leading-tight text-[var(--text-primary)]">
            Accountable grievance closure, verified with proof.
          </h1>

          <p className="text-base text-[var(--text-secondary)] max-w-xl leading-relaxed">
            Define clear response criteria at intake, verify officer replies against submitted evidence, and confirm resolution before closure.
          </p>

          {!isFirebaseConfigured && (
            <div className="p-3 rounded-xl border border-[var(--disputed-border)] bg-[var(--disputed-bg)] text-[var(--disputed-fg)] text-xs">
              Configure Firebase credentials in <span className="font-mono-code">apps/web/.env</span>.
            </div>
          )}

          {authError && (
            <div className="p-3 rounded-xl border border-[var(--reopened-border)] bg-[var(--reopened-bg)] text-[var(--reopened-fg)] text-xs">
              {authError}
            </div>
          )}

          {!user && (
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Button
                size="lg"
                onClick={handleGoogleLogin}
                disabled={busy || judgeBusy || !isFirebaseConfigured}
              >
                <span>{busy ? "Signing in..." : t("loginGoogle")}</span>
                <ArrowRight className="w-4 h-4" />
              </Button>

              <Button
                size="lg"
                variant="secondary"
                onClick={handleJudgeGuest}
                disabled={busy || judgeBusy || !isFirebaseConfigured}
              >
                <ShieldCheck className="w-4 h-4 text-[var(--accent)]" />
                <span>{judgeBusy ? "Loading..." : "Judge Evaluation"}</span>
              </Button>

              <Link
                to="/dashboard"
                className="px-3 py-2 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                Public Ledger →
              </Link>
            </div>
          )}

          {needsOnboarding && (
            <Card elevated className="p-5 space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-[var(--accent)]">
                Account Setup · {user!.name}
              </div>
              <div className="text-sm font-bold">Select your role</div>
              <div className="grid sm:grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={() => void handleSelectUserType("citizen")}
                  disabled={pickingRole !== null}
                  className="p-3.5 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-subtle)] hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] transition-all cursor-pointer text-left space-y-2"
                >
                  <div className="w-8 h-8 rounded-lg bg-[var(--accent)] text-[var(--accent-fg)] flex items-center justify-center">
                    <UserCheck className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold">
                      {pickingRole === "citizen" ? "Saving..." : "Applicant"}
                    </div>
                    <div className="text-xs text-[var(--text-muted)]">File &amp; track tickets</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => void handleSelectUserType("officer")}
                  disabled={pickingRole !== null}
                  className="p-3.5 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-subtle)] hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] transition-all cursor-pointer text-left space-y-2"
                >
                  <div className="w-8 h-8 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-strong)] text-[var(--text-primary)] flex items-center justify-center">
                    <Briefcase className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold">
                      {pickingRole === "officer" ? "Saving..." : "Officer"}
                    </div>
                    <div className="text-xs text-[var(--text-muted)]">Respond &amp; attach proof</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => void handleSelectUserType("judge")}
                  disabled={pickingRole !== null}
                  className="p-3.5 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-subtle)] hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] transition-all cursor-pointer text-left space-y-2"
                >
                  <div className="w-8 h-8 rounded-lg bg-[var(--accent-soft)] text-[var(--accent)] flex items-center justify-center">
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold">
                      {pickingRole === "judge" ? "Saving..." : "Judge"}
                    </div>
                    <div className="text-xs text-[var(--text-muted)]">End-to-end review</div>
                  </div>
                </button>
              </div>
            </Card>
          )}

          {user && !needsOnboarding && (
            <div className="flex flex-wrap items-center gap-3 pt-1">
              {user.role === "judge" ? (
                <Button size="lg" onClick={onOpenJudge}>
                  <ShieldCheck className="w-4 h-4" />
                  <span>Open Judge Evaluation</span>
                </Button>
              ) : (
                <Button
                  size="lg"
                  onClick={() => navigate(user.role === "officer" ? "/officer" : "/citizen")}
                >
                  <span>
                    {user.role === "officer" ? "Open Officer Desk" : "View Previous Filings"}
                  </span>
                  <ArrowRight className="w-4 h-4" />
                </Button>
              )}
            </div>
          )}
        </div>

        <div className="lg:col-span-5">
          <Card elevated className="p-5 grid grid-cols-2 gap-3">
            <div className="silk-subtle p-4">
              <div className="text-xs text-[var(--text-muted)]">Total Filings</div>
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
              <div className="text-xs text-[var(--text-muted)]">Audits Returned</div>
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
