/**
 * Scheduled restarts, as a pure calculation.
 *
 * Kept away from the database and the worker so the arithmetic — which is where
 * a scheduler goes wrong — can be tested directly: a restart that fires twice,
 * or skips a day, is a bug nobody notices until a server is down at the wrong
 * hour.
 */

/** Türkiye has held a fixed +03:00 offset with no daylight saving since 2016. */
export const DEFAULT_OFFSET_MINUTES = 180;

export const SCHEDULE_KINDS = ["restart"] as const;
export type ScheduleKind = (typeof SCHEDULE_KINDS)[number];

export type Schedule = {
  kind: ScheduleKind;
  /** Wall-clock hour the customer picked, in their own offset. */
  hour: number;
  minute: number;
  offsetMinutes: number;
  enabled: boolean;
};

export type ScheduleValidation =
  | { ok: true; schedule: Schedule }
  | { ok: false; code: string; message: string };

const MINUTE_STEP = 5;
const OFFSET_LIMIT_MINUTES = 14 * 60;

export function isScheduleKind(value: unknown): value is ScheduleKind {
  return typeof value === "string" && (SCHEDULE_KINDS as readonly string[]).includes(value);
}

/**
 * Validates what the panel sends.
 *
 * Minutes are restricted to five-minute steps because the worker polls: asking
 * for 03:07 would promise a precision the queue cannot keep, and a schedule
 * that fires a few minutes late looks broken even when it is working.
 */
export function validateSchedule(input: unknown): ScheduleValidation {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, code: "INVALID_SCHEDULE", message: "Zamanlama bir nesne olmalıdır." };
  }
  const value = input as Record<string, unknown>;

  const kind = value.kind ?? "restart";
  if (!isScheduleKind(kind)) {
    return { ok: false, code: "INVALID_SCHEDULE_KIND", message: "Zamanlama türü geçersiz." };
  }
  if (typeof value.enabled !== "boolean") {
    return { ok: false, code: "INVALID_SCHEDULE", message: "Zamanlamanın açık veya kapalı olduğu belirtilmelidir." };
  }

  const hour = Number(value.hour);
  const minute = Number(value.minute);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return { ok: false, code: "INVALID_SCHEDULE_TIME", message: "Saat 0-23 aralığında olmalıdır." };
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59 || minute % MINUTE_STEP !== 0) {
    return {
      ok: false,
      code: "INVALID_SCHEDULE_TIME",
      message: `Dakika ${MINUTE_STEP} dakikalık adımlarla seçilmelidir.`,
    };
  }

  const offsetMinutes = value.offsetMinutes === undefined
    ? DEFAULT_OFFSET_MINUTES
    : Number(value.offsetMinutes);
  if (!Number.isInteger(offsetMinutes) || Math.abs(offsetMinutes) > OFFSET_LIMIT_MINUTES) {
    return { ok: false, code: "INVALID_SCHEDULE_TIME", message: "Saat dilimi farkı geçersiz." };
  }

  return { ok: true, schedule: { kind, hour, minute, offsetMinutes, enabled: value.enabled } };
}

/**
 * The first moment at or after `after` when the wall clock reads hour:minute.
 *
 * Works in the customer's offset and converts back to UTC, which is what the
 * database stores. Strictly after, never equal: firing on the instant that was
 * just handled would run the same restart twice.
 */
export function nextRunAt(schedule: Pick<Schedule, "hour" | "minute" | "offsetMinutes">, after: Date): Date {
  const offsetMs = schedule.offsetMinutes * 60_000;
  const localMs = after.getTime() + offsetMs;
  const local = new Date(localMs);

  const todayLocalMs = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
    schedule.hour,
    schedule.minute,
  );
  const nextLocalMs = todayLocalMs > localMs ? todayLocalMs : todayLocalMs + 86_400_000;
  return new Date(nextLocalMs - offsetMs);
}

/** How the panel writes a schedule back to the customer. */
export function describeSchedule(schedule: Schedule) {
  const clock = `${String(schedule.hour).padStart(2, "0")}:${String(schedule.minute).padStart(2, "0")}`;
  return schedule.enabled
    ? `Her gün ${clock} (UTC${schedule.offsetMinutes >= 0 ? "+" : "-"}${Math.abs(schedule.offsetMinutes) / 60}) yeniden başlatılır.`
    : "Zamanlanmış yeniden başlatma kapalı.";
}
