import { PrismaClient } from '@prisma/client';
import { notifyNewOrder } from '../orderBot';
import { OrderService } from '../services/orderService';

const prisma = new PrismaClient();

export async function createOrderAndNotify(tenantId: string, cashierId: string, items: Array<{ productId: string; qty: number }>) {
  const order = await OrderService.createOrder(tenantId, cashierId, items);
  const admin = process.env.MAIN_ADMIN;
  if (admin) await notifyNewOrder(admin, order);
  return order;
}
