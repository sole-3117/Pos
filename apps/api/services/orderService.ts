import { PrismaClient, OrderStatus, PaymentStatus, StockMovementType, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

// updateStatus orqali ruxsat etilgan holat o'tishlari
// DIQQAT: CONFIRMED uchun confirmOrder, CANCELLED uchun cancelOrder ishlatilishi shart
const ALLOWED_DIRECT_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.NEW]: [], // Faqat confirmOrder yoki cancelOrder orqali
  [OrderStatus.CONFIRMED]: [OrderStatus.PREPARING],
  [OrderStatus.PREPARING]: [OrderStatus.COMPLETED],
  [OrderStatus.COMPLETED]: [],
  [OrderStatus.CANCELLED]: []
};

export class OrderService {
  /**
   * 1. Yangi buyurtma yaratish
   * - Mahsulotlar takrorlanganda ularni avtomatik birlashtiradi
   * - Miqdor va narxlarni to'liq tekshiradi
   */
  static async createOrder(
    tenantId: string,
    cashierId: string,
    itemsData: Array<{ productId: string; qty: number }>
  ) {
    if (!itemsData || !Array.isArray(itemsData) || itemsData.length === 0) {
      throw new Error('Buyurtmada kamida bitta mahsulot bo\'lishi shart');
    }

    // Takrorlangan mahsulotlarni birlashtirish (aggregation)
    const aggregatedItemsMap = new Map<string, number>();
    for (const item of itemsData) {
      if (!item.productId || typeof item.productId !== 'string') {
        throw new Error('Mahsulot identifikatori (productId) noto\'g\'ri');
      }
      if (typeof item.qty !== 'number' || !Number.isInteger(item.qty) || item.qty <= 0) {
        throw new Error('Mahsulot miqdori 0 dan katta butun son bo\'lishi shart');
      }
      const currentQty = aggregatedItemsMap.get(item.productId) || 0;
      aggregatedItemsMap.set(item.productId, currentQty + item.qty);
    }

    const distinctProductIds = Array.from(aggregatedItemsMap.keys());

    return await prisma.$transaction(async (tx) => {
      const products = await tx.product.findMany({
        where: { id: { in: distinctProductIds }, tenantId }
      });

      if (products.length !== distinctProductIds.length) {
        throw new Error('Bir yoki bir nechta mahsulot topilmadi yoki bu do\'konga tegishli emas');
      }

      const productMap = new Map(products.map((p) => [p.id, p]));
      let totalAmount = new Prisma.Decimal(0);

      const itemsToCreate = distinctProductIds.map((productId) => {
        const qty = aggregatedItemsMap.get(productId)!;
        const prod = productMap.get(productId)!;
        const lineTotal = new Prisma.Decimal(prod.price).mul(qty);
        totalAmount = totalAmount.add(lineTotal);

        return {
          productId,
          qty,
          priceAtSale: prod.price
        };
      });

      const order = await tx.order.create({
        data: {
          tenantId,
          cashierId,
          status: OrderStatus.NEW,
          paymentStatus: PaymentStatus.UNPAID,
          totalAmount,
          items: {
            create: itemsToCreate
          }
        },
        include: {
          items: { include: { product: true } },
          cashier: { select: { id: true, name: true } },
          payments: true
        }
      });

      return order;
    });
  }

  /**
   * 2. Buyurtmani tasdiqlash (Deadlock-Free Pessimistic Lock & Stock Deduction)
   * - Order qatorining o'zini FOR UPDATE bilan qulflab, parallel tasdiqlash race condition'larini bartaraf qiladi
   * - Mahsulotlarni ID bo'yicha saralangan tartibda qulflab, PostgreSQL deadlock'larining oldini oladi
   */
  static async confirmOrder(orderId: string, tenantId: string) {
    return await prisma.$transaction(async (tx) => {
      // 1. Parallel confirm race condition oldini olish uchun Order qatorini qulflaymiz
      const lockedOrders = await tx.$queryRaw<Array<{ id: string; status: OrderStatus }>>`
        SELECT id, status FROM "Order"
        WHERE id = ${orderId} AND "tenantId" = ${tenantId}
        FOR UPDATE
      `;

      const orderRecord = lockedOrders[0];
      if (!orderRecord) {
        throw new Error('Buyurtma topilmadi');
      }

      if (orderRecord.status !== OrderStatus.NEW) {
        throw new Error(`Faqat NEW statusidagi buyurtmani tasdiqlash mumkin. Hozirgi status: ${orderRecord.status}`);
      }

      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true }
      });

      if (!order || !order.items || order.items.length === 0) {
        throw new Error('Buyurtmada mahsulotlar mavjud emas');
      }

      // 2. Mahsulotlar bo'yicha jami miqdorlarni hisoblash
      const itemTotals = new Map<string, number>();
      for (const item of order.items) {
        const current = itemTotals.get(item.productId) || 0;
        itemTotals.set(item.productId, current + item.qty);
      }

