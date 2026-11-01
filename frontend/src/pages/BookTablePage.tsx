import { useEffect, useState, type FormEvent } from 'react';
import type { AxiosError } from 'axios';
import api from '../api/axios';

interface Branch {
  id: number;
  name: string;
}

interface Table {
  id: number;
  tableNumber: number;
  capacity: number;
}

export default function BookTablePage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState('');
  const [tables, setTables] = useState<Table[]>([]);
  const [tableId, setTableId] = useState('');
  const [guestCount, setGuestCount] = useState('2');
  const [date, setDate] = useState('');
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<Branch[]>('/public/branches').then((response) => setBranches(response.data)).catch(() => setError('Unable to load locations.'));
  }, []);

  async function onBranchChange(value: string) {
    setBranchId(value);
    setTableId('');
    setTables([]);
    setError('');

    if (!value) {
      return;
    }

    try {
      const response = await api.get<{ tables: Table[] }>(`/public/branches/${value}`);
      setTables(response.data.tables ?? []);
    } catch (error: unknown) {
      if ((error as AxiosError)?.response?.status === 404) {
        setBranchId('');
        try {
          const activeBranches = await api.get<Branch[]>('/public/branches');
          setBranches(activeBranches.data);
          setError('This location is no longer active. Please select an active location.');
        } catch {
          setError('This location is no longer active. Refresh the page and select an active location.');
        }
      } else {
        setError('Unable to load tables for the selected location.');
      }
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSuccess('');

    if (!branchId || !tableId || !guestCount || !date) {
      setError('Fill out all fields before proceeding.');
      return;
    }

    try {
      await api.post('/customer/bookings', {
        tableId: Number(tableId),
        guestCount: Number(guestCount),
        date,
      });
      setSuccess('Reservation confirmed. View it in your dashboard.');
    } catch (err: unknown) {
      const message =
        typeof err === 'object' && err !== null && 'response' in err && (err as any).response?.data?.error
          ? (err as any).response.data.error
          : 'Reservation failed.';
      setError(message);
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Reserve a Table</h1>
        <p>Secure your spot at any Steakz location</p>
      </div>

      <div style={{ maxWidth: 520 }}>
        <div className="card">
          {error && <div className="alert alert-error">⚠ {error}</div>}
          {success && <div className="alert alert-success">✓ {success}</div>}
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Location</label>
              <select value={branchId} onChange={(event) => onBranchChange(event.target.value)} required>
                <option value="">Select a location</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Table</label>
              <select value={tableId} onChange={(event) => setTableId(event.target.value)} required>
                <option value="">Select a table</option>
                {tables.map((table) => (
                  <option key={table.id} value={table.id}>
                    Table {table.tableNumber} — seats {table.capacity}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label>Guests</label>
                <input type="number" min="1" value={guestCount} onChange={(event) => setGuestCount(event.target.value)} required />
              </div>
              <div className="form-group">
                <label>Date &amp; Time</label>
                <input type="datetime-local" value={date} onChange={(event) => setDate(event.target.value)} required />
              </div>
            </div>

            <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: '0.25rem' }}>
              Confirm Reservation
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
