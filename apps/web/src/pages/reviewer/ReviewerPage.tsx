import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Scale, ShieldAlert } from "lucide-react";
import { ActorBadge, Button, Card, StatusBadge } from "../../components/ui.js";
import { apiFetch } from "../../lib/api.js";
import type { MeProfile } from "../../components/Layout.js";

interface AppealEntry {
  appeal: {
    id: string;
    reasons: string[];
    status: string;
    decisionNote: string | null;
    correctedVerdict: string | null;
    createdAt: number;
  };
  verificationCase: {
    id: string;
    verdict: string | null;
    confidence: number | null;
    trigger: string;
  };
  ticket: {
    id: string;
    title: string;
    status: string;
  };
}

interface AgentActionLog {
  id: string;
  kind: string;
  model: string;
  outcome: string;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  ticketTitle: string;
  createdAt: number;
}

export function ReviewerPage({ user }: { user: MeProfile | null }) {
  const [selectedAppealId, setSelectedAppealId] = useState<string | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [correctedVerdict, setCorrectedVerdict] = useState("verified_resolved");

  const { data: appealsRes, refetch: refetchAppeals } = useQuery({
    queryKey: ["review-appeals", user?.id],
    queryFn: () => apiFetch<{ appeals: AppealEntry[] }>("/api/v1/review/appeals"),
    enabled: Boolean(user)
  });

  const { data: actionsRes } = useQuery({
    queryKey: ["review-agent-actions", user?.id],
    queryFn: () => apiFetch<{ actions: AgentActionLog[] }>("/api/v1/review/agent-actions"),
    enabled: Boolean(user)
  });

  const appeals = appealsRes?.appeals ?? [];
  const activeId = selectedAppealId ?? appeals[0]?.appeal.id ?? null;

  const { data: appealDetail, refetch: refetchDetail } = useQuery({
    queryKey: ["review-detail", activeId],
    queryFn: () =>
      apiFetch<{
        appeal: AppealEntry["appeal"];
        ticket: { id: string; title: string; originalQuestion: string; status: string };
        signals: Array<{ id: string; name: string; present: number; detail: string }>;
      }>(`/api/v1/review/${activeId}`),
    enabled: Boolean(activeId)
  });

  const handleDecision = async (status: "upheld" | "corrected") => {
    if (!activeId || !decisionNote.trim()) return;
    await apiFetch(`/api/v1/review/${activeId}/decide`, {
      method: "POST",
      body: JSON.stringify({
        status,
        ...(status === "corrected" ? { corrected_verdict: correctedVerdict } : {}),
        decision_note: decisionNote
      })
    });
    setDecisionNote("");
    await Promise.all([refetchAppeals(), refetchDetail()]);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Independent Reviewer & Audit Console</h1>
          <p className="text-sm text-[var(--text-secondary)]">
            Non-blocking post-decision audit & appeals. Redressa never waits for reviewer approval before acting.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-[var(--bg-surface)] border border-[var(--border-hairline)] shadow-[var(--shadow-sm)]">
          <Scale className="w-3.5 h-3.5 text-[var(--accent)]" />
          <span>Non-Blocking Audit</span>
        </span>
      </div>

      <div className="grid lg:grid-cols-12 gap-6 items-start">
        <Card className="lg:col-span-5 p-4 space-y-2.5">
          <h2 className="text-sm font-semibold px-1">Appeals & Disputed Closures ({appeals.length})</h2>
          {appeals.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)] py-6 text-center">
              No appeal or audit records open yet.
            </p>
          ) : (
            appeals.map((entry) => (
              <button
                key={entry.appeal.id}
                type="button"
                onClick={() => setSelectedAppealId(entry.appeal.id)}
                className={`w-full text-left p-3.5 rounded-xl border transition-all cursor-pointer ${
                  entry.appeal.id === activeId
                    ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                    : "border-[var(--border-hairline)] bg-[var(--bg-subtle)]"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-semibold line-clamp-1">{entry.ticket.title}</span>
                  <StatusBadge status={entry.appeal.status} />
                </div>
                <div className="text-xs text-[var(--text-muted)] mt-1">
                  Verdict: {entry.verificationCase.verdict ?? "pending"} · Trigger:{" "}
                  {entry.verificationCase.trigger}
                </div>
              </button>
            ))
          )}
        </Card>

        <div className="lg:col-span-7 space-y-5">
          {appealDetail ? (
            <Card className="p-5 space-y-4">
              <div className="flex items-start justify-between gap-3 border-b border-[var(--border-hairline)] pb-3">
                <div>
                  <h2 className="text-base font-bold">{appealDetail.ticket.title}</h2>
                  <p className="text-xs text-[var(--text-secondary)] mt-1">
                    {appealDetail.ticket.originalQuestion}
                  </p>
                </div>
                <StatusBadge status={appealDetail.appeal.status} />
              </div>

              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Factual Integrity Signals
                </div>
                <div className="grid sm:grid-cols-2 gap-2">
                  {appealDetail.signals
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

              {appealDetail.appeal.status === "open" ? (
                <div className="silk-subtle p-4 space-y-3">
                  <div className="text-xs font-semibold">Record Audit Decision</div>
                  <textarea
                    rows={2}
                    value={decisionNote}
                    onChange={(e) => setDecisionNote(e.target.value)}
                    placeholder="Enter factual audit rationale..."
                    className="w-full p-2.5 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-canvas)] text-sm"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" onClick={() => void handleDecision("upheld")}>
                      <Check className="w-4 h-4" />
                      <span>Uphold Agent Verdict</span>
                    </Button>
                    <select
                      value={correctedVerdict}
                      onChange={(e) => setCorrectedVerdict(e.target.value)}
                      className="min-h-9 px-2.5 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-canvas)] text-xs"
                    >
                      <option value="verified_resolved">verified_resolved</option>
                      <option value="unverified">unverified</option>
                      <option value="not_resolved">not_resolved</option>
                    </select>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void handleDecision("corrected")}
                    >
                      <ShieldAlert className="w-4 h-4" />
                      <span>Correct Verdict</span>
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="p-3.5 rounded-xl bg-[var(--bg-subtle)] text-xs">
                  <strong>Decision Note:</strong> {appealDetail.appeal.decisionNote}
                </div>
              )}
            </Card>
          ) : (
            <Card className="p-8 text-center text-sm text-[var(--text-muted)]">
              Select an appeal item to inspect integrity signals and audit the agent decision.
            </Card>
          )}

          <Card className="p-5 space-y-3">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">Recent Autonomous Agent Runs</h3>
              <ActorBadge kind="ai" />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[var(--border-hairline)] text-[var(--text-muted)]">
                    <th className="py-2 pr-3">Ticket</th>
                    <th className="py-2 pr-3">Kind</th>
                    <th className="py-2 pr-3">Model</th>
                    <th className="py-2 pr-3">Outcome</th>
                    <th className="py-2 text-right">Latency</th>
                  </tr>
                </thead>
                <tbody>
                  {(actionsRes?.actions ?? []).map((act) => (
                    <tr
                      key={act.id}
                      className="border-b border-[var(--border-hairline)] last:border-0"
                    >
                      <td className="py-2.5 pr-3 font-medium">{act.ticketTitle}</td>
                      <td className="py-2.5 pr-3 font-mono-code">{act.kind}</td>
                      <td className="py-2.5 pr-3 font-mono-code">{act.model}</td>
                      <td className="py-2.5 pr-3">
                        <StatusBadge status={act.outcome} />
                      </td>
                      <td className="py-2.5 text-right tabular-nums">{act.latencyMs} ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
