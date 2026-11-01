import { withIsolatedApi } from './e2e_test_environment.js';

async function runCheckoutTest(base) {
  const email = `test+${Date.now()}@example.com`;
  const password = 'Password123!';
  const name = 'E2E Test User';

  // use global fetch (Node 18+)

  function ok(res) {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  }

  console.log('Registering', email);
  let res = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password }),
  });
  console.log('Register status', res.status);

  res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const login = await res.json();
  console.log('Login status', res.status, login.user?.role ?? login.message ?? 'completed');
  if (!login.token) throw new Error('Login failed, abort.');
  const token = login.token;

  // get branches
  res = await fetch(`${base}/api/public/branches`);
  const branches = await res.json();
  console.log('branches', branches.length);
  const branchId = branches[0]?.id;
  if (!branchId) throw new Error('No branch found');

  // get branch details to obtain a table
  res = await fetch(`${base}/api/public/branches/${branchId}`);
  const branch = await res.json();
  console.log('branch has tables', (branch.tables || []).length);
  const tableId = branch.tables && branch.tables[0] && branch.tables[0].id;
  if (!tableId) throw new Error('No table available');

  // create booking
  const bookingBody = { tableId, guestCount: 2, date: new Date(Date.now() + 3600000).toISOString() };
  res = await fetch(`${base}/api/customer/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(bookingBody),
  });
  console.log('create booking status', res.status);
  const booking = await res.json();
  const bookingId = booking.id;

  // get menu
  res = await fetch(`${base}/api/menu/${branchId}`);
  const menu = await res.json();
  console.log('menu items', menu.length);
  const menuItemId = menu[0]?.id;
  if (!menuItemId) throw new Error('No menu item');

  // create order
  const orderBody = { bookingId, items: [{ menuItemId, quantity: 2 }] };
  res = await fetch(`${base}/api/customer/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(orderBody),
  });
  console.log('create order status', res.status);
  const order = await res.json();
  console.log('order created id', order.id, 'total', order.total);

  // verify orders list
  res = await fetch(`${base}/api/customer/orders`, { headers: { Authorization: `Bearer ${token}` } });
  const orders = await res.json();
  console.log('customer orders count', orders.length);
  console.log('E2E completed successfully');
}

withIsolatedApi(runCheckoutTest).catch((e) => { console.error('E2E failed', e); process.exitCode = 1; });
