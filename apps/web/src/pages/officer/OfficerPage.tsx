import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  FileText,
  Paperclip,
  Send,
  Video,
  X
} from "lucide-react";
import type { MeProfile } from "../../components/Layout.js";
import { Button, Card, StatusBadge } from "../../components/ui.js";
import { apiFetch, resolveApiUrl, uploadEvidenceFile } from "../../lib/api.js";
import { DEMO_TEST_QUERIES } from "../../lib/demoQueries.js";

interface OfficerTicket {
  id: string;
  citizenId: string;
  title: string;
  status: string;
  locationText: string | null;
  createdAt: number;
}

interface OfficerDetail {
  ticket: OfficerTicket & { originalQuestion: string };
  contract: {
    desiredOutcome: string;
    questionAuditJson?: {
      requires_video_inspection?: boolean;
      siteInspection?: {
        latest?: {
          assessment: string;
          confidence: number;
          summary: string;
          status_update: string;
          urgent_hazard: boolean;
        } | null;
      };
    } | null;
    responseRequirements: Array<{
      id: string;
      label: string;
      description: string;
    }>;
  } | null;
  replies: Array<{
    id: string;
    text: string;
    returned: number;
    returnGapsJson: string[] | null;
  }>;
  evidence: Array<{
    id: string;
    uploaderId: string;
    mime: string;
    signedUrl: string;
  }>;
  verificationCase: {
    reasons: string[] | null;
  } | null;
}

interface AttachedFile {
  id: string;
  name: string;
}

