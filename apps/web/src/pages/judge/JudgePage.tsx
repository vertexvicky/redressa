import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  Play,
  RefreshCw,
  ShieldCheck,
  UserCheck
} from "lucide-react";
import { Link } from "react-router-dom";
import type { DemoScenario } from "@redressa/shared";
import { ActorBadge, Button, Card, StatusBadge } from "../../components/ui.js";
import { apiFetch } from "../../lib/api.js";
import type { MeProfile } from "../../components/Layout.js";

interface DemoState {
  sessionId: string;
  activeRole: string;
  scenario: DemoScenario;
  takeoverCitizen: boolean;
  takeoverOfficer: boolean;
  primaryTicketId: string | null;
  primaryTicketStatus: string | null;
  departmentId: string | null;
  expiresAt: number;
}

interface TicketDetailResponse {
  ticket: {
    id: string;
    title: string;
    status: string;
    originalQuestion: string;
    escalationLevel: number;
  };
  contract: {
    userIntent: string;
    desiredOutcome: string;
    criteria: Array<{ id: string; text: string; verificationMethod: string }>;
    responseRequirements: Array<{ id: string; label: string; description: string }>;
  } | null;
  replies: Array<{
    id: string;
    text: string;
    returned: number;
    returnGapsJson: string[] | null;
  }>;
  verificationCase: {
    id: string;
    verdict: string | null;
    confidence: number | null;
    reasons: string[] | null;
  } | null;
  signals: Array<{ id: string; name: string; present: number; detail: string }>;
}

const STEPS = [
  {
    num: 1,
    title: "Ask Question & Audit",
    desc: "Redressa audits the GH bus-stop question at submission and creates a binding Expectation Contract."
  },
  {
    num: 2,
    title: "Officer Structured Reply",
    desc: "The officer sees the contract's Response Requirements. Vague replies are autonomously returned."
  },
  {
    num: 3,
    title: "Closure Verification",
    desc: "Pick a scenario below. Redressa checks signals, contacts, proof, and chats with the citizen."
  },
  {
    num: 4,
    title: "Autonomous Verdict",
    desc: "Disputed or unresolved cases are reopened, escalated, and reflected on the Integrity Dashboard."
  }
];

