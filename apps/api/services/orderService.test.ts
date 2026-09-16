import { PrismaClient, OrderStatus, PaymentStatus } from '@prisma/client';
import { OrderService } from './orderService';

const prisma = new PrismaClient();

describe('OrderService Integration & Concurrency Tests', () => {
  const tenantId = 'test-tenant-' + Date.now();
  const cashierId = 'test-cashier-' + Date.now();
  let testProductId: string;

  beforeAll(async () => {
    // Foreign key cheklovlarini qondirish uchun Tenant va Kassir (User) yaratamiz
    await prisma.tenant.create({
      data: {
        id: tenantId,
        name: 'Test Savdo Markazi'
      }
    });

    await prisma.user.create({
      data: {
        id: cashierId,
        tenantId,
        name: 'Aziz Kassir',
        role: 'CASHIER'
      }
    });

    // Sinov uchun omborida atigi 5 dona mahsulot yaratamiz
    const prod = await prisma.product.create({
      data: {
        tenantId,
        name: 'Olma Golden',
        sku: 'OLMA-GOLDEN-' + Date.now(),
        price: 15000,
        stock: 5
      }
    });
    testProductId = prod.id;
  });

  afterAll(async () => {
    // Bog'langan barcha test ma'lumotlarini tozalaymiz
    await prisma.payment.deleteMany({ where: { order: { tenantId } } });
    await prisma.stockMovement.deleteMany({ where: { productId: testProductId } });
    await prisma.orderItem.deleteMany({ where: { productId: testProductId } });
    await prisma.order.deleteMany({ where: { tenantId } });
    await prisma.product.deleteMany({ where: { id: testProductId } });
    await prisma.user.deleteMany({ where: { id: cashierId } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });

    await prisma.$disconnect();
  });

  test('Asosiy oqim: Yaratish -> Tasdiqlash -> Tayyorlash -> Yakunlash', async () => {
    // 1 dona buyurtma
    const order = await OrderService.createOrder(tenantId, cashierId, [
      { productId: testProductId, qty: 1 }
    ]);
    expect(order.status).toBe(OrderStatus.NEW);
    expect(order.paymentStatus).toBe(PaymentStatus.UNPAID);

    // Tasdiqlash (Stock 5 dan 4 ga tushishi kerak)
    const confirmed = await OrderService.confirmOrder(order.id, tenantId);
    expect(confirmed.status).toBe(OrderStatus.CONFIRMED);

    const prodAfter = await prisma.product.findUnique({ where: { id: testProductId } });
    expect(prodAfter?.stock).toBe(4);

    // PREPARING ga o'tkazish
    const preparing = await OrderService.updateStatus(order.id, tenantId, OrderStatus.PREPARING);
    expect(preparing.status).toBe(OrderStatus.PREPARING);

    // COMPLETED ga o'tkazish
    const completed = await OrderService.updateStatus(order.id, tenantId, OrderStatus.COMPLETED);
    expect(completed.status).toBe(OrderStatus.COMPLETED);
  });

  test('Race Condition Test: 2 ta kassir bir vaqtda qoldiqdan ko\'p so\'rov yuborganda', async () => {
    // Hozir stock = 4 dona
    // Ikkala kassir ham 3 donadan buyurtma qiladi (Jami 6 dona kerak, lekin atigi 4 dona bor)
    const order1 = await OrderService.createOrder(tenantId, cashierId, [
      { productId: testProductId, qty: 3 }
    ]);
    const order2 = await OrderService.createOrder(tenantId, cashierId, [
      { productId: testProductId, qty: 3 }
    ]);

    // Bir vaqtda tasdiqlash (Parallel confirm)
    const results = await Promise.allSettled([
      OrderService.confirmOrder(order1.id, tenantId),
      OrderService.confirmOrder(order2.id, tenantId)
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Faqat 1 tasi muvaffaqiyatli o'tishi kerak, 2-chisi omborda qoldiq yetmagani uchun xato berishi kerak
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    // Ombor qoldig'i manfiy bo'lmasligi kerak (4 - 3 = 1)
    const finalProd = await prisma.product.findUnique({ where: { id: testProductId } });
    expect(finalProd?.stock).toBe(1);
  });

  test('Bekor qilish va qoldiqni omborga qaytarish testi', async () => {
    // Hozir stock = 1 dona
    const order = await OrderService.createOrder(tenantId, cashierId, [
      { productId: testProductId, qty: 1 }
    ]);

    // Tasdiqlaymiz: stock 1 -> 0
    await OrderService.confirmOrder(order.id, tenantId);
    let prod = await prisma.product.findUnique({ where: { id: testProductId } });
    expect(prod?.stock).toBe(0);

    // Bekor qilamiz: stock 0 -> 1 qaytishi kerak
    const cancelled = await OrderService.cancelOrder(order.id, tenantId, 'Mijoz to\'lov qilmay ketib qoldi');
    expect(cancelled.status).toBe(OrderStatus.CANCELLED);
    expect(cancelled.cancelReason).toBe('Mijoz to\'lov qilmay ketib qoldi');

    prod = await prisma.product.findUnique({ where: { id: testProductId } });
    expect(prod?.stock).toBe(1);
  });
});
