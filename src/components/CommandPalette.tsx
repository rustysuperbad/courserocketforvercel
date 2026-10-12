import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { useNavigate } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "../lib/firebase";
import { useAuth } from "../context/AuthContext";

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function go(path: string) {
    setOpen(false);
    navigate(path);
  }

  if (!open) return null;

  return (
    <div className="cr-cmdk-overlay" role="presentation" onClick={() => setOpen(false)}>
      <div className="cr-cmdk" onClick={(event) => event.stopPropagation()}>
        <Command label="Command palette">
          <Command.Input placeholder="Go somewhere, or draft a course…" />
          <Command.List>
            <Command.Empty style={{ padding: 16, color: "var(--text-3)" }}>Nothing matches.</Command.Empty>
            <Command.Group heading="Navigate">
              <Command.Item onSelect={() => go("/")}>Home</Command.Item>
              {user && <Command.Item onSelect={() => go("/dashboard")}>Library</Command.Item>}
              {user && <Command.Item onSelect={() => go("/learn")}>Learn</Command.Item>}
              {user && <Command.Item onSelect={() => go("/learn/onboarding")}>Diagnostic</Command.Item>}
              {user && <Command.Item onSelect={() => go("/learn/studio")}>Studio</Command.Item>}
              {user && <Command.Item onSelect={() => go("/learn/practice")}>Practice</Command.Item>}
              {user && <Command.Item onSelect={() => go("/learn/review")}>Reviews</Command.Item>}
              {user && <Command.Item onSelect={() => go("/profile")}>Profile</Command.Item>}
              <Command.Item onSelect={() => go("/privacy")}>Privacy</Command.Item>
            </Command.Group>
            {user && (
              <Command.Group heading="Draft a course (does not start generation)">
                <Command.Item onSelect={() => go("/dashboard?topic=" + encodeURIComponent("Trace a web request across a network"))}>
                  Prefill: trace a web request
                </Command.Item>
                <Command.Item onSelect={() => go("/learn?goal=" + encodeURIComponent("Explain DNS before TCP"))}>
                  Prefill Learn: DNS before TCP
                </Command.Item>
              </Command.Group>
            )}
            {user && (
              <Command.Group heading="Account">
                <Command.Item onSelect={async () => { setOpen(false); await signOut(auth); navigate("/"); }}>Sign out</Command.Item>
              </Command.Group>
            )}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
