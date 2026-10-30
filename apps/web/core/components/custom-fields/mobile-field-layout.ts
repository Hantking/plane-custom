type Viewport = { width: number; height: number; offsetLeft?: number; offsetTop?: number };
type AnchorBounds = { left: number; top: number; bottom: number };

/** Keep an inline editor inside the visible viewport, including above the software keyboard. */
export function fieldEditorPosition(anchor: AnchorBounds, viewport: Viewport, measuredHeight = 300) {
  const inset = 8;
  const visibleLeft = viewport.offsetLeft ?? 0;
  const visibleTop = viewport.offsetTop ?? 0;
  const width = Math.max(0, Math.min(420, viewport.width - inset * 2));
  const maxHeight = Math.max(0, viewport.height - inset * 2);
  const height = Math.min(measuredHeight, maxHeight);
  const bottom = visibleTop + viewport.height - inset;
  const below = anchor.bottom + 4;
  const preferredTop = below + height <= bottom ? below : anchor.top - height - 4;
  return {
    width,
    maxHeight,
    left: Math.max(visibleLeft + inset, Math.min(anchor.left, visibleLeft + viewport.width - width - inset)),
    top: Math.max(visibleTop + inset, Math.min(preferredTop, bottom - height)),
  };
}

export function longTextKeyAction({
  key,
  ctrlKey = false,
  shiftKey = false,
  isComposing = false,
  mobile = false,
  disabled = false,
}: {
  key: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
  mobile?: boolean;
  disabled?: boolean;
}): "cancel" | "insert-line" | "save" | "native" {
  if (isComposing) return "native";
  if (key === "Escape") return "cancel";
  if (key !== "Enter" || disabled) return "native";
  if (ctrlKey) return "insert-line";
  return !mobile && !shiftKey ? "save" : "native";
}
