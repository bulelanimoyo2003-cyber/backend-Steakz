interface ReceiptRequestError {
  code?: string;
  response?: {
    status?: number;
    data?: { error?: string };
  };
}

export type ReceiptLoadFailure =
  | { kind: 'payment-required' }
  | { kind: 'error'; message: string };

export function describeReceiptFailure(error: unknown): ReceiptLoadFailure {
  const requestError = typeof error === 'object' && error !== null
    ? error as ReceiptRequestError
    : undefined;

  if (requestError?.response?.status === 409) {
    return { kind: 'payment-required' };
  }

  const responseMessage = requestError?.response?.data?.error;
  if (typeof responseMessage === 'string' && responseMessage.trim()) {
    return { kind: 'error', message: responseMessage };
  }

  return {
    kind: 'error',
    message: requestError?.code === 'ERR_NETWORK'
      ? 'Unable to reach the Steakz server. Open the local app at http://127.0.0.1:5173 and try again.'
      : 'Failed to load receipt.',
  };
}
