import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { Popover, Portal } from "@headlessui/react";
import { usePopper } from "react-popper";
import { ChevronDown } from "lucide-react";

let target: HTMLDivElement | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const notify = () => listeners.forEach((listener) => listener());

/** Keeps List controls in the page header while retaining the List's React providers. */
export function NativeListToolbarSlot() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    target = element;
    notify();
    return () => {
      if (target === element) {
        target = null;
        notify();
      }
    };
  }, []);
  return (
    <div
      ref={ref}
      className="order-last w-full min-w-0 empty:hidden sm:order-none sm:w-auto"
      data-native-list-toolbar-slot
    />
  );
}

export function NativeListToolbarPortal({ children }: { children: ReactNode }) {
  const element = useSyncExternalStore(
    subscribe,
    () => target,
    () => null
  );
  return element ? createPortal(children, element) : children;
}

export function NativeListToolbarPopover({
  title,
  icon,
  children,
  active = false,
  wide = false,
  showLabel = false,
  searchTrigger = false,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  active?: boolean;
  wide?: boolean;
  showLabel?: boolean;
  searchTrigger?: boolean;
}) {
  const [reference, setReference] = useState<HTMLButtonElement | null>(null);
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const [maxHeight, setMaxHeight] = useState<number>();
  const { styles, attributes, update } = usePopper(reference, panel, {
    placement: "bottom-end",
    strategy: "fixed",
    modifiers: [
      { name: "preventOverflow", options: { padding: 12 } },
      { name: "offset", options: { offset: [0, 8] } },
    ],
  });
  useEffect(() => {
    if (!panel) return;
    const resize = () => {
      setMaxHeight(Math.min(640, (window.visualViewport?.height ?? window.innerHeight) * 0.75));
      void update?.();
    };
    resize();
    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("resize", resize);
    };
  }, [panel, update]);
  return (
    <Popover className="shrink-0">
      {({ open, close }) => (
        <>
          <Popover.Button
            ref={setReference}
            type="button"
            title={title}
            aria-label={title}
            data-native-list-search-trigger={searchTrigger ? "" : undefined}
            className={`relative flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-md px-2 text-12 font-medium transition-colors focus-visible:outline-2 focus-visible:outline-accent-strong sm:h-8 sm:min-w-0 sm:px-1.5 ${open || active ? "bg-accent-primary/10 text-accent-primary" : "text-secondary hover:bg-layer-transparent-hover hover:text-primary"}`}
          >
            {icon}
            <span className={`${showLabel ? "@8xl:inline" : ""} max-w-28 truncate sm:hidden`}>{title}</span>
            {showLabel && <ChevronDown className="@8xl:block hidden size-3 text-tertiary" />}
            {active && <span className="absolute top-1 right-1 size-1.5 rounded-full bg-accent-primary" />}
          </Popover.Button>
          <Portal>
            <Popover.Panel
              ref={setPanel}
              data-native-list-popover
              style={{ ...styles.popper, maxHeight }}
              {...attributes.popper}
              className={`z-[80] max-h-[min(75dvh,640px)] max-w-[calc(100vw-24px)] overflow-auto overscroll-contain rounded-xl border border-subtle bg-surface-1 shadow-raised-200 ${wide ? "w-[640px]" : "w-[360px]"}`}
            >
              <div className="flex items-center justify-between gap-3 border-b border-subtle px-4 py-2 text-13 font-semibold text-primary">
                <span>{title}</span>
                <button
                  type="button"
                  aria-label={`Fechar ${title}`}
                  className="min-h-11 shrink-0 rounded px-2 text-secondary md:min-h-8"
                  onClick={() => close()}
                >
                  Fechar
                </button>
              </div>
              <div className="space-y-3 p-4 text-13 text-primary">{children}</div>
            </Popover.Panel>
          </Portal>
        </>
      )}
    </Popover>
  );
}
