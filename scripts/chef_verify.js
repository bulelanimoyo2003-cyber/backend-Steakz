import assert from 'node:assert/strict';
import { withIsolatedApi } from './e2e_test_environment.js';

await withIsolatedApi(async (baseUrl) => {
  const api = `${baseUrl}/api`;
  const signIn = async (email, password) => {
    const response = await fetch(`${api}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await response.json();
    assert.equal(response.status, 200, 'Test account login must succeed.');
    return data.token;
  };
  const customerToken = await signIn('customer@steakz.com', 'password123');
  const chefToken = await signIn('steakz.city.centre.chef@steakz.com', 'password123');
  const branchesResponse = await fetch(`${api}/public/branches`);
  const branches = await branchesResponse.json();
  const menuResponse = await fetch(`${api}/menu/${branches[0].id}`);
  const menu = await menuResponse.json();
  assert.ok(menu.length > 0, 'Seeded menu item is required.');

  const orderResponse = await fetch(`${api}/customer/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${customerToken}` },
    body: JSON.stringify({
      orderType: 'COLLECTION',
      branchId: branches[0].id,
      items: [{ menuItemId: menu[0].id, quantity: 1 }],
    }),
  });
  const order = await orderResponse.json();
  assert.equal(orderResponse.status, 201);

  const prepareResponse = await fetch(`${api}/chef/orders/${order.id}/preparing`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${chefToken}` },
  });
  assert.equal(prepareResponse.status, 200);
  const doneResponse = await fetch(`${api}/chef/orders/${order.id}/done`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${chefToken}` },
  });
  assert.equal(doneResponse.status, 200);

  const afterResponse = await fetch(`${api}/chef/orders`, {
    headers: { Authorization: `Bearer ${chefToken}` },
  });
  const activeOrders = await afterResponse.json();
  assert.ok(!activeOrders.some((candidate) => candidate.id === order.id));
  console.log(`Chef workflow passed in isolated database for order ${order.id}.`);
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
