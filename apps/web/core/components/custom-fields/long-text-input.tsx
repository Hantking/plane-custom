import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { FieldValue } from "./service";

export function LongTextInput({
  name,
  value,
  disabled,
  immediate,
  inline,
  inputClass,
  onChange,
}: {
  name: string;
  value: FieldValue | undefined;
  disabled: boolean;
  immediate: boolean;
  inline: boolean;
  inputClass: string;
  onChange: (value: FieldValue) => void;
}) {
  const original = value == null ? "" : String(value);
  const [draft, setDraft] = useState(original);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 360 });
  const anchor = useRef<HTMLButtonElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancelled = useRef(false);
  const id = useId();
  useEffect(() => setDraft(original), [original]);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(420, window.innerWidth - 16);
      setPosition({
        width,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top: rect.bottom + 240 < window.innerHeight ? rect.bottom : Math.max(8, rect.top - 240),
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);
  const save = () => {
    if (!disabled && !immediate && !cancelled.current && draft !== original) onChange(draft || null);
    cancelled.current = false;
  };
  const change = (next: string) => {
    setDraft(next);
    if (immediate) onChange(next || null);
  };
  const show = () => {
    clearTimeout(timer.current);
    setOpen(true);
  };
  const leave = () => {
    timer.current = setTimeout(() => {
      if (!panel.current?.contains(document.activeElement) && document.activeElement !== anchor.current) setOpen(false);
    }, 150);
  };
  const textarea = (
    <textarea
      ref={editor}
      aria-label={name}
      aria-describedby={inline ? id + "-help" : undefined}
      className={`${inputClass} min-h-32 w-full resize-y whitespace-pre-wrap`}
      rows={6}
      maxLength={10000}
      readOnly={disabled}
      value={draft}
      onChange={(event) => change(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Escape") {
          event.preventDefault();
          cancelled.current = true;
          setDraft(original);
          if (inline) anchor.current?.focus();
          else event.currentTarget.blur();
          setOpen(false);
        } else if (event.key === "Enter" && event.ctrlKey && !disabled) {
          event.preventDefault();
          const { selectionStart: start, selectionEnd: end } = event.currentTarget;
          if (draft.length - (end - start) >= 10000) return;
          change(draft.slice(0, start) + "\n" + draft.slice(end));
          requestAnimationFrame(() => editor.current?.setSelectionRange(start + 1, start + 1));
        } else if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          event.currentTarget.blur();
          if (inline) anchor.current?.focus();
          setOpen(false);
        }
      }}
    />
  );
  if (!inline) return textarea;
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={`${inputClass} w-full truncate text-left`}
        aria-label={`${name}: ${draft || "Sem valor"}`}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={leave}
        onFocus={show}
        onBlur={(event) => {
          if (!panel.current?.contains(event.relatedTarget)) setOpen(false);
        }}
        onClick={() => {
          show();
          requestAnimationFrame(() => editor.current?.focus());
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            show();
            requestAnimationFrame(() => editor.current?.focus());
          } else if (event.key === "Escape") setOpen(false);
        }}
      >
        {draft.replace(/\s*\n\s*/g, " ") || "—"}
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            id={id}
            role="dialog"
            aria-label={name}
            className="shadow-lg fixed z-[110] rounded border border-subtle bg-surface-1 p-3"
            style={position}
            onMouseEnter={show}
            onMouseLeave={leave}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== anchor.current)
                setOpen(false);
            }}
          >
            <p className="mb-2 text-13 font-medium">{name}</p>
            {textarea}
            <p id={id + "-help"} className="mt-1 text-11 text-secondary">
              Ctrl + Enter: nova linha · Enter: salvar · Esc: cancelar
            </p>
          </div>,
          document.body
        )}
    </>
  );
}
