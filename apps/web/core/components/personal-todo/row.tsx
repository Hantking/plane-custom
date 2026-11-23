/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { Pencil } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { cn } from "@plane/utils";
import type { PersonalTodo, TodoFields } from "@/services/personal-todo.service";
import { TodoForm } from "./form";

type TodoRowProps = {
  task: PersonalTodo;
  overdue?: boolean;
  onUpdate: (id: string, changes: Partial<TodoFields & Pick<PersonalTodo, "is_completed">>) => Promise<void>;
};

export function TodoRow({ task, overdue, onUpdate }: TodoRowProps) {
  const { t, currentLocale } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const toggle = async () => {
    setSaving(true);
    setFailed(false);
    try {
      await onUpdate(task.id, { is_completed: !task.is_completed });
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  const save = async (fields: TodoFields) => {
    const changes: Partial<TodoFields> = {};
    if (fields.title !== task.title) changes.title = fields.title;
    if (fields.due_date !== task.due_date) changes.due_date = fields.due_date;
    if (fields.priority !== task.priority) changes.priority = fields.priority;
    if (Object.keys(changes).length) await onUpdate(task.id, changes);
    setEditing(false);
  };

  return (
    <li className="px-3 py-2 sm:px-4">
      {editing ? (
        <TodoForm initial={task} onSave={save} onCancel={() => setEditing(false)} />
      ) : (
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={task.is_completed}
            disabled={saving}
            onChange={toggle}
            aria-label={t(task.is_completed ? "personal_todo.reopen" : "personal_todo.complete", { title: task.title })}
            className="accent-accent-primary mt-1.5 size-4 shrink-0 cursor-pointer"
          />
          <div className="min-w-0 grow py-1">
            <p className={cn("text-14 break-words text-primary", task.is_completed && "text-secondary line-through")}>
              {task.title}
            </p>
            {(task.due_date || task.priority !== "none") && (
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-12 text-secondary">
                {task.due_date && (
                  <time dateTime={task.due_date} className={cn(overdue && "text-danger-primary")}>
                    {new Intl.DateTimeFormat(currentLocale, {
                      dateStyle: "medium",
                      timeZone: "UTC",
                    }).format(new Date(task.due_date))}
                  </time>
                )}
                {task.priority !== "none" && <span>{t("issue.priority." + task.priority)}</span>}
              </div>
            )}
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={() => setEditing(true)}
            aria-label={t("personal_todo.edit", { title: task.title })}
            className="grid size-8 shrink-0 place-items-center rounded-md text-secondary hover:bg-layer-2-hover"
          >
            <Pencil className="size-4" />
          </button>
        </div>
      )}
      {failed && (
        <p role="alert" className="text-13 text-danger-primary">
          {t("personal_todo.save_error")}
        </p>
      )}
    </li>
  );
}
