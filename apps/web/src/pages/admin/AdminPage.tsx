import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, Plus, Trash2 } from "lucide-react";
import { Button, Card } from "../../components/ui.js";
import { apiFetch } from "../../lib/api.js";
import type { MeProfile } from "../../components/Layout.js";

export function AdminPage({ user }: { user: MeProfile | null }) {
  const [deptName, setDeptName] = useState("");
  const [region, setRegion] = useState("");
  const [email, setEmail] = useState("");

  const { data: deptsRes, refetch: refetchDepts } = useQuery({
    queryKey: ["admin-depts", user?.id],
    queryFn: () =>
      apiFetch<{
        departments: Array<{ id: string; name: string; region: string; contactEmail: string }>;
      }>("/api/v1/admin/departments"),
    enabled: Boolean(user)
  });

  const { data: usersRes, refetch: refetchUsers } = useQuery({
    queryKey: ["admin-users", user?.id],
    queryFn: () =>
      apiFetch<{
        users: Array<{ id: string; name: string; email: string | null; role: string }>;
      }>("/api/v1/admin/users"),
    enabled: Boolean(user)
  });

  const { data: auditRes } = useQuery({
    queryKey: ["admin-audit", user?.id],
    queryFn: () =>
      apiFetch<{
        audit: Array<{
          id: string;
          actorType: string;
          action: string;
          entityType: string;
          entityId: string;
          createdAt: number;
        }>;
      }>("/api/v1/admin/audit"),
    enabled: Boolean(user)
  });

  const handleCreateDept = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deptName.trim() || !region.trim() || !email.trim()) return;
    await apiFetch("/api/v1/admin/departments", {
      method: "POST",
      body: JSON.stringify({
        name: deptName,
        region,
        contact_email: email,
        escalation_level: 1
      })
    });
    setDeptName("");
    setRegion("");
    setEmail("");
    await refetchDepts();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Administration & Audit Log</h1>
        <p className="text-sm text-[var(--text-secondary)]">
          Manage departments, nodal officer assignments, user roles, and the append-only audit trail.
        </p>
      </div>

      <div className="grid lg:grid-cols-12 gap-6 items-start">
        <Card className="lg:col-span-5 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-[var(--accent)]" />
            <h2 className="text-base font-semibold">Departments</h2>
          </div>

          <form onSubmit={handleCreateDept} className="space-y-2.5">
            <input
              value={deptName}
              onChange={(e) => setDeptName(e.target.value)}
              placeholder="Department name"
              className="w-full min-h-10 px-3 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-canvas)] text-sm"
              required
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                placeholder="Region"
                className="w-full min-h-10 px-3 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-canvas)] text-sm"
                required
              />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nodal@dept.gov"
                className="w-full min-h-10 px-3 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-canvas)] text-sm"
                required
              />
            </div>
            <Button type="submit" size="sm" className="w-full">
              <Plus className="w-4 h-4" />
              <span>Add Department</span>
            </Button>
          </form>

          <div className="space-y-2">
            {(deptsRes?.departments ?? []).map((d) => (
              <div
                key={d.id}
                className="p-3 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-hairline)] flex items-center justify-between gap-2 text-xs"
              >
                <div>
                  <div className="font-semibold">{d.name}</div>
                  <div className="text-[var(--text-muted)]">
                    {d.region} · {d.contactEmail}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    await apiFetch(`/api/v1/admin/departments/${d.id}`, { method: "DELETE" });
                    await refetchDepts();
                  }}
                  aria-label="Delete department"
                  className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--reopened-fg)] cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </Card>

        <Card className="lg:col-span-7 p-5 space-y-4">
          <h2 className="text-base font-semibold">Users & Roles</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[var(--border-hairline)] text-[var(--text-muted)]">
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Email</th>
                  <th className="py-2">Role</th>
                </tr>
              </thead>
              <tbody>
                {(usersRes?.users ?? []).map((u) => (
                  <tr key={u.id} className="border-b border-[var(--border-hairline)] last:border-0">
                    <td className="py-2 pr-3 font-medium">{u.name}</td>
                    <td className="py-2 pr-3 text-[var(--text-muted)]">{u.email ?? "Anonymous"}</td>
                    <td className="py-2">
                      <select
                        value={u.role}
                        onChange={async (e) => {
                          await apiFetch(`/api/v1/admin/users/${u.id}/role`, {
                            method: "PATCH",
                            body: JSON.stringify({ role: e.target.value })
                          });
                          await refetchUsers();
                        }}
                        className="min-h-8 px-2 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-canvas)] text-xs"
                      >
                        <option value="citizen">citizen</option>
                        <option value="officer">officer</option>
                        <option value="reviewer">reviewer</option>
                        <option value="admin">admin</option>
                        <option value="judge">judge</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card className="p-5 space-y-3">
        <h2 className="text-base font-semibold">Append-Only Audit Log</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--border-hairline)] text-[var(--text-muted)]">
                <th className="py-2 pr-3">Action</th>
                <th className="py-2 pr-3">Actor</th>
                <th className="py-2 pr-3">Entity</th>
                <th className="py-2 text-right">Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {(auditRes?.audit ?? []).map((row) => (
                <tr key={row.id} className="border-b border-[var(--border-hairline)] last:border-0">
                  <td className="py-2 pr-3 font-mono-code">{row.action}</td>
                  <td className="py-2 pr-3">{row.actorType}</td>
                  <td className="py-2 pr-3 font-mono-code">
                    {row.entityType}:{row.entityId.slice(0, 8)}
                  </td>
                  <td className="py-2 text-right font-mono-code text-[var(--text-muted)]">
                    {new Date(row.createdAt).toLocaleString()}
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