export function JudgePage({
  user,
  onAuthChanged
}: {
  user: MeProfile | null;
  onAuthChanged: () => Promise<void>;
}) {
  const [selectedScenario, setSelectedScenario] = useState<DemoScenario>("pressured_withdrawal");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const { data: stateRes, refetch: refetchState } = useQuery({
    queryKey: ["demo-state", user?.id],
    queryFn: () => apiFetch<{ state: DemoState | null }>("/api/v1/demo/state"),
    enabled: Boolean(user)
  });

  const demoState = stateRes?.state ?? null;

  const { data: ticketDetail, refetch: refetchTicket } = useQuery({
    queryKey: ["demo-ticket-detail", demoState?.primaryTicketId],
    queryFn: () => apiFetch<TicketDetailResponse>(`/api/v1/tickets/${demoState!.primaryTicketId}`),
    enabled: Boolean(demoState?.primaryTicketId)
  });

  const refreshAll = async () => {
    await Promise.all([refetchState(), refetchTicket(), onAuthChanged()]);
  };

  const runAction = async (label: string, fn: () => Promise<unknown>) => {
    setBusyAction(label);
    setFeedback(null);
    try {
      await fn();
      await refreshAll();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusyAction(null);
    }
  };

  const currentStep = !demoState
    ? 1
    : ticketDetail?.verificationCase?.verdict
      ? 4
      : (ticketDetail?.replies.length ?? 0) > 0
        ? 3
        : 2;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Guided Judge Sandbox</h1>
            <ActorBadge kind="simulated" />
          </div>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Real Firebase anonymous session, real D1 database writes, real agent verification loop.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!demoState ? (
            <Button
              onClick={() =>
                runAction("start", () => apiFetch("/api/v1/demo/start", { method: "POST" }))
              }
              disabled={busyAction !== null}
            >
              <Play className="w-4 h-4" />
              <span>{busyAction === "start" ? "Seeding..." : "Start Sandbox"}</span>
            </Button>
          ) : (
            <>
              <Button
                onClick={() =>
                  runAction("autoplay", () =>
                    apiFetch("/api/v1/demo/autoplay", {
                      method: "POST",
                      body: JSON.stringify({ scenario: selectedScenario })
                    })
                  )
                }
                disabled={busyAction !== null}
              >
                <Play className="w-4 h-4" />
                <span>{busyAction === "autoplay" ? "Running..." : "Autoplay Scenario"}</span>
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  runAction("reset", () => apiFetch("/api/v1/demo/reset", { method: "POST" }))
                }
                disabled={busyAction !== null}
              >
                <RefreshCw className="w-4 h-4" />
                <span>Reset Demo</span>
              </Button>
            </>
          )}
        </div>
      </div>

      {feedback && (
        <div className="p-3.5 rounded-xl border border-[var(--reopened-border)] bg-[var(--reopened-bg)] text-[var(--reopened-fg)] text-sm">
          {feedback}
        </div>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {STEPS.map((step) => {
          const active = currentStep === step.num;
          const done = currentStep > step.num;
          return (
            <Card
              key={step.num}
              className={`p-4 space-y-1.5 ${
                active ? "ring-2 ring-[var(--accent)]" : ""
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono-code text-[var(--text-muted)]">
                  STEP 0{step.num}
                </span>
                {done && <CheckCircle2 className="w-4 h-4 text-[var(--verified-fg)]" />}
              </div>
              <div className="text-sm font-semibold">{step.title}</div>
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{step.desc}</p>
            </Card>
          );
        })}
      </div>

      {demoState && (
        <div className="grid lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 space-y-4">
            <Card className="p-5 space-y-4">
              <div>
                <h2 className="text-base font-semibold">Scenario Picker</h2>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  Execute a realistic closure path against the seeded GH Bus Stop case.
                </p>
              </div>

              <div className="space-y-2">
                {(
                  [
                    {
                      id: "genuinely_fixed",
                      title: "A · Genuinely Fixed",
                      desc: "Structured reply + circular + proof photo + unpressured citizen confirmation."
                    },
                    {
                      id: "fake_closure",
                      title: "B · Fake Closure",
                      desc: "Officer submits vague 'Action taken' reply, auto-returned; citizen says buses still skip."
                    },
                    {
                      id: "pressured_withdrawal",
                      title: "C · Pressured Withdrawal",
                      desc: "Department logs outbound phone call; citizen withdraws shortly after while problem persists."
                    }
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedScenario(item.id)}
                    className={`w-full text-left p-3.5 rounded-xl border transition-all cursor-pointer ${
                      selectedScenario === item.id
                        ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                        : "border-[var(--border-hairline)] bg-[var(--bg-subtle)] hover:border-[var(--border-strong)]"
                    }`}
                  >
                    <div className="text-sm font-semibold">{item.title}</div>
                    <div className="text-xs text-[var(--text-secondary)] mt-0.5">{item.desc}</div>
                  </button>
                ))}
              </div>

              <Button
                className="w-full"
                onClick={() =>
                  runAction("scenario", () =>
                    apiFetch("/api/v1/demo/scenario", {
                      method: "POST",
                      body: JSON.stringify({ scenario: selectedScenario })
                    })
                  )
                }
                disabled={busyAction !== null}
              >
                <ShieldCheck className="w-4 h-4" />
                <span>
                  {busyAction === "scenario" ? "Running Verification..." : "Run Selected Scenario"}
                </span>
              </Button>
            </Card>

            <Card className="p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Take Over Controls</h3>
                <UserCheck className="w-4 h-4 text-[var(--text-muted)]" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  size="sm"
                  variant={demoState.takeoverCitizen ? "primary" : "secondary"}
                  onClick={() =>
                    runAction("takeover-citizen", () =>
                      apiFetch("/api/v1/demo/takeover", {
                        method: "POST",
                        body: JSON.stringify({
                          actor: "citizen",
                          enabled: !demoState.takeoverCitizen
                        })
                      })
                    )
                  }
                >
                  {demoState.takeoverCitizen ? "Citizen: Manual" : "Take Over Citizen"}
                </Button>
                <Button
                  size="sm"
                  variant={demoState.takeoverOfficer ? "primary" : "secondary"}
                  onClick={() =>
                    runAction("takeover-officer", () =>
                      apiFetch("/api/v1/demo/takeover", {
                        method: "POST",
                        body: JSON.stringify({
                          actor: "officer",
                          enabled: !demoState.takeoverOfficer
                        })
                      })
                    )
                  }
                >
                  {demoState.takeoverOfficer ? "Officer: Manual" : "Take Over Officer"}
                </Button>
              </div>
              <div className="flex flex-wrap gap-2 pt-2 border-t border-[var(--border-hairline)]">
                <Link to="/citizen" className="text-xs font-medium text-[var(--accent)] hover:underline">
                  Open Citizen View →
                </Link>
                <Link to="/officer" className="text-xs font-medium text-[var(--accent)] hover:underline">
                  Open Officer View →
                </Link>
                <Link to="/reviewer" className="text-xs font-medium text-[var(--accent)] hover:underline">
                  Open Reviewer Audit →
                </Link>
                <Link
                  to={`/dashboard?demo_session_id=${demoState.sessionId}`}
                  className="text-xs font-medium text-[var(--accent)] hover:underline"
                >
                  Open Sandbox Dashboard →
                </Link>
              </div>
            </Card>
          </div>

          <div className="lg:col-span-7 space-y-4">
            {ticketDetail && (
              <Card className="p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-hairline)] pb-3">
                  <div>
                    <span className="text-xs font-mono-code text-[var(--text-muted)]">
                      {ticketDetail.ticket.id.slice(0, 8)}
                    </span>
                    <h2 className="text-base font-semibold">{ticketDetail.ticket.title}</h2>
                  </div>
                  <StatusBadge status={ticketDetail.ticket.status} />
                </div>

                {ticketDetail.contract && (
                  <div className="silk-subtle p-4 space-y-2">
                    <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                      Expectation Contract
                    </div>
                    <p className="text-sm font-medium">{ticketDetail.contract.userIntent}</p>
                    <div className="grid sm:grid-cols-2 gap-3 pt-1">
                      <div>
                        <div className="text-xs font-semibold text-[var(--text-secondary)] mb-1">
                          Success Criteria ({ticketDetail.contract.criteria.length})
                        </div>
                        <ul className="space-y-1 text-xs text-[var(--text-secondary)] list-disc pl-4">
                          {ticketDetail.contract.criteria.map((c) => (
                            <li key={c.id}>{c.text}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-[var(--text-secondary)] mb-1">
                          Officer Response Requirements
                        </div>
                        <ul className="space-y-1 text-xs text-[var(--text-secondary)] list-disc pl-4">
                          {ticketDetail.contract.responseRequirements.map((r) => (
                            <li key={r.id}>{r.label}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                )}

                {ticketDetail.verificationCase && (
                  <div className="p-4 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                        Latest Closure Verdict
                      </span>
                      {ticketDetail.verificationCase.verdict && (
                        <StatusBadge status={ticketDetail.verificationCase.verdict} />
                      )}
                    </div>
                    {ticketDetail.verificationCase.reasons?.map((reason, idx) => (
                      <p key={idx} className="text-sm text-[var(--text-secondary)]">
                        {reason}
                      </p>
                    ))}
                  </div>
                )}

                {ticketDetail.signals.some((s) => s.present === 1) && (
                  <div className="space-y-2">
                    <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                      Triggered Integrity Signals
                    </div>
                    <div className="grid sm:grid-cols-2 gap-2">
                      {ticketDetail.signals
                        .filter((s) => s.present === 1)
                        .map((sig) => (
                          <div
                            key={sig.id}
                            className="p-3 rounded-xl border border-[var(--disputed-border)] bg-[var(--disputed-bg)] text-xs"
                          >
                            <div className="font-mono-code font-semibold text-[var(--disputed-fg)]">
                              {sig.name}
                            </div>
                            <div className="text-[var(--text-secondary)] mt-0.5">{sig.detail}</div>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
