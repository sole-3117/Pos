import { Router } from 'express';
import { OrderController } from '../controllers/orderController';
import { requireAuth, requireRole } from '../middlewares/authMiddleware';

const router = Router();
router.use(requireAuth);
router.post('/', requireRole(['ADMIN', 'CASHIER']), OrderController.create);
router.get('/', requireRole(['ADMIN', 'CASHIER']), OrderController.list);
router.get('/:id', requireRole(['ADMIN', 'CASHIER']), OrderController.getById);
router.get('/:id/receipt.pdf', requireRole(['ADMIN', 'CASHIER']), OrderController.getReceiptPdf);
router.patch('/:id/confirm', requireRole(['ADMIN']), OrderController.confirm);
router.patch('/:id/status', requireRole(['ADMIN', 'CASHIER']), OrderController.updateStatus);
router.patch('/:id/cancel', requireRole(['ADMIN']), OrderController.cancel);
router.post('/:id/payments', requireRole(['ADMIN', 'CASHIER']), OrderController.addPayment);
export default router;
