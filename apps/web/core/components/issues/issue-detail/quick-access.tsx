import { useState } from "react";
import type { ReactNode } from "react";
import { BrainCircuit, MessageSquare, Paperclip, SlidersHorizontal } from "lucide-react";
import { EIssueServiceType } from "@plane/types";
import { usePlaneAI } from "@/components/plane-ai/panel";
import { IssueActivity } from "./issue-activity";
import { IssueAttachmentsCollapsibleContent } from "../issue-detail-widgets/attachments/content";
import { IssueAttachmentActionButton } from "../issue-detail-widgets/attachments/quick-action-button";
import { ISSUE_MOBILE_PANELS, adjacentIssueMobilePanel, resolveIssueMobilePanel } from "./mobile-panels";
import type { IssueMobilePanel, IssueMobilePanelState } from "./mobile-panels";

export type IssueQuickPanel = "properties" | "comments" | "attachments";

export function useIssueMobilePanel(issueId: string) {
  const [state, setState] = useState<IssueMobilePanelState>({ issueId, panel: "content" });
  return [resolveIssueMobilePanel(state, issueId), (panel: IssueMobilePanel) => setState({ issueId, panel })] as const;
}

export function IssueMobileTabs({
  issueId,
  panel,
  onChange,
  idPrefix,
}: {
  issueId: string;
  panel: IssueMobilePanel;
  onChange: (panel: IssueMobilePanel) => void;
  idPrefix: string;
}) {
  const labels = { content: "Tarefa", properties: "Propriedades", comments: "Atividade", attachments: "Anexos" };
  const ai = usePlaneAI();
  return (
    <div className="flex shrink-0 items-center border-b border-subtle bg-surface-1" data-mobile-issue-tabs>
      <div role="tablist" aria-label="Seções da tarefa" className="flex min-w-0 flex-1 overflow-x-auto px-2">
        {ISSUE_MOBILE_PANELS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`${idPrefix}-${issueId}-${key}-tab`}
            aria-controls={`${idPrefix}-${issueId}-${key}-panel`}
            aria-selected={panel === key}
            tabIndex={panel === key ? 0 : -1}
            onClick={() => onChange(key)}
            onKeyDown={(event) => {
              const next = adjacentIssueMobilePanel(key, event.key);
              if (!next) return;
              event.preventDefault();
              onChange(next);
              document.getElementById(`${idPrefix}-${issueId}-${next}-tab`)?.focus();
            }}
            className={`min-h-11 shrink-0 border-b-2 px-3 text-12 font-medium focus-visible:outline-2 focus-visible:outline-accent-strong ${panel === key ? "border-accent-strong text-accent-primary" : "border-transparent text-secondary"}`}
          >
            {labels[key]}
          </button>
        ))}
      </div>
      {ai?.enabled && (
        <button
          type="button"
          title="Plane AI · esta tarefa"
          aria-label="Abrir Plane AI para esta tarefa"
          className="flex size-11 shrink-0 items-center justify-center border-l border-subtle text-accent-primary focus-visible:outline-2 focus-visible:outline-accent-strong"
          onClick={() => ai.open({ scope: { kind: "issue", id: issueId } })}
        >
          <BrainCircuit size={18} />
        </button>
      )}
    </div>
  );
}

export function IssueMobilePanelContent({
  issueId,
  panel,
  activePanel,
  idPrefix,
  children,
  isMobile = true,
  isVisible,
  className = "",
}: {
  issueId: string;
  panel: IssueMobilePanel;
  activePanel: IssueMobilePanel;
  idPrefix: string;
  children: ReactNode;
  isMobile?: boolean;
  isVisible?: boolean;
  className?: string;
}) {
  const visible = isVisible ?? (!isMobile || activePanel === panel);
  return (
    <section
      id={`${idPrefix}-${issueId}-${panel}-panel`}
      role={isMobile ? "tabpanel" : undefined}
      aria-labelledby={isMobile ? `${idPrefix}-${issueId}-${panel}-tab` : undefined}
      tabIndex={isMobile ? 0 : undefined}
      hidden={!visible}
      className={!visible ? "hidden" : `min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain ${className}`}
      data-mobile-issue-panel={isMobile ? panel : undefined}
      data-issue-panel={panel}
    >
      {children}
    </section>
  );
}

/** One mounted editor per section; moving between viewport layouts never discards its local draft. */
export function IssueQuickAccessPanels({
  issueId,
  idPrefix,
  activePanel,
  isMobile,
  properties,
  workspaceSlug,
  projectId,
  disabled,
  isArchived,
}: {
  issueId: string;
  idPrefix: string;
  activePanel: IssueMobilePanel;
  isMobile: boolean;
  properties: ReactNode;
  workspaceSlug: string;
  projectId: string;
  disabled: boolean;
  isArchived: boolean;
}) {
  return (
    <>
      {(["properties", "comments", "attachments"] as const).map((panel) => (
        <IssueMobilePanelContent
          key={panel}
          issueId={issueId}
          panel={panel}
          activePanel={activePanel}
          idPrefix={idPrefix}
          isMobile={isMobile}
          isVisible={activePanel === panel}
          className="h-full"
        >
          {panel === "properties" ? (
            <div className="min-w-0 px-4 py-5" data-mobile-issue-properties={isMobile || undefined}>
              {properties}
            </div>
          ) : (
            <IssueQuickAccessContent
              panel={panel}
              workspaceSlug={workspaceSlug}
              projectId={projectId}
              issueId={issueId}
              disabled={disabled}
              isArchived={isArchived}
              commentsOnly={false}
            />
          )}
        </IssueMobilePanelContent>
      ))}
    </>
  );
}

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
  commentsOnly = true,
}: {
  panel: IssueQuickPanel;
  properties?: ReactNode;
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  disabled: boolean;
  isArchived: boolean;
  commentsOnly?: boolean;
}) {
  if (panel === "properties") return <>{properties}</>;
  return (
    <div className="h-full min-w-0 space-y-4 overflow-y-auto p-4" data-issue-quick-panel={panel}>
      {panel === "comments" ? (
        <IssueActivity
          commentsOnly={commentsOnly}
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
