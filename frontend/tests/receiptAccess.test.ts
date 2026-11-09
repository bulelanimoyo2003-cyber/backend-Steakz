import assert from 'node:assert/strict';
import test from 'node:test';
import { describeReceiptFailure } from '../src/pages/receiptAccess';

test('a blocked unpaid receipt offers the payment-required state', () => {
  assert.deepEqual(describeReceiptFailure({
    response: { status: 409, data: { error: 'A receipt is available after payment is confirmed.' } },
  }), { kind: 'payment-required' });
});

test('receipt API errors retain their server message', () => {
  assert.deepEqual(describeReceiptFailure({
    response: { status: 404, data: { error: 'Receipt not found.' } },
  }), { kind: 'error', message: 'Receipt not found.' });
});

test('a disconnected local API points customers to the intended app URL', () => {
  assert.deepEqual(describeReceiptFailure({ code: 'ERR_NETWORK' }), {
    kind: 'error',
    message: 'Unable to reach the Steakz server. Open the local app at http://127.0.0.1:5173 and try again.',
  });
});
