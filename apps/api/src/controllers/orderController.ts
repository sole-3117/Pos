import { Request, Response } from 'express';
import { OrderService } from '../services/orderService';
import PDFDocument from 'pdfkit';

function getAuthUser(req: Request) {
  const user = (req as any).user;
  if (!user || !user.tenantId) {
    throw new Error('Foydalanuvchi ma\'lumotlari yoki do\'kon identifikatori topilmadi');
  }
  return user;
}

export class OrderController {
  static async create(req: Request, res: Response) {
    try {
      const user = getAuthUser(req);
      const tenantId = user.tenantId;
      const cashierId = user.id;
      const { items } = req.body;

      if (!items || !Array.isArray(items)) {
        return res.status(400).json({ error: 'Mahsulotlar ro\'yxati (items) to\'g\'ri formatda yuborilishi shart' });
      }

      const order = await OrderService.createOrder(tenantId, cashierId, items);
      res.status(201).json(order);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }

  static async confirm(req: Request, res: Response) {
    try {
      const user = getAuthUser(req);
      const tenantId = user.tenantId;
      const { id } = req.params;

      const order = await OrderService.confirmOrder(id, tenantId);
      res.json(order);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }

  static async updateStatus(req: Request, res: Response) {
    try {
      const user = getAuthUser(req);
      const tenantId = user.tenantId;
      const { id } = req.params;
      const { status } = req.body;

      if (!status) {
        return res.status(400).json({ error: 'Yangi status (status) ko\'rsatilishi shart' });
      }

      const order = await OrderService.updateStatus(id, tenantId, status);
      res.json(order);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }

  static async cancel(req: Request, res: Response) {
    try {
      const user = getAuthUser(req);
      const tenantId = user.tenantId;
      const { id } = req.params;
      const { reason } = req.body;

      if (!reason || typeof reason !== 'string' || !reason.trim()) {
        return res.status(400).json({ error: 'Bekor qilish sababi (reason) kiritilishi majburiy' });
      }

      const order = await OrderService.cancelOrder(id, tenantId, reason);
      res.json(order);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }

  static async addPayment(req: Request, res: Response) {
    try {
      const user = getAuthUser(req);
      const tenantId = user.tenantId;
      const { id } = req.params;
      const { amount, method } = req.body;

      const numericAmount = Number(amount);
      if (isNaN(numericAmount) || numericAmount <= 0) {
        return res.status(400).json({ error: 'To\'lov summasi musbat son bo\'lishi shart' });
      }

      const order = await OrderService.addPayment(id, tenantId, numericAmount, method);
      res.json(order);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }

  static async list(req: Request, res: Response) {
    try {
      const user = getAuthUser(req);
      const tenantId = user.tenantId;
      const { status, from, to, page, limit } = req.query;

      const result = await OrderService.getOrders(tenantId, {
        status: status as any,
        from: from as string,
        to: to as string,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined
      });

      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }

  static async getById(req: Request, res: Response) {
    try {
      const user = getAuthUser(req);
      const tenantId = user.tenantId;
      const { id } = req.params;

      const order = await OrderService.getOrderById(id, tenantId);
      res.json(order);
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  }

  static async getReceiptPdf(req: Request, res: Response) {
    try {
      const user = getAuthUser(req);
      const tenantId = user.tenantId;
      const { id } = req.params;

      const order = await OrderService.getOrderById(id, tenantId);

      const doc = new PDFDocument({ size: [226, 600], margin: 10 });

      doc.on('error', (err) => {
        if (!res.headersSent) {
          res.status(500).json({ error: `PDF yaratishda xatolik: ${err.message}` });
        }
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="receipt-${order.id}.pdf"`);

      doc.pipe(res);

      doc.fontSize(12).text('POS CHEK', { align: 'center' });
      doc.fontSize(8).text(`Buyurtma ID: ${order.id}`, { align: 'center' });
      doc.text(`Sana: ${new Date(order.createdAt).toLocaleString('uz-UZ')}`, { align: 'center' });
      doc.moveDown();
      doc.text('-------------------------------------------');

      if (order.items && order.items.length > 0) {
        order.items.forEach((item) => {
          const prodName = item.product?.name || 'Noma\'lum mahsulot';
          doc.fontSize(8).text(prodName);
          doc.text(`${item.qty} x ${item.priceAtSale} = ${(Number(item.priceAtSale) * item.qty).toLocaleString()} so'm`, {
            align: 'right'
          });
        });
      }

      doc.text('-------------------------------------------');
      doc.fontSize(10).text(`Jami: ${Number(order.totalAmount).toLocaleString()} so'm`, { align: 'right' });
      doc.fontSize(8).text(`To\'lov holati: ${order.paymentStatus}`, { align: 'right' });
      doc.moveDown();
      doc.fontSize(8).text('Xaridingiz uchun rahmat!', { align: 'center' });

      doc.end();
    } catch (err: any) {
      if (!res.headersSent) {
        res.status(400).json({ error: err.message });
      }
    }
  }
}
