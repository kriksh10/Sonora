import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth, useClerk } from "@clerk/react";
import { LogOut, RefreshCw, ShieldCheck, X } from "lucide-react";
import {
  getGetAccessStatusQueryKey,
  getListAccessUsersQueryKey,
  useChangeUserAccess,
  useGetAccessStatus,
  useListAccessUsers,
  useRequestAppAccess,
  type AccessStatus,
  type AccessUser,
} from "@workspace/api-client-react";
import Modal from "@/components/modal";

type AccessContextValue = { role: AccessStatus["role"]; email: string; openAdmin: () => void };
const AccessContext = createContext<AccessContextValue>({ role: "user", email: "", openAdmin: () => {} });
export const useAccess = () => useContext(AccessContext);

const shell = "flex min-h-[100dvh] items-center justify-center bg-[#101113] px-4 py-8 text-white";
const card = "w-full max-w-md rounded-2xl border border-white/10 bg-[#17181b] p-6";
const ghost = "inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 px-4 py-2.5 text-sm font-medium text-white/80 transition hover:bg-white/5 disabled:opacity-50";
const primary = "inline-flex items-center justify-center gap-2 rounded-lg bg-[#257c3c] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#2c9147] disabled:opacity-50";

function errorText(cause: unknown, fallback: string) {
  const data = (cause as { data?: { error?: string } } | null)?.data;
  return data?.error || (cause instanceof Error && cause.message ? cause.message : fallback);
}

function Frame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className={shell}>
      <section className={card} aria-live="polite">
        <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-[#75c853] text-[#19321d]"><ShieldCheck size={20} /></span>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {children}
      </section>
    </main>
  );
}

