"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TEAM_LABEL, type Role, type Team } from "@/lib/auth-shared";

type UserRow = {
  uid: string;
  email: string;
  displayName: string | null;
  team: Team | null;
  role: Role;
  createdAt: string | null;
  lastSignInAt: string | null;
  lastActiveAt: string | null;
};

type ThreadRow = {
  id: string;
  title: string;
  market: string;
  tags: string[];
  updatedAt: string;
  slug: string;
};

/**
 * Owner-only view of every user. Promote / demote by clicking the role chip.
 * Owner row is always visible but its actions are disabled so nobody can
 * demote the sole Owner by accident.
 */
export function UserManagementList() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyUid, setBusyUid] = useState<string | null>(null);

  const [expandedUid, setExpandedUid] = useState<string | null>(null);
  const [userThreads, setUserThreads] = useState<Record<string, ThreadRow[]>>({});
  const [loadingThreads, setLoadingThreads] = useState<Record<string, boolean>>({});

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/users");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Failed to load users");
      setUsers(payload.users as UserRow[]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }

  async function toggleExpand(uid: string) {
    if (expandedUid === uid) {
      setExpandedUid(null);
      return;
    }
    setExpandedUid(uid);

    if (userThreads[uid]) return;

    setLoadingThreads((prev) => ({ ...prev, [uid]: true }));
    try {
      const response = await fetch(`/api/admin/users/${uid}/threads`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Failed to load threads");
      setUserThreads((prev) => ({ ...prev, [uid]: payload.threads }));
    } catch (caught) {
      console.error(caught);
    } finally {
      setLoadingThreads((prev) => ({ ...prev, [uid]: false }));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function setRole(user: UserRow, role: Role) {
    setBusyUid(user.uid);
    try {
      const response = await fetch(`/api/admin/users/${user.uid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Update failed");
      setUsers((prev) => prev.map((row) => (row.uid === user.uid ? { ...row, role } : row)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusyUid(null);
    }
  }

  if (loading) {
    return (
      <p className="text-[12px]" style={{ color: "var(--revibe-ink-muted)" }}>
        Loading users…
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <div
          className="rounded-[var(--revibe-radius)] border px-3 py-2 text-[12px]"
          style={{
            borderColor: "var(--revibe-error)",
            background: "var(--revibe-error-bg)",
            color: "var(--revibe-error)",
          }}
        >
          {error}
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-[12px]">
          <thead>
            <tr
              className="revibe-label text-left text-[10px]"
              style={{ color: "var(--revibe-ink-muted)" }}
            >
              <th className="border-b py-2 pr-3" style={{ borderColor: "var(--revibe-border)" }}>User</th>
              <th className="border-b py-2 pr-3" style={{ borderColor: "var(--revibe-border)" }}>Team</th>
              <th className="border-b py-2 pr-3" style={{ borderColor: "var(--revibe-border)" }}>Role</th>
              <th className="border-b py-2 pr-3" style={{ borderColor: "var(--revibe-border)" }}>Last sign-in</th>
              <th className="border-b py-2 pr-3" style={{ borderColor: "var(--revibe-border)" }}>Last active</th>
              <th className="border-b py-2" style={{ borderColor: "var(--revibe-border)" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const isOwner = user.role === "owner";
              const isBusy = busyUid === user.uid;
              const isExpanded = expandedUid === user.uid;
              return (
                <optgroup key={user.uid} label={user.email} style={{ display: "contents" }}>
                  <tr>
                    <td className="border-b py-2 pr-3 align-top" style={{ borderColor: "var(--revibe-border)" }}>
                      <div className="flex items-start gap-1.5">
                        <button
                          type="button"
                          onClick={() => toggleExpand(user.uid)}
                          className="revibe-focus mt-0.5 text-[10px] font-semibold hover:text-[var(--revibe-accent)]"
                          title="Toggle conversations"
                        >
                          {isExpanded ? "▼" : "▶"}
                        </button>
                        <div className="flex flex-col">
                          <span className="font-semibold">{user.displayName || user.email.split("@")[0]}</span>
                          <span className="block text-[10px]" style={{ color: "var(--revibe-ink-faint)" }}>
                            {user.email}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="border-b py-2 pr-3 align-top" style={{ borderColor: "var(--revibe-border)" }}>
                      {user.team ? TEAM_LABEL[user.team] : <span style={{ color: "var(--revibe-ink-faint)" }}>—</span>}
                    </td>
                    <td className="border-b py-2 pr-3 align-top" style={{ borderColor: "var(--revibe-border)" }}>
                      <span
                        className="revibe-label rounded px-1.5 py-0.5 text-[10px]"
                        style={{
                          background: isOwner ? "var(--revibe-accent)" : "var(--revibe-canvas)",
                          color: isOwner ? "#fff" : "var(--revibe-ink)",
                        }}
                      >
                        {user.role}
                      </span>
                    </td>
                    <td className="border-b py-2 pr-3 align-top text-[10px]" style={{ borderColor: "var(--revibe-border)", color: "var(--revibe-ink-faint)" }}>
                      {user.lastSignInAt ? new Date(user.lastSignInAt).toLocaleString() : "—"}
                    </td>
                    <td className="border-b py-2 pr-3 align-top text-[10px]" style={{ borderColor: "var(--revibe-border)", color: "var(--revibe-ink-faint)" }}>
                      {user.lastActiveAt ? new Date(user.lastActiveAt).toLocaleString() : "—"}
                    </td>
                    <td className="border-b py-2 align-top" style={{ borderColor: "var(--revibe-border)" }}>
                      <div className="flex gap-1.5 items-center">
                        {isOwner ? (
                          <span className="text-[10px]" style={{ color: "var(--revibe-ink-faint)" }}>
                            Owner — not editable
                          </span>
                        ) : (
                          <>
                            {user.role === "admin" ? (
                              <button
                                type="button"
                                onClick={() => setRole(user, "member")}
                                disabled={isBusy}
                                className="revibe-label revibe-focus rounded-[var(--revibe-radius)] border px-2 py-1 text-[10px] transition-opacity disabled:opacity-40"
                                style={{ borderColor: "var(--revibe-border)", color: "var(--revibe-ink)" }}
                              >
                                Demote to member
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setRole(user, "admin")}
                                disabled={isBusy}
                                className="revibe-label revibe-focus rounded-[var(--revibe-radius)] px-2 py-1 text-[10px] transition-opacity disabled:opacity-40"
                                style={{ background: "var(--revibe-ink)", color: "#fff" }}
                              >
                                Promote to admin
                              </button>
                            )}
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => toggleExpand(user.uid)}
                          className="revibe-label revibe-focus rounded-[var(--revibe-radius)] border border-dashed px-2 py-1 text-[10px] hover:bg-gray-50 transition-colors"
                          style={{ borderColor: "var(--revibe-border)", color: "var(--revibe-ink)" }}
                        >
                          {isExpanded ? "Hide chats" : "Show chats"}
                        </button>
                      </div>
                    </td>
                  </tr>

                  {isExpanded && (
                    <tr>
                      <td colSpan={6} className="bg-[var(--revibe-canvas)] p-3 border-b" style={{ borderColor: "var(--revibe-border)" }}>
                        <div className="flex flex-col gap-2 pl-2 border-l-2 border-[var(--revibe-accent)]">
                          <h4 className="font-semibold text-[11px]" style={{ color: "var(--revibe-ink-muted)" }}>
                            Conversations ({userThreads[user.uid]?.length ?? 0})
                          </h4>
                          {loadingThreads[user.uid] ? (
                            <p className="text-[10px]" style={{ color: "var(--revibe-ink-faint)" }}>Loading conversations...</p>
                          ) : !userThreads[user.uid] || userThreads[user.uid].length === 0 ? (
                            <p className="text-[10px]" style={{ color: "var(--revibe-ink-faint)" }}>No conversations found for this user.</p>
                          ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-2">
                              {userThreads[user.uid].map((t) => (
                                <div key={t.id} className="text-[11px] p-2 bg-white rounded border border-gray-100 flex items-center justify-between gap-2 shadow-sm">
                                  <div className="flex flex-col">
                                    <Link
                                      href={`/t/${t.slug}`}
                                      className="font-medium hover:text-[var(--revibe-accent)] transition-colors line-clamp-1"
                                    >
                                      {t.title || "Untitled Chat"}
                                    </Link>
                                    <span className="text-[9px] uppercase font-bold" style={{ color: "var(--revibe-ink-faint)" }}>
                                      Market: {t.market}
                                    </span>
                                  </div>
                                  <span className="text-[9px] whitespace-nowrap" style={{ color: "var(--revibe-ink-faint)" }}>
                                    {new Date(t.updatedAt).toLocaleDateString()}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </optgroup>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
