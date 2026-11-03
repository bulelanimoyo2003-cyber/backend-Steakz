import assert from 'node:assert/strict';
import test from 'node:test';
import { getDineInBookingWindow, isDineInBookingEligible } from './dineInBooking.js';

const bookingTime = new Date('2030-01-01T18:00:00.000Z');
const now = bookingTime.getTime();
const defaultWindow = { earlyWindowMinutes: 60, visitDurationMinutes: 240 };

test('only confirmed bookings in the dining window are eligible', () => {
  assert.equal(isDineInBookingEligible({ status: 'CONFIRMED', date: bookingTime }, now, defaultWindow), true);
  for (const status of ['PENDING', 'CANCELLED', 'COMPLETED']) {
    assert.equal(isDineInBookingEligible({ status, date: bookingTime }, now, defaultWindow), false);
  }
  assert.equal(isDineInBookingEligible({ status: 'CONFIRMED', date: 'invalid' }, now, defaultWindow), false);
});

test('dining window has inclusive bounds and validated configuration', () => {
  assert.equal(isDineInBookingEligible({
    status: 'CONFIRMED',
    date: new Date(now + 60 * 60_000),
  }, now, defaultWindow), true);
  assert.equal(isDineInBookingEligible({
    status: 'CONFIRMED',
    date: new Date(now - 240 * 60_000),
  }, now, defaultWindow), true);
  assert.deepEqual(getDineInBookingWindow({}), defaultWindow);
  assert.throws(() => getDineInBookingWindow({ DINE_IN_BOOKING_EARLY_WINDOW_MINUTES: '-1' }), /nonnegative whole number/);
  assert.throws(() => getDineInBookingWindow({ DINE_IN_BOOKING_DURATION_MINUTES: '0' }), /positive whole number/);
});