/** Renders children only while the server currently reports approved access. Fails closed. */
export default function AccessGate({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const { signOut } = useClerk();
  const cache = useQueryClient();
  const signedIn = isLoaded && !!isSignedIn;
  const queryKey = useMemo(() => [...getGetAccessStatusQueryKey(), userId ?? "anonymous"] as const, [userId]);
  const query = useGetAccessStatus({
    query: {
      queryKey, enabled: signedIn, retry: false, gcTime: 0, staleTime: 0,
      refetchInterval: 15_000, refetchIntervalInBackground: true, refetchOnWindowFocus: true, refetchOnReconnect: true,
    },
  });
  const request = useRequestAppAccess();
  const [adminOpen, setAdminOpen] = useState(false);
  const refetchRef = useRef(query.refetch);
  refetchRef.current = query.refetch;

  const granted = signedIn && !query.isError && query.data?.status === "approved";
  const wasGranted = useRef(false);

  useEffect(() => {
    const onFocus = () => { if (signedIn) void refetchRef.current(); };
    const onVisible = () => { if (document.visibilityState === "visible") onFocus(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onVisible); };
  }, [signedIn]);

  useEffect(() => {
    if (granted) { wasGranted.current = true; return; }
    if (!wasGranted.current || query.isPending) return;
    wasGranted.current = false;
    window.dispatchEvent(new Event("sonora-stop-audio"));
    setAdminOpen(false);
    cache.removeQueries({ predicate: (q) => q.queryKey[0] !== getGetAccessStatusQueryKey()[0] });
  }, [granted, query.isPending, cache]);

  const openAdmin = useCallback(() => setAdminOpen(true), []);
  const role = query.data?.role ?? "user";
  const ctx = useMemo(() => ({ role, email: query.data?.email ?? "", openAdmin }), [role, query.data?.email, openAdmin]);
  const leave = () => void signOut({ redirectUrl: import.meta.env.BASE_URL });

  if (!isLoaded || !signedIn) return <main className={shell} />;
  if (query.isError) {
    return (
      <Frame title="We could not verify your access">
        <p className="mt-2 text-sm leading-6 text-white/60">Sonora is unavailable until your approval can be confirmed. Nothing is shown while this check fails.</p>
        <p role="alert" className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-200">{errorText(query.error, "Network or server error.")}</p>
        <div className="mt-5 flex gap-2">
          <button className={primary} disabled={query.isFetching} onClick={() => void query.refetch()}><RefreshCw size={15} /> {query.isFetching ? "Checking…" : "Retry"}</button>
          <button className={ghost} onClick={leave}><LogOut size={15} /> Sign out</button>
        </div>
      </Frame>
    );
  }
  if (!query.data) {
    return <Frame title="Checking access…"><div className="mt-4 h-2 w-40 animate-pulse rounded bg-white/10" /></Frame>;
  }
  const access = query.data;
  if (access.status !== "approved") {
    const copy = {
      pending: access.requested
        ? "Your request is waiting for approval. This page checks again automatically."
        : "Sonora is limited to approved accounts. Request access and the owner will review it.",
      denied: "Your access request was declined. Contact the owner if you believe this is a mistake.",
      revoked: "Your access has been revoked. Interviews you saved earlier are kept and remain private.",
    }[access.status];
    return (
      <Frame title={access.status === "pending" ? (access.requested ? "Request sent" : "Approval required") : access.status === "denied" ? "Access declined" : "Access revoked"}>
        <p className="mt-2 text-sm leading-6 text-white/60">{copy}</p>
        <p className="mt-2 text-xs text-white/40">Signed in as {access.email}</p>
        {request.isError && <p role="alert" className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-200">{errorText(request.error, "Could not send the request.")}</p>}
        <div className="mt-5 flex flex-wrap gap-2">
          {access.status === "pending" && !access.requested && (
            <button className={primary} disabled={request.isPending} data-testid="button-request-access"
              onClick={() => request.mutate(undefined, { onSuccess: (next) => cache.setQueryData(queryKey, next) })}>
              {request.isPending ? "Sending…" : "Request access"}
            </button>
          )}
          <button className={ghost} disabled={query.isFetching} onClick={() => void query.refetch()}><RefreshCw size={15} /> {query.isFetching ? "Checking…" : "Check status"}</button>
          <button className={ghost} onClick={leave}><LogOut size={15} /> Sign out</button>
        </div>
      </Frame>
    );
  }
  return (
    <AccessContext.Provider value={ctx}>
      {children}
      {adminOpen && (access.role === "owner" || access.role === "approver") && <AccessAdmin role={access.role} selfEmail={access.email} onClose={() => setAdminOpen(false)} />}
    </AccessContext.Provider>
  );
}

const groups: { key: AccessUser["status"]; label: string }[] = [
  { key: "pending", label: "Pending requests" }, { key: "approved", label: "Approved" },
  { key: "denied", label: "Denied" }, { key: "revoked", label: "Revoked" },
];

function AccessAdmin({ role, selfEmail, onClose }: { role: "owner" | "approver"; selfEmail: string; onClose: () => void }) {
  const cache = useQueryClient();
  const users = useListAccessUsers({ query: { queryKey: getListAccessUsersQueryKey(), retry: false, gcTime: 0, staleTime: 0, refetchInterval: 15_000 } });
  const change = useChangeUserAccess();
  const [confirm, setConfirm] = useState<AccessUser | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const owner = role === "owner";

  const act = (user: AccessUser, action: "approve" | "deny" | "revoke") => {
    if (change.isPending) return;
    setPendingId(user.userId); setError(""); setMessage("");
    change.mutate({ userId: user.userId, data: { action } }, {
      onSuccess: (next) => {
        cache.setQueryData<AccessUser[]>(getListAccessUsersQueryKey(), (old) => old?.map((u) => (u.userId === next.userId ? next : u)));
        setMessage(`${user.email}: ${action === "approve" ? "approved" : action === "deny" ? "denied" : "access revoked"}.`);
        setConfirm(null);
        void users.refetch();
      },
      onError: (cause) => { setError(errorText(cause, "That change could not be saved. Nothing was changed.")); setConfirm(null); void users.refetch(); },
      onSettled: () => setPendingId(null),
    });
  };

  const list = users.data ?? [];
  const visible = owner ? list : list.filter((u) => u.status === "pending");
  const btn = "rounded-md border border-white/10 px-2.5 py-1.5 text-xs font-medium hover:bg-white/5 disabled:opacity-50";

  return (
    <Modal label="Access management" onClose={onClose} busy={change.isPending} width="max-w-[720px]">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-white">{owner ? "Access management" : "Pending approvals"}</h2>
          <p className="mt-1 text-xs text-white/45">{owner ? "Approve, deny or revoke Sonora access. Interview content is never shown here." : "You can approve pending requests. Other changes are owner-only."}</p>
        </div>
        <div className="flex gap-1">
          <button aria-label="Refresh" className="rounded-lg p-2 text-white/50 hover:bg-white/5 hover:text-white" onClick={() => void users.refetch()}><RefreshCw size={17} className={users.isFetching ? "animate-spin" : ""} /></button>
          <button aria-label="Close" data-autofocus className="rounded-lg p-2 text-white/50 hover:bg-white/5 hover:text-white" onClick={onClose}><X size={19} /></button>
        </div>
      </div>
      {message && <p role="status" className="mb-3 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">{message}</p>}
      {(error || users.isError) && (
        <div role="alert" className="mb-3 flex items-center justify-between gap-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-200">
          <span>{error || errorText(users.error, "Could not load users.")}</span>
          <button className="shrink-0 font-semibold underline" onClick={() => { setError(""); void users.refetch(); }}>Retry</button>
        </div>
      )}
      {users.isPending ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-white/5" />)}</div>
      ) : !visible.length && !users.isError ? (
        <p className="rounded-xl border border-white/10 px-4 py-10 text-center text-sm text-white/45">{owner ? "No accounts yet." : "No pending requests."}</p>
      ) : (
        <div className="max-h-[60dvh] space-y-5 overflow-y-auto pr-1">
          {groups.map(({ key, label }) => {
            const rows = visible.filter((u) => u.status === key);
            if (!rows.length) return null;
            return (
              <section key={key}>
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[.14em] text-white/40">{label} · {rows.length}</h3>
                <ul className="space-y-1.5">
                  {rows.map((u) => {
                    const privileged = u.role === "owner" || (!owner && u.role !== "user") || u.email.toLowerCase() === selfEmail.toLowerCase();
                    const busy = pendingId === u.userId;
                    return (
                      <li key={u.userId} data-testid={`row-access-${u.userId}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-[#101113] px-3 py-2.5">
                        <div className="min-w-0">
                          <div className="truncate text-sm text-white">{u.email}{u.role !== "user" && <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase text-white/60">{u.role}</span>}</div>
                          <div className="text-[11px] text-white/35">Updated {new Date(u.updatedAt).toLocaleString()}</div>
                        </div>
                        {!privileged && (
                          <div className="flex gap-1.5">
                            {(u.status !== "approved") && <button className={`${btn} text-emerald-200`} disabled={change.isPending} onClick={() => act(u, "approve")}>{busy ? "Saving…" : "Approve"}</button>}
                            {owner && u.status === "pending" && <button className={`${btn} text-white/70`} disabled={change.isPending} onClick={() => act(u, "deny")}>Deny</button>}
                            {owner && u.status === "approved" && <button className={`${btn} text-red-200`} disabled={change.isPending} onClick={() => setConfirm(u)}>Revoke</button>}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
      {confirm && (
        <Modal label="Confirm revoke" onClose={() => setConfirm(null)} busy={change.isPending} width="max-w-[420px]">
          <h3 className="text-lg font-semibold text-white">Revoke access?</h3>
          <p className="mt-2 text-sm leading-6 text-white/60">{confirm.email} will lose access within about 15 seconds, and live audio capture on their device will stop. Their saved interviews are kept.</p>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <button className={ghost} data-autofocus onClick={() => setConfirm(null)} disabled={change.isPending}>Cancel</button>
            <button className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50" disabled={change.isPending} onClick={() => act(confirm, "revoke")}>{change.isPending ? "Revoking…" : "Revoke access"}</button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
