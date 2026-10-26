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
  return <div ref={ref} className="min-w-0 empty:hidden" data-native-list-toolbar-slot />;
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
  const { styles, attributes } = usePopper(reference, panel, {
    placement: "bottom-end",
    strategy: "fixed",
    modifiers: [
      { name: "preventOverflow", options: { padding: 12 } },
      { name: "offset", options: { offset: [0, 8] } },
    ],
  });
  return (
    <Popover className="shrink-0">
      {({ open }) => (
        <>
          <Popover.Button
            ref={setReference}
            type="button"
            title={title}
            aria-label={title}
            data-native-list-search-trigger={searchTrigger ? "" : undefined}
            className={`relative flex h-8 items-center gap-1.5 rounded-md px-1.5 text-12 font-medium transition-colors focus-visible:outline-2 focus-visible:outline-accent-strong sm:px-2 ${open || active ? "bg-accent-primary/10 text-accent-primary" : "text-secondary hover:bg-layer-transparent-hover hover:text-primary"}`}
          >
            {icon}
            {showLabel && <span className="hidden max-w-28 truncate @6xl:inline">{title}</span>}
            {showLabel && <ChevronDown className="hidden size-3 text-tertiary @6xl:block" />}
            {active && <span className="absolute top-1 right-1 size-1.5 rounded-full bg-accent-primary" />}
          </Popover.Button>
          <Portal>
            <Popover.Panel
              ref={setPanel}
              style={styles.popper}
              {...attributes.popper}
              className={`z-[80] max-h-[min(75vh,640px)] max-w-[calc(100vw-24px)] overflow-auto rounded-xl border border-subtle bg-surface-1 shadow-raised-200 ${wide ? "w-[640px]" : "w-[360px]"}`}
            >
              <div className="border-b border-subtle px-4 py-3 text-13 font-semibold text-primary">{title}</div>
              <div className="space-y-3 p-4 text-13 text-primary">{children}</div>
            </Popover.Panel>
          </Portal>
        </>
      )}
    </Popover>
  );
}
