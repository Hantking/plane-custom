import type { SelectOption } from "./service";

export const DEFAULT_OPTION_COLOR = "#64748b";
export const OPTION_PALETTE = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#06b6d4", "#a855f7", "#ec4899", "#64748b"];

export function optionBackground(option: Pick<SelectOption, "color">): string {
  return typeof option.color === "string" && /^#[\da-f]{6}$/i.test(option.color)
    ? option.color.toLowerCase()
    : DEFAULT_OPTION_COLOR;
}

export function optionBadgeStyle(option: Pick<SelectOption, "color">) {
  const backgroundColor = optionBackground(option);
  const channels = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(backgroundColor.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  // Only the background is configurable. Text contrast is automatic, including light colors.
  const color = (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? "#000000" : "#ffffff";
  return { backgroundColor, color };
}
