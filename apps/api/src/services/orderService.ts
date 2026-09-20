import { PrismaClient, OrderStatus, PaymentStatus, StockMovementType, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

const ALLOWED_DIRECT_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.NEW]: [],
  [OrderStatus.CONFIRMED]: [OrderStatus.PREPARING],
  [OrderStatus.PREPARING]: [OrderStatus.COMPLETED],
  [OrderStatus.COMPLETED]: [],
  [OrderStatus.CANCELLED]: []
};

export class OrderService {
  static async createOrder(tenantId: string, cashierId: string, itemsData: Array<{ productId: string; qty: number }>) {
    if (!Array.isArray(itemsData) || itemsData.length === 0) throw new Error('Buyurtmada kamida bitta mahsulot bo\'lishi shart');
    const aggregatedItemsMap = new Map<string, number>();
    for (const item of itemsData) {
      if (!item.productId || typeof item.productId !== 'string') throw new Error('Mahsulot identifikatori noto\'g\'ri');
      if (typeof item.qty !== 'number' || !Number.isInteger(item.qty) || item.qty <= 0) throw new Error('Mahsulot miqdori musbat butun son bo\'lishi shart');
      aggregatedItemsMap.set(item.productId, (aggregatedItemsMap.get(item.productId) || 0) + item.qty);
    }
    const ids = Array.from(aggregatedItemsMap.keys());
    return prisma.$transaction(async (tx) => {
      const products = await tx.product.findMany({ where: { id: { in: ids }, tenantId } });
      if (products.length !== ids.length) throw new Error('Mahsulot topilmadi yoki bu do\'konga tegishli emas');
      const productMap = new Map(products.map((p) => [p.id, p]));
      let totalAmount = new Prisma.Decimal(0);
      const items = ids.map((productId) => {
        const product = productMap.get(productId)!;
        const qty = aggregatedItemsMap.get(productId)!;
        totalAmount = totalAmount.add(new Prisma.Decimal(product.price).mul(qty));
        return { productId, qty, priceAtSale: product.price };
      });
      return tx.order.create({
        data: { tenantId, cashierId, status: OrderStatus.NEW, paymentStatus: PaymentStatus.UNPAID, totalAmount, items: { create: items } },
        include: { items: { include: { product: true } }, cashier: { select: { id: true, name: true } }, payments: true }
      });
    });
  }

