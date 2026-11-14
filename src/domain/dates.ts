// The one place that decides how a calendar date (YYYY-MM-DD) is shown to the user.
// Finnish day.month. without the year, e.g. 2026-09-01 -> "1.9.". Change it here to change every screen.
const day = new Intl.DateTimeFormat("fi-FI", { day: "numeric", month: "numeric", timeZone: "UTC" });

export function formatDay(iso: string): string {
  return day.format(new Date(`${iso.slice(0, 10)}T12:00:00Z`));
}
