import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AnimatePresence,
  MotionConfig,
  motion,
  useReducedMotion,
} from "motion/react";
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  LoaderCircle,
  X,
} from "lucide-react";
import { Button, Icon, IconButton, Notice } from "../ui/components.tsx";
import "../ui/styles.css";
import "./style.css";

declare global {
  interface Window {
    setup?: {
      info(): Promise<{ version: string; path: string }>;
      install(): Promise<{ ok: boolean; error?: string }>;
      open(): Promise<void>;
      close(): Promise<void>;
      progress(callback: (value: number) => void): void;
    };
  }
}

declare const __SETUP_MARK__: string;
const mark =
  typeof __SETUP_MARK__ === "undefined" ? "/assets/mark.svg" : __SETUP_MARK__;
function Setup() {
  const [phase, setPhase] = useState<"welcome" | "installing" | "ready">(
      "welcome",
    ),
    [percent, setPercent] = useState(0),
    [error, setError] = useState(""),
    [info, setInfo] = useState<{ version: string; path: string }>();
  const reduced = useReducedMotion();
  useEffect(() => {
    if (window.setup) {
      void window.setup.info().then(setInfo);
      window.setup.progress(setPercent);
    }
  }, []);
  async function start() {
    if (!window.setup) return;
    setError("");
    setPhase("installing");
    setPercent(0);
    try {
      const result = await window.setup.install();
      if (!result.ok) throw new Error(result.error);
      setPhase("ready");
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      setPhase("welcome");
    }
  }
  return (
    <MotionConfig reducedMotion="user">
      <div className={`setup-frame ${window.setup ? "desktop" : "preview"}`}>
        <header className="titlebar">
          <div className="brand">
            <img src={mark} alt="" draggable={false} />
            <span>Cloak Setup</span>
          </div>
          {!window.setup && (
            <IconButton label="Close setup" icon={X} disabled />
          )}
        </header>
        <div className="setup-glow" aria-hidden="true" />
        <main className="setup-main">
          <motion.img
            className="setup-mark"
            src={mark}
            alt=""
            draggable={false}
            initial={{ opacity: 0, scale: reduced ? 1 : 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: "spring", stiffness: 230, damping: 25 }}
          />
          <AnimatePresence mode="wait">
            <motion.div
              className="setup-copy"
              key={phase}
              initial={{ opacity: 0, y: reduced ? 0 : 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: reduced ? 0 : -3 }}
              transition={{ duration: reduced ? 0 : 0.15 }}
            >
              <h1>
                {phase === "ready"
                  ? "Cloak is ready"
                  : phase === "installing"
                    ? "Installing Cloak"
                    : "Install Cloak"}
              </h1>
              <p>
                {phase === "ready"
                  ? "Open Cloak to add your first project."
                  : phase === "installing"
                    ? "Your projects and settings stay in place."
                    : "Keep Git projects outside OneDrive."}
              </p>
            </motion.div>
          </AnimatePresence>
          {phase === "installing" && (
            <div
              className="setup-progress"
              role="progressbar"
              aria-label="Installing Cloak"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
            >
              <motion.div
                animate={{ scaleX: percent / 100 }}
                style={{ originX: 0 }}
                transition={{ duration: reduced ? 0 : 0.2 }}
              />
            </div>
          )}
          {error && <Notice>{error}</Notice>}
          <div className="setup-action">
            <Button
              tone="primary"
              icon={
                phase === "ready"
                  ? Check
                  : phase === "installing"
                    ? LoaderCircle
                    : ArrowDownToLine
              }
              busy={phase === "installing"}
              disabled={!window.setup}
              onClick={() =>
                void (phase === "ready" ? window.setup?.open() : start())
              }
            >
              {phase === "ready"
                ? "Open Cloak"
                : phase === "installing"
                  ? "Installing"
                  : error
                    ? "Try again"
                    : "Install"}
              {phase === "ready" && <Icon icon={ArrowRight} />}
            </Button>
          </div>
          {info && phase === "welcome" && (
            <p className="setup-location">{info.path}</p>
          )}
        </main>
      </div>
    </MotionConfig>
  );
}
createRoot(document.getElementById("root")!).render(<Setup />);
