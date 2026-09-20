import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { createAuthToken } from '../middlewares/authMiddleware';
const prisma = new PrismaClient();
async function main() { const [id, tenantId, role] = process.argv.slice(2); if (!id || !tenantId || !['ADMIN', 'CASHIER'].includes(role)) throw new Error('Usage: npm run token -- user-id tenant-id ADMIN|CASHIER'); const user = await prisma.user.findFirst({ where: { id, tenantId, role } }); if (!user) throw new Error('User not found'); console.log(createAuthToken({ id: user.id, tenantId: user.tenantId, role: user.role as 'ADMIN' | 'CASHIER', name: user.name })); }
main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
