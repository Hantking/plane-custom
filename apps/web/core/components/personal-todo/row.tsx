/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { Link2, Pencil } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslation } from "@plane/i18n";
import { cn, generateWorkItemLink } from "@plane/utils";
import type { PersonalTodo, TodoFields, TodoUpdate } from "@/services/personal-todo.service";
import { TodoForm } from "./form";

type TodoRowProps = {
  task: PersonalTodo;
  overdue?: boolean;
  onUpdate: (id: string, changes: TodoUpdate) => Promise<void>;
};

export function TodoRow({ task, overdue, onUpdate }: TodoRowProps) {
  const { t, currentLocale } = useTranslation();
  const { workspaceSlug } = useParams();
  const [editing, setEditing] = useState<PersonalTodo | null>(null);
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
    if (!editing) return;
    const changes: TodoUpdate = {};
    if (fields.title !== editing.title) changes.title = fields.title;
    if (fields.due_date !== editing.due_date) changes.due_date = fields.due_date;
    if (fields.priority !== editing.priority) changes.priority = fields.priority;

    const before = new Set(editing.linked_issues.map((item) => item.id));
    const after = new Set(fields.linked_issue_ids);
    const add = [...after].filter((id) => !before.has(id));
    const remove = [...before].filter((id) => !after.has(id));
    if (add.length || remove.length) changes.link_changes = { add, remove };
    if (Object.keys(changes).length) await onUpdate(task.id, changes);
    setEditing(null);
  };

  return (
    <li className="px-3 py-2 sm:px-4">
      {editing ? (
        <TodoForm initial={editing} onSave={save} onCancel={() => setEditing(null)} />
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
            {workspaceSlug && task.linked_issues.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                {task.linked_issues.map((item) => (
                  <Link
                    key={item.id}
                    href={generateWorkItemLink({
                      workspaceSlug: workspaceSlug.toString(),
                      projectId: item.project_id,
                      issueId: item.id,
                      projectIdentifier: item.project_identifier,
                      sequenceId: item.sequence_id,
                    })}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-md text-12 text-link-primary hover:underline"
                  >
                    <Link2 className="size-3.5 shrink-0" />
                    <span className="shrink-0">
                      {item.project_identifier}-{item.sequence_id}
                    </span>
                    <span className="truncate">{item.name}</span>
                    <span className="sr-only">{t("personal_todo.work_item.opens_in_new_tab")}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={() => setEditing(task)}
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
