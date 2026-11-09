import assert from 'node:assert/strict';
import test from 'node:test';
import { getBookingOverlapRange, getDineInBookingWindow, isDineInBookingEligible } from './dineInBooking.js';

const bookingTime = new Date('2030-01-01T18:00:00.000Z');
const now = bookingTime.getTime();
const defaultWindow = { earlyWindowMinutes: 60, visitDurationMinutes: 240 };

test('only confirmed bookings in the configured visit window are eligible', () => {
  assert.equal(isDineInBookingEligible({ status: 'CONFIRMED', date: bookingTime }, now, defaultWindow), true);
  assert.equal(isDineInBookingEligible({
    status: 'CONFIRMED',
    date: new Date(now - 30 * 60_000),
  }, now, defaultWindow), true);
  assert.equal(isDineInBookingEligible({
    status: 'CONFIRMED',
    date: new Date(now + 30 * 60_000),
  }, now, defaultWindow), true);
  for (const status of ['PENDING', 'CANCELLED', 'COMPLETED']) {
    assert.equal(isDineInBookingEligible({ status, date: bookingTime }, now, defaultWindow), false, status);
  }
});

test('booking window boundaries are inclusive and outside times are rejected', () => {
  assert.equal(isDineInBookingEligible({
    status: 'CONFIRMED',
    date: new Date(now + 60 * 60_000),
  }, now, defaultWindow), true);
  assert.equal(isDineInBookingEligible({
    status: 'CONFIRMED',
    date: new Date(now + 60 * 60_000 + 1),
  }, now, defaultWindow), false);
  assert.equal(isDineInBookingEligible({
    status: 'CONFIRMED',
    date: new Date(now - 240 * 60_000),
  }, now, defaultWindow), true);
  assert.equal(isDineInBookingEligible({
    status: 'CONFIRMED',
    date: new Date(now - 240 * 60_000 - 1),
  }, now, defaultWindow), false);
});

test('invalid booking dates are rejected', () => {
  assert.equal(isDineInBookingEligible({ status: 'CONFIRMED', date: 'not-a-date' }, now, defaultWindow), false);
});

test('dining window configuration is explicit, validated, and supports zero early entry', () => {
  assert.deepEqual(getDineInBookingWindow({}), defaultWindow);
  assert.deepEqual(getDineInBookingWindow({
    DINE_IN_BOOKING_EARLY_WINDOW_MINUTES: '0',
    DINE_IN_BOOKING_DURATION_MINUTES: '90',
  }), { earlyWindowMinutes: 0, visitDurationMinutes: 90 });
  assert.throws(() => getDineInBookingWindow({ DINE_IN_BOOKING_EARLY_WINDOW_MINUTES: '-1' }), /nonnegative whole number/);
  assert.throws(() => getDineInBookingWindow({ DINE_IN_BOOKING_DURATION_MINUTES: '0' }), /positive whole number/);
});

test('reservation overlap ranges use the visit duration and exclude adjacent bookings', () => {
  const range = getBookingOverlapRange(bookingTime, defaultWindow.visitDurationMinutes);
  assert.equal(range.startsAfter.getTime(), now - 240 * 60_000);
  assert.equal(range.startsBefore.getTime(), now + 240 * 60_000);
  assert.throws(() => getBookingOverlapRange(new Date(Number.NaN)), /valid reservation time/);
});