      // 3. Deadlock'larning oldini olish uchun mahsulot ID larini doimiy tartibda saralaymiz
      const sortedProductIds = Array.from(itemTotals.keys()).sort();

      // 4. Mahsulotlarni qulflash va qoldiqni tekshirish
      for (const productId of sortedProductIds) {
        const requiredQty = itemTotals.get(productId)!;

        const lockedProducts = await tx.$queryRaw<Array<{ id: string; stock: number; name: string }>>`
          SELECT id, stock, name FROM "Product"
          WHERE id = ${productId} AND "tenantId" = ${tenantId}
          FOR UPDATE
        `;

        const product = lockedProducts[0];
        if (!product) {
          throw new Error(`Mahsulot topilmadi: ${productId}`);
        }

        if (product.stock < requiredQty) {
          throw new Error(`Omborda yetarli mahsulot yo'q: "${product.name}". Mavjud: ${product.stock}, So'ralgan: ${requiredQty}`);
        }

        // Ombordan qoldiqni ayirish
        await tx.product.update({
          where: { id: productId },
          data: { stock: { decrement: requiredQty } }
        });

        // Ombor harakatini qayd etish
        await tx.stockMovement.create({
          data: {
            productId,
            type: StockMovementType.OUT,
            qty: requiredQty,
            orderId: order.id,
            reason: `Buyurtma #${order.id} tasdiqlandi`
          }
        });
      }

