import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { FieldValue } from "./service";
import { fieldEditorPosition, longTextKeyAction } from "./mobile-field-layout";

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
  const [mobile, setMobile] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 360, maxHeight: 320 });
  const anchor = useRef<HTMLButtonElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const skipBlurSave = useRef(false);
  const id = useId();
  useEffect(() => setDraft(original), [original]);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    const pointer = window.matchMedia("(pointer: coarse)");
    const update = () => setMobile(window.innerWidth < 768 || pointer.matches);
    update();
    window.addEventListener("resize", update);
    pointer.addEventListener("change", update);
    return () => {
      window.removeEventListener("resize", update);
      pointer.removeEventListener("change", update);
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      const viewport = window.visualViewport;
      setPosition(
        fieldEditorPosition(
          rect,
          viewport ?? { width: window.innerWidth, height: window.innerHeight },
          panel.current?.scrollHeight || 300
        )
      );
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    const observer = new ResizeObserver(place);
    if (panel.current) observer.observe(panel.current);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
      observer.disconnect();
    };
  }, [open]);
  const save = () => {
    if (!disabled && !immediate && draft !== original) onChange(draft || null);
  };
  const finish = (commit: boolean) => {
    skipBlurSave.current = true;
    if (commit) save();
    else setDraft(original);
    if (inline) anchor.current?.focus();
    else editor.current?.blur();
    setOpen(false);
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
    if (mobile) return;
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
      onFocus={() => {
        skipBlurSave.current = false;
      }}
      onChange={(event) => change(event.target.value)}
      onBlur={() => {
        if (!skipBlurSave.current) save();
        skipBlurSave.current = false;
      }}
      onKeyDown={(event) => {
        const action = longTextKeyAction({
          key: event.key,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
          isComposing: event.nativeEvent.isComposing,
          mobile,
          disabled,
        });
        if (action === "cancel") {
          event.preventDefault();
          finish(false);
        } else if (action === "insert-line") {
          event.preventDefault();
          const { selectionStart: start, selectionEnd: end } = event.currentTarget;
          if (draft.length - (end - start) >= 10000) return;
          change(draft.slice(0, start) + "\n" + draft.slice(end));
          requestAnimationFrame(() => editor.current?.setSelectionRange(start + 1, start + 1));
        } else if (action === "save") {
          event.preventDefault();
          finish(true);
        }
      }}
    />
  );
  const actions = (
    <div className={`mt-2 flex flex-wrap justify-end gap-2 ${inline ? "" : "md:hidden"}`}>
      {!disabled && !immediate && (
        <>
          <button
            type="button"
            className="min-h-11 rounded border border-subtle px-3 text-13"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => finish(false)}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="min-h-11 rounded bg-accent-primary px-3 text-13 text-white"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => finish(true)}
          >
            Salvar
          </button>
        </>
      )}
      {(disabled || immediate) && (
        <button
          type="button"
          className="min-h-11 rounded border border-subtle px-3 text-13"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => finish(true)}
        >
          Fechar
        </button>
      )}
    </div>
  );
  if (!inline)
    return (
      <div data-long-text-editor>
        {textarea}
        {actions}
      </div>
    );
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={`${inputClass} min-h-11 w-full truncate text-left md:min-h-0`}
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
            data-long-text-editor
            className="shadow-lg fixed z-[110] overflow-y-auto overscroll-contain rounded border border-subtle bg-surface-1 p-3"
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
              {mobile
                ? "Enter: nova linha · Use Salvar para concluir"
                : "Ctrl + Enter: nova linha · Enter: salvar · Esc: cancelar"}
            </p>
            {actions}
          </div>,
          document.body
        )}
    </>
  );
}
