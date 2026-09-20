import 'dotenv/config';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import orderRoutes from './routes/orderRoutes';
import { requireAuth } from './middlewares/authMiddleware';
import './orderBot';

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Authentication must run before the handler; otherwise /api/products is public.
app.use('/api/products', requireAuth);
app.get('/api/products', async (req, res) => {
  try {
    const tenantId = (req as any).user?.tenantId;
    if (!tenantId) return res.status(401).json({ error: 'Avtorizatsiyadan o\'tilmagan' });
    const products = await prisma.product.findMany({ where: { tenantId }, orderBy: { name: 'asc' } });
    res.json(products);
  } catch (error) {
    console.error('Products error:', error);
    res.status(500).json({ error: 'Serverda ichki xatolik yuz berdi' });
  }
});

app.use('/api/orders', orderRoutes);

app.use((error: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Server xatoligi:', error);
  res.status(500).json({ error: 'Serverda ichki xatolik yuz berdi' });
});

app.listen(PORT, () => console.log(`POS API serveri http://localhost:${PORT} portida ishga tushdi`));
export default app;
