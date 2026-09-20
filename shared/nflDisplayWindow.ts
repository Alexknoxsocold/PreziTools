const EASTERN_TIME_ZONE = "America/New_York";
const NFL_SLATE_CUTOFF_MINUTES = 30;

function easternParts(value: string | Date): { dateKey: string; hour: number; minute: number } | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? "";
  const year = part("year"), month = part("month"), day = part("day");
  const hour = Number(part("hour")), minute = Number(part("minute"));
  if (!year || !month || !day || !Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return { dateKey: `${year}-${month}-${day}`, hour, minute };
}

function addDays(dateKey: string, amount: number): string {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function easternDateKey(value: string | Date): string {
  return easternParts(value)?.dateKey ?? "";
}

/** The previous day's slate remains active until 12:30 AM Eastern. */
export function activeNflSlateDateKey(now = new Date()): string {
  const parts = easternParts(now);
  if (!parts) return "";
  const minutesAfterMidnight = parts.hour * 60 + parts.minute;
  return minutesAfterMidnight < NFL_SLATE_CUTOFF_MINUTES ? addDays(parts.dateKey, -1) : parts.dateKey;
}

export function isActiveNflSlateGame(gameTime: string | Date, now = new Date()): boolean {
  return easternDateKey(gameTime) === activeNflSlateDateKey(now);
}
