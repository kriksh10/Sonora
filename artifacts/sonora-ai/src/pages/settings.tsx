import { useEffect, useState } from "react";
import { useAuth, useClerk, useUser } from "@clerk/react";
import { useLocation } from "wouter";
import { applySonoraTheme, readSonoraTheme, type SonoraTheme } from "@/lib/theme";

const home = import.meta.env.BASE_URL || "/";

export default function SettingsPage() {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const { signOut } = useClerk();
  const [, setLocation] = useLocation();
  const [theme, setTheme] = useState<SonoraTheme>(() => readSonoraTheme());

  useEffect(() => {
    applySonoraTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (isLoaded && !isSignedIn) setLocation("/sign-in", { replace: true });
  }, [isLoaded, isSignedIn, setLocation]);

  if (!isLoaded || !isSignedIn) {
    return (
      <div className="auth-screen" role="status">
        <p>Loading Sonora AI…</p>
      </div>
    );
  }

  const email = user?.primaryEmailAddress?.emailAddress || "No email on this account";

  return (
    <main className={`settings-page ${theme === "light" ? "is-light" : "is-dark"}`}>
      <a className="settings-back" href={`${home}dashboard`}>Back to dashboard</a>
      <h1>Settings</h1>
      <section>
        <h2>Account</h2>
        <p className="settings-label">Email</p>
        <p className="settings-email">{email}</p>
        <button type="button" onClick={() => void signOut({ redirectUrl: home })}>Sign out</button>
      </section>
      <section>
        <h2>Appearance</h2>
        <p className="settings-label">Theme</p>
        <div className="settings-theme" role="group" aria-label="Theme">
          <button type="button" aria-pressed={theme === "light"} onClick={() => setTheme("light")}>Light</button>
          <button type="button" aria-pressed={theme === "dark"} onClick={() => setTheme("dark")}>Dark</button>
        </div>
      </section>
    </main>
  );
}
