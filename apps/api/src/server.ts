import 'dotenv/config';
import express from 'express';
import orderRoutes from './routes/orderRoutes';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/api/products', async (req, res) => {
  try {
    const tenantId = (req.headers['x-tenant-id'] as string) || 'default-tenant';
    const products = await prisma.product.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' }
    });
    res.json(products);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.use('/api/orders', orderRoutes);

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Server xatoligi:', err);
  res.status(500).json({ error: err.message || 'Serverda ichki xatolik yuz berdi' });
});

app.listen(PORT, () => {
  console.log(`🚀 POS API serveri http://localhost:${PORT} portida ishga tushdi`);
});

export default app;
