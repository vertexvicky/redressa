import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  FileText,
  MapPin,
  Paperclip,
  Plus,
  ThumbsDown,
  ThumbsUp,
  Upload,
  X
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MeProfile } from "../../components/Layout.js";
import { Button, Card, StatusBadge } from "../../components/ui.js";
import { apiFetch, resolveApiUrl, uploadEvidenceFile } from "../../lib/api.js";

interface TicketSummary {
  id: string;
  title: string;
  status: string;
  category: string;
  severity: string;
  locationText: string | null;
  createdAt: number;
}

interface DepartmentReply {
  id: string;
  text: string;
  returned: number;
  returnGapsJson: string[] | null;
  repliedAt: number;
}

interface TicketDetail {
  ticket: TicketSummary & {
    citizenId: string;
    originalQuestion: string;
  };
  department: { id: string; name: string } | null;
  contract: {
    id: string;
    version: number;
    userIntent: string;
    desiredOutcome: string;
    confirmedByCitizen: number;
    criteria: Array<{ id: string; text: string }>;
    responseRequirements: Array<{ id: string; label: string; description: string }>;
  } | null;
  replies: DepartmentReply[];
  evidence: Array<{
    id: string;
    uploaderId: string;
    mime: string;
    sha256: string;
    aiSummary: string | null;
    signedUrl: string;
  }>;
  verificationCase: {
    id: string;
    reasons: string[] | null;
  } | null;
}

const STAGES = [
  "Submitted",
  "Contract",
  "Assigned",
  "AI Audit",
  "Review",
  "Closed"
] as const;

function getStageIndex(status: string): number {
  switch (status) {
    case "draft":
    case "intake_audit":
      return 0;
    case "awaiting_citizen_confirmation":
      return 1;
    case "filed":
    case "assigned":
    case "in_progress":
    case "reopened":
      return 2;
    case "reply_returned":
      return 3;
    case "department_replied":
    case "closure_claimed":
    case "under_verification":
    case "needs_review":
    case "unverified":
    case "not_resolved":
      return 4;
    case "verified_resolved":
    case "closed_final":
      return 5;
    default:
      return 0;
  }
}

