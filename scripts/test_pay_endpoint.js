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
  const orderResponse = await fetch(`${api}/cashier/orders`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ items: [{ menuItemId: menu[0].id, quantity: 1 }] }),
  });
  const order = await orderResponse.json();
  assert.equal(orderResponse.status, 201);

  const paymentResponse = await fetch(`${api}/cashier/orders/${order.id}/pay`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({}),
  });
  const payment = await paymentResponse.json();
  assert.equal(paymentResponse.status, 200);
  assert.equal(payment.paymentStatus, 'PAID');
  const ordersResponse = await fetch(`${api}/cashier/orders`, { headers });
  const orders = await ordersResponse.json();
  assert.equal(ordersResponse.status, 200);
  assert.equal(orders.find((candidate) => candidate.id === order.id)?.paymentStatus, 'PAID');
  console.log(`Payment endpoint verified in isolated database for order ${order.id}.`);
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
