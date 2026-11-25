import type { RefObject } from "react";
import type { EditorRefApi } from "@plane/editor";
import type { TRichLongTextValue } from "@plane/types";
import type { FieldValue } from "./service";

export type LongTextEditorContext = {
  workspaceSlug: string;
  projectId: string;
  issueId?: string;
  fieldId: string;
  editorRef?: RefObject<EditorRefApi>;
  onAssetUpload?: (assetId: string) => void;
};

export function isRichLongText(value: FieldValue | undefined): value is TRichLongTextValue {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function longTextHtml(value: FieldValue | undefined) {
  if (isRichLongText(value)) return value.html;
  const escaped = String(value ?? "").replace(/[&<>]/g, (character) => {
    if (character === "&") return "&amp;";
    if (character === "<") return "&lt;";
    return "&gt;";
  });
  return `<p>${escaped.replace(/\r\n?|\n/g, "</p><p>")}</p>`;
}

export function isMainPendingField(name: string) {
  return name.trim().toLocaleLowerCase("pt-BR").normalize("NFC") === "pendência principal";
}
