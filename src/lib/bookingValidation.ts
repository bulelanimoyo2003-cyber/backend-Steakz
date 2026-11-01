export function validateBookingDetails(
  tableId: unknown,
  guestCount: unknown,
  dateValue: unknown,
  tableCapacity?: number,
  now = Date.now(),
): string | null {
  if (typeof tableId !== 'number' || !Number.isInteger(tableId) || tableId <= 0) {
    return 'A valid tableId is required.';
  }
  if (typeof guestCount !== 'number' || !Number.isInteger(guestCount) || guestCount <= 0) {
    return 'guestCount must be a positive whole number.';
  }
  if (typeof dateValue !== 'string' || !dateValue.trim()) {
    return 'A valid reservation date and time is required.';
  }

  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime()) || date.getTime() <= now) {
    return 'Reservation date and time must be in the future.';
  }
  if (tableCapacity !== undefined && guestCount > tableCapacity) {
    return `guestCount cannot exceed this table's capacity of ${tableCapacity}.`;
  }

  return null;
}

export function canReserveTable(table: { isAvailable: boolean; status: string } | null): boolean {
  return table !== null && table.isAvailable && table.status === 'AVAILABLE';
}