export function OfficerPage({ user }: { user: MeProfile | null }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<{ kind: "success" | "warning" | "error"; text: string } | null>(null);

  const { data: listRes, refetch: refetchList } = useQuery({
    queryKey: ["officer-tickets", user?.id],
    queryFn: () => apiFetch<{ tickets: OfficerTicket[] }>("/api/v1/officer/tickets"),
    enabled: Boolean(user),
    refetchInterval: 8000
  });

  const ticketsList = listRes?.tickets ?? [];
  const activeId = selectedId ?? ticketsList[0]?.id ?? null;

  const { data: detail, refetch: refetchDetail } = useQuery({
    queryKey: ["officer-ticket-detail", activeId],
    queryFn: () => apiFetch<OfficerDetail>(`/api/v1/officer/tickets/${activeId}`),
    enabled: Boolean(activeId),
    refetchInterval: 8000
  });

  const handleSelect = (id: string) => {
    setSelectedId(id);
    setBanner(null);
    setReplyText("");
    setFieldValues({});
    setAttachedFiles([]);
  };

  const handleAttach = async (files: FileList | null) => {
    if (!files || !activeId) return;
    setUploading(true);
    setBanner(null);
    try {
      const added: AttachedFile[] = [];
      for (const file of Array.from(files)) {
        const res = await uploadEvidenceFile({ file, ticketId: activeId });
        added.push({ id: res.evidence.id, name: file.name });
      }
      setAttachedFiles((prev) => [...prev, ...added]);
      await refetchDetail();
    } catch (err) {
      setBanner({ kind: "error", text: err instanceof Error ? err.message : "Upload failed" });
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeId) return;
    setBanner(null);
    setSubmitting(true);

    const reqs = detail?.contract?.responseRequirements ?? [];
    const ids = attachedFiles.map((f) => f.id);
    const structuredEntries = reqs
      .filter((rq) => (fieldValues[rq.id] ?? "").trim())
      .map((rq, idx) => ({
        requirement_id: rq.id,
        label: rq.label,
        value: fieldValues[rq.id] ?? "",
        evidence_ids: idx === 0 ? ids : []
      }));

    const text =
      replyText.trim() ||
      structuredEntries.map((entry) => `${entry.label}: ${entry.value}`).join("\n");

    if (!text) {
      setSubmitting(false);
      setBanner({ kind: "error", text: "Enter a reply before submitting." });
      return;
    }

    try {
      const res = await apiFetch<{
        reply: { returned: number };
        compliance: { compliant: boolean };
      }>(`/api/v1/officer/tickets/${activeId}/reply`, {
        method: "POST",
        body: JSON.stringify({
          text,
          structured_entries: structuredEntries,
          evidence_ids: ids,
          claims_resolved: false
        })
      });

      if (res.reply.returned === 1 || !res.compliance.compliant) {
        setBanner({
          kind: "warning",
          text: "Verification requires additional proof or clarification. Review the questions below."
        });
      } else {
        setBanner({
          kind: "success",
          text: "Reply verified and sent to the applicant for final confirmation."
        });
        setReplyText("");
        setFieldValues({});
        setAttachedFiles([]);
      }
      await Promise.all([refetchDetail(), refetchList()]);
    } catch (err) {
      setBanner({ kind: "error", text: err instanceof Error ? err.message : "Submit failed" });
    } finally {
      setSubmitting(false);
    }
  };

  const latestReturned = detail?.replies[0]?.returned === 1 ? detail.replies[0] : null;
  const citizenFiles = detail?.evidence.filter((ev) => ev.uploaderId === detail.ticket.citizenId) ?? [];
  const matchingDemo = detail
    ? DEMO_TEST_QUERIES.find(
        (preset) => preset.title.trim().toLowerCase() === detail.ticket.title.trim().toLowerCase()
      ) ?? null
    : null;

  const buildCompleteDemoReply = () => {
    if (matchingDemo) {
      return matchingDemo.sampleCompleteReply;
    }
    const reqs = detail?.contract?.responseRequirements ?? [];
    if (reqs.length > 0) {
      const details = reqs
        .map((req, idx) => `${req.label}: Verified Ref #RD-2026-${410 + idx} on 26 Nov 2026`)
        .join(". ");
      return `Official inspection and corrective action completed for "${detail?.ticket.title ?? "this petition"}". ${details}. Status is confirmed and open for petitioner verification.`;
    }
    return DEMO_TEST_QUERIES[0]!.sampleCompleteReply;
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-[var(--border-hairline)] pb-4">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Officer Desk</h1>
        <p className="text-xs sm:text-sm text-[var(--text-secondary)] mt-0.5">
          Review assigned tickets, attach official records, and submit verified responses.
        </p>
      </div>

      {banner && (
        <div
          className={`px-4 py-3 rounded-xl border text-sm flex items-center gap-2 ${
            banner.kind === "success"
              ? "border-[var(--verified-border)] bg-[var(--verified-bg)] text-[var(--verified-fg)]"
              : banner.kind === "warning"
                ? "border-[var(--disputed-border)] bg-[var(--disputed-bg)] text-[var(--disputed-fg)]"
                : "border-[var(--reopened-border)] bg-[var(--reopened-bg)] text-[var(--reopened-fg)]"
          }`}
        >
          {banner.kind === "success" ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0" />
          )}
          <span>{banner.text}</span>
        </div>
      )}

      <div className="grid lg:grid-cols-12 gap-6 items-start">
        <Card className="lg:col-span-4 p-3 space-y-2">
          <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Assigned Queue ({ticketsList.length})
          </div>
          {ticketsList.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)] py-8 text-center">No tickets assigned.</p>
          ) : (
            <div className="space-y-1.5 max-h-[600px] overflow-y-auto">
              {ticketsList.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelect(item.id)}
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
                  <div className="text-[11px] text-[var(--text-muted)] mt-1.5 flex justify-between">
                    <span>{item.locationText || "Assigned Division"}</span>
                    <span className="font-mono-code">#{item.id.slice(0, 6)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </Card>

        <div className="lg:col-span-8 space-y-4">
          {detail ? (
            <Card elevated className="p-6 space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border-hairline)] pb-4">
                <div className="space-y-1">
                  <div className="text-xs font-mono-code text-[var(--text-muted)]">
                    Ticket #{detail.ticket.id.slice(0, 8)}
                  </div>
                  <h2 className="text-lg font-bold">{detail.ticket.title}</h2>
                  <p className="text-sm text-[var(--text-secondary)]">
                    {detail.ticket.originalQuestion}
                  </p>
                  {detail.contract && (
                    <p className="text-xs text-[var(--accent)] font-medium pt-1">
                      Expected Outcome: {detail.contract.desiredOutcome}
                    </p>
                  )}
                </div>
                <StatusBadge status={detail.ticket.status} />
              </div>

              {detail.contract?.questionAuditJson?.siteInspection?.latest && (
                <div className="silk-subtle p-3.5 text-xs space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-[var(--accent)]">
                      AI Site Video Evaluation
                    </span>
                    <span className="font-mono-code text-[var(--text-muted)]">
                      {detail.contract.questionAuditJson.siteInspection.latest.assessment.replace(/_/g, " ")} ·{" "}
                      {Math.round(detail.contract.questionAuditJson.siteInspection.latest.confidence * 100)}%
                    </span>
                  </div>
                  <p className="text-[var(--text-secondary)]">
                    {detail.contract.questionAuditJson.siteInspection.latest.summary}
                  </p>
                </div>
              )}

              {detail.ticket.status === "reopened" && detail.verificationCase?.reasons?.[0] && (
                <div className="p-3.5 rounded-xl border border-[var(--reopened-border)] bg-[var(--reopened-bg)] text-[var(--reopened-fg)] text-xs">
                  <strong>Applicant Feedback:</strong> {detail.verificationCase.reasons[0]}
                </div>
              )}

              {latestReturned && (
                <div className="p-4 rounded-xl border border-[var(--disputed-border)] bg-[var(--disputed-bg)] text-[var(--disputed-fg)] space-y-1.5">
                  <div className="text-xs font-semibold">
                    Audit Follow-up Questions (Insufficient Evidence)
                  </div>
                  <ul className="list-disc pl-4 text-xs space-y-0.5">
                    {(latestReturned.returnGapsJson ?? []).map((gap, i) => (
                      <li key={i}>{gap}</li>
                    ))}
                  </ul>
                </div>
              )}

              {citizenFiles.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {citizenFiles.map((ev) => (
                    <a
                      key={ev.id}
                      href={resolveApiUrl(ev.signedUrl)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-hairline)] text-xs"
                    >
                      {ev.mime.startsWith("video/") ? (
                        <Video className="w-3.5 h-3.5 text-[var(--accent)]" />
                      ) : (
                        <FileText className="w-3.5 h-3.5 text-[var(--accent)]" />
                      )}
                      <span>Applicant Attachment ({ev.mime})</span>
                    </a>
                  ))}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                    <label className="block text-xs font-medium text-[var(--text-secondary)]">
                      Official Response
                    </label>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setReplyText("Action taken and issue resolved.")}
                        className="px-2.5 py-1 rounded-lg border border-[var(--disputed-border)] bg-[var(--disputed-bg)] text-[var(--disputed-fg)] text-[11px] font-medium cursor-pointer hover:opacity-90"
                      >
                        Fill Vague Reply (AI returns)
                      </button>
                      <button
                        type="button"
                        onClick={() => setReplyText(buildCompleteDemoReply())}
                        className="px-2.5 py-1 rounded-lg border border-[var(--verified-border)] bg-[var(--verified-bg)] text-[var(--verified-fg)] text-[11px] font-medium cursor-pointer hover:opacity-90"
                      >
                        Fill Complete Demo Reply
                      </button>
                    </div>
                  </div>
                  <textarea
                    rows={4}
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Provide reference/order numbers, corrective actions taken, and effective dates..."
                    className="w-full p-3 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-canvas)] text-sm"
                  />
                </div>

                {(detail.contract?.responseRequirements ?? []).length > 0 && (
                  <details className="silk-subtle p-3.5 text-xs">
                    <summary className="cursor-pointer font-medium text-[var(--text-secondary)] inline-flex items-center gap-1">
                      <ChevronDown className="w-3.5 h-3.5" />
                      <span>Expected Response Checklist ({detail.contract?.responseRequirements.length})</span>
                    </summary>
                    <div className="space-y-2.5 mt-3">
                      {(detail.contract?.responseRequirements ?? []).map((req) => (
                        <div key={req.id} className="space-y-1">
                          <label className="font-semibold block">{req.label}</label>
                          <input
                            value={fieldValues[req.id] ?? ""}
                            onChange={(e) =>
                              setFieldValues((prev) => ({ ...prev, [req.id]: e.target.value }))
                            }
                            placeholder={req.description}
                            className="w-full min-h-9 px-2.5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-canvas)] text-xs"
                          />
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="inline-flex items-center gap-1.5 min-h-10 px-3.5 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-subtle)] text-xs font-medium cursor-pointer hover:opacity-90">
                      <Paperclip className="w-3.5 h-3.5" />
                      <span>{uploading ? "Uploading..." : "Attach Proof"}</span>
                      <input
                        type="file"
                        multiple
                        accept="image/*,application/pdf,text/plain"
                        className="hidden"
                        onChange={(e) => void handleAttach(e.target.files)}
                      />
                    </label>

                    {attachedFiles.map((file) => (
                      <span
                        key={file.id}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-hairline)] text-xs"
                      >
                        <span>{file.name}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setAttachedFiles((prev) => prev.filter((item) => item.id !== file.id))
                          }
                          className="cursor-pointer text-[var(--text-muted)]"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>

                  <Button type="submit" disabled={submitting || uploading}>
                    <Send className="w-4 h-4" />
                    <span>{submitting ? "Verifying..." : "Submit Response"}</span>
                  </Button>
                </div>
              </form>
            </Card>
          ) : (
            <Card className="p-10 text-center text-sm text-[var(--text-muted)]">
              Select a ticket from the queue to respond.
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
