/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { Combobox, Dialog } from "@headlessui/react";
import { Link2, Search, X } from "lucide-react";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { ModalCore } from "@plane/ui";
import { cn } from "@plane/utils";
import { useUser } from "@/hooks/store/user";
import useDebounce from "@/hooks/use-debounce";
import { personalTodoService } from "@/services/personal-todo.service";
import type { TodoWorkItem } from "@/services/personal-todo.service";

type WorkItemPickerProps = {
  onSelect: (item: TodoWorkItem) => void;
  onClose: () => void;
};

function WorkItemPicker({ onSelect, onClose }: WorkItemPickerProps) {
  const { t } = useTranslation();
  const { workspaceSlug } = useParams();
  const { data: user } = useUser();
  const [query, setQuery] = useState("");
  const term = query.trim();
  const search = useDebounce(term, 250);
  const ready = term.length > 0 && search === term;
  const { data, error, isLoading, mutate } = useSWR(
    ready && workspaceSlug && user?.id
      ? (["personal-todo-work-items", user.id, workspaceSlug.toString(), search] as const)
      : null,
    ([, , slug, text]) => personalTodoService.searchWorkItems(slug, text)
  );

  return (
    <ModalCore isOpen handleClose={onClose} className="p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <Dialog.Title className="text-16 font-semibold text-primary">{t("personal_todo.work_item.link")}</Dialog.Title>
        <Button type="button" variant="ghost" appendIcon={<X />} onClick={onClose} aria-label={t("close")} />
      </div>
      <Combobox onChange={onSelect}>
        <div className="relative">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-secondary" aria-hidden="true" />
          <Combobox.Input
            type="search"
            aria-label={t("personal_todo.work_item.search")}
            placeholder={t("personal_todo.work_item.search")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={120}
            className="h-9 w-full rounded-md border border-subtle bg-layer-2 pr-2 pl-9 text-13 text-primary"
          />
        </div>
        <Combobox.Options static className="mt-2 max-h-72 overflow-y-auto">
          {ready &&
            data?.map((item) => (
              <Combobox.Option
                key={item.id}
                value={item}
                className={({ active }) =>
                  cn("flex cursor-pointer items-baseline gap-2 rounded-md px-2 py-2 text-13", active && "bg-layer-2")
                }
              >
                <span className="shrink-0 text-secondary">
                  {item.project_identifier}-{item.sequence_id}
                </span>
                <span className="min-w-0 break-words text-primary">{item.name}</span>
              </Combobox.Option>
            ))}
        </Combobox.Options>
        {term && (!ready || isLoading) && (
          <p role="status" className="py-2 text-13 text-secondary">
            {t("personal_todo.work_item.searching")}
          </p>
        )}
        {ready && error && (
          <div className="flex flex-wrap items-center gap-2">
            <p role="alert" className="text-13 text-danger-primary">
              {t("personal_todo.work_item.error")}
            </p>
            <Button type="button" variant="secondary" onClick={() => void mutate()}>
              {t("personal_todo.retry")}
            </Button>
          </div>
        )}
        {ready && !error && data?.length === 0 && (
          <p className="py-2 text-13 text-secondary">{t("personal_todo.work_item.empty")}</p>
        )}
      </Combobox>
    </ModalCore>
  );
}

type TodoWorkItemFieldProps = {
  value: TodoWorkItem | null;
  onChange: (item: TodoWorkItem | null) => void;
  disabled: boolean;
};

export function TodoWorkItemField({ value, onChange, disabled }: TodoWorkItemFieldProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
      {value && (
        <span className="max-w-full truncate rounded-md bg-layer-2 px-2 py-1 text-12 text-secondary">
          {value.project_identifier}-{value.sequence_id} {value.name}
        </span>
      )}
      <Button type="button" variant="ghost" prependIcon={<Link2 />} disabled={disabled} onClick={() => setOpen(true)}>
        {t(value ? "personal_todo.work_item.change" : "personal_todo.work_item.link")}
      </Button>
      {value && (
        <Button type="button" variant="ghost" disabled={disabled} onClick={() => onChange(null)}>
          {t("personal_todo.work_item.remove")}
        </Button>
      )}
      {open && (
        <WorkItemPicker
          onClose={() => setOpen(false)}
          onSelect={(item) => {
            onChange(item);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}
