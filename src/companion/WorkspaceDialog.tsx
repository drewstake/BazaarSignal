import { useEffect, useRef, type ReactNode } from "react";

export default function WorkspaceDialog({
  busy,
  cancel,
  children,
  label,
  labelledBy,
  describedBy,
  className = "",
  alert = false,
  initialFocus = "input, select, button",
}: {
  busy: boolean;
  cancel: () => void;
  children: ReactNode;
  label?: string;
  labelledBy?: string;
  describedBy?: string;
  className?: string;
  alert?: boolean;
  initialFocus?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const trigger = document.activeElement;
    const overflow = document.body.style.overflow;
    const scrollPosition = {
      left: window.scrollX,
      top: window.scrollY,
      behavior: "instant" as const,
    };
    dialog.showModal();
    dialog
      .querySelector<HTMLElement>(initialFocus)
      ?.focus({ preventScroll: true });
    document.body.style.overflow = "hidden";
    window.scrollTo(scrollPosition);
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      if (trigger instanceof HTMLElement && trigger.isConnected)
        trigger.focus({ preventScroll: true });
      window.scrollTo(scrollPosition);
    };
  }, [initialFocus]);

  return (
    <dialog
      ref={ref}
      className={`panel workspace-dialog ${className}`}
      role={alert ? "alertdialog" : "dialog"}
      aria-modal="true"
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) cancel();
      }}
    >
      {children}
    </dialog>
  );
}
