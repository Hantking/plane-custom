/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { addDays, formatISO, parseISO } from "date-fns";
import useSWRInfinite from "swr/infinite";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { cn } from "@plane/utils";
import { personalTodoService } from "@/services/personal-todo.service";
import type { PersonalTodo, TodoFields, TodoPage, TodoView } from "@/services/personal-todo.service";
import { TodoForm } from "./form";
import { TodoRow } from "./row";

type OpenTodoView = Exclude<TodoView, "completed">;
const VIEWS: OpenTodoView[] = ["today", "upcoming", "unscheduled"];

function useTodoList(workspaceSlug: string, userId: string, view: TodoView | null) {
  return useSWRInfinite<TodoPage>(
    (index: number, previous: TodoPage | null) =>
      view && (index === 0 || previous?.next) ? ["personal-todos", userId, workspaceSlug, view, index + 1] : null,
    ([, , slug, selected, page]: [string, string, string, TodoView, number]) =>
      personalTodoService.list(slug, selected, page),
    { revalidateFirstPage: false }
  );
}

type TodoListProps = {
  list: ReturnType<typeof useTodoList>;
  view: TodoView;
  onUpdate: (id: string, changes: Partial<TodoFields & Pick<PersonalTodo, "is_completed">>) => Promise<void>;
};

function TodoList({ list, view, onUpdate }: TodoListProps) {
  const { t } = useTranslation();
  const { data, error, isValidating, setSize, mutate } = list;
  const today = data?.[0]?.today;
  const tasks = Array.from(
    new Map(data?.flatMap((page) => page.results.map((task) => [task.id, task] as const))).values()
  );
  const overdue = view === "today" && today ? tasks.filter((task) => task.due_date && task.due_date < today) : [];
  const current = view === "today" ? tasks.filter((task) => task.due_date === today) : tasks;
  const groups = overdue.length
    ? [
        { label: "overdue", items: overdue },
        { label: "today", items: current },
      ]
    : [{ label: view, items: current }];

  return (
    <div className="space-y-4" aria-busy={!data && !error}>
      {error && (
        <div className="flex flex-wrap items-center gap-2 text-13">
          <p role="alert" className="text-danger-primary">
            {t("personal_todo.load_error")}
          </p>
          <Button type="button" variant="secondary" onClick={() => void mutate()}>
            {t("personal_todo.retry")}
          </Button>
        </div>
      )}
      {!data && !error && (
        <p role="status" className="text-13 text-secondary">
          {t("personal_todo.loading")}
        </p>
      )}
      {data && !tasks.length && (
        <p className="rounded-md border border-subtle p-4 text-13 text-secondary">{t("personal_todo.empty." + view)}</p>
      )}
      {groups.map(({ label, items }) =>
        items.length ? (
          <section key={label}>
            <h2 className="mb-2 text-13 font-semibold text-primary">{t("personal_todo.views." + label)}</h2>
            <ul className="divide-y divide-subtle rounded-lg border border-subtle">
              {items.map((task) => (
                <TodoRow key={task.id} task={task} overdue={label === "overdue"} onUpdate={onUpdate} />
              ))}
            </ul>
          </section>
        ) : null
      )}
      {data?.at(-1)?.next && !error && (
        <Button
          type="button"
          variant="secondary"
          loading={isValidating}
          onClick={() => void setSize((size) => size + 1)}
        >
          {t("personal_todo.load_more")}
        </Button>
      )}
    </div>
  );
}

export function PersonalTodoBoard({ workspaceSlug, userId }: { workspaceSlug: string; userId: string }) {
  const { t } = useTranslation();
  const [view, setView] = useState<OpenTodoView>("today");
  const [showCompleted, setShowCompleted] = useState(false);
  const openList = useTodoList(workspaceSlug, userId, view);
  const completedList = useTodoList(workspaceSlug, userId, showCompleted ? "completed" : null);
  const today = openList.data?.[0]?.today;
  const initialDate =
    today && view === "upcoming" ? formatISO(addDays(parseISO(today), 1), { representation: "date" }) : today;

  const refresh = async () => {
    await Promise.allSettled([openList.mutate(), completedList.mutate()]);
  };

  const add = async (fields: TodoFields) => {
    const task = await personalTodoService.create(workspaceSlug, fields);
    const destination = !task.due_date ? "unscheduled" : today && task.due_date > today ? "upcoming" : "today";
    await refresh();
    setView(destination);
  };

  const update: TodoListProps["onUpdate"] = async (id, changes) => {
    await personalTodoService.update(workspaceSlug, id, changes);
    await refresh();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-subtle pb-3">
        <div className="flex flex-wrap gap-1" role="group" aria-label={t("personal_todo.views.label")}>
          {VIEWS.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={item === view}
              onClick={() => setView(item)}
              className={cn(
                "rounded-md px-3 py-1.5 text-13 font-medium text-secondary hover:bg-layer-2-hover",
                item === view && "bg-layer-2 text-primary"
              )}
            >
              {t("personal_todo.views." + item)}
            </button>
          ))}
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-13 text-secondary">
          <input
            type="checkbox"
            checked={showCompleted}
            onChange={(event) => setShowCompleted(event.target.checked)}
            className="accent-accent-primary size-4"
          />
          {t("personal_todo.show_completed")}
        </label>
      </div>
      {today && (
        <TodoForm
          key={view + today}
          initial={{ title: "", due_date: view === "unscheduled" ? null : (initialDate ?? null), priority: "none" }}
          onSave={add}
        />
      )}
      <TodoList list={openList} view={view} onUpdate={update} />
      {showCompleted && (
        <div className="border-t border-subtle pt-4">
          <TodoList list={completedList} view="completed" onUpdate={update} />
        </div>
      )}
    </div>
  );
}
