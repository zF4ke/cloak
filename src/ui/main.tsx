import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AnimatePresence,
  MotionConfig,
  motion,
  useReducedMotion,
} from "motion/react";
import { Check, Cloud, Folder, LoaderCircle, Settings, X } from "lucide-react";
import type { Snapshot } from "../shared/types.ts";
import { api, message } from "./api.ts";
import { Icon, IconButton, Notice } from "./components.tsx";
import { ProjectsView } from "./projects.tsx";
import { SettingsView } from "./settings.tsx";
import { ProtectionView } from "./protection.tsx";
import "./styles.css";

function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>(),
    [error, setError] = useState(""),
    [view, setView] = useState<"projects" | "protection" | "settings">(
      "projects",
    ),
    [toast, setToast] = useState("");
  const request = useRef(0),
    reduced = useReducedMotion();
  const refresh = useCallback(async () => {
    const current = ++request.current;
    try {
      const result = await api.snapshot();
      if (current === request.current) {
        setSnapshot(result);
        setError("");
      }
    } catch (error) {
      if (current === request.current) setError(message(error));
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (!document.querySelector("dialog[open]")) void refresh();
    }, 15_000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  return (
    <MotionConfig reducedMotion="user">
      <div className={`app-frame ${window.cloak ? "desktop" : "preview"}`}>
        <header className="titlebar">
          <div className="brand">
            <img src="./assets/mark.svg" alt="" />
            <span>cloak</span>
          </div>
        </header>
        <aside className="sidebar">
          <nav aria-label="Main navigation">
            {(
              [
                { id: "projects", label: "Projects", icon: Folder },
                { id: "protection", label: "OneDrive", icon: Cloud },
                { id: "settings", label: "Settings", icon: Settings },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                title={item.label}
                aria-label={item.label}
                aria-current={view === item.id ? "page" : undefined}
                onClick={() => setView(item.id)}
              >
                {view === item.id && (
                  <motion.span
                    layoutId="navigation"
                    className="nav-background"
                    transition={
                      reduced
                        ? { duration: 0 }
                        : { type: "spring", stiffness: 460, damping: 35 }
                    }
                  />
                )}
                <Icon icon={item.icon} />
                <span className="sr-only">{item.label}</span>
              </button>
            ))}
          </nav>
        </aside>
        <main className="main">
          <div className="page-scroll">
            {error && <Notice>{error}</Notice>}
            {!snapshot ? (
              <div className="app-loading" role="status">
                <Icon icon={LoaderCircle} className="spin" />
                Opening Cloak
              </div>
            ) : (
              <AnimatePresence mode="wait">
                <motion.div
                  key={view}
                  initial={{ opacity: 0, y: reduced ? 0 : 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: reduced ? 0 : -4 }}
                  transition={{ duration: reduced ? 0 : 0.15 }}
                >
                  {view === "projects" ? (
                    <ProjectsView
                      snapshot={snapshot}
                      refresh={refresh}
                      notify={setToast}
                    />
                  ) : view === "settings" ? (
                    <SettingsView
                      snapshot={snapshot}
                      refresh={refresh}
                      notify={setToast}
                    />
                  ) : (
                    <ProtectionView
                      snapshot={snapshot}
                      refresh={refresh}
                      notify={setToast}
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            )}
          </div>
        </main>
        <AnimatePresence>
          {toast && (
            <motion.div
              role="status"
              className="toast"
              initial={{
                opacity: 0,
                y: reduced ? 0 : 16,
                scale: reduced ? 1 : 0.97,
              }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: reduced ? 0 : 8 }}
              transition={{ type: "spring", stiffness: 430, damping: 33 }}
            >
              <Icon icon={Check} />
              <span>{toast}</span>
              <IconButton
                label="Dismiss notification"
                icon={X}
                onClick={() => setToast("")}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
