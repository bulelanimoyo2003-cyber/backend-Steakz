export interface DineInBookingWindow {
  earlyWindowMinutes: number;
  visitDurationMinutes: number;
}

export interface DineInBookingCandidate {
  status: string;
  date: Date | string;
}

const MINUTE_IN_MS = 60_000;

function readMinuteSetting(
  env: NodeJS.ProcessEnv,
  name: string,
  defaultValue: number,
  allowZero: boolean,
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return defaultValue;
  if (!/^\d+$/.test(raw.trim())) {
    throw new Error(`${name} must be a ${allowZero ? 'nonnegative' : 'positive'} whole number of minutes.`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || (allowZero ? value < 0 : value <= 0)) {
    throw new Error(`${name} must be a ${allowZero ? 'nonnegative' : 'positive'} whole number of minutes.`);
  }
  return value;
}

export function getDineInBookingWindow(env: NodeJS.ProcessEnv = process.env): DineInBookingWindow {
  return {
    earlyWindowMinutes: readMinuteSetting(env, 'DINE_IN_BOOKING_EARLY_WINDOW_MINUTES', 60, true),
    visitDurationMinutes: readMinuteSetting(env, 'DINE_IN_BOOKING_DURATION_MINUTES', 240, false),
  };
}

export function isDineInBookingEligible(
  booking: DineInBookingCandidate,
  now = Date.now(),
  window = getDineInBookingWindow(),
): boolean {
  const bookingTime = booking.date instanceof Date ? booking.date.getTime() : new Date(booking.date).getTime();
  if (booking.status !== 'CONFIRMED' || !Number.isFinite(bookingTime) || !Number.isFinite(now)) return false;
  return now >= bookingTime - window.earlyWindowMinutes * MINUTE_IN_MS
    && now <= bookingTime + window.visitDurationMinutes * MINUTE_IN_MS;
}
