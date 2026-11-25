import type { Ref } from "react";
import { observer } from "mobx-react";
import type { EditorRefApi } from "@plane/editor";
import { EFileAssetType } from "@plane/types";
import { RichTextEditor } from "@/components/editor/rich-text";
import { useEditorAsset } from "@/hooks/store/use-editor-asset";
import { useWorkspace } from "@/hooks/store/use-workspace";
import { WorkspaceService } from "@/services/workspace.service";
import type { LongTextEditorContext } from "./rich-long-text-value";

const workspaceService = new WorkspaceService();
const entityType = EFileAssetType.ISSUE_DESCRIPTION;

export const RichLongTextEditor = observer(function RichLongTextEditor({
  context,
  name,
  disabled,
  editorRef,
  html,
  autofocus,
  onChange,
}: {
  context: LongTextEditorContext;
  name: string;
  disabled: boolean;
  editorRef: Ref<EditorRefApi>;
  html: string;
  autofocus: boolean;
  onChange: (html: string) => void;
}) {
  const { workspaceSlug, projectId, issueId, fieldId, onAssetUpload } = context;
  const workspaceId = useWorkspace().getWorkspaceBySlug(workspaceSlug)?.id;
  const { uploadEditorAsset, duplicateEditorAsset } = useEditorAsset();
  if (!workspaceId) return null;

  return (
    <RichTextEditor
      ref={editorRef}
      id={`${issueId ?? "create"}-${fieldId}`}
      workspaceSlug={workspaceSlug}
      workspaceId={workspaceId}
      projectId={projectId}
      initialValue={html}
      autofocus={autofocus}
      containerClassName="min-w-0 pb-0 pl-0"
      editorProps={{
        attributes: {
          class: "prose-brand prose-headings:font-display font-default max-w-full prose min-h-24 focus:outline-none",
          role: "textbox",
          "aria-label": name,
          "aria-multiline": "true",
        },
      }}
      onChange={(_json, next, options) => {
        if (!options?.isMigrationUpdate) onChange(next);
      }}
      {...(disabled
        ? { editable: false }
        : {
            editable: true,
            dragDropEnabled: true,
            searchMentionCallback: (payload) =>
              workspaceService.searchEntity(workspaceSlug, { ...payload, project_id: projectId }),
            uploadFile: async (blockId, file) => {
              const { asset_id } = await uploadEditorAsset({
                blockId,
                data: { entity_identifier: issueId ?? "", entity_type: entityType },
                file,
                projectId,
                workspaceSlug,
              });
              onAssetUpload?.(asset_id);
              return asset_id;
            },
            duplicateFile: async (assetId) => {
              const { asset_id } = await duplicateEditorAsset({
                assetId,
                entityId: issueId,
                entityType,
                projectId,
                workspaceSlug,
              });
              onAssetUpload?.(asset_id);
              return asset_id;
            },
          })}
    />
  );
});