export function CitizenPage({ user }: { user: MeProfile | null }) {
  const { i18n } = useTranslation();
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [filter, setFilter] = useState<"all" | "action" | "closed">("all");
  const [title, setTitle] = useState("");
  const [question, setQuestion] = useState("");
  const [category, setCategory] = useState("transport");
  const [locationText, setLocationText] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [initialFile, setInitialFile] = useState<File | null>(null);
  const [feedbackReason, setFeedbackReason] = useState("");
  const [showRejectBox, setShowRejectBox] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sendingFeedback, setSendingFeedback] = useState(false);

  const { data: ticketListRes, refetch: refetchList, isLoading } = useQuery({
    queryKey: ["citizen-tickets", user?.id],
    queryFn: () => apiFetch<{ tickets: TicketSummary[] }>("/api/v1/tickets"),
    enabled: Boolean(user),
    refetchInterval: 8000
  });

  const ticketsList = ticketListRes?.tickets ?? [];
  const filtered = ticketsList.filter((item) => {
    if (filter === "action") {
      return ["awaiting_citizen_confirmation", "department_replied", "closure_claimed", "under_verification"].includes(item.status);
    }
    if (filter === "closed") {
      return ["verified_resolved", "closed_final"].includes(item.status);
    }
    return true;
  });

  const activeId = selectedTicketId ?? filtered[0]?.id ?? ticketsList[0]?.id ?? null;

  const { data: detail, refetch: refetchDetail } = useQuery({
    queryKey: ["citizen-ticket-detail", activeId],
    queryFn: () => apiFetch<TicketDetail>(`/api/v1/tickets/${activeId}`),
    enabled: Boolean(activeId),
    refetchInterval: 8000
  });

  const { data: timelineRes, refetch: refetchTimeline } = useQuery({
    queryKey: ["citizen-ticket-timeline", activeId],
    queryFn: () =>
      apiFetch<{ events: Array<{ id: string; eventType: string; actorType: string; occurredAt: number }> }>(
        `/api/v1/tickets/${activeId}/timeline`
      ),
    enabled: Boolean(activeId)
  });

  const handleSubmitQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !question.trim()) return;
    setSubmitting(true);
    setNotice(null);
    try {
      const res = await apiFetch<{ ticket: TicketSummary }>("/api/v1/intake", {
        method: "POST",
        body: JSON.stringify({
          title,
          question,
          category,
          location_text: locationText || undefined,
          lat: coords?.lat,
          lng: coords?.lng,
          language: i18n.language === "ta" ? "ta" : "en"
        })
      });

      if (initialFile) {
        try {
          await uploadEvidenceFile({ file: initialFile, ticketId: res.ticket.id });
        } catch {
        }
      }

      setTitle("");
      setQuestion("");
      setLocationText("");
      setInitialFile(null);
      setSelectedTicketId(res.ticket.id);
      setShowNewForm(false);
      await Promise.all([refetchList(), refetchDetail(), refetchTimeline()]);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Failed to submit filing");
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmContract = async () => {
    if (!activeId) return;
    await apiFetch(`/api/v1/intake/${activeId}/contract/confirm`, { method: "POST" });
    setNotice("Filing confirmed and forwarded to the assigned officer.");
    await Promise.all([refetchList(), refetchDetail(), refetchTimeline()]);
  };

  const handleFeedback = async (satisfied: boolean) => {
    if (!activeId) return;
    setSendingFeedback(true);
    setNotice(null);
    try {
      await apiFetch(`/api/v1/tickets/${activeId}/feedback`, {
        method: "POST",
        body: JSON.stringify({
          satisfied,
          reason: satisfied ? "Satisfied" : feedbackReason.trim() || "Not satisfied with reply"
        })
      });
      setFeedbackReason("");
      setShowRejectBox(false);
      setNotice(satisfied ? "Ticket marked Verified Closed." : "Ticket reopened and returned to Officer.");
      await Promise.all([refetchList(), refetchDetail(), refetchTimeline()]);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Failed to submit response");
    } finally {
      setSendingFeedback(false);
    }
  };

  const handleUploadOptional = async (file: File | undefined) => {
    if (!file || !activeId) return;
    await uploadEvidenceFile({ file, ticketId: activeId });
    setNotice("Attachment added.");
    await refetchDetail();
  };

  const stageIdx = detail ? getStageIndex(detail.ticket.status) : 0;
  const latestAcceptedReply = detail?.replies.find((r) => r.returned === 0) ?? null;
  const latestReturnedReply = detail?.replies[0]?.returned === 1 ? detail.replies[0] : null;
  const officerFiles = detail?.evidence.filter((ev) => ev.uploaderId !== detail.ticket.citizenId) ?? [];

  const canReviewSatisfaction =
    Boolean(detail) &&
    Boolean(latestAcceptedReply) &&
    ["department_replied", "closure_claimed", "under_verification", "needs_review", "unverified"].includes(
      detail!.ticket.status
    );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border-hairline)] pb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Previous Filings</h1>
          <p className="text-xs sm:text-sm text-[var(--text-secondary)] mt-0.5">
            Track status across every stage or submit a new ticket.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {!showNewForm && ticketsList.length > 0 && (
            <div className="hidden sm:flex items-center gap-1 p-1 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-hairline)] text-xs">
              {(["all", "action", "closed"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setFilter(tab)}
                  className={`px-3 py-1 rounded-lg capitalize cursor-pointer transition-colors ${
                    filter === tab
                      ? "bg-[var(--bg-surface)] text-[var(--text-primary)] font-semibold shadow-[var(--shadow-sm)]"
                      : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {tab === "action" ? "Needs Review" : tab}
                </button>
              ))}
            </div>
          )}

          {showNewForm ? (
            <Button size="sm" variant="secondary" onClick={() => setShowNewForm(false)}>
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Filings</span>
            </Button>
          ) : (
            <Button onClick={() => setShowNewForm(true)}>
              <Plus className="w-4 h-4" />
              <span>New Ticket</span>
            </Button>
          )}
        </div>
      </div>

      {notice && (
        <div className="px-4 py-3 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-surface)] shadow-[var(--shadow-sm)] text-sm">
          {notice}
        </div>
      )}

      {showNewForm ? (
        <Card elevated className="p-6 max-w-2xl mx-auto space-y-5">
          <div className="border-b border-[var(--border-hairline)] pb-3">
            <h2 className="text-lg font-bold">New Grievance / Query Filing</h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Provide clear details so the system can define required proof criteria.
            </p>
          </div>

          <form onSubmit={handleSubmitQuestion} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Subject
              </label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Brief title of your issue or request"
                className="w-full min-h-10 px-3 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-canvas)] text-sm"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Details / Question
              </label>
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                rows={4}
                placeholder="State the issue, dates, location, and exact resolution or record requested..."
                className="w-full p-3 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-canvas)] text-sm"
                required
              />
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  Category
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full min-h-10 px-2.5 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-canvas)] text-sm"
                >
                  <option value="transport">Public Transport</option>
                  <option value="water">Water &amp; Sanitation</option>
                  <option value="roads">Roads &amp; Infrastructure</option>
                  <option value="health">Healthcare</option>
                  <option value="rti">RTI / Public Records</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  Location / Office
                </label>
                <div className="flex gap-1.5">
                  <input
                    value={locationText}
                    onChange={(e) => setLocationText(e.target.value)}
                    placeholder="Area, ward, or department"
                    className="w-full min-h-10 px-3 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-canvas)] text-sm"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      navigator.geolocation?.getCurrentPosition((pos) => {
                        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
                        if (!locationText) {
                          setLocationText(`${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`);
                        }
                      })
                    }
                    title="Attach coordinates"
                  >
                    <MapPin className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 pt-1">
              <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-subtle)] text-xs font-medium cursor-pointer hover:opacity-90">
                <Paperclip className="w-3.5 h-3.5" />
                <span>{initialFile ? initialFile.name : "Attach supporting document (optional)"}</span>
                <input
                  type="file"
                  accept="image/*,application/pdf,text/plain"
                  className="hidden"
                  onChange={(e) => setInitialFile(e.target.files?.[0] ?? null)}
                />
              </label>
              {initialFile && (
                <button
                  type="button"
                  onClick={() => setInitialFile(null)}
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--reopened-fg)] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border-hairline)]">
              <Button type="button" variant="ghost" onClick={() => setShowNewForm(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Submitting..." : "Submit Ticket"}
              </Button>
            </div>
          </form>
        </Card>
      ) : !isLoading && ticketsList.length === 0 ? (
        <Card className="p-12 text-center space-y-4">
          <div className="space-y-1">
            <h2 className="text-base font-semibold">No filings yet</h2>
            <p className="text-sm text-[var(--text-muted)]">
              Submit your first grievance or information request to begin tracking.
            </p>
          </div>
          <div>
            <Button onClick={() => setShowNewForm(true)}>
              <Plus className="w-4 h-4" />
              <span>New Ticket</span>
            </Button>
          </div>
        </Card>
      ) : (
        <div className="grid lg:grid-cols-12 gap-6 items-start">
          <Card className="lg:col-span-4 p-3 space-y-2">
            <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Filings ({filtered.length})
            </div>
            <div className="space-y-1.5 max-h-[600px] overflow-y-auto">
              {filtered.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedTicketId(item.id)}
                  className={`w-full text-left p-3.5 rounded-xl border transition-all cursor-pointer ${
                    item.id === activeId
                      ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                      : "border-[var(--border-hairline)] bg-[var(--bg-subtle)] hover:border-[var(--border-strong)]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-semibold line-clamp-1">{item.title}</span>
                    <StatusBadge status={item.status} />
                  </div>
                  <div className="text-[11px] text-[var(--text-muted)] mt-1.5 flex items-center justify-between">
                    <span>Stage {getStageIndex(item.status) + 1} of {STAGES.length}</span>
                    <span className="font-mono-code">
                      {new Date(item.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </Card>

          <div className="lg:col-span-8 space-y-4">
            {detail ? (
              <Card elevated className="p-6 space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border-hairline)] pb-4">
                  <div className="space-y-1">
                    <div className="text-xs font-mono-code text-[var(--text-muted)]">
                      Ticket #{detail.ticket.id.slice(0, 8)}
                      {detail.department ? ` · ${detail.department.name}` : ""}
                    </div>
                    <h2 className="text-lg font-bold">{detail.ticket.title}</h2>
                    <p className="text-sm text-[var(--text-secondary)]">
                      {detail.ticket.originalQuestion}
                    </p>
                  </div>
                  <StatusBadge status={detail.ticket.status} />
                </div>

                <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
                  {STAGES.map((label, idx) => {
                    const done = idx < stageIdx || (idx === 5 && stageIdx === 5);
                    const current = idx === stageIdx && !(idx === 5 && stageIdx === 5);
                    return (
                      <div
                        key={label}
                        className={`px-2 py-2 rounded-lg border text-center text-[11px] font-medium ${
                          done
                            ? "border-[var(--verified-border)] bg-[var(--verified-bg)] text-[var(--verified-fg)]"
                            : current
                              ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] font-semibold"
                              : "border-[var(--border-hairline)] bg-[var(--bg-subtle)] text-[var(--text-muted)]"
                        }`}
                      >
                        <div className="flex items-center justify-center gap-1">
                          {done && <Check className="w-3 h-3 shrink-0" />}
                          <span className="truncate">{label}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {detail.contract && (
                  <div className="silk-subtle p-4 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="space-y-0.5">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--accent)]">
                          Expectation Contract
                        </div>
                        <div className="text-sm font-medium">{detail.contract.desiredOutcome}</div>
                      </div>
                      {detail.contract.confirmedByCitizen === 0 &&
                      detail.ticket.status === "awaiting_citizen_confirmation" ? (
                        <Button size="sm" onClick={handleConfirmContract}>
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Confirm &amp; File</span>
                        </Button>
                      ) : (
                        <span className="text-xs font-semibold text-[var(--verified-fg)]">
                          Confirmed ✓
                        </span>
                      )}
                    </div>

                    <details className="text-xs text-[var(--text-secondary)]">
                      <summary className="cursor-pointer font-medium text-[var(--text-muted)] inline-flex items-center gap-1">
                        <ChevronDown className="w-3.5 h-3.5" />
                        <span>Required Officer Deliverables ({detail.contract.responseRequirements.length})</span>
                      </summary>
                      <ul className="list-disc pl-5 mt-2 space-y-1">
                        {detail.contract.responseRequirements.map((rq) => (
                          <li key={rq.id}>
                            <strong>{rq.label}:</strong> {rq.description}
                          </li>
                        ))}
                      </ul>
                    </details>
                  </div>
                )}

                {latestReturnedReply && (
                  <div className="p-4 rounded-xl border border-[var(--disputed-border)] bg-[var(--disputed-bg)] text-[var(--disputed-fg)] text-xs space-y-1">
                    <div className="font-semibold">
                      System audit returned the officer&rsquo;s initial reply for missing documentation
                    </div>
                    <ul className="list-disc pl-4 space-y-0.5">
                      {(latestReturnedReply.returnGapsJson ?? []).map((g, i) => (
                        <li key={i}>{g}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {latestAcceptedReply && (
                  <div className="p-4 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-subtle)] space-y-3">
                    <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                      <span className="font-semibold text-[var(--text-primary)]">Official Reply</span>
                      <span>{new Date(latestAcceptedReply.repliedAt).toLocaleString()}</span>
                    </div>
                    <p className="text-sm whitespace-pre-line">{latestAcceptedReply.text}</p>

                    {officerFiles.length > 0 && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {officerFiles.map((ev) => (
                          <a
                            key={ev.id}
                            href={resolveApiUrl(ev.signedUrl)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-hairline)] text-xs hover:border-[var(--border-strong)]"
                          >
                            <FileText className="w-3.5 h-3.5 text-[var(--accent)]" />
                            <span>Attached Proof ({ev.mime})</span>
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {canReviewSatisfaction && (
                  <div className="p-4 rounded-xl border border-[var(--accent)] bg-[var(--accent-soft)] space-y-3">
                    <div className="text-sm font-bold">
                      Does this reply satisfy your request?
                    </div>
                    {!showRejectBox ? (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          onClick={() => void handleFeedback(true)}
                          disabled={sendingFeedback}
                        >
                          <ThumbsUp className="w-3.5 h-3.5" />
                          <span>Yes, Satisfied</span>
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => setShowRejectBox(true)}
                          disabled={sendingFeedback}
                        >
                          <ThumbsDown className="w-3.5 h-3.5" />
                          <span>Not Satisfied</span>
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <input
                          value={feedbackReason}
                          onChange={(e) => setFeedbackReason(e.target.value)}
                          placeholder="Specify what remains unresolved..."
                          className="w-full min-h-9 px-3 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] text-sm"
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => void handleFeedback(false)}
                            disabled={sendingFeedback}
                          >
                            Reopen Ticket
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setShowRejectBox(false)}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {["verified_resolved", "closed_final"].includes(detail.ticket.status) && (
                  <div className="p-3.5 rounded-xl border border-[var(--verified-border)] bg-[var(--verified-bg)] text-[var(--verified-fg)] text-xs flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>Verified Closed — marked satisfied by you.</span>
                  </div>
                )}

                {detail.ticket.status === "reopened" && (
                  <div className="p-3.5 rounded-xl border border-[var(--reopened-border)] bg-[var(--reopened-bg)] text-[var(--reopened-fg)] text-xs flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>Reopened: {detail.verificationCase?.reasons?.[0] || "Returned for officer follow-up"}</span>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-[var(--border-hairline)]">
                  <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] text-xs font-medium cursor-pointer hover:bg-[var(--bg-subtle)]">
                    <Upload className="w-3.5 h-3.5" />
                    <span>Add Attachment</span>
                    <input
                      type="file"
                      accept="image/*,application/pdf,text/plain"
                      className="hidden"
                      onChange={(e) => void handleUploadOptional(e.target.files?.[0])}
                    />
                  </label>

                  <details className="text-xs text-[var(--text-muted)]">
                    <summary className="cursor-pointer">
                      Status History ({timelineRes?.events.length ?? 0})
                    </summary>
                    <div className="mt-2 space-y-1">
                      {(timelineRes?.events ?? []).map((ev) => (
                        <div key={ev.id} className="flex justify-between gap-4">
                          <span className="capitalize">{ev.eventType.replace(/_/g, " ")}</span>
                          <span className="font-mono-code">
                            {new Date(ev.occurredAt).toLocaleTimeString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              </Card>
            ) : (
              <Card className="p-10 text-center text-sm text-[var(--text-muted)]">
                Select a filing to view its status and replies.
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