  static async confirmOrder(orderId: string, tenantId: string) {
    return prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string; status: OrderStatus }>>`SELECT id, status FROM "Order" WHERE id = ${orderId} AND "tenantId" = ${tenantId} FOR UPDATE`;
      const record = locked[0];
      if (!record) throw new Error('Buyurtma topilmadi');
      if (record.status !== OrderStatus.NEW) throw new Error(`Faqat NEW statusidagi buyurtmani tasdiqlash mumkin. Hozirgi status: ${record.status}`);
      const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
      if (!order?.items.length) throw new Error('Buyurtmada mahsulotlar mavjud emas');
      const totals = new Map<string, number>();
      for (const item of order.items) totals.set(item.productId, (totals.get(item.productId) || 0) + item.qty);
      for (const productId of Array.from(totals.keys()).sort()) {
        const qty = totals.get(productId)!;
        const lockedProduct = (await tx.$queryRaw<Array<{ id: string; stock: number; name: string }>>`SELECT id, stock, name FROM "Product" WHERE id = ${productId} AND "tenantId" = ${tenantId} FOR UPDATE`)[0];
        if (!lockedProduct) throw new Error('Mahsulot topilmadi');
        if (lockedProduct.stock < qty) throw new Error(`Omborda yetarli mahsulot yo'q: "${lockedProduct.name}"`);
        await tx.product.update({ where: { id: productId }, data: { stock: { decrement: qty } } });
        await tx.stockMovement.create({ data: { productId, type: StockMovementType.OUT, qty, orderId, reason: `Buyurtma #${orderId} tasdiqlandi` } });
      }
      return tx.order.update({ where: { id: orderId }, data: { status: OrderStatus.CONFIRMED }, include: { items: { include: { product: true } }, cashier: { select: { id: true, name: true } }, payments: true } });
    });
  }

  static async updateStatus(orderId: string, tenantId: string, targetStatus: OrderStatus) {
    if (targetStatus === OrderStatus.CONFIRMED || targetStatus === OrderStatus.CANCELLED) throw new Error('Bu status uchun maxsus amal endpointidan foydalaning');
    const order = await prisma.order.findFirst({ where: { id: orderId, tenantId } });
    if (!order) throw new Error('Buyurtma topilmadi');
    if (targetStatus === OrderStatus.COMPLETED && order.paymentStatus !== PaymentStatus.PAID) throw new Error('To\'lov to\'liq amalga oshirilmasdan buyurtmani yakunlab bo\'lmaydi');
    const allowed = ALLOWED_DIRECT_TRANSITIONS[order.status];
    if (!allowed?.includes(targetStatus)) throw new Error(`Noto'g'ri o'tish: ${order.status} holatidan ${targetStatus} holatiga o'tib bo'lmaydi`);
    return prisma.order.update({ where: { id: orderId }, data: { status: targetStatus }, include: { items: { include: { product: true } }, cashier: { select: { id: true, name: true } }, payments: true } });
  }

  static async cancelOrder(orderId: string, tenantId: string, reason: string) {
    if (!reason?.trim()) throw new Error('Bekor qilish sababini kiritish majburiy');
    return prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string; status: OrderStatus }>>`SELECT id, status FROM "Order" WHERE id = ${orderId} AND "tenantId" = ${tenantId} FOR UPDATE`;
      const record = locked[0];
      if (!record) throw new Error('Buyurtma topilmadi');
      if ([OrderStatus.COMPLETED, OrderStatus.CANCELLED].includes(record.status)) throw new Error(`${record.status} holatidagi buyurtmani bekor qilib bo'lmaydi`);
      const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
      if (!order) throw new Error('Buyurtma topilmadi');
      if ([OrderStatus.CONFIRMED, OrderStatus.PREPARING].includes(order.status)) {
        const totals = new Map<string, number>();
        for (const item of order.items) totals.set(item.productId, (totals.get(item.productId) || 0) + item.qty);
        for (const [productId, qty] of totals) {
          await tx.product.update({ where: { id: productId }, data: { stock: { increment: qty } } });
          await tx.stockMovement.create({ data: { productId, type: StockMovementType.RETURN, qty, orderId, reason: `Buyurtma bekor qilindi. Sabab: ${reason.trim()}` } });
        }
      }
      return tx.order.update({ where: { id: orderId }, data: { status: OrderStatus.CANCELLED, cancelReason: reason.trim() }, include: { items: { include: { product: true } }, cashier: { select: { id: true, name: true } }, payments: true } });
    });
  }

  static async addPayment(orderId: string, tenantId: string, amount: number, method: 'cash' | 'card' | 'online') {
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('To\'lov summasi musbat son bo\'lishi kerak');
    if (!['cash', 'card', 'online'].includes(method)) throw new Error('Noto\'g\'ri to\'lov usuli');
    return prisma.$transaction(async (tx) => {
      const locked = (await tx.$queryRaw<Array<{ id: string; status: OrderStatus; totalAmount: Prisma.Decimal }>>`SELECT id, status, "totalAmount" FROM "Order" WHERE id = ${orderId} AND "tenantId" = ${tenantId} FOR UPDATE`)[0];
      if (!locked) throw new Error('Buyurtma topilmadi');
      if (locked.status === OrderStatus.CANCELLED) throw new Error('Bekor qilingan buyurtmaga to\'lov qabul qilinmaydi');
      await tx.payment.create({ data: { orderId, amount: new Prisma.Decimal(amount), method, status: 'success' } });
      const payments = await tx.payment.findMany({ where: { orderId, status: 'success' } });
      const paid = payments.reduce((sum, payment) => sum.add(payment.amount), new Prisma.Decimal(0));
      const paymentStatus = paid.gte(locked.totalAmount) ? PaymentStatus.PAID : paid.gt(0) ? PaymentStatus.PARTIAL : PaymentStatus.UNPAID;
      return tx.order.update({ where: { id: orderId }, data: { paymentStatus }, include: { payments: true, items: { include: { product: true } }, cashier: { select: { id: true, name: true } } } });
    });
  }

  static async getOrders(tenantId: string, filters: { status?: OrderStatus; from?: string; to?: string; page?: number; limit?: number }) {
    const page = Number.isFinite(Number(filters.page)) && Number(filters.page) > 0 ? Number(filters.page) : 1;
    const limit = Number.isFinite(Number(filters.limit)) && Number(filters.limit) > 0 ? Math.min(Number(filters.limit), 100) : 20;
    const where: Prisma.OrderWhereInput = { tenantId };
    if (filters.status && Object.values(OrderStatus).includes(filters.status)) where.status = filters.status;
    const createdAt: Prisma.DateTimeFilter = {};
    if (filters.from && !isNaN(new Date(filters.from).getTime())) createdAt.gte = new Date(filters.from);
    if (filters.to && !isNaN(new Date(filters.to).getTime())) createdAt.lte = new Date(filters.to);
    if (Object.keys(createdAt).length) where.createdAt = createdAt;
    const [total, orders] = await Promise.all([prisma.order.count({ where }), prisma.order.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' }, include: { cashier: { select: { id: true, name: true } }, items: { include: { product: true } }, payments: true } })]);
    return { total, page, limit, totalPages: Math.ceil(total / limit), orders };
  }

  static async getOrderById(orderId: string, tenantId: string) {
    const order = await prisma.order.findFirst({ where: { id: orderId, tenantId }, include: { items: { include: { product: true } }, payments: true, cashier: { select: { id: true, name: true } } } });
    if (!order) throw new Error('Buyurtma topilmadi');
    return order;
  }
}
