import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  BarChart3,
  Briefcase,
  CheckCircle2,
  Database,
  FileCheck2,
  Lock,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  UserCheck,
  Video
} from "lucide-react";
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

  const features = [
    {
      icon: ScanSearch,
      title: "Question Pre-Analysis",
      body: "Analyzes every petition at intake and determines whether a text/record reply suffices or live visual verification is required."
    },
    {
      icon: FileCheck2,
      title: "Aligned Reply Finalization",
      body: "Approves a complete first reply immediately. If gaps exist, sends all follow-up questions at once and composes the final reply once answered."
    },
    {
      icon: Video,
      title: "Live GPS Video Proof",
      body: "Whenever visual proof is needed, static gallery photos are blocked. Citizens record a time-limited live video stamped with GPS coordinates."
    },
    {
      icon: Database,
      title: "Timestamped Reply Index",
      body: "Every finalized petition and answer is full-text indexed with its exact timestamp for fast search and precedent lookup."
    },
    {
      icon: Lock,
      title: "Private Withdrawal Check",
      body: "No phone calls. Withdrawals enter a 48h cooling-off period with private outcome questions officers cannot see."
    },
    {
      icon: BarChart3,
      title: "Public Integrity Ledger",
      body: "Unverified withdrawals never inflate resolved counts—only proven fixes count as Verified Resolved."
    }
  ];

  const workflowSteps = [
    {
      step: "01",
      title: "Ask Your Question",
      body: "Submit a civic or RTI petition—like why express buses skip a hospital stop—with location context."
    },
    {
      step: "02",
      title: "Pre-Analysis Mode",
      body: "The AI determines whether written records or live GPS-verified video proof is needed to confirm the fix."
    },
    {
      step: "03",
      title: "Single-Batch Review",
      body: "Good first replies go straight to you. Incomplete replies trigger one complete follow-up batch, then AI finalizes the answer."
    },
    {
      step: "04",
      title: "Indexed & Protected",
      body: "Finalized replies enter the timestamped search index; any withdrawal goes through a private 48h check."
    }
  ];

  const agentRules = [
    "Checks alignment directly against the petitioner's exact question—vague 'action taken' replies are rejected.",
    "Never drip-feeds questions; returns all missing items and evidence requests in a single structured batch.",
    "Blocks gallery uploads and photos for physical proof; requires time-capped live video with GPS verification.",
    "Never names or blames individuals, never gives legal advice, and never certifies structural safety.",
    "Keeps multi-round video context bounded to a clean 900-character brief and isolates <untrusted_data>.",
    "Keeps withdrawal outcome checks private from officers and marks unresolved withdrawals as Withdrawn · Unverified."
  ];

  return (
    <div className="space-y-16 sm:space-y-20 pb-12">
      <section
        className="rounded-3xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] shadow-[var(--shadow-lg)] px-6 py-10 sm:px-12 sm:py-14"
        style={{ backgroundImage: "var(--bg-hero-glow)" }}
      >
        <div className="grid lg:grid-cols-12 gap-10 items-center">
          <div className="lg:col-span-7 space-y-6">
            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--bg-subtle)] border border-[var(--border-hairline)] text-xs font-medium text-[var(--text-secondary)]">
              <span className="w-2 h-2 rounded-full bg-[var(--accent)]" />
              <span>Citizen-First Petition Verification</span>
            </span>

            <h1 className="text-3xl sm:text-5xl font-bold leading-[1.08] tracking-tight text-[var(--text-primary)]">
              Your question answered completely, or it doesn&rsquo;t close.
            </h1>

            <p className="text-base sm:text-lg text-[var(--text-secondary)] max-w-xl leading-relaxed">
              Redressa evaluates every petition at intake, checks department replies against what you actually asked, requires live GPS-verified video instead of manipulable photos when visual proof is needed, and indexes every finalized reply with timestamps.
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
                        {pickingRole === "citizen" ? "Saving..." : "Petitioner"}
                      </div>
                      <div className="text-xs text-[var(--text-muted)]">Ask &amp; verify answers</div>
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
                      <div className="text-xs text-[var(--text-muted)]">Respond with proof</div>
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
                      <div className="text-xs text-[var(--text-muted)]">End-to-end sandbox</div>
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
                      {user.role === "officer" ? "Open Officer Desk" : "My Petitions"}
                    </span>
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                )}
                <Link
                  to="/records"
                  className="px-3 py-2 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  Records Index →
                </Link>
              </div>
            )}
          </div>

          <div className="lg:col-span-5 space-y-4">
            <Card elevated className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--accent)]">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Live Integrity Ledger</span>
                </div>
                <span className="text-[11px] font-mono-code text-[var(--text-muted)]">
                  Real-time Ground Truth
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="silk-subtle p-4">
                  <div className="text-xs text-[var(--text-muted)]">Total Petitions</div>
                  <div className="text-2xl font-bold tabular-nums mt-1">
                    {overview?.totalTickets ?? 0}
                  </div>
                </div>
                <div className="silk-subtle p-4">
                  <div className="text-xs text-[var(--text-muted)]">Verified Resolved</div>
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
                  <div className="text-xs text-[var(--text-muted)]">Replies Returned</div>
                  <div className="text-2xl font-bold tabular-nums text-[var(--disputed-fg)] mt-1">
                    {overview?.repliesReturned ?? 0}
                  </div>
                </div>
              </div>

              <div className="silk-subtle p-3.5 text-xs text-[var(--text-secondary)] leading-relaxed">
                <span className="font-semibold text-[var(--text-primary)]">Zero fake closures: </span>
                A petition marked withdrawn without independent proof stays recorded as <span className="font-medium">Withdrawn · Unverified</span>, never <span className="font-medium">Verified Resolved</span>.
              </div>
            </Card>
          </div>
        </div>
      </section>

      <section className="space-y-6">
        <div className="max-w-2xl space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--accent)]">
            How It Works
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold text-[var(--text-primary)]">
            Built around the petitioner, not the bureaucracy
          </h2>
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
            Every stage ensures your question receives a complete, aligned answer backed by tamper-resistant evidence.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {workflowSteps.map((item) => (
            <Card key={item.step} className="p-5 space-y-2.5">
              <div className="font-mono-code text-xs font-semibold text-[var(--accent)]">
                {item.step}
              </div>
              <h3 className="text-base font-semibold text-[var(--text-primary)]">{item.title}</h3>
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{item.body}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-6">
        <div className="max-w-2xl space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--accent)]">
            Core Architecture
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold text-[var(--text-primary)]">
            Verification, indexing, and safe withdrawal
          </h2>
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
            Six tightly integrated guarantees replace vague replies, static gallery photos, and pressured phone withdrawals.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map(({ icon: Icon, title, body }) => (
            <Card key={title} className="p-5 space-y-3">
              <div className="w-9 h-9 rounded-xl bg-[var(--accent-soft)] text-[var(--accent)] flex items-center justify-center">
                <Icon className="w-4 h-4" />
              </div>
              <h3 className="text-base font-semibold text-[var(--text-primary)]">{title}</h3>
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{body}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="grid lg:grid-cols-12 gap-6 items-center">
        <div className="lg:col-span-5 space-y-3">
          <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--accent)]">
            <Lock className="w-3.5 h-3.5" />
            <span>AI Agent Rules &amp; Compliance</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold text-[var(--text-primary)]">
            Strict guardrails on every model action
          </h2>
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
            Rules are enforced both in system prompts and programmatically in TypeScript and Zod schemas after every response.
          </p>
        </div>

        <Card elevated className="lg:col-span-7 p-6">
          <ul className="space-y-3">
            {agentRules.map((rule) => (
              <li key={rule} className="flex gap-3 text-sm text-[var(--text-secondary)] leading-relaxed">
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-[var(--verified-fg)]" />
                <span>{rule}</span>
              </li>
            ))}
          </ul>
        </Card>
      </section>
    </div>
  );
}
