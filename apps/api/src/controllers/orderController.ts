import { Request, Response } from 'express';
import PDFDocument from 'pdfkit';
import { OrderService } from '../services/orderService';
import { createOrderAndNotify } from '../services/orderNotification';

function getAuthUser(req: Request) { const user = (req as any).user; if (!user?.tenantId) throw new Error('Foydalanuvchi ma\'lumotlari topilmadi'); return user; }
function clientError(res: Response, status: number, err: unknown) { console.error(err); return res.status(status).json({ error: err instanceof Error ? err.message : 'So\'rovni bajarib bo\'lmadi' }); }

export class OrderController {
  static async create(req: Request, res: Response) { try { const user = getAuthUser(req); if (!Array.isArray(req.body.items)) return res.status(400).json({ error: 'items ro\'yxati talab qilinadi' }); res.status(201).json(await createOrderAndNotify(user.tenantId, user.id, req.body.items)); } catch (e) { return clientError(res, 400, e); } }
  static async confirm(req: Request, res: Response) { try { const u = getAuthUser(req); res.json(await OrderService.confirmOrder(req.params.id, u.tenantId)); } catch (e) { return clientError(res, 400, e); } }
  static async updateStatus(req: Request, res: Response) { try { const u = getAuthUser(req); res.json(await OrderService.updateStatus(req.params.id, u.tenantId, req.body.status)); } catch (e) { return clientError(res, 400, e); } }
  static async cancel(req: Request, res: Response) { try { const u = getAuthUser(req); res.json(await OrderService.cancelOrder(req.params.id, u.tenantId, req.body.reason)); } catch (e) { return clientError(res, 400, e); } }
  static async addPayment(req: Request, res: Response) { try { const u = getAuthUser(req); res.json(await OrderService.addPayment(req.params.id, u.tenantId, Number(req.body.amount), req.body.method)); } catch (e) { return clientError(res, 400, e); } }
  static async list(req: Request, res: Response) { try { const u = getAuthUser(req); res.json(await OrderService.getOrders(u.tenantId, { status: req.query.status as any, from: req.query.from as string, to: req.query.to as string, page: req.query.page ? Number(req.query.page) : undefined, limit: req.query.limit ? Number(req.query.limit) : undefined })); } catch (e) { return clientError(res, 400, e); } }
  static async getById(req: Request, res: Response) { try { const u = getAuthUser(req); res.json(await OrderService.getOrderById(req.params.id, u.tenantId)); } catch (e) { return clientError(res, 404, e); } }
  static async getReceiptPdf(req: Request, res: Response) { try { const u = getAuthUser(req); const order = await OrderService.getOrderById(req.params.id, u.tenantId); const doc = new PDFDocument({ size: [226, 600], margin: 10 }); res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `inline; filename="receipt-${order.id}.pdf"`); doc.pipe(res); doc.fontSize(12).text('POS CHEK', { align: 'center' }); doc.fontSize(8).text(`Buyurtma ID: ${order.id}`, { align: 'center' }); order.items.forEach(item => doc.text(`${item.product?.name || 'Noma\'lum'}: ${item.qty} x ${item.priceAtSale}`)); doc.fontSize(10).text(`Jami: ${Number(order.totalAmount).toLocaleString()} so'm`); doc.end(); } catch (e) { return clientError(res, 400, e); } }
}
