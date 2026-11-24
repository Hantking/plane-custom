/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import type { FormEvent } from "react";
import { Plus } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TODO_PRIORITIES } from "@/services/personal-todo.service";
import type { PersonalTodo, TodoFields, TodoPriority } from "@/services/personal-todo.service";
import { TodoWorkItemField } from "./work-item-field";

const inputClass = "h-8 rounded-md border border-subtle bg-layer-2 px-2 text-13 text-primary outline-accent-primary";

type TodoFormProps = {
  initial: Pick<PersonalTodo, "title" | "due_date" | "priority"> & Partial<Pick<PersonalTodo, "linked_issue">>;
  onSave: (fields: TodoFields) => Promise<void>;
  onCancel?: () => void;
};

export function TodoForm({ initial, onSave, onCancel }: TodoFormProps) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(initial.title);
  const [dueDate, setDueDate] = useState(initial.due_date ?? "");
  const [priority, setPriority] = useState(initial.priority);
  const [workItem, setWorkItem] = useState(initial.linked_issue ?? null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || saving) return;

    setSaving(true);
    setFailed(false);
    try {
      await onSave({ title: trimmed, due_date: dueDate || null, priority, linked_issue_id: workItem?.id ?? null });
      setTitle(initial.title);
      setDueDate(initial.due_date ?? "");
      setPriority(initial.priority);
      setWorkItem(initial.linked_issue ?? null);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} aria-busy={saving} className="rounded-lg border border-subtle bg-layer-1 p-3">
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <input
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          readOnly={saving}
          required
          maxLength={255}
          autoComplete="off"
          aria-label={t("personal_todo.title")}
          placeholder={t("personal_todo.title_placeholder")}
          className={inputClass + " min-w-0 flex-1 sm:min-w-40"}
        />
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
            readOnly={saving}
            max="9999-12-31"
            aria-label={t("personal_todo.due_date")}
            className={inputClass}
          />
          <select
            value={priority}
            onChange={(event) => setPriority(event.target.value as TodoPriority)}
            disabled={saving}
            aria-label={t("personal_todo.priority")}
            className={inputClass}
          >
            {TODO_PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {t(value === "none" ? "personal_todo.no_priority" : "issue.priority." + value)}
              </option>
            ))}
          </select>
          <Button
            type="submit"
            size="xl"
            disabled={saving || !title.trim()}
            loading={saving}
            prependIcon={onCancel ? undefined : <Plus />}
          >
            {t(onCancel ? "personal_todo.save" : "personal_todo.add")}
          </Button>
          {onCancel && (
            <Button type="button" size="xl" variant="ghost" disabled={saving} onClick={onCancel}>
              {t("personal_todo.cancel")}
            </Button>
          )}
        </div>
      </div>
      <TodoWorkItemField value={workItem} onChange={setWorkItem} disabled={saving} />
      {failed && (
        <p role="alert" className="mt-2 text-13 text-danger-primary">
          {t("personal_todo.save_error")}
        </p>
      )}
    </form>
  );
}
