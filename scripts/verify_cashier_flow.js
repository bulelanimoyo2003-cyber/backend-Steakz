import assert from 'node:assert/strict';
import { withIsolatedApi } from './e2e_test_environment.js';

await withIsolatedApi(async (baseUrl) => {
  const api = `${baseUrl}/api`;
  const loginResponse = await fetch(`${api}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'steakz.city.centre.cashier@steakz.com', password: 'password123' }),
  });
  const login = await loginResponse.json();
  assert.equal(loginResponse.status, 200);
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` };

  const menuResponse = await fetch(`${api}/cashier/menu`, { headers });
  const menu = await menuResponse.json();
  assert.equal(menuResponse.status, 200);
  assert.ok(menu.length > 0);
  const createdResponse = await fetch(`${api}/cashier/orders`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ items: [{ menuItemId: menu[0].id, quantity: 1 }] }),
  });
  const created = await createdResponse.json();
  assert.equal(createdResponse.status, 201);

  const payResponse = await fetch(`${api}/cashier/orders/${created.id}/pay`, { method: 'PATCH', headers });
  const paid = await payResponse.json();
  assert.equal(payResponse.status, 200);
  assert.equal(paid.paymentStatus, 'PAID');
  const ordersResponse = await fetch(`${api}/cashier/orders`, { headers });
  const orders = await ordersResponse.json();
  assert.equal(ordersResponse.status, 200);
  assert.equal(orders.find((order) => order.id === created.id)?.paymentStatus, 'PAID');
  console.log(`Cashier order/payment flow passed in isolated database for order ${created.id}.`);
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
