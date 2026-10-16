import type { ReactNode } from "react";
import WorkspaceDialog from "./WorkspaceDialog";

export default function DeletionDialog({
  busy,
  cancel,
  children,
}: {
  busy: boolean;
  cancel: () => void;
  children: ReactNode;
}) {
  return (
    <WorkspaceDialog
      className="confirm deletion-dialog"
      alert
      labelledBy="deletion-title"
      describedBy="deletion-description"
      initialFocus="[data-deletion-cancel]"
      busy={busy}
      cancel={cancel}
    >
      {children}
    </WorkspaceDialog>
  );
}
