import {
  useEffect,
  useRef,
  useId,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  AlertCircle,
  Check,
  ChevronRight,
  LoaderCircle,
  X,
  type LucideIcon,
} from "lucide-react";
export function Icon({
  icon: Svg,
  ...props
}: {
  icon: LucideIcon;
  className?: string;
}) {
  return <Svg size={18} strokeWidth={1.7} aria-hidden="true" {...props} />;
}
export function Button({
  children,
  icon,
  tone = "quiet",
  busy,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: LucideIcon;
  tone?: "quiet" | "primary" | "danger";
  busy?: boolean;
}) {
  return (
    <button
      className={`button ${tone} ${className}`}
      {...props}
      disabled={props.disabled || busy}
    >
      {busy ? (
        <Icon icon={LoaderCircle} className="spin" />
      ) : (
        icon && <Icon icon={icon} />
      )}
      {children}
    </button>
  );
}
export function IconButton({
  label,
  icon,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  icon: LucideIcon;
}) {
  return (
    <Button
      className="icon-button"
      aria-label={label}
      title={label}
      icon={icon}
      {...props}
    />
  );
}
export function Notice({
  children,
  success = false,
}: {
  children: ReactNode;
  success?: boolean;
}) {
  return (
    <div
      className={`notice ${success ? "success" : ""}`}
      role={success ? "status" : "alert"}
    >
      <Icon icon={success ? Check : AlertCircle} />
      <span>{children}</span>
    </div>
  );
}
export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange(value: boolean): void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  const reduced = useReducedMotion();
  return (
    <div className="setting-row">
      <div>
        <label htmlFor={`toggle-${label.replace(/\s/g, "-")}`}>{label}</label>
        {hint && <p className="hint">{hint}</p>}
      </div>
      <button
        id={`toggle-${label.replace(/\s/g, "-")}`}
        type="button"
        disabled={disabled}
        className="toggle"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        data-checked={checked}
        onClick={() => onChange(!checked)}
      >
        <motion.span
          animate={{ x: checked ? 15 : 0 }}
          transition={
            reduced
              ? { duration: 0 }
              : { type: "spring", stiffness: 530, damping: 30 }
          }
        />
      </button>
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  footer,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose(): void;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    reduced = useReducedMotion();
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    dialog
      .querySelector<HTMLElement>(
        ".modal-content input:not(:disabled), .modal-content button:not(:disabled), .modal-content textarea",
      )
      ?.focus();
    return () => dialog.close();
  }, []);
  return (
    <motion.dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""}`}
      aria-labelledby="dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      initial={{ opacity: 0, y: reduced ? 0 : 18, scale: reduced ? 1 : 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: reduced ? 0 : 8, scale: reduced ? 1 : 0.98 }}
      transition={
        reduced
          ? { duration: 0 }
          : { type: "spring", stiffness: 420, damping: 34 }
      }
    >
      <header className="modal-header">
        <h2 id="dialog-title">{title}</h2>
        <IconButton label="Close" icon={X} onClick={onClose} />
      </header>
      <div className="modal-content">{children}</div>
      {footer && <footer className="modal-footer">{footer}</footer>}
    </motion.dialog>
  );
}
export function Disclosure({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false),
    id = useId(),
    reduced = useReducedMotion(),
    trigger = useRef<HTMLButtonElement>(null),
    content = useRef<HTMLDivElement>(null);
  return (
    <section className="disclosure">
      <button
        ref={trigger}
        className="disclosure-heading"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          if (open && content.current?.contains(document.activeElement))
            trigger.current?.focus();
          setOpen(!open);
        }}
      >
        {title}
        <motion.span
          animate={{ rotate: open ? 90 : 0 }}
          transition={
            reduced
              ? { duration: 0 }
              : { type: "spring", stiffness: 420, damping: 32 }
          }
        >
          <Icon icon={ChevronRight} />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            ref={content}
            id={id}
            className="disclosure-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            onAnimationStart={(definition) => {
              if (
                typeof definition === "object" &&
                "height" in definition &&
                definition.height === 0 &&
                content.current
              )
                content.current.inert = true;
            }}
            transition={
              reduced
                ? { duration: 0 }
                : { type: "spring", stiffness: 380, damping: 34 }
            }
          >
            <div className="disclosure-inner">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
