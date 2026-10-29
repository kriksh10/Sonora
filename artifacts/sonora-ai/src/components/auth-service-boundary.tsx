import { type ReactNode, useEffect, useState } from "react";
import { isClerkLoadFailure } from "@/lib/auth-load-error";

export default function AuthServiceBoundary({ children }: { children: ReactNode }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const fail = (event: Event, value: unknown) => {
      if (!isClerkLoadFailure(value)) return;
      // The SDK rejects outside React. Prevent only this known error from being
      // promoted into the development runtime overlay before showing recovery.
      event.preventDefault();
      event.stopImmediatePropagation();
      setFailed(true);
    };
    const onError = (event: ErrorEvent) => fail(event, event.error ?? event.message);
    const onRejection = (event: PromiseRejectionEvent) => fail(event, event.reason);
    window.addEventListener("error", onError, true);
    window.addEventListener("unhandledrejection", onRejection, true);
    return () => {
      window.removeEventListener("error", onError, true);
      window.removeEventListener("unhandledrejection", onRejection, true);
    };
  }, []);
  if (!failed) return children;
  return (
    <main className="auth-screen">
      <section className="auth-fallback" role="alert">
        <h1>Sonora AI sign-in is unavailable</h1>
        <p>The account service could not load. Check your connection or content blocker, then try again.</p>
        <button type="button" onClick={() => window.location.reload()}>Try again</button>
        <a href={import.meta.env.BASE_URL}>Back to home</a>
      </section>
    </main>
  );
}
