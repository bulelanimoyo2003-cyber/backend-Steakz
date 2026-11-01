import assert from 'node:assert/strict';
import test from 'node:test';
import { canReserveTable, validateBookingDetails } from './bookingValidation.js';

const futureDate = '2030-01-01T18:00:00.000Z';
const now = new Date('2029-01-01T00:00:00.000Z').getTime();

test('booking validation accepts a valid future reservation within capacity', () => {
  assert.equal(validateBookingDetails(1, 4, futureDate, 4, now), null);
});

test('booking validation rejects nonpositive, fractional, and over-capacity party sizes', () => {
  assert.notEqual(validateBookingDetails(1, -1, futureDate, 4, now), null);
  assert.notEqual(validateBookingDetails(1, 0, futureDate, 4, now), null);
  assert.notEqual(validateBookingDetails(1, 1.5, futureDate, 4, now), null);
  assert.notEqual(validateBookingDetails(1, 5, futureDate, 4, now), null);
});

test('booking validation rejects invalid, missing, and past reservation dates', () => {
  assert.notEqual(validateBookingDetails(1, 2, 'not-a-date', 4, now), null);
  assert.notEqual(validateBookingDetails(1, 2, '', 4, now), null);
  assert.notEqual(validateBookingDetails(1, 2, '2028-12-31T23:59:59.000Z', 4, now), null);
});

test('booking validation requires a positive integer table id and guest count', () => {
  assert.notEqual(validateBookingDetails(0, 2, futureDate, 4, now), null);
  assert.notEqual(validateBookingDetails(1.5, 2, futureDate, 4, now), null);
  assert.notEqual(validateBookingDetails(1, '2', futureDate, 4, now), null);
});

test('only available tables in AVAILABLE status can be reserved', () => {
  assert.equal(canReserveTable({ isAvailable: true, status: 'AVAILABLE' }), true);
  assert.equal(canReserveTable({ isAvailable: false, status: 'AVAILABLE' }), false);
  assert.equal(canReserveTable({ isAvailable: true, status: 'OCCUPIED' }), false);
  assert.equal(canReserveTable(null), false);
});
