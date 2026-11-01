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

  const menuResponse = await fetch(`${api}/cashier/menu`, {
    headers: { Authorization: `Bearer ${login.token}` },
  });
  const menu = await menuResponse.json();
  assert.equal(menuResponse.status, 200);
  assert.ok(menu.length > 0);

  const orderResponse = await fetch(`${api}/cashier/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` },
    body: JSON.stringify({ items: [{ menuItemId: menu[0].id, quantity: 2 }] }),
  });
  const order = await orderResponse.json();
  assert.equal(orderResponse.status, 201);
  console.log(`Cashier order creation passed in isolated database for order ${order.id}.`);
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
