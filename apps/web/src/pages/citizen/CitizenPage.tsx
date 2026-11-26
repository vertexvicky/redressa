import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  FileText,
  Lock,
  MapPin,
  Paperclip,
  Plus,
  ScanSearch,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Upload,
  Video,
  X
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MeProfile } from "../../components/Layout.js";
import {
  SiteVideoInspector,
  type StoredSiteInspectionState
} from "../../components/SiteVideoInspector.js";
import { Button, Card, StatusBadge } from "../../components/ui.js";
import { apiFetch, resolveApiUrl, uploadEvidenceFile } from "../../lib/api.js";
import { DEMO_TEST_QUERIES, type DemoQueryPreset } from "../../lib/demoQueries.js";

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
  complianceJson?: {
    final_reply?: string;
    auto_composed?: boolean;
    rounds?: number;
    finalized_at?: number;
  } | null;
  repliedAt: number;
}

interface WithdrawalRecord {
  id: string;
  reason: string;
  questions: Array<{ id: string; text: string }>;
  answers: Array<{ question_id: string; answer: string; note?: string }> | null;
  ownDecision: string | null;
  outcome: string | null;
  status: string;
  effectiveAt: number;
  finalizedAt: number | null;
}

interface PreAnalysisAudit {
  issue_domain?: string;
  required_proof_mode?: string;
  requires_video_inspection?: boolean;
  pre_analysis_summary?: string;
  requested_footage_shots?: string[];
  siteInspection?: StoredSiteInspectionState;
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
    questionAuditJson?: PreAnalysisAudit | null;
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
  withdrawal: WithdrawalRecord | null;
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
  const [showWithdrawForm, setShowWithdrawForm] = useState(false);
  const [withdrawReason, setWithdrawReason] = useState("");
  const [withdrawAnswers, setWithdrawAnswers] = useState<Record<string, string>>({});
  const [withdrawOwnDecision, setWithdrawOwnDecision] = useState<string>("");
  const [withdrawBusy, setWithdrawBusy] = useState(false);
  const [selectedDemoId, setSelectedDemoId] = useState<string | null>(null);

  const applyDemoPreset = (preset: DemoQueryPreset) => {
    setSelectedDemoId(preset.id);
    setTitle(preset.title);
    setQuestion(preset.question);
    setCategory(preset.category);
    setLocationText(preset.locationText);
    setCoords(null);
    setInitialFile(null);
    setNotice(null);
    setShowNewForm(true);
  };

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

      setSelectedDemoId(null);
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

