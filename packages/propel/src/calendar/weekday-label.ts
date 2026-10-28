export function weekdayLabel(day: number): string {
  return ["do", "2ª", "3ª", "4ª", "5ª", "6ª", "sá"][day] ?? "";
}
