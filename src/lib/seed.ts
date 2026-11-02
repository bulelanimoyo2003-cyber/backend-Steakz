import bcrypt from 'bcryptjs';
import type { Role } from '@prisma/client';
import prisma from './prisma.js';

const BRANCHES = [
  { name: 'Steakz City Centre', address: '1 Main Street, City Centre' },
  { name: 'Steakz Northside', address: '45 North Ave, Northside' },
  { name: 'Steakz Southgate', address: '88 South Road, Southgate' },
  { name: 'Steakz East Quarter', address: '12 East Lane, East Quarter' },
  { name: 'Steakz Westfield', address: '200 West Mall, Westfield' },
  { name: 'Steakz Marina Bay', address: '9 Marina Blvd, Marina Bay' },
  { name: 'Steakz Uptown', address: '77 Uptown Drive, Uptown' },
];

const ACTIVE_BRANCH_NAMES = [
  'Steakz City Centre',
  'Steakz Northside',
  'Steakz Southgate',
  'Steakz Uptown',
];
const SHARED_BRANCH_MANAGER_EMAIL = 'steakz.city.centre.manager@steakz.com';

const MENU_ITEMS = [
  { name: 'Ribeye 300g', description: 'Aged ribeye with caramelized shallots', price: 38.9, category: 'Steaks' },
  { name: 'Filet Mignon', description: 'Tender filet with truffle butter', price: 44.5, category: 'Steaks' },
  { name: 'Lamb Chops', description: 'Herb-crusted lamb served with mint jus', price: 35.0, category: 'Specialties' },
  { name: 'Lasagna', description: 'Baked layers of pasta, cheese, and rich meat sauce', price: 18.5, category: 'Mains' },
  { name: 'Beef Burger', description: 'Juicy beef patty with lettuce, tomato, and special sauce', price: 16.0, category: 'Burgers' },
  { name: 'Cheese Burger', description: 'Classic beef burger topped with melted cheddar', price: 17.0, category: 'Burgers' },
  { name: 'Chicken Burger', description: 'Crispy chicken fillet with slaw and garlic mayo', price: 15.5, category: 'Burgers' },
  { name: 'BBQ Ribs', description: 'Slow-cooked ribs glazed in smoky BBQ sauce', price: 24.0, category: 'Specialties' },
  { name: 'Caesar Salad', description: 'Crisp romaine with parmesan and anchovy dressing', price: 12.5, category: 'Starters' },
  { name: 'Mushroom Soup', description: 'Creamy wild mushroom soup with chive oil', price: 10.0, category: 'Starters' },
  { name: 'Chocolate Fondant', description: 'Molten chocolate cake with caramel', price: 11.5, category: 'Desserts' },
  { name: 'Ice Cream', description: 'Scoops of creamy vanilla ice cream', price: 6.5, category: 'Desserts' },
  { name: 'Milkshakes', description: 'Rich milkshake with whipped cream and cherry', price: 7.0, category: 'Desserts' },
  { name: 'Apple Pie', description: 'Warm apple pie with cinnamon glaze', price: 8.0, category: 'Desserts' },
  { name: 'Banana Split', description: 'Banana, ice cream, chocolate sauce, and nuts', price: 9.0, category: 'Desserts' },
];

const TABLES = [
  { tableNumber: 1, capacity: 4 },
  { tableNumber: 2, capacity: 6 },
  { tableNumber: 3, capacity: 2 },
];

type SeedRole = Role;

const TEST_USERS: Array<{ name: string; email: string; role: SeedRole; branchId: number | null; salary: number | null }> = [
  { name: 'System Admin', email: 'admin@steakz.com', role: 'ADMIN', branchId: null, salary: null },
  { name: 'HQ Manager', email: 'hq@steakz.com', role: 'HQ_MANAGER', branchId: null, salary: 85000 },
  { name: 'Sample Customer', email: 'customer@steakz.com', role: 'CUSTOMER', branchId: null, salary: null },
];

