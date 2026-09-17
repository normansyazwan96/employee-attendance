import { useEffect, useState } from "react";
import { getAdminAudit, type AuditEntry } from "../lib/admin-audit";

const actionStyle: Record<string, string> = { CREATE: "bg-emerald-50 text-emerald-700", UPDATE: "bg-blue-50 text-blue-700", ACTIVATE: "bg-emerald-50 text-emerald-700", DEACTIVATE: "bg-amber-50 text-amber-700", DELETE: "bg-rose-50 text-rose-700" };
const when = (value: string): string => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

export function AuditHistory(): JSX.Element {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => { getAdminAudit().then(setEntries).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Unable to load audit history")).finally(() => setLoading(false)); }, []);
  return <section className="mt-10"><div className="mb-4"><h2 className="text-lg font-bold">Audit history</h2><p className="text-sm text-slate-500">Recent administrative changes for your client.</p></div>{error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}{loading && <div className="rounded-2xl bg-white p-6 text-sm text-slate-500 shadow-card">Loading audit history...</div>}{!loading && !error && entries.length === 0 && <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">No administrative changes recorded yet.</div>}{!loading && !error && entries.length > 0 && <div className="overflow-x-auto rounded-2xl bg-white shadow-card"><table className="w-full min-w-[620px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500"><tr><th className="p-5">Action</th><th>Entity</th><th>Changed by</th><th>When</th></tr></thead><tbody>{entries.map((entry) => <tr key={entry.id} className="border-t border-slate-100"><td className="p-5"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${actionStyle[entry.action] ?? "bg-slate-100 text-slate-600"}`}>{entry.action}</span></td><td className="font-semibold">{entry.entityType}<span className="ml-2 font-mono text-xs font-normal text-slate-400">{entry.entityId.slice(-8)}</span></td><td className="font-mono text-xs text-slate-500">{entry.actorUserId.slice(-8)}</td><td className="text-slate-500">{when(entry.createdAt)}</td></tr>)}</tbody></table></div>}</section>;
}
