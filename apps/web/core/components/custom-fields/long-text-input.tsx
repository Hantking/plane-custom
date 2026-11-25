import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { EditorRefApi } from "@plane/editor";
import { RichLongTextEditor } from "./rich-long-text-editor";
import { isRichLongText, longTextHtml } from "./rich-long-text-value";
import type { LongTextEditorContext } from "./rich-long-text-value";
import type { FieldValue } from "./service";
import { fieldEditorPosition, longTextKeyAction } from "./mobile-field-layout";

export function LongTextInput({
  name,
  value,
  disabled,
  immediate,
  inline,
  inputClass,
  editorContext,
  onChange,
}: {
  name: string;
  value: FieldValue | undefined;
  disabled: boolean;
  immediate: boolean;
  inline: boolean;
  inputClass: string;
  editorContext?: LongTextEditorContext;
  onChange: (value: FieldValue) => void;
}) {
  const original = isRichLongText(value) ? value.text : String(value ?? "");
  const originalHtml = editorContext ? longTextHtml(value) : "";
  const [draft, setDraft] = useState(original);
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 360, maxHeight: 320 });
  const anchor = useRef<HTMLButtonElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const localRichEditor = useRef<EditorRefApi>(null);
  const richEditor = editorContext?.editorRef ?? localRichEditor;
  const richDraft = useRef<string | undefined>(undefined);
  const [focusRich, setFocusRich] = useState(false);
  const [uploadPending, setUploadPending] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const skipBlurSave = useRef(false);
  const id = useId();
  useEffect(() => setDraft(original), [original]);
  useEffect(() => {
    if (!originalHtml || originalHtml === richDraft.current) return;
    richDraft.current = undefined;
    richEditor.current?.setEditorValue(originalHtml, false);
  }, [originalHtml, richEditor]);
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
  const saveRich = (html: string) => {
    const document = new DOMParser().parseFromString(html, "text/html");
    onChange({ html, text: document.body.textContent ?? "" });
  };
  const save = () => {
    if (disabled || immediate) return;
    if (editorContext) {
      if (
        richDraft.current !== undefined &&
        richDraft.current !== originalHtml &&
        richEditor.current?.isEditorReadyToDiscard()
      )
        saveRich(richDraft.current);
    } else if (draft !== original) {
      onChange(draft || null);
    }
  };
  const finish = (commit: boolean) => {
    if (commit && editorContext && richEditor.current && !richEditor.current.isEditorReadyToDiscard()) {
      setUploadPending(true);
      return;
    }
    skipBlurSave.current = true;
    if (commit) save();
    else if (editorContext) {
      richDraft.current = undefined;
      richEditor.current?.setEditorValue(originalHtml, false);
    } else {
      setDraft(original);
    }
    if (inline) anchor.current?.focus();
    else if (editorContext) richEditor.current?.blur();
    else editor.current?.blur();
    setFocusRich(false);
    setUploadPending(false);
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
  const focusEditor = () => {
    show();
    if (editorContext) {
      setFocusRich(true);
      richEditor.current?.focus("end");
    } else {
      requestAnimationFrame(() => editor.current?.focus());
    }
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
  const richText = editorContext && (
    <div
      role="group"
      className={`${inputClass} w-full min-w-0`}
      onFocus={() => {
        skipBlurSave.current = false;
      }}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget) || richEditor.current?.isAnyDropbarOpen()) return;
        if (!skipBlurSave.current) save();
      }}
      onKeyDown={(event) => {
        if (event.defaultPrevented || event.nativeEvent.isComposing || richEditor.current?.isAnyDropbarOpen()) return;
        if (event.key === "Escape" && !immediate) {
          event.preventDefault();
          event.stopPropagation();
          finish(false);
        } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !immediate) {
          event.preventDefault();
          event.stopPropagation();
          finish(true);
        }
      }}
    >
      <RichLongTextEditor
        context={editorContext}
        name={name}
        disabled={disabled}
        editorRef={richEditor}
        html={richDraft.current ?? originalHtml}
        autofocus={focusRich}
        onChange={(html) => {
          richDraft.current = html;
          if (immediate) saveRich(html);
        }}
      />
    </div>
  );
  const content = editorContext ? richText : textarea;
  const actions = (
    <div className={`mt-2 flex flex-wrap justify-end gap-2 ${inline || editorContext ? "" : "md:hidden"}`}>
      {uploadPending && (
        <p role="status" className="mr-auto self-center text-11 text-secondary">
          Aguarde o envio da imagem para salvar.
        </p>
      )}
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
      {(disabled || immediate) && (inline || !editorContext) && (
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
        {content}
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
        onClick={focusEditor}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            focusEditor();
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
            className={`shadow-lg fixed ${editorContext ? "z-[95]" : "z-[110]"} overflow-y-auto overscroll-contain rounded border border-subtle bg-surface-1 p-3`}
            style={position}
            onMouseEnter={show}
            onMouseLeave={leave}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            onBlur={(event) => {
              if (
                !event.currentTarget.contains(event.relatedTarget) &&
                event.relatedTarget !== anchor.current &&
                !richEditor.current?.isAnyDropbarOpen() &&
                (!richEditor.current || richEditor.current.isEditorReadyToDiscard())
              ) {
                setFocusRich(false);
                setOpen(false);
              }
            }}
          >
            <p className="mb-2 text-13 font-medium">{name}</p>
            {content}
            <p id={id + "-help"} className="mt-1 text-11 text-secondary">
              {editorContext
                ? "Digite / para ver os comandos."
                : mobile
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
