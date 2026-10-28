import { useEffect, useState } from "react";

export function IssueTimeInput({
  value,
  timeZone,
  disabled,
  onChange,
}: {
  value?: string | null;
  timeZone: string;
  disabled: boolean;
  onChange: (value: string | null) => void;
}) {
  const saved = value?.slice(0, 5) ?? "";
  const [draft, setDraft] = useState(saved);
  useEffect(() => setDraft(saved), [saved]);
  const commit = () => {
    if (draft !== saved) onChange(draft || null);
  };
  return (
    <div className="space-y-2 border-t border-subtle px-3 py-3">
      <label className="flex items-center justify-between gap-3 text-12 text-secondary">
        Horário (opcional)
        <input
          aria-label="Horário da tarefa"
          type="time"
          step={60}
          value={draft}
          disabled={disabled}
          className="rounded border border-subtle bg-surface-1 px-2 py-1 text-13 text-primary disabled:opacity-50"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
              event.currentTarget.blur();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setDraft(saved);
              event.currentTarget.blur();
            }
          }}
        />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-2 text-11 text-tertiary">
        <span>Fuso: {timeZone}</span>
        {saved && (
          <button
            type="button"
            disabled={disabled}
            className="text-secondary hover:text-primary"
            onClick={() => {
              setDraft("");
              onChange(null);
            }}
          >
            Remover horário
          </button>
        )}
        <button
          type="button"
          disabled={disabled || draft === saved}
          onClick={commit}
          className="rounded bg-accent-primary px-2 py-1 text-12 font-medium text-on-color disabled:opacity-50"
        >
          Salvar horário
        </button>
      </div>
    </div>
  );
}
