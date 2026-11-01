#!/usr/bin/env node

/**
 * Full end-to-end flow test for Steakz Restaurant Portal
 * Tests: Customer → Cashier → Chef → Cashier → Customer order flow
 */

import { withIsolatedApi } from './e2e_test_environment.js';

let BASE_URL;

async function api(method, endpoint, body = null, token = null) {
  const url = `${BASE_URL}${endpoint}`;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);

  try {
    const res = await fetch(url, options);
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (e) {
      console.error(`[PARSE ERROR] ${method} ${endpoint} status=${res.status}`);
      console.error(`Response text (first 500 chars): ${text.substring(0, 500)}`);
      throw new Error(`Failed to parse JSON from ${endpoint}: ${e.message}`);
    }

    if (!res.ok) {
      console.error(`[API ERROR] ${method} ${endpoint} status=${res.status}`, data);
      throw new Error(`API error: ${res.status} ${JSON.stringify(data)}`);
    }

    return data;
  } catch (e) {
    console.error(`[FETCH ERROR] ${method} ${endpoint}: ${e.message}`);
    throw e;
  }
}

async function run() {
  try {
    console.log('\n=== STEAKZ E2E FULL FLOW TEST ===\n');

    // 1. CUSTOMER: Register and login
    console.log('1. CUSTOMER: Register and login');
    const custEmail = `e2e+${Date.now()}@example.com`;
    const custRegister = await api('POST', '/auth/register', {
      name: 'E2E Customer',
      email: custEmail,
      password: 'password123',
    });
    console.log(`   ✓ Customer registered: ${custEmail}`);

    const custLogin = await api('POST', '/auth/login', {
      email: custEmail,
      password: 'password123',
    });
    const custToken = custLogin.token;
    console.log('   ✓ Customer logged in');

    // 2. CUSTOMER: Get branches and tables
    console.log('\n2. CUSTOMER: Get branches and tables');
    const branches = await api('GET', '/public/branches');
    console.log(`   ✓ Found ${branches.length} branches`);
    const branchId = branches[0]?.id;
    if (!branchId) throw new Error('No branches found');

    const branchDetail = await api('GET', `/public/branches/${branchId}`);
    const tables = branchDetail.tables || [];
    console.log(`   ✓ Branch ${branches[0].name} has ${tables.length} tables`);
    const tableId = tables[0]?.id;
    if (!tableId) throw new Error('No tables found');

    // 3. CUSTOMER: Create booking
    console.log('\n3. CUSTOMER: Create booking');
    const bookingRes = await api('POST', '/customer/bookings', {
      tableId,
      guestCount: 2,
      date: new Date(Date.now() + 3600000).toISOString(),
    }, custToken);
    const bookingId = bookingRes.id;
    console.log(`   ✓ Booking created: ${bookingId}`);

    // 4. CUSTOMER: View menu and place order
    console.log('\n4. CUSTOMER: View menu and place order');
    const menu = await api('GET', `/menu/${branchId}`);
    console.log(`   ✓ Found ${menu.length} menu items`);
    if (menu.length === 0) throw new Error('No menu items available');

    const orderRes = await api('POST', '/customer/orders', {
      bookingId,
      items: [
        { menuItemId: menu[0].id, quantity: 1 },
        { menuItemId: menu[1].id, quantity: 1 },
      ],
    }, custToken);
    const orderId = orderRes.id;
    console.log(`   ✓ Order created: ${orderId}, status: ${orderRes.status}, payment: ${orderRes.paymentStatus}`);

    // 5. CASHIER: Login and view orders
    console.log('\n5. CASHIER: Login and view orders');
    const cashierEmail = `${branches[0].name.toLowerCase().replace(/\s+/g, '.')}.cashier@steakz.com`;
    const cashierLogin = await api('POST', '/auth/login', {
      email: cashierEmail,
      password: 'password123',
    });
    const cashierToken = cashierLogin.token;
    console.log(`   ✓ Cashier logged in: ${cashierEmail}`);

    const cashierOrders = await api('GET', '/cashier/orders', null, cashierToken);
    console.log(`   ✓ Cashier sees ${cashierOrders.length} orders`);
    const orderInList = cashierOrders.find(o => o.id === orderId);
    if (!orderInList) throw new Error(`Order ${orderId} not visible to cashier`);
    console.log(`   ✓ Order ${orderId} found in cashier view`);

    // 6. CASHIER: Mark order PAID
    console.log('\n6. CASHIER: Mark order PAID');
    const paidRes = await api('PATCH', `/cashier/orders/${orderId}/pay`, {}, cashierToken);
    console.log(`   ✓ Order marked PAID, paymentStatus: ${paidRes.paymentStatus}`);
    if (paidRes.paymentStatus !== 'PAID') throw new Error('Order not marked PAID');

    // 7. CHEF: Login and view orders
    console.log('\n7. CHEF: Login and view orders');
    const chefEmail = `${branches[0].name.toLowerCase().replace(/\s+/g, '.')}.chef@steakz.com`;
    const chefLogin = await api('POST', '/auth/login', {
      email: chefEmail,
      password: 'password123',
    });
    const chefToken = chefLogin.token;
    console.log(`   ✓ Chef logged in: ${chefEmail}`);

    const chefOrders = await api('GET', '/chef/orders', null, chefToken);
    console.log(`   ✓ Chef sees ${chefOrders.length} orders`);
    const orderInChefView = chefOrders.find(o => o.id === orderId);
    if (!orderInChefView) throw new Error(`Order ${orderId} not visible to chef`);
    console.log(`   ✓ Order ${orderId} found in chef view`);

    // 8. CHEF: Mark order PREPARING
    console.log('\n8. CHEF: Mark order PREPARING');
    const preparingRes = await api('PATCH', `/chef/orders/${orderId}/preparing`, {}, chefToken);
    console.log(`   ✓ Order marked PREPARING, status: ${preparingRes.status}`);
    if (preparingRes.status !== 'PREPARING') throw new Error('Order not marked PREPARING');

    // 9. CHEF: Mark order DONE
    console.log('\n9. CHEF: Mark order DONE');
    const doneRes = await api('PATCH', `/chef/orders/${orderId}/done`, {}, chefToken);
    console.log(`   ✓ Order marked DONE, status: ${doneRes.status}`);
    if (doneRes.status !== 'DONE') throw new Error('Order not marked DONE');

    // 10. CASHIER: Mark order DELIVERED
    console.log('\n10. CASHIER: Mark order DELIVERED');
    const deliveredRes = await api('PATCH', `/cashier/orders/${orderId}/deliver`, {}, cashierToken);
    console.log(`   ✓ Order marked DELIVERED, status: ${deliveredRes.status}`);
    if (deliveredRes.status !== 'DELIVERED') throw new Error('Order not marked DELIVERED');

    // 11. CUSTOMER: Verify final order status
    console.log('\n11. CUSTOMER: Verify final order status');
    const custOrders = await api('GET', '/customer/orders', null, custToken);
    const finalOrder = custOrders.find(o => o.id === orderId);
    console.log(`   ✓ Customer sees order ${orderId}: status=${finalOrder.status}, payment=${finalOrder.paymentStatus}`);
    if (finalOrder.status !== 'DELIVERED') throw new Error('Final status is not DELIVERED');
    if (finalOrder.paymentStatus !== 'PAID') throw new Error('Final payment status is not PAID');

    // 12. ADMIN: Create a staff user
    console.log('\n12. ADMIN: Create a staff user');
    const adminLogin = await api('POST', '/auth/login', {
      email: 'admin@steakz.com',
      password: 'admin123',
    });
    const adminToken = adminLogin.token;
    console.log(`   ✓ Admin logged in`);

    const newStaffEmail = `newstaff+${Date.now()}@example.com`;
    const staffRes = await api('POST', '/admin/users', {
      name: 'New Staff Member',
      email: newStaffEmail,
      password: 'password123',
      role: 'CASHIER',
      branchId: branchId,
      salary: 40000,
    }, adminToken);
    console.log(`   ✓ New staff user created: ${newStaffEmail}`);

    // 13. New staff: Verify login works
    console.log('\n13. New staff: Verify login works');
    const newStaffLogin = await api('POST', '/auth/login', {
      email: newStaffEmail,
      password: 'password123',
    });
    const newStaffToken = newStaffLogin.token;
    console.log(`   ✓ New staff can login`);

    // 14. New staff: Can view menu
    console.log('\n14. New staff: Can view menu');
    const newStaffMenu = await api('GET', '/cashier/menu', null, newStaffToken);
    console.log(`   ✓ New staff sees ${newStaffMenu.length} menu items`);

    // 15. HQ: View all branches
    console.log('\n15. HQ: View all branches');
    const hqLogin = await api('POST', '/auth/login', {
      email: 'hq@steakz.com',
      password: 'password123',
    });
    const hqToken = hqLogin.token;
    console.log(`   ✓ HQ Manager logged in`);

    const hqOverview = await api('GET', '/hq/overview', null, hqToken);
    console.log(`   ✓ HQ sees ${hqOverview.length} branches`);

    // 16. HQ: View all orders
    console.log('\n16. HQ: View all orders');
    const hqOrders = await api('GET', '/hq/orders', null, hqToken);
    console.log(`   ✓ HQ sees ${hqOrders.length} orders across all branches`);

    // 17. HQ: View all staff
    console.log('\n17. HQ: View all staff');
    const hqStaff = await api('GET', '/hq/staff', null, hqToken);
    console.log(`   ✓ HQ sees ${hqStaff.length} staff members`);

    // 18. HQ: View sales
    console.log('\n18. HQ: View sales');
    const hqSales = await api('GET', '/hq/sales', null, hqToken);
    console.log(`   ✓ HQ sees sales data: ${JSON.stringify(hqSales.slice(0, 1))}`);

    console.log('\n✅ E2E FULL FLOW TEST PASSED\n');
  } catch (e) {
    console.error('\n❌ E2E FULL FLOW TEST FAILED');
    console.error(`Error: ${e.message}\n`);
    throw e;
  }
}

withIsolatedApi(async (baseUrl) => {
  BASE_URL = `${baseUrl}/api`;
  await run();
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
