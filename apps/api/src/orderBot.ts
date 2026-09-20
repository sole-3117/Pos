import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { OrderService } from './services/orderService';

const prisma = new PrismaClient();
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const HMAC_SECRET = process.env.BOT_HMAC_SECRET;
const MAIN_ADMIN = process.env.MAIN_ADMIN;

if (!HMAC_SECRET || HMAC_SECRET.length < 32) console.warn('BOT_HMAC_SECRET 32 belgidan uzun bo\'lishi kerak; Telegram bot o\'chirilgan.');
export const bot: TelegramBot | null = BOT_TOKEN && HMAC_SECRET && HMAC_SECRET.length >= 32 ? new TelegramBot(BOT_TOKEN, { polling: true }) : null;

function signAction(action: 'confirm' | 'cancel', orderId: string) {
  return crypto.createHmac('sha256', HMAC_SECRET!).update(`${action}:${orderId}`).digest('hex').slice(0, 16);
}
function verifyAction(action: 'confirm' | 'cancel', orderId: string, signature: string) {
  const expected = signAction(action, orderId);
  return signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
function escapeHtml(text: string) { return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

export async function notifyNewOrder(adminTelegramChatId: number | string, order: any) {
  if (!bot) return;
  const items = (order.items || []).map((item: any) => `▫️ ${escapeHtml(item.product?.name || 'Mahsulot')}: ${item.qty} x ${Number(item.priceAtSale).toLocaleString()} so'm`).join('\n');
  const text = `🔔 <b>YANGI BUYURTMA #${escapeHtml(order.id.slice(-6))}</b>\n\nKassir: ${escapeHtml(order.cashier?.name || 'Noma\'lum')}\nJami summa: <b>${Number(order.totalAmount || 0).toLocaleString()} so'm</b>\n\n<b>Tarkibi:</b>\n${items || 'Mahsulotlar mavjud emas'}`;
  await bot.sendMessage(adminTelegramChatId, text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[
    { text: '✅ Tasdiqlash', callback_data: `ord:confirm:${order.id}:${signAction('confirm', order.id)}` },
    { text: '❌ Rad etish', callback_data: `ord:cancel:${order.id}:${signAction('cancel', order.id)}` }
  ]] } }).catch((error) => console.error('Telegram xabari yuborilmadi:', error));
}

if (bot) bot.on('callback_query', async (query) => {
  const { data, message, id, from } = query;
  if (!data?.startsWith('ord:')) return;
  if (!MAIN_ADMIN || String(from.id) !== MAIN_ADMIN) return bot.answerCallbackQuery(id, { text: 'Faqat bosh administrator amal bajarishi mumkin.' });
  const parts = data.split(':');
  if (parts.length !== 4) return bot.answerCallbackQuery(id, { text: 'Noto\'g\'ri buyruq formati' });
  const [, action, orderId, signature] = parts;
  if ((action !== 'confirm' && action !== 'cancel') || !verifyAction(action, orderId, signature)) return bot.answerCallbackQuery(id, { text: 'Yaroqsiz buyruq' });
  try {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return bot.answerCallbackQuery(id, { text: 'Buyurtma topilmadi' });
    if (action === 'confirm') await OrderService.confirmOrder(orderId, order.tenantId);
    else await OrderService.cancelOrder(orderId, order.tenantId, 'Telegram bot orqali rad etildi');
    await bot.answerCallbackQuery(id, { text: action === 'confirm' ? 'Buyurtma tasdiqlandi!' : 'Buyurtma bekor qilindi!' });
    if (message) await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: message.chat.id, message_id: message.message_id });
  } catch { await bot.answerCallbackQuery(id, { text: 'Amalni bajarib bo\'lmadi' }); }
});
