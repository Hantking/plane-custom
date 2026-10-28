import { useState } from "react";
import type { ReactNode } from "react";
import { BrainCircuit, MessageSquare, Paperclip, SlidersHorizontal } from "lucide-react";
import { EIssueServiceType } from "@plane/types";
import { usePlaneAI } from "@/components/plane-ai/panel";
import { IssueActivity } from "./issue-activity";
import { IssueAttachmentsCollapsibleContent } from "../issue-detail-widgets/attachments/content";
import { IssueAttachmentActionButton } from "../issue-detail-widgets/attachments/quick-action-button";

export type IssueQuickPanel = "properties" | "comments" | "attachments";

export function useIssueQuickPanel(issueId: string) {
  const [state, setState] = useState<{ issue: string; panel: IssueQuickPanel }>({
    issue: issueId,
    panel: "properties",
  });
  const panel = state.issue === issueId ? state.panel : "properties";
  return [panel, (next: IssueQuickPanel) => setState({ issue: issueId, panel: next })] as const;
}

export function IssueQuickAccessRail({
  issueId,
  panel,
  onChange,
}: {
  issueId: string;
  panel: IssueQuickPanel;
  onChange: (panel: IssueQuickPanel) => void;
}) {
  const ai = usePlaneAI();
  return (
    <nav
      aria-label="Acesso rápido da tarefa"
      className="relative z-10 flex w-11 shrink-0 flex-col items-center gap-2 border-l border-subtle bg-surface-1 py-3"
    >
      {(
        [
          ["properties", "Propriedades", SlidersHorizontal],
          ["comments", "Comentários", MessageSquare],
          ["attachments", "Anexos", Paperclip],
        ] as const
      ).map(([key, label, Icon]) => (
        <button
          key={key}
          type="button"
          title={label}
          aria-label={label}
          aria-pressed={panel === key}
          onClick={() => onChange(key)}
          className={`flex size-8 items-center justify-center rounded-md focus-visible:outline-2 focus-visible:outline-accent-strong ${panel === key ? "bg-accent-primary/10 text-accent-primary" : "text-secondary hover:bg-layer-1"}`}
        >
          <Icon size={17} />
        </button>
      ))}
      {ai?.enabled && (
        <button
          type="button"
          title="Plane AI · esta tarefa"
          aria-label="Abrir Plane AI para esta tarefa"
          className="flex size-8 items-center justify-center rounded-md text-accent-primary hover:bg-accent-primary/10 focus-visible:outline-2 focus-visible:outline-accent-strong"
          onClick={() => ai.open({ scope: { kind: "issue", id: issueId } })}
        >
          <BrainCircuit size={18} />
        </button>
      )}
    </nav>
  );
}

export function IssueQuickAccessContent({
  panel,
  properties,
  workspaceSlug,
  projectId,
  issueId,
  disabled,
  isArchived,
}: {
  panel: IssueQuickPanel;
  properties?: ReactNode;
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  disabled: boolean;
  isArchived: boolean;
}) {
  if (panel === "properties") return <>{properties}</>;
  return (
    <div className="h-full min-w-0 space-y-4 overflow-y-auto p-4" data-issue-quick-panel={panel}>
      {panel === "comments" ? (
        <IssueActivity
          commentsOnly
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          issueId={issueId}
          disabled={isArchived}
        />
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-14 font-semibold">Anexos</h3>
            {!disabled && (
              <IssueAttachmentActionButton
                workspaceSlug={workspaceSlug}
                projectId={projectId}
                issueId={issueId}
                disabled={disabled}
                customButton={<span className="text-12 text-accent-primary">Adicionar anexo</span>}
                issueServiceType={EIssueServiceType.ISSUES}
              />
            )}
          </div>
          <IssueAttachmentsCollapsibleContent
            workspaceSlug={workspaceSlug}
            projectId={projectId}
            issueId={issueId}
            disabled={disabled}
          />
        </>
      )}
    </div>
  );
}
