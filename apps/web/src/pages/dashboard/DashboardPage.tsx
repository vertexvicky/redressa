import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, MapPin } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Card, StatusBadge } from "../../components/ui.js";
import { apiFetch } from "../../lib/api.js";

interface OverviewData {
  totalTickets: number;
  claimedResolved: number;
  verifiedResolved: number;
  unverified: number;
  disputed: number;
  reopened: number;
  integrityRate: number;
  reopenedRate: number;
  avgDaysToVerified: number;
  replyComplianceRate: number;
  repliesReturned: number;
}

interface DeptMetric {
  id: string;
  name: string;
  region: string;
  claimedResolved: number;
  verifiedResolved: number;
  disputed: number;
  reopened: number;
  repliesReturned: number;
  replyComplianceRate: number;
  integrityRate: number;
}

interface MapPoint {
  ticketId: string;
  title: string;
  category: string;
  status: string;
  locationText: string | null;
  lat: number;
  lng: number;
}

export function DashboardPage() {
  const [searchParams] = useSearchParams();
  const demoSessionId = searchParams.get("demo_session_id") ?? "";
  const [regionFilter, setRegionFilter] = useState("all");

  const querySuffix = demoSessionId
    ? `?demo_session_id=${encodeURIComponent(demoSessionId)}`
    : "";

  const { data: overview } = useQuery({
    queryKey: ["dashboard-overview", demoSessionId],
    queryFn: () =>
      apiFetch<OverviewData>(`/api/v1/dashboard/overview${querySuffix}`, { skipAuth: true }),
    refetchInterval: 10_000
  });

  const { data: deptsRes } = useQuery({
    queryKey: ["dashboard-depts", demoSessionId],
    queryFn: () =>
      apiFetch<{ departments: DeptMetric[] }>(`/api/v1/dashboard/departments${querySuffix}`, {
        skipAuth: true
      }),
    refetchInterval: 10_000
  });

  const { data: mapRes } = useQuery({
    queryKey: ["dashboard-map", demoSessionId],
    queryFn: () =>
      apiFetch<{ points: MapPoint[] }>(`/api/v1/dashboard/map${querySuffix}`, { skipAuth: true }),
    refetchInterval: 10_000
  });

  const departments = (deptsRes?.departments ?? []).filter(
    (d) => regionFilter === "all" || d.region === regionFilter
  );
  const regions = Array.from(new Set((deptsRes?.departments ?? []).map((d) => d.region)));
  const maxBar = Math.max(
    1,
    ...departments.map((d) => Math.max(d.claimedResolved, d.verifiedResolved))
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Public Closure Integrity Dashboard</h1>
          <p className="text-sm text-[var(--text-secondary)]">
            {demoSessionId
              ? "Scoped to active Judge Sandbox session."
              : "Production ground-truth metrics — demo sandboxes strictly excluded."}
          </p>
        </div>

        <select
          value={regionFilter}
          onChange={(e) => setRegionFilter(e.target.value)}
          className="min-h-10 px-3 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-surface)] text-sm"
        >
          <option value="all">All Regions</option>
          {regions.map((rg) => (
            <option key={rg} value={rg}>
              {rg}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        {[
          { label: "Claimed Resolved", value: overview?.claimedResolved ?? 0 },
          {
            label: "Verified Resolved",
            value: overview?.verifiedResolved ?? 0,
            tone: "text-[var(--verified-fg)]"
          },
          { label: "Integrity Rate", value: `${overview?.integrityRate ?? 100}%` },
          { label: "Reply Compliance", value: `${overview?.replyComplianceRate ?? 100}%` },
          {
            label: "Replies Returned",
            value: overview?.repliesReturned ?? 0,
            tone: "text-[var(--disputed-fg)]"
          },
          { label: "Avg Days to Close", value: overview?.avgDaysToVerified ?? 0 }
        ].map((kpi) => (
          <Card key={kpi.label} className="p-4">
            <div className="text-xs text-[var(--text-muted)]">{kpi.label}</div>
            <div className={`text-2xl font-bold tabular-nums mt-1 ${kpi.tone ?? ""}`}>
              {kpi.value}
            </div>
          </Card>
        ))}
      </div>

      <div className="grid lg:grid-cols-12 gap-6">
        <Card className="lg:col-span-7 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-[var(--accent)]" />
              <h2 className="text-base font-semibold">Claimed vs Verified Resolved</h2>
            </div>
            <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-[var(--text-muted)] opacity-45" />
                Claimed
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-[var(--accent)]" />
                Verified
              </span>
            </div>
          </div>

          {departments.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)] py-8 text-center">
              No department records available in this scope yet.
            </p>
          ) : (
            <div className="space-y-4">
              {departments.map((dept) => (
                <div key={dept.id} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold">{dept.name}</span>
                    <span className="tabular-nums text-[var(--text-secondary)]">
                      {dept.verifiedResolved} / {dept.claimedResolved} verified ({dept.integrityRate}%)
                    </span>
                  </div>
                  <div className="space-y-1">
                    <div className="h-2.5 w-full rounded-full bg-[var(--bg-subtle)] overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[var(--text-muted)] opacity-45 transition-all duration-300"
                        style={{ width: `${Math.round((dept.claimedResolved / maxBar) * 100)}%` }}
                      />
                    </div>
                    <div className="h-2.5 w-full rounded-full bg-[var(--bg-subtle)] overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[var(--accent)] transition-all duration-300"
                        style={{ width: `${Math.round((dept.verifiedResolved / maxBar) * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="lg:col-span-5 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-[var(--accent)]" />
            <h2 className="text-base font-semibold">Geolocated Case Feed</h2>
          </div>
          {(mapRes?.points ?? []).length === 0 ? (
            <p className="text-xs text-[var(--text-muted)] py-8 text-center">
              No geolocated tickets recorded yet.
            </p>
          ) : (
            <div className="space-y-2.5 max-h-72 overflow-y-auto">
              {(mapRes?.points ?? []).map((pt) => (
                <div
                  key={pt.ticketId}
                  className="p-3 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-hairline)] text-xs flex items-start justify-between gap-2"
                >
                  <div>
                    <div className="font-semibold">{pt.title}</div>
                    <div className="text-[var(--text-muted)] mt-0.5">
                      {pt.locationText || "Location"} ·{" "}
                      <span className="font-mono-code">
                        {pt.lat.toFixed(4)}, {pt.lng.toFixed(4)}
                      </span>
                    </div>
                  </div>
                  <StatusBadge status={pt.status} />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card className="p-5 space-y-3">
        <h2 className="text-base font-semibold">Department Compliance Breakdown</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--border-hairline)] text-[var(--text-muted)]">
                <th className="py-2 pr-4">Department</th>
                <th className="py-2 pr-4">Region</th>
                <th className="py-2 pr-4 text-right">Claimed</th>
                <th className="py-2 pr-4 text-right">Verified</th>
                <th className="py-2 pr-4 text-right">Disputed / Reopened</th>
                <th className="py-2 pr-4 text-right">Replies Returned</th>
                <th className="py-2 text-right">Reply Compliance</th>
              </tr>
            </thead>
            <tbody>
              {departments.map((dept) => (
                <tr
                  key={dept.id}
                  className="border-b border-[var(--border-hairline)] last:border-0"
                >
                  <td className="py-2.5 pr-4 font-semibold">{dept.name}</td>
                  <td className="py-2.5 pr-4 text-[var(--text-secondary)]">{dept.region}</td>
                  <td className="py-2.5 pr-4 text-right tabular-nums">{dept.claimedResolved}</td>
                  <td className="py-2.5 pr-4 text-right tabular-nums text-[var(--verified-fg)] font-semibold">
                    {dept.verifiedResolved}
                  </td>
                  <td className="py-2.5 pr-4 text-right tabular-nums text-[var(--reopened-fg)]">
                    {dept.disputed + dept.reopened}
                  </td>
                  <td className="py-2.5 pr-4 text-right tabular-nums">{dept.repliesReturned}</td>
                  <td className="py-2.5 text-right tabular-nums font-semibold">
                    {dept.replyComplianceRate}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
