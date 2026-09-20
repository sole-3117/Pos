import 'dotenv/config';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { Request, Response, NextFunction } from 'express';

export interface AuthenticatedUser {
  id: string;
  tenantId: string;
  role: 'ADMIN' | 'CASHIER';
  name?: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

const prisma = new PrismaClient();
const AUTH_SECRET = process.env.AUTH_SECRET;
const DEV_AUTH = process.env.DEV_AUTH === 'true' && process.env.NODE_ENV !== 'production';

if (!AUTH_SECRET || AUTH_SECRET.length < 32) {
  throw new Error('AUTH_SECRET must be configured and at least 32 characters long');
}

function base64url(value: string): string {
  return Buffer.from(value).toString('base64url');
}

function verifyToken(token: string): AuthenticatedUser | null {
  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) return null;

  const expected = crypto.createHmac('sha256', AUTH_SECRET!).update(encodedPayload).digest('base64url');
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as Partial<AuthenticatedUser> & { exp?: number };
    if (!payload.id || !payload.tenantId || !payload.role || !['ADMIN', 'CASHIER'].includes(payload.role)) return null;
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return { id: payload.id, tenantId: payload.tenantId, role: payload.role as AuthenticatedUser['role'], name: payload.name };
  } catch {
    return null;
  }
}

export function createAuthToken(user: AuthenticatedUser, expiresInSeconds = 86400): string {
  const payload = base64url(JSON.stringify({ ...user, exp: Math.floor(Date.now() / 1000) + expiresInSeconds }));
  const signature = crypto.createHmac('sha256', AUTH_SECRET!).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function getCookie(req: Request, name: string): string | undefined {
  const cookies = req.headers.cookie?.split(';').map((part) => part.trim()) || [];
  const value = cookies.find((part) => part.startsWith(`${name}=`));
  return value ? decodeURIComponent(value.slice(name.length + 1)) : undefined;
}

export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7).trim()
    : getCookie(req, 'pos_token');
  const user = token ? verifyToken(token) : null;

  if (!user) {
    if (DEV_AUTH) {
      return res.status(401).json({ error: 'Development token required. Generate one with npm run token.' });
    }
    return res.status(401).json({ error: 'Avtorizatsiyadan o\'tilmagan' });
  }

  try {
    const dbUser = await prisma.user.findFirst({ where: { id: user.id, tenantId: user.tenantId } });
    if (!dbUser || !['ADMIN', 'CASHIER'].includes(dbUser.role)) {
      return res.status(401).json({ error: 'Token foydalanuvchisi topilmadi' });
    }
    (req as AuthenticatedRequest).user = {
      id: dbUser.id,
      tenantId: dbUser.tenantId,
      role: dbUser.role as AuthenticatedUser['role'],
      name: dbUser.name
    };
    next();
  } catch (error) {
    console.error('Auth verification failed:', error);
    res.status(500).json({ error: 'Serverda ichki xatolik yuz berdi' });
  }
};

export const requireRole = (allowedRoles: Array<'ADMIN' | 'CASHIER'>) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as AuthenticatedRequest).user;
    if (!user) return res.status(401).json({ error: 'Foydalanuvchi ma\'lumotlari topilmadi' });
    if (!allowedRoles.includes(user.role)) {
      return res.status(403).json({ error: 'Bu amal uchun ruxsat yetarli emas' });
    }
    next();
  };
};
