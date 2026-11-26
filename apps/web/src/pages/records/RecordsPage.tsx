import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Calendar, Clock, Database, Search, Sparkles } from "lucide-react";
import { Button, Card } from "../../components/ui.js";
import { apiFetch } from "../../lib/api.js";

interface IndexedReplyRecord {
  id: string;
  ticketId: string;
  category: string;
  question: string;
  finalReply: string;
  rounds: number;
  autoComposed: boolean;
  finalizedAt: number;
  snippet: string;
}

export function RecordsPage() {
  const [queryInput, setQueryInput] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [applied, setApplied] = useState({ q: "", from: "", to: "" });

  const searchParams = new URLSearchParams();
  if (applied.q) searchParams.set("q", applied.q);
  if (applied.from) searchParams.set("from", applied.from);
  if (applied.to) searchParams.set("to", applied.to);
  const qs = searchParams.toString();

  const { data, isLoading } = useQuery({
    queryKey: ["records-index", applied],
    queryFn: () =>
      apiFetch<{ records: IndexedReplyRecord[] }>(
        `/api/v1/records/search${qs ? `?${qs}` : ""}`
      )
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setApplied({ q: queryInput.trim(), from: fromDate, to: toDate });
  };

  const records = data?.records ?? [];

  return (
    <div className="space-y-6">
      <div className="border-b border-[var(--border-hairline)] pb-4 flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--accent)]">
            <Database className="w-3.5 h-3.5" />
            <span>Timestamped Reply Index</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight mt-1">
            Finalized Reports &amp; Replies
          </h1>
          <p className="text-xs sm:text-sm text-[var(--text-secondary)] mt-0.5">
            Full-text indexed archive of finalized petitions and department replies with timestamps.
          </p>
        </div>
        <span className="text-xs font-mono-code text-[var(--text-muted)]">
          {records.length} record{records.length === 1 ? "" : "s"}
        </span>
      </div>

      <Card className="p-4">
        <form onSubmit={handleSearch} className="grid sm:grid-cols-12 gap-3 items-end">
          <div className="sm:col-span-6">
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              Keyword search
            </label>
            <div className="relative">
              <Search className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-3" />
              <input
                value={queryInput}
                onChange={(e) => setQueryInput(e.target.value)}
                placeholder="Search questions or finalized replies (e.g. express bus, GH stop, circular)..."
                className="w-full min-h-10 pl-9 pr-3 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-canvas)] text-sm"
              />
            </div>
          </div>

          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              From
            </label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full min-h-10 px-2.5 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-canvas)] text-xs"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              To
            </label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full min-h-10 px-2.5 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-canvas)] text-xs"
            />
          </div>

          <div className="sm:col-span-2 flex gap-2">
            <Button type="submit" size="md" className="w-full">
              Search
            </Button>
          </div>
        </form>
      </Card>

      {isLoading ? (
        <Card className="p-8 text-center text-sm text-[var(--text-muted)]">
          Searching timestamped index...
        </Card>
      ) : records.length === 0 ? (
        <Card className="p-10 text-center space-y-1">
          <div className="text-sm font-semibold">No indexed finalized replies match yet</div>
          <p className="text-xs text-[var(--text-muted)]">
            Every approved first reply or AI-consolidated multi-round reply is indexed here automatically with its timestamp.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {records.map((rec) => (
            <Card key={rec.id} className="p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-full bg-[var(--bg-subtle)] border border-[var(--border-hairline)] font-medium capitalize">
                    {rec.category}
                  </span>
                  <span className="font-mono-code text-[var(--text-muted)]">
                    Ticket #{rec.ticketId.slice(0, 8)}
                  </span>
                  {rec.autoComposed ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] font-semibold">
                      <Sparkles className="w-3 h-3" />
                      <span>AI Finalized ({rec.rounds} rounds)</span>
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full bg-[var(--verified-bg)] text-[var(--verified-fg)] border border-[var(--verified-border)] font-medium">
                      Approved Round 1
                    </span>
                  )}
                </div>

                <div className="inline-flex items-center gap-1.5 font-mono-code text-[var(--text-muted)]">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>{new Date(rec.finalizedAt).toLocaleDateString()}</span>
                  <Clock className="w-3.5 h-3.5 ml-1" />
                  <span>{new Date(rec.finalizedAt).toLocaleTimeString()}</span>
                </div>
              </div>

              <div className="text-sm font-semibold text-[var(--text-primary)]">
                {rec.question}
              </div>

              <div className="silk-subtle p-3.5 text-xs sm:text-sm text-[var(--text-secondary)] whitespace-pre-line leading-relaxed">
                {rec.finalReply}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
