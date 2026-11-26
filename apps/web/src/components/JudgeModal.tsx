import { useState } from "react";
import {
  ArrowRight,
  Briefcase,
  Check,
  CheckCircle2,
  FileText,
  Paperclip,
  RotateCcw,
  Send,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  UserCheck,
  X
} from "lucide-react";
import { Button, StatusBadge } from "./ui.js";
import { apiFetch, resolveApiUrl, uploadEvidenceFile } from "../lib/api.js";
import { DEMO_TEST_QUERIES } from "../lib/demoQueries.js";

interface ContractView {
  id: string;
  desiredOutcome: string;
  criteria: Array<{ id: string; text: string }>;
  responseRequirements: Array<{ id: string; label: string; description: string }>;
}

interface AttachedItem {
  id: string;
  name: string;
}

interface JudgeModalProps {
  open: boolean;
  onClose: () => void;
}

const STEPS = [
  { id: 1, label: "Student Query", actor: "Student" },
  { id: 2, label: "AI Contract", actor: "Student" },
  { id: 3, label: "Officer Reply", actor: "Officer" },
  { id: 4, label: "Student Review", actor: "Student" },
  { id: 5, label: "Verified Closed", actor: "Done" }
] as const;

export function JudgeModal({ open, onClose }: JudgeModalProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedPresetId, setSelectedPresetId] = useState(DEMO_TEST_QUERIES[1]!.id);
  const [title, setTitle] = useState(DEMO_TEST_QUERIES[1]!.title);
  const [question, setQuestion] = useState(DEMO_TEST_QUERIES[1]!.question);
  const [category, setCategory] = useState(DEMO_TEST_QUERIES[1]!.category);
  const [locationText, setLocationText] = useState(DEMO_TEST_QUERIES[1]!.locationText);

  const [ticketId, setTicketId] = useState<string | null>(null);
  const [ticketStatus, setTicketStatus] = useState("intake_audit");
  const [contract, setContract] = useState<ContractView | null>(null);

  const [replyText, setReplyText] = useState("");
  const [attached, setAttached] = useState<AttachedItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [aiQuestions, setAiQuestions] = useState<string[]>([]);
  const [reopenReason, setReopenReason] = useState<string | null>(null);

  const [approvedReply, setApprovedReply] = useState<string | null>(null);
  const [proofList, setProofList] = useState<Array<{ id: string; mime: string; signedUrl: string }>>([]);
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectInput, setShowRejectInput] = useState(false);

  if (!open) return null;

  const resetAll = () => {
    setStep(1);
    setBusy(false);
    setError(null);
    setTicketId(null);
    setTicketStatus("intake_audit");
    setContract(null);
    setReplyText("");
    setAttached([]);
    setAiQuestions([]);
    setReopenReason(null);
    setApprovedReply(null);
    setProofList([]);
    setRejectReason("");
    setShowRejectInput(false);
  };

  const handleSubmitStudentQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{
        ticket: { id: string; status: string };
        contract: ContractView | null;
      }>("/api/v1/intake", {
        method: "POST",
        body: JSON.stringify({
          title,
          question,
          category,
          location_text: locationText || undefined,
          language: "en"
        })
      });
      setTicketId(res.ticket.id);
      setTicketStatus(res.ticket.status);
      setContract(res.contract);
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit query");
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmContract = async () => {
    if (!ticketId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ ticket: { status: string } }>(
        `/api/v1/intake/${ticketId}/contract/confirm`,
        { method: "POST" }
      );
      setTicketStatus(res.ticket.status);
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to confirm contract");
    } finally {
      setBusy(false);
    }
  };

  const handleOfficerAttach = async (files: FileList | null) => {
    if (!files || !ticketId) return;
    setUploading(true);
    setError(null);
    try {
      const added: AttachedItem[] = [];
      for (const file of Array.from(files)) {
        const res = await uploadEvidenceFile({ file, ticketId });
        added.push({ id: res.evidence.id, name: file.name });
      }
      setAttached((prev) => [...prev, ...added]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Attachment upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleOfficerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticketId || !replyText.trim()) return;
    setBusy(true);
    setError(null);
    setAiQuestions([]);
    try {
      const ids = attached.map((a) => a.id);
      const res = await apiFetch<{
        ticket: { status: string };
        reply: { text: string; returned: number; returnGapsJson: string[] | null };
        compliance: { compliant: boolean; gaps: string[]; follow_up_questions?: string[] };
      }>(`/api/v1/officer/tickets/${ticketId}/reply`, {
        method: "POST",
        body: JSON.stringify({
          text: replyText,
          structured_entries: [],
          evidence_ids: ids,
          claims_resolved: false
        })
      });

      setTicketStatus(res.ticket.status);
      if (res.reply.returned === 1 || !res.compliance.compliant) {
        const qs =
          res.reply.returnGapsJson && res.reply.returnGapsJson.length > 0
            ? res.reply.returnGapsJson
            : [...(res.compliance.gaps ?? []), ...(res.compliance.follow_up_questions ?? [])];
        setAiQuestions(qs);
        return;
      }

      const detail = await apiFetch<{
        evidence: Array<{ id: string; mime: string; signedUrl: string }>;
      }>(`/api/v1/tickets/${ticketId}`);

      setApprovedReply(res.reply.text);
      setProofList(detail.evidence);
      setReopenReason(null);
      setStep(4);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit reply");
    } finally {
      setBusy(false);
    }
  };

  const handleStudentFeedback = async (satisfied: boolean) => {
    if (!ticketId) return;
    setBusy(true);
    setError(null);
    try {
      const reason = satisfied ? "Satisfied" : rejectReason.trim() || "Water pressure still low, issue persists";
      const res = await apiFetch<{ ticket: { status: string } }>(
        `/api/v1/tickets/${ticketId}/feedback`,
        {
          method: "POST",
          body: JSON.stringify({ satisfied, reason })
        }
      );
      setTicketStatus(res.ticket.status);
      if (satisfied) {
        setStep(5);
      } else {
        setReopenReason(reason);
        setShowRejectInput(false);
        setRejectReason("");
        setStep(3);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit feedback");
    } finally {
      setBusy(false);
    }
  };

  const currentActor = STEPS.find((s) => s.id === step)?.actor ?? "Judge";

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto silk-card-elevated p-5 sm:p-6 space-y-5">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border-hairline)] pb-3">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[var(--accent-soft)] text-[var(--accent)] text-xs font-semibold">
              {currentActor === "Officer" ? (
                <Briefcase className="w-3.5 h-3.5" />
              ) : (
                <UserCheck className="w-3.5 h-3.5" />
              )}
              <span>Acting as {currentActor}</span>
            </span>
            <h2 className="text-base sm:text-lg font-bold">Judge Walkthrough</h2>
          </div>

          <div className="flex items-center gap-2">
            {ticketId && <StatusBadge status={ticketStatus} />}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close judge modal"
              className="p-1.5 rounded-lg border border-[var(--border-hairline)] hover:bg-[var(--bg-subtle)] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-5 gap-1.5">
          {STEPS.map((s) => {
            const done = s.id < step || (step === 5 && s.id === 5);
            const active = s.id === step && !(step === 5 && s.id === 5);
            return (
              <div
                key={s.id}
                className={`px-2 py-1.5 rounded-lg border text-center text-[11px] font-medium ${
                  done
                    ? "border-[var(--verified-border)] bg-[var(--verified-bg)] text-[var(--verified-fg)]"
                    : active
                      ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] font-semibold"
                      : "border-[var(--border-hairline)] bg-[var(--bg-subtle)] text-[var(--text-muted)]"
                }`}
              >
                <div className="flex items-center justify-center gap-1">
                  {done && <Check className="w-3 h-3 shrink-0" />}
                  <span className="truncate">{s.label}</span>
                </div>
              </div>
            );
          })}
        </div>

        {error && (
          <div className="p-3 rounded-xl border border-[var(--reopened-border)] bg-[var(--reopened-bg)] text-[var(--reopened-fg)] text-xs">
            {error}
          </div>
        )}

        {step === 1 && (
          <form onSubmit={handleSubmitStudentQuery} className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">
                Step 1: Student raises query (choose demo query or edit)
              </span>
              <div className="flex flex-wrap gap-1.5">
                {DEMO_TEST_QUERIES.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      setSelectedPresetId(preset.id);
                      setTitle(preset.title);
                      setQuestion(preset.question);
                      setCategory(preset.category);
                      setLocationText(preset.locationText);
                    }}
                    className={`px-2.5 py-1 rounded-lg border text-[11px] cursor-pointer ${
                      selectedPresetId === preset.id
                        ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] font-semibold"
                        : "border-[var(--border-hairline)] bg-[var(--bg-subtle)]"
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Subject"
              className="w-full min-h-10 px-3 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-canvas)] text-sm"
              required
            />
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={3}
              placeholder="Question or grievance..."
              className="w-full p-3 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-canvas)] text-sm"
              required
            />
            <div className="grid grid-cols-2 gap-2.5">
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full min-h-10 px-2.5 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-canvas)] text-sm"
              >
                <option value="water">Water</option>
                <option value="transport">Transport</option>
                <option value="roads">Roads &amp; Lights</option>
                <option value="rti">RTI / Info</option>
              </select>
              <input
                value={locationText}
                onChange={(e) => setLocationText(e.target.value)}
                placeholder="Location"
                className="w-full min-h-10 px-3 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-canvas)] text-sm"
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              <span>{busy ? "AI Analyzing Query..." : "Submit Query →"}</span>
            </Button>
          </form>
        )}

        {step === 2 && contract && (
          <div className="space-y-4">
            <div className="silk-subtle p-4 space-y-2.5">
              <div className="text-xs font-semibold uppercase tracking-wider text-[var(--accent)]">
                AI-Generated Expectation Contract
              </div>
              <div className="text-sm font-semibold">{contract.desiredOutcome}</div>
              <ul className="list-disc pl-4 text-xs text-[var(--text-secondary)] space-y-1">
                {contract.responseRequirements.map((r) => (
                  <li key={r.id}>
                    <strong>{r.label}:</strong> {r.description}
                  </li>
                ))}
              </ul>
            </div>

            <Button onClick={() => void handleConfirmContract()} className="w-full" disabled={busy}>
              <span>{busy ? "Filing..." : "Confirm & Switch to Officer"}</span>
              <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        )}

        {step === 3 && (
          <form onSubmit={handleOfficerSubmit} className="space-y-3">
            <div className="silk-subtle p-3 space-y-1 text-xs">
              <div className="font-semibold text-[var(--text-primary)]">{title}</div>
              <div className="text-[var(--text-secondary)]">{question}</div>
            </div>

            {reopenReason && (
              <div className="p-3 rounded-xl border border-[var(--reopened-border)] bg-[var(--reopened-bg)] text-[var(--reopened-fg)] text-xs">
                <strong>Student Not Satisfied:</strong> {reopenReason}
              </div>
            )}

            {aiQuestions.length > 0 && (
              <div className="p-3.5 rounded-xl border border-[var(--disputed-border)] bg-[var(--disputed-bg)] text-[var(--disputed-fg)] space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>AI Intercepted Reply — Answer Needed:</span>
                </div>
                <ul className="list-disc pl-4 text-xs space-y-0.5">
                  {aiQuestions.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setReplyText("Action taken and resolved.")}
                className="px-2.5 py-1 rounded-lg border border-[var(--disputed-border)] bg-[var(--disputed-bg)] text-[var(--disputed-fg)] text-[11px] font-medium cursor-pointer"
              >
                Fill Vague Reply (AI rejects)
              </button>
              <button
                type="button"
                onClick={() => {
                  const matched =
                    DEMO_TEST_QUERIES.find((p) => p.id === selectedPresetId) ?? DEMO_TEST_QUERIES[0]!;
                  setReplyText(matched.sampleCompleteReply);
                }}
                className="px-2.5 py-1 rounded-lg border border-[var(--verified-border)] bg-[var(--verified-bg)] text-[var(--verified-fg)] text-[11px] font-medium cursor-pointer"
              >
                Fill Complete Reply
              </button>
            </div>

            <textarea
              rows={3}
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="Write Officer reply with order/circular numbers & dates..."
              className="w-full p-3 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-canvas)] text-sm"
              required
            />

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center gap-1.5 min-h-9 px-3 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-subtle)] text-xs cursor-pointer">
                  <Paperclip className="w-3.5 h-3.5" />
                  <span>{uploading ? "Uploading..." : "Attach Proof"}</span>
                  <input
                    type="file"
                    multiple
                    accept="image/*,application/pdf,text/plain"
                    className="hidden"
                    onChange={(e) => void handleOfficerAttach(e.target.files)}
                  />
                </label>
                {attached.map((a) => (
                  <span
                    key={a.id}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-hairline)] text-xs"
                  >
                    <span>{a.name}</span>
                    <button
                      type="button"
                      onClick={() => setAttached((prev) => prev.filter((item) => item.id !== a.id))}
                      className="cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>

              <Button type="submit" disabled={busy || uploading}>
                <Send className="w-4 h-4" />
                <span>{busy ? "AI Checking..." : "Submit Reply"}</span>
              </Button>
            </div>
          </form>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <div className="silk-subtle p-4 space-y-2.5">
              <div className="flex items-center justify-between text-xs text-[var(--verified-fg)] font-semibold">
                <span>AI Approved Officer Reply — Sent to Student</span>
              </div>
              <p className="text-sm whitespace-pre-line">{approvedReply}</p>
              {proofList.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {proofList.map((ev) => (
                    <a
                      key={ev.id}
                      href={resolveApiUrl(ev.signedUrl)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-hairline)] text-xs"
                    >
                      <FileText className="w-3.5 h-3.5 text-[var(--accent)]" />
                      <span>Proof ({ev.mime})</span>
                    </a>
                  ))}
                </div>
              )}
            </div>

            <div className="p-4 rounded-xl border border-[var(--accent)] bg-[var(--accent-soft)] space-y-3">
              <div className="text-sm font-bold">Student Check: Is this reply OK for you?</div>
              {!showRejectInput ? (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => void handleStudentFeedback(true)} disabled={busy}>
                    <ThumbsUp className="w-3.5 h-3.5" />
                    <span>Yes, Satisfied</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => setShowRejectInput(true)}
                    disabled={busy}
                  >
                    <ThumbsDown className="w-3.5 h-3.5" />
                    <span>Not Satisfied (Send back to Officer)</span>
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <input
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Why is it not satisfied?"
                    className="w-full min-h-9 px-3 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] text-sm"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => void handleStudentFeedback(false)}
                      disabled={busy}
                    >
                      Confirm &amp; Reopen
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setShowRejectInput(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="p-5 rounded-xl border border-[var(--verified-border)] bg-[var(--verified-bg)] text-[var(--verified-fg)] space-y-4 text-center">
            <CheckCircle2 className="w-10 h-10 mx-auto" />
            <div>
              <h3 className="text-base font-bold">Walkthrough Complete — Verified Closed</h3>
              <p className="text-xs mt-1 opacity-90">
                Student query audited → Expectation Contract locked → Officer reply &amp; proof verified by AI → Student confirmed satisfaction.
              </p>
            </div>
            <div className="flex justify-center gap-2">
              <Button size="sm" variant="secondary" onClick={resetAll}>
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Test Another Case</span>
              </Button>
              <Button size="sm" onClick={onClose}>
                Done
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