async function ensureBranchData() {
  for (const branch of BRANCHES) {
    const isActive = ACTIVE_BRANCH_NAMES.includes(branch.name);
    let branchRecord = await prisma.branch.findUnique({ where: { name: branch.name } });
    if (!branchRecord) {
      branchRecord = await prisma.branch.create({ data: { ...branch, isActive } });
      console.log(`[Seeder] Branch created: ${branch.name}`);
    } else if (branchRecord.isActive !== isActive) {
      branchRecord = await prisma.branch.update({ where: { id: branchRecord.id }, data: { isActive } });
    }

    if (!isActive) continue;

    const existingTables = await prisma.table.findMany({ where: { branchId: branchRecord.id } });
    if (existingTables.length === 0) {
      for (const table of TABLES) {
        await prisma.table.create({ data: { ...table, branchId: branchRecord.id } });
      }
      console.log(`[Seeder] Tables created for ${branch.name}`);
    }

    const existingMenuItems = await prisma.menuItem.findMany({ where: { branchId: branchRecord.id } });
    const existingNames = new Set(existingMenuItems.map((item) => item.name));
    let createdCount = 0;
    for (const item of MENU_ITEMS) {
      if (existingNames.has(item.name)) {
        continue;
      }
      await prisma.menuItem.create({ data: { ...item, branchId: branchRecord.id } });
      createdCount += 1;
    }
    if (createdCount > 0) {
      console.log(`[Seeder] ${createdCount} missing menu items added for ${branch.name}`);
    }

    const chefEmail = `${branchRecord.name.toLowerCase().replace(/\s+/g, '.')}.chef@steakz.com`;
    const cashierEmail = `${branchRecord.name.toLowerCase().replace(/\s+/g, '.')}.cashier@steakz.com`;

    const staff = [
      { name: `${branchRecord.name} Chef`, email: chefEmail, role: 'CHEF' as SeedRole, salary: 42000 },
      { name: `${branchRecord.name} Cashier`, email: cashierEmail, role: 'CASHIER' as SeedRole, salary: 38000 },
    ];

    for (const member of staff) {
      const existing = await prisma.user.findUnique({ where: { email: member.email } });
      if (!existing) {
        await prisma.user.create({
          data: {
            name: member.name,
            email: member.email,
            password: await bcrypt.hash('password123', 10),
            role: member.role,
            branchId: branchRecord.id,
            salary: member.salary,
          },
        });
        console.log(`[Seeder] User created: ${member.email}`);
      }
    }
  }

  await prisma.branch.updateMany({
    where: { name: { notIn: ACTIVE_BRANCH_NAMES }, isActive: true },
    data: { isActive: false },
  });

  const activeBranches = await prisma.branch.findMany({
    where: { name: { in: ACTIVE_BRANCH_NAMES }, isActive: true },
    select: { id: true, name: true },
  });
  if (activeBranches.length !== ACTIVE_BRANCH_NAMES.length) {
    throw new Error('One or more configured active locations are missing or inactive.');
  }
  const cityCentre = activeBranches.find((branch) => branch.name === ACTIVE_BRANCH_NAMES[0]);
  if (!cityCentre) {
    throw new Error('The active City Centre location is missing.');
  }

  let sharedManager = await prisma.user.findUnique({ where: { email: SHARED_BRANCH_MANAGER_EMAIL } });
  if (!sharedManager) {
    sharedManager = await prisma.user.create({
      data: {
        name: 'Steakz City Centre Manager',
        email: SHARED_BRANCH_MANAGER_EMAIL,
        password: await bcrypt.hash('password123', 10),
        role: 'BRANCH_MANAGER',
        branchId: cityCentre.id,
        salary: 65000,
      },
    });
  }
  if (sharedManager.role !== 'BRANCH_MANAGER' || !sharedManager.isActive) {
    throw new Error(`The configured multi-branch manager ${SHARED_BRANCH_MANAGER_EMAIL} must be an active BRANCH_MANAGER.`);
  }

  await prisma.branchManagerAssignment.deleteMany({
    where: {
      branchId: { in: activeBranches.map((branch) => branch.id) },
      userId: { not: sharedManager.id },
    },
  });
  for (const branch of activeBranches) {
    await prisma.branchManagerAssignment.upsert({
      where: { userId_branchId: { userId: sharedManager.id, branchId: branch.id } },
      update: {},
      create: { userId: sharedManager.id, branchId: branch.id },
    });
  }
}

export async function seed() {
  const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@steakz.com';
  const adminPassword = process.env.ADMIN_PASSWORD ?? 'admin123';

  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!existingAdmin) {
    const hashed = await bcrypt.hash(adminPassword, 10);
    await prisma.user.create({
      data: { name: 'System Admin', email: adminEmail, password: hashed, role: 'ADMIN' },
    });
    console.log(`[Seeder] Admin created: ${adminEmail}`);
  } else {
    console.log('[Seeder] Admin already exists — skipping.');
  }

  for (const user of TEST_USERS.slice(1)) {
    const existing = await prisma.user.findUnique({ where: { email: user.email } });
    if (!existing) {
      await prisma.user.create({
        data: {
          name: user.name,
          email: user.email,
          password: await bcrypt.hash('password123', 10),
          role: user.role as any,
          branchId: user.branchId,
          salary: user.salary,
        },
      });
      console.log(`[Seeder] User created: ${user.email}`);
    }
  }

  await ensureBranchData();
}
