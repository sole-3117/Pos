import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const tenant = await prisma.tenant.upsert({ where: { id: 'default-tenant' }, update: {}, create: { id: 'default-tenant', name: 'Default POS' } });
  await prisma.user.upsert({ where: { id: 'admin-1' }, update: { tenantId: tenant.id, role: 'ADMIN' }, create: { id: 'admin-1', tenantId: tenant.id, name: 'Administrator', role: 'ADMIN' } });
  await prisma.user.upsert({ where: { id: 'cashier-1' }, update: { tenantId: tenant.id, role: 'CASHIER' }, create: { id: 'cashier-1', tenantId: tenant.id, name: 'Kassir', role: 'CASHIER' } });
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
