import assert from 'node:assert/strict';
import { withIsolatedApi } from './e2e_test_environment.js';

async function request(baseUrl, method, endpoint, body, token, branchId) {
  const response = await fetch(`${baseUrl}/api${endpoint}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(branchId ? { 'X-Branch-Id': String(branchId) } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${method} ${endpoint} returned invalid JSON (HTTP ${response.status}).`);
  }
  return { status: response.status, data };
}

async function expectStatus(baseUrl, method, endpoint, token, expectedStatus, body, branchId) {
  const result = await request(baseUrl, method, endpoint, body, token, branchId);
  assert.equal(result.status, expectedStatus, `${method} ${endpoint} response: ${JSON.stringify(result.data)}`);
  return result.data;
}

async function login(baseUrl, email, password, expectedRole) {
  const data = await expectStatus(baseUrl, 'POST', '/auth/login', undefined, 200, { email, password });
  assert.equal(data.user.role, expectedRole);
  return data.token;
}

await withIsolatedApi(async (baseUrl) => {
  const nonce = `${Date.now()}-${process.pid}`;
  const branches = await expectStatus(baseUrl, 'GET', '/public/branches', undefined, 200);
  assert.deepEqual(branches.map((branch) => branch.name), [
    'Steakz City Centre',
    'Steakz Northside',
    'Steakz Southgate',
    'Steakz Uptown',
  ]);
  const branchData = [];

  const adminToken = await login(baseUrl, 'admin@steakz.com', 'admin123', 'ADMIN');
  const hqToken = await login(baseUrl, 'hq@steakz.com', 'password123', 'HQ_MANAGER');
  const sampleCustomerToken = await login(baseUrl, 'customer@steakz.com', 'password123', 'CUSTOMER');
  assert.ok(sampleCustomerToken);

  const customerEmail = `delivery-customer-${nonce}@test.invalid`;
  const otherCustomerEmail = `other-customer-${nonce}@test.invalid`;
  for (const [name, email] of [['Delivery Test Customer', customerEmail], ['Other Test Customer', otherCustomerEmail]]) {
    const registered = await request(baseUrl, 'POST', '/auth/register', { name, email, password: 'Password123!' });
    assert.ok([200, 201].includes(registered.status), `Customer registration failed: ${JSON.stringify(registered.data)}`);
  }
  const customerToken = await login(baseUrl, customerEmail, 'Password123!', 'CUSTOMER');
  const otherCustomerToken = await login(baseUrl, otherCustomerEmail, 'Password123!', 'CUSTOMER');

  for (const branch of branches) {
    const emailPrefix = branch.name.toLowerCase().replace(/\s+/g, '.');
    const managerToken = await login(baseUrl, `${emailPrefix}.manager@steakz.com`, 'password123', 'BRANCH_MANAGER');
    const chefToken = await login(baseUrl, `${emailPrefix}.chef@steakz.com`, 'password123', 'CHEF');
    const cashierToken = await login(baseUrl, `${emailPrefix}.cashier@steakz.com`, 'password123', 'CASHIER');
    const menu = await expectStatus(baseUrl, 'GET', `/menu/${branch.id}`, undefined, 200);
    assert.ok(menu.length > 0, `Branch ${branch.id} must have an available menu item.`);

    const driverEmail = `delivery-driver-${branch.id}-${nonce}@test.invalid`;
    const createdDriver = await expectStatus(baseUrl, 'POST', '/branch-manager/staff/drivers', managerToken, 201, {
      name: `Delivery Test Driver ${branch.id}`,
      email: driverEmail,
      password: 'Password123!',
    }, branch.id);
    assert.equal(createdDriver.branchId, branch.id);
    const driverToken = await login(baseUrl, driverEmail, 'Password123!', 'DELIVERY_DRIVER');
    const driverChoices = await expectStatus(baseUrl, 'GET', `/delivery-management/drivers?branchId=${branch.id}`, managerToken, 200, undefined, branch.id);
    assert.ok(driverChoices.some((driver) => driver.id === createdDriver.id), 'Manager must see its eligible same-branch driver.');
    branchData.push({ branch, managerToken, chefToken, cashierToken, driverToken, driver: createdDriver, menuItem: menu[0] });
  }

  const extraDriver = await expectStatus(baseUrl, 'POST', '/branch-manager/staff/drivers', branchData[0].managerToken, 201, {
    name: 'Unassigned Same-Branch Driver',
    email: `unassigned-driver-${nonce}@test.invalid`,
    password: 'Password123!',
  }, branchData[0].branch.id);
  const extraDriverToken = await login(baseUrl, extraDriver.email, 'Password123!', 'DELIVERY_DRIVER');

  const orders = [];
  for (const { branch, managerToken, chefToken, driverToken, driver, menuItem } of branchData) {
    const createResult = await request(baseUrl, 'POST', '/customer/orders', {
      orderType: 'DELIVERY',
      branchId: branch.id,
      recipientName: 'Delivery Test Recipient',
      recipientPhone: '+1 (555) 010-0100',
      deliveryAddress: `${branch.address}, Delivery Test`,
      deliveryInstructions: branch.id === branches[0].id ? undefined : `Use the test entrance for branch ${branch.id}.`,
      items: [{ menuItemId: menuItem.id, quantity: 1 }],
    }, customerToken);
    assert.equal(createResult.status, 201, `Delivery checkout failed for branch ${branch.id}: ${JSON.stringify(createResult.data)}`);
    const order = createResult.data;
    assert.equal(order.orderType, 'DELIVERY');
    assert.equal(order.status, 'PENDING');
    assert.equal(order.deliveryStatus, null);
    assert.equal(order.paymentStatus, 'UNPAID');
    assert.equal(order.recipientPhone, '+1 (555) 010-0100');
    assert.match(order.deliveryAddress, /Delivery Test/);
    if (branch.id === branches[0].id) {
      assert.equal(order.deliveryInstructions, null, 'Delivery instructions are optional.');
    } else {
      assert.ok(order.deliveryInstructions.includes('test entrance'));
    }

    const unassignedDriverOrders = await expectStatus(baseUrl, 'GET', '/driver/orders', driverToken, 200);
    assert.deepEqual(unassignedDriverOrders, []);
    const assignment = await expectStatus(baseUrl, 'PATCH', `/delivery-management/orders/${order.id}/driver`, managerToken, 200, { driverId: driver.id }, branch.id);
    assert.equal(assignment.deliveryStatus, 'ASSIGNED');
    assert.equal(assignment.assignedDriverId, driver.id);
    const pendingOrders = await expectStatus(baseUrl, 'GET', '/chef/orders', chefToken, 200);
    assert.deepEqual(pendingOrders.map((candidate) => candidate.id), [order.id]);
    const assignedProgress = await expectStatus(baseUrl, 'GET', '/customer/orders', customerToken, 200);
    assert.equal(assignedProgress.find((candidate) => candidate.id === order.id)?.deliveryStatus, 'ASSIGNED');

    await expectStatus(baseUrl, 'PATCH', `/driver/orders/${order.id}/pickup`, driverToken, 409);
    orders.push({ order, branch, managerToken, chefToken, driverToken, driver });
  }

  if (branchData.length > 1) {
    const first = orders[0];
    const second = orders[1];
    await expectStatus(baseUrl, 'GET', `/delivery-management/drivers?branchId=${second.branch.id}`, first.managerToken, 403, undefined, first.branch.id);
    await expectStatus(baseUrl, 'PATCH', `/delivery-management/orders/${second.order.id}/driver`, first.managerToken, 403, {
      driverId: branchData[1].driver.id,
    }, first.branch.id);
    await expectStatus(baseUrl, 'PATCH', `/delivery-management/orders/${first.order.id}/driver`, first.managerToken, 400, {
      driverId: branchData[1].driver.id,
    }, first.branch.id);
    await expectStatus(baseUrl, 'PATCH', `/chef/orders/${second.order.id}/preparing`, first.chefToken, 403);
  }

  for (const { order, branch, managerToken, chefToken, driverToken, driver } of orders) {
    const ownBranchOrders = await expectStatus(baseUrl, 'GET', '/branch-manager/orders', managerToken, 200, undefined, branch.id);
    assert.ok(ownBranchOrders.some((candidate) => candidate.id === order.id));
    assert.ok(ownBranchOrders.every((candidate) => candidate.branchId === branch.id));
    const branchIndex = branches.findIndex((candidate) => candidate.id === branch.id);
    const cashierOrders = await expectStatus(baseUrl, 'GET', '/cashier/orders', branchData[branchIndex].cashierToken, 200);
    assert.deepEqual(cashierOrders.map((candidate) => candidate.id), [order.id]);
    await expectStatus(baseUrl, 'GET', `/branch-manager/orders`, branchData[0].managerToken, 200, undefined, branches[0].id).then((list) => {
      if (branch.id !== branches[0].id) assert.ok(list.every((candidate) => candidate.branchId === branches[0].id));
    });

    const driverOrders = await expectStatus(baseUrl, 'GET', '/driver/orders', driverToken, 200);
    assert.deepEqual(driverOrders.map((candidate) => candidate.id), [order.id]);
    assert.ok(driverOrders.every((candidate) => candidate.assignedDriverId === driver.id));
    const otherDriverOrders = await expectStatus(baseUrl, 'GET', '/driver/orders', extraDriverToken, 200);
    assert.ok(otherDriverOrders.every((candidate) => candidate.id !== order.id));
    await expectStatus(baseUrl, 'PATCH', `/driver/orders/${order.id}/pickup`, extraDriverToken, 404);

    await expectStatus(baseUrl, 'PATCH', `/chef/orders/${order.id}/preparing`, chefToken, 200);
    await expectStatus(baseUrl, 'PATCH', `/chef/orders/${order.id}/done`, chefToken, 200);
    const readyProgress = await expectStatus(baseUrl, 'GET', '/customer/orders', customerToken, 200);
    const readyOrder = readyProgress.find((candidate) => candidate.id === order.id);
    assert.equal(readyOrder?.status, 'DONE');
    assert.equal(readyOrder?.deliveryStatus, 'ASSIGNED');
    const pickup = await expectStatus(baseUrl, 'PATCH', `/driver/orders/${order.id}/pickup`, driverToken, 200);
    assert.equal(pickup.deliveryStatus, 'OUT_FOR_DELIVERY');
    const enRouteProgress = await expectStatus(baseUrl, 'GET', '/customer/orders', customerToken, 200);
    assert.equal(enRouteProgress.find((candidate) => candidate.id === order.id)?.deliveryStatus, 'OUT_FOR_DELIVERY');
    const delivered = await expectStatus(baseUrl, 'PATCH', `/driver/orders/${order.id}/delivered`, driverToken, 200);
    assert.equal(delivered.deliveryStatus, 'DELIVERED');
    assert.equal(delivered.status, 'DELIVERED');
  }

  const customerOrders = await expectStatus(baseUrl, 'GET', '/customer/orders', customerToken, 200);
  assert.deepEqual(new Set(customerOrders.map((order) => order.id)), new Set(orders.map(({ order }) => order.id)));
  assert.ok(customerOrders.every((order) => order.deliveryStatus === 'DELIVERED' && order.paymentStatus === 'UNPAID'));
  const otherCustomerOrders = await expectStatus(baseUrl, 'GET', '/customer/orders', otherCustomerToken, 200);
  assert.deepEqual(otherCustomerOrders, []);
  await expectStatus(baseUrl, 'GET', `/customer/receipt/${orders[0].order.id}`, otherCustomerToken, 404);

  const hqDrivers = await expectStatus(baseUrl, 'GET', `/delivery-management/drivers?branchId=${branches.at(-1).id}`, hqToken, 200);
  assert.ok(hqDrivers.length > 0, 'HQ manager may view drivers for an authorised branch.');
  const adminDrivers = await expectStatus(baseUrl, 'GET', `/delivery-management/drivers?branchId=${branches[0].id}`, adminToken, 200);
  assert.ok(adminDrivers.length > 0);

  if (branchData.length > 1) {
    await expectStatus(baseUrl, 'PATCH', `/cashier/orders/${orders[0].order.id}/pay`, branchData[1].cashierToken, 403);
  }
  const paid = await expectStatus(baseUrl, 'PATCH', `/cashier/orders/${orders[0].order.id}/pay`, branchData[0].cashierToken, 200);
  assert.equal(paid.paymentStatus, 'PAID', 'Payment is a separate cashier action.');
  assert.equal(paid.status, 'DELIVERED');

  console.log(`Delivery E2E passed for all ${branches.length} configured branches; verified branch, customer, driver, delivery-state, and payment isolation.`);
});