      // 5. Buyurtma holatini yangilash
      return await tx.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.CONFIRMED },
        include: {
          items: { include: { product: true } },
          cashier: { select: { id: true, name: true } },
          payments: true
        }
      });
    });
  }

  /**
   * 3. Statusni yangilash (State Machine)
   * Faqat oraliq bosqichlar uchun (CONFIRMED -> PREPARING -> COMPLETED).
   * Tasdiqlash va bekor qilish uchun alohida xavfsiz metodlar ishlatiladi.
   */
  static async updateStatus(orderId: string, tenantId: string, targetStatus: OrderStatus) {
    if (targetStatus === OrderStatus.CONFIRMED) {
      throw new Error('Buyurtmani tasdiqlash uchun confirmOrder metodidan foydalaning');
    }
    if (targetStatus === OrderStatus.CANCELLED) {
      throw new Error('Buyurtmani bekor qilish uchun cancelOrder metodidan foydalaning');
    }

    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId }
    });

    if (!order) throw new Error('Buyurtma topilmadi');

    const allowed = ALLOWED_DIRECT_TRANSITIONS[order.status];
    if (!allowed || !allowed.includes(targetStatus)) {
      throw new Error(`Noto'g'ri o'tish: ${order.status} holatidan ${targetStatus} holatiga o'tib bo'lmaydi`);
    }

    return await prisma.order.update({
      where: { id: orderId },
      data: { status: targetStatus },
      include: {
        items: { include: { product: true } },
        cashier: { select: { id: true, name: true } },
        payments: true
      }
    });
  }

  /**
   * 4. Buyurtmani bekor qilish va qoldiqni xavfsiz qaytarish
   * - Order qatorini qulflaydi
   * - Agar mahsulotlar avval ombordan yechilgan bo'lsa (CONFIRMED yoki PREPARING), qaytaradi
   */
  static async cancelOrder(orderId: string, tenantId: string, reason: string) {
    if (!reason || reason.trim() === '') {
      throw new Error('Bekor qilish sababini kiritish majburiy');
    }

    return await prisma.$transaction(async (tx) => {
      // Parallel bekor qilish yoki tasdiqlash poygasini oldini olish uchun Order qatorini qulflaymiz
      const lockedOrders = await tx.$queryRaw<Array<{ id: string; status: OrderStatus }>>`
        SELECT id, status FROM "Order"
        WHERE id = ${orderId} AND "tenantId" = ${tenantId}
        FOR UPDATE
      `;

      const orderRecord = lockedOrders[0];
      if (!orderRecord) throw new Error('Buyurtma topilmadi');

      if (orderRecord.status === OrderStatus.COMPLETED || orderRecord.status === OrderStatus.CANCELLED) {
        throw new Error(`${orderRecord.status} holatidagi buyurtmani bekor qilib bo'lmaydi`);
      }

      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true }
      });

      if (!order) throw new Error('Buyurtma topilmadi');

      // Agar stock allaqachon yechilgan bo'lsa (CONFIRMED yoki PREPARING), qaytaramiz
      const shouldReturnStock =
        order.status === OrderStatus.CONFIRMED || order.status === OrderStatus.PREPARING;

      if (shouldReturnStock && order.items && order.items.length > 0) {
        // Mahsulotlar miqdorini birlashtirish
        const itemTotals = new Map<string, number>();
        for (const item of order.items) {
          const current = itemTotals.get(item.productId) || 0;
          itemTotals.set(item.productId, current + item.qty);
        }

        const sortedProductIds = Array.from(itemTotals.keys()).sort();

        for (const productId of sortedProductIds) {
          const returnQty = itemTotals.get(productId)!;

          await tx.product.update({
            where: { id: productId },
            data: { stock: { increment: returnQty } }
          });

          await tx.stockMovement.create({
            data: {
              productId,
              type: StockMovementType.RETURN,
              qty: returnQty,
              orderId: order.id,
              reason: `Buyurtma bekor qilindi. Sabab: ${reason.trim()}`
            }
          });
        }
      }

      return await tx.order.update({
        where: { id: orderId },
        data: {
          status: OrderStatus.CANCELLED,
          cancelReason: reason.trim()
        },
        include: {
          items: { include: { product: true } },
          cashier: { select: { id: true, name: true } },
          payments: true
        }
      });
    });
  }

  /**
   * 5. To'lov qo'shish va PaymentStatusni avtomatik hisoblash
   */
  static async addPayment(
    orderId: string,
    tenantId: string,
    amount: number,
    method: 'cash' | 'card' | 'online'
  ) {
    if (typeof amount !== 'number' || isNaN(amount) || !isFinite(amount) || amount <= 0) {
      throw new Error('To\'lov summasi 0 dan katta to\'g\'ri son bo\'lishi kerak');
    }

    const validMethods = ['cash', 'card', 'online'];
    if (!validMethods.includes(method)) {
      throw new Error('Noto\'g\'ri to\'lov usuli: faqat cash, card yoki online qabul qilinadi');
    }

    return await prisma.$transaction(async (tx) => {
      // Order qatorini qulflaymiz
      const lockedOrders = await tx.$queryRaw<Array<{ id: string; status: OrderStatus; totalAmount: Prisma.Decimal }>>`
        SELECT id, status, "totalAmount" FROM "Order"
        WHERE id = ${orderId} AND "tenantId" = ${tenantId}
        FOR UPDATE
      `;

      const orderRecord = lockedOrders[0];
      if (!orderRecord) throw new Error('Buyurtma topilmadi');

      if (orderRecord.status === OrderStatus.CANCELLED) {
        throw new Error('Bekor qilingan buyurtmaga to\'lov qabul qilinmaydi');
      }

      await tx.payment.create({
        data: {
          orderId,
          amount: new Prisma.Decimal(amount),
          method,
          status: 'success'
        }
      });

      const allPayments = await tx.payment.findMany({
        where: { orderId, status: 'success' }
      });

      const totalPaid = allPayments.reduce(
        (acc, p) => acc.add(new Prisma.Decimal(p.amount)),
        new Prisma.Decimal(0)
      );

      let newPaymentStatus: PaymentStatus = PaymentStatus.UNPAID;
      if (totalPaid.gte(orderRecord.totalAmount)) {
        newPaymentStatus = PaymentStatus.PAID;
      } else if (totalPaid.gt(0)) {
        newPaymentStatus = PaymentStatus.PARTIAL;
      }

      return await tx.order.update({
        where: { id: orderId },
        data: { paymentStatus: newPaymentStatus },
        include: {
          payments: true,
          items: { include: { product: true } },
          cashier: { select: { id: true, name: true } }
        }
      });
    });
  }

  /**
   * 6. Ro'yxatni olish (filtrlar va xavfsiz pagination bilan)
   */
  static async getOrders(
    tenantId: string,
    filters: {
      status?: OrderStatus;
      from?: string;
      to?: string;
      page?: number;
      limit?: number;
    }
  ) {
    const rawPage = Number(filters.page);
    const rawLimit = Number(filters.limit);

    const page = !isNaN(rawPage) && rawPage > 0 ? rawPage : 1;
    const limit = !isNaN(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 20;
    const skip = (page - 1) * limit;

    const where: Prisma.OrderWhereInput = { tenantId };

    if (filters.status && Object.values(OrderStatus).includes(filters.status)) {
      where.status = filters.status;
    }

    if (filters.from || filters.to) {
      const createdAtFilter: Prisma.DateTimeFilter = {};

      if (filters.from) {
        const fromDate = new Date(filters.from);
        if (!isNaN(fromDate.getTime())) {
          createdAtFilter.gte = fromDate;
        }
      }

      if (filters.to) {
        const toDate = new Date(filters.to);
        if (!isNaN(toDate.getTime())) {
          createdAtFilter.lte = toDate;
        }
      }

      if (Object.keys(createdAtFilter).length > 0) {
        where.createdAt = createdAtFilter;
      }
    }

    const [total, orders] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          cashier: { select: { id: true, name: true } },
          items: { include: { product: true } },
          payments: true
        }
      })
    ]);

    return { total, page, limit, totalPages: Math.ceil(total / limit), orders };
  }

  /**
   * 7. Bitta buyurtma tafsiloti
   */
  static async getOrderById(orderId: string, tenantId: string) {
    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId },
      include: {
        items: { include: { product: true } },
        payments: true,
        cashier: { select: { id: true, name: true } }
      }
    });

    if (!order) throw new Error('Buyurtma topilmadi');
    return order;
  }
}