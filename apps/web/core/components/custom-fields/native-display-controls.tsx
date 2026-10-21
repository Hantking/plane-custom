import { useState } from "react";
import { observer } from "mobx-react";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { ISSUE_DISPLAY_PROPERTIES } from "@plane/constants";
import type { IIssueDisplayProperties } from "@plane/types";
import { useTranslation } from "@plane/i18n";
import { useNativeDisplay } from "./native-layout";
import { nativeDisplayService } from "./native-service";
import { isWorkspaceNativeScope, moveNativeProperty } from "./native-display-helpers";
import type { NativePreference } from "./native-display-helpers";
import { fieldError } from "./service";

export const NativeDisplayControls = observer(function NativeDisplayControls({
  layout,
  standardProperties,
  displayProperties,
  updateStandard,
}: {
  layout: string;
  standardProperties: (keyof IIssueDisplayProperties)[];
  displayProperties: IIssueDisplayProperties;
  updateStandard: (patch: Partial<IIssueDisplayProperties>) => void;
}) {
  const display = useNativeDisplay(layout);
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!display.request) return null;
  if (display.error)
    return (
      <p role="alert" className="text-red-600 mt-2 text-11">
        Não foi possível carregar as propriedades personalizadas.
      </p>
    );
  if (!display.data) return <p className="mt-2 text-11 text-secondary">Carregando campos personalizados…</p>;
  const metadata = display.data;
  const standard = new Set(standardProperties.filter((key) => key !== "key").map((key) => "standard:" + key));
  const fields = new Map(metadata.fields.map((field) => ["custom:" + field.id, field]));
  const rows = metadata.preference.order.filter((key) => standard.has(key) || fields.has(key));
  if (!rows.length) return null;
  const save = async (preference: NativePreference) => {
    setBusy(true);
    setError("");
    try {
      const data = await nativeDisplayService.save(display.workspace, display.request!, preference);
      await display.mutate(data, { revalidate: false });
    } catch (e) {
      setError(fieldError(e));
    } finally {
      setBusy(false);
    }
  };
  const label = (key: string) => {
    const field = fields.get(key);
    if (field)
      return isWorkspaceNativeScope(display.request?.scope)
        ? `${field.project_identifier} · ${field.name}`
        : field.name;
    const property = key.slice(9);
    const original = ISSUE_DISPLAY_PROPERTIES.find((item) => item.key === property);
    const fallback: Record<string, string> = {
      created_on: "Criado em",
      updated_on: "Atualizado em",
      issue_type: "Tipo",
    };
    return original ? t(original.titleTranslationKey) : (fallback[property] ?? property);
  };
  const move = (source: string, target: string) =>
    void save({ ...metadata.preference, order: moveNativeProperty(metadata.preference.order, source, target) });
  return (
    <details className="mt-3 rounded border border-subtle p-2" open>
      <summary className="cursor-pointer text-13 font-medium">Campos personalizados e ordem</summary>
      <p className="my-2 text-11 text-secondary">
        {metadata.context_label} · Campos personalizados e ordem são pessoais neste layout. Marque os campos e arraste
        ou use as setas para mudar a posição. O título permanece fixo.
      </p>
      <ol className="max-h-72 space-y-1 overflow-auto">
        {rows.map((key, index) => {
          const field = fields.get(key);
          const checked = field
            ? metadata.preference.visible.includes(field.id)
            : !!displayProperties[key.slice(9) as keyof IIssueDisplayProperties];
          const name = label(key);
          return (
            <li
              key={key}
              draggable={!busy}
              onDragStart={(event) => event.dataTransfer.setData("application/x-plane-property", key)}
              onDragOver={(event) => {
                if (!busy) event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                const source = event.dataTransfer.getData("application/x-plane-property");
                if (!busy && rows.includes(source) && source !== key) move(source, key);
              }}
              className="flex items-center gap-2 rounded bg-layer-1 p-1 text-11"
            >
              <GripVertical className="h-3 w-3 shrink-0 text-secondary" aria-hidden="true" />
              <label className="flex min-w-0 flex-1 items-center gap-2">
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={checked}
                  onChange={(event) => {
                    if (field)
                      void save({
                        ...metadata.preference,
                        visible: event.target.checked
                          ? [...metadata.preference.visible, field.id]
                          : metadata.preference.visible.filter((id) => id !== field.id),
                      });
                    else updateStandard({ [key.slice(9)]: event.target.checked });
                  }}
                />
                <span className="truncate" title={name}>
                  {name}
                  {field ? " · personalizado" : ""}
                </span>
              </label>
              <button
                type="button"
                aria-label={`Mover ${name} para cima`}
                disabled={busy || index === 0}
                onClick={() => move(key, rows[index - 1])}
              >
                <ArrowUp className="h-3 w-3" />
              </button>
              <button
                type="button"
                aria-label={`Mover ${name} para baixo`}
                disabled={busy || index === rows.length - 1}
                onClick={() => move(key, rows[index + 1])}
              >
                <ArrowDown className="h-3 w-3" />
              </button>
            </li>
          );
        })}
      </ol>
      {busy && (
        <p className="mt-1 text-11 text-secondary" role="status">
          Salvando…
        </p>
      )}
      {error && (
        <p role="alert" className="text-red-600 mt-1 text-11">
          {error}
        </p>
      )}
    </details>
  );
});