  const handleRequestWithdrawal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeId || withdrawReason.trim().length < 3) return;
    setWithdrawBusy(true);
    setNotice(null);
    try {
      await apiFetch(`/api/v1/tickets/${activeId}/withdraw`, {
        method: "POST",
        body: JSON.stringify({ reason: withdrawReason.trim() })
      });
      setShowWithdrawForm(false);
      setWithdrawReason("");
      setWithdrawAnswers({});
      setWithdrawOwnDecision("");
      setNotice("48-hour cooling-off started. Complete the private check below (hidden from officers).");
      await Promise.all([refetchDetail(), refetchTimeline()]);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not start withdrawal");
    } finally {
      setWithdrawBusy(false);
    }
  };

  const handleSaveWithdrawalCheck = async (confirmNow: boolean) => {
    if (!activeId || !detail?.withdrawal) return;
    setWithdrawBusy(true);
    setNotice(null);
    try {
      const answers = detail.withdrawal.questions
        .filter((q) => withdrawAnswers[q.id])
        .map((q) => ({ question_id: q.id, answer: withdrawAnswers[q.id]! }));
      await apiFetch(`/api/v1/tickets/${activeId}/withdraw/answers`, {
        method: "POST",
        body: JSON.stringify({
          answers,
          own_decision: withdrawOwnDecision || undefined,
          confirm_now: confirmNow
        })
      });
      setNotice(
        confirmNow
          ? "Withdrawal finalized and recorded on the ledger."
          : "Private check saved. Withdrawal remains in its 48-hour cooling-off window."
      );
      await Promise.all([refetchList(), refetchDetail(), refetchTimeline()]);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not save private check");
    } finally {
      setWithdrawBusy(false);
    }
  };

  const handleCancelWithdrawal = async () => {
    if (!activeId) return;
    setWithdrawBusy(true);
    setNotice(null);
    try {
      await apiFetch(`/api/v1/tickets/${activeId}/withdraw/cancel`, { method: "POST" });
      setNotice("Withdrawal cancelled. Your petition stays open.");
      await Promise.all([refetchDetail(), refetchTimeline()]);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not cancel withdrawal");
    } finally {
      setWithdrawBusy(false);
    }
  };

  const stageIdx = detail ? getStageIndex(detail.ticket.status) : 0;
  const latestAcceptedReply = detail?.replies.find((r) => r.returned === 0) ?? null;
  const latestReturnedReply = detail?.replies[0]?.returned === 1 ? detail.replies[0] : null;
  const officerFiles = detail?.evidence.filter((ev) => ev.uploaderId !== detail.ticket.citizenId) ?? [];
  const citizenFiles = detail?.evidence.filter((ev) => ev.uploaderId === detail.ticket.citizenId) ?? [];
  const preAudit = detail?.contract?.questionAuditJson ?? null;

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

          <div className="silk-subtle p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Default Demo Infos
              </span>
              {selectedDemoId && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedDemoId(null);
                    setTitle("");
                    setQuestion("");
                    setCategory("transport");
                    setLocationText("");
                  }}
                  className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {DEMO_TEST_QUERIES.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyDemoPreset(preset)}
                  className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium cursor-pointer transition-colors ${
                    selectedDemoId === preset.id
                      ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] font-semibold"
                      : "border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
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
                  <option value="construction">Construction &amp; Site Safety</option>
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
          <div className="pt-4 border-t border-[var(--border-hairline)] max-w-xl mx-auto space-y-2.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Or quick-fill with a default demo scenario
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {DEMO_TEST_QUERIES.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyDemoPreset(preset)}
                  className="px-3 py-1.5 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-subtle)] text-xs font-medium text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)] cursor-pointer transition-colors"
                >
                  {preset.label}
                </button>
              ))}
            </div>
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

                {preAudit && (
                  <div className="silk-subtle p-4 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--accent)]">
                        <ScanSearch className="w-3.5 h-3.5" />
                        <span>AI Pre-Analysis</span>
                      </div>
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-primary)]">
                        {preAudit.requires_video_inspection ? (
                          <>
                            <Video className="w-3 h-3 text-[var(--accent)]" />
                            <span>Site Video Inspection</span>
                          </>
                        ) : (
                          <span>
                            {(preAudit.required_proof_mode ?? "photo_or_document").replace(/_/g, " ")}
                          </span>
                        )}
                      </span>
                    </div>
                    {preAudit.pre_analysis_summary && (
                      <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                        {preAudit.pre_analysis_summary}
                      </p>
                    )}
                  </div>
                )}

                {preAudit?.requires_video_inspection && (
                  <SiteVideoInspector
                    ticketId={detail.ticket.id}
                    requestedShots={preAudit.requested_footage_shots ?? []}
                    storedState={preAudit.siteInspection ?? null}
                    onEvaluated={async () => {
                      await Promise.all([refetchDetail(), refetchTimeline()]);
                    }}
                  />
                )}

                {citizenFiles.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                      Your Uploaded Evidence ({citizenFiles.length})
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {citizenFiles.map((ev) => (
                        <a
                          key={ev.id}
                          href={resolveApiUrl(ev.signedUrl)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-hairline)] text-xs hover:border-[var(--border-strong)]"
                        >
                          {ev.mime.startsWith("video/") ? (
                            <Video className="w-3.5 h-3.5 text-[var(--accent)]" />
                          ) : (
                            <FileText className="w-3.5 h-3.5 text-[var(--accent)]" />
                          )}
                          <span>{ev.mime}</span>
                        </a>
                      ))}
                    </div>
                  </div>
                )}

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
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-muted)]">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-[var(--text-primary)]">
                          Finalized Reply
                        </span>
                        {latestAcceptedReply.complianceJson?.auto_composed ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] text-[11px] font-semibold">
                            <Sparkles className="w-3 h-3" />
                            <span>
                              AI Consolidated ({latestAcceptedReply.complianceJson.rounds ?? 2} rounds)
                            </span>
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full bg-[var(--verified-bg)] text-[var(--verified-fg)] border border-[var(--verified-border)] text-[11px] font-medium">
                            Approved Round 1
                          </span>
                        )}
                      </div>
                      <span>{new Date(latestAcceptedReply.repliedAt).toLocaleString()}</span>
                    </div>
                    <p className="text-sm whitespace-pre-line">
                      {latestAcceptedReply.complianceJson?.final_reply || latestAcceptedReply.text}
                    </p>

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

                {detail.withdrawal?.status === "pending" && (
                  <div className="p-4 rounded-xl border border-[var(--disputed-border)] bg-[var(--bg-surface)] space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="space-y-0.5">
                        <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--disputed-fg)]">
                          <Lock className="w-3.5 h-3.5" />
                          <span>Private Withdrawal Check (Hidden from Officers)</span>
                        </div>
                        <p className="text-xs text-[var(--text-secondary)]">
                          No phone calls. Your withdrawal takes effect after a 48-hour cooling-off unless you confirm early.
                        </p>
                      </div>
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[var(--disputed-bg)] text-[var(--disputed-fg)] text-[11px] font-medium">
                        <Clock className="w-3 h-3" />
                        <span>
                          Effective{" "}
                          {Math.max(
                            0,
                            Math.ceil((detail.withdrawal.effectiveAt - Date.now()) / 3_600_000)
                          )}
                          h left
                        </span>
                      </span>
                    </div>

                    <div className="space-y-3">
                      {detail.withdrawal.questions.map((q) => {
                        const existing =
                          withdrawAnswers[q.id] ??
                          detail.withdrawal?.answers?.find((a) => a.question_id === q.id)?.answer ??
                          "";
                        return (
                          <div key={q.id} className="silk-subtle p-3 space-y-2">
                            <div className="text-xs font-medium text-[var(--text-primary)]">
                              {q.text}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {(["yes", "partly", "no"] as const).map((choice) => (
                                <button
                                  key={choice}
                                  type="button"
                                  onClick={() =>
                                    setWithdrawAnswers((prev) => ({ ...prev, [q.id]: choice }))
                                  }
                                  className={`px-3 py-1 rounded-lg text-xs font-medium border capitalize cursor-pointer ${
                                    existing === choice
                                      ? "bg-[var(--accent)] text-[var(--accent-fg)] border-transparent"
                                      : "bg-[var(--bg-surface)] text-[var(--text-secondary)] border-[var(--border-strong)]"
                                  }`}
                                >
                                  {choice}
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="space-y-1.5">
                      <div className="text-xs font-medium text-[var(--text-secondary)]">
                        Optional: was withdrawing your own decision?
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {[
                          { value: "own_decision", label: "My own decision" },
                          { value: "prefer_not_to_say", label: "Prefer not to say" },
                          { value: "need_help", label: "I need help" }
                        ].map((opt) => {
                          const active =
                            (withdrawOwnDecision || detail.withdrawal?.ownDecision) === opt.value;
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => setWithdrawOwnDecision(opt.value)}
                              className={`px-3 py-1 rounded-lg text-xs font-medium border cursor-pointer ${
                                active
                                  ? "bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent)]"
                                  : "bg-[var(--bg-surface)] text-[var(--text-secondary)] border-[var(--border-strong)]"
                              }`}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        size="sm"
                        onClick={() => void handleSaveWithdrawalCheck(false)}
                        disabled={withdrawBusy}
                      >
                        Save Private Check
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void handleSaveWithdrawalCheck(true)}
                        disabled={withdrawBusy}
                      >
                        Confirm Withdrawal Now
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void handleCancelWithdrawal()}
                        disabled={withdrawBusy}
                      >
                        Cancel Withdrawal &amp; Keep Open
                      </Button>
                    </div>
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

                {showWithdrawForm && (
                  <form
                    onSubmit={handleRequestWithdrawal}
                    className="silk-subtle p-4 space-y-2.5 text-xs"
                  >
                    <div className="font-semibold text-[var(--text-primary)]">
                      Request Withdrawal (Private 48h Check)
                    </div>
                    <input
                      value={withdrawReason}
                      onChange={(e) => setWithdrawReason(e.target.value)}
                      placeholder="Briefly state why you want to withdraw..."
                      className="w-full min-h-9 px-3 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] text-sm"
                      required
                    />
                    <div className="flex gap-2">
                      <Button size="sm" type="submit" disabled={withdrawBusy}>
                        Start 48h Withdrawal Check
                      </Button>
                      <Button
                        size="sm"
                        type="button"
                        variant="ghost"
                        onClick={() => setShowWithdrawForm(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </form>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-[var(--border-hairline)]">
                  <div className="flex flex-wrap items-center gap-2">
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
                    {!["verified_resolved", "closed_final", "unverified"].includes(
                      detail.ticket.status
                    ) &&
                      detail.withdrawal?.status !== "pending" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setShowWithdrawForm((prev) => !prev)}
                        >
                          Withdraw Petition
                        </Button>
                      )}
                  </div>

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
