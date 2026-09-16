import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { OrderService } from './services/orderService';

const prisma = new PrismaClient();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const HMAC_SECRET = process.env.BOT_HMAC_SECRET || 'pos_secret_hmac_key';

// Token mavjud bo'lgandagina botni faollashtiramiz (server qulab tushmasligi uchun)
export const bot: TelegramBot | null = BOT_TOKEN
  ? new TelegramBot(BOT_TOKEN, { polling: true })
  : null;

if (!BOT_TOKEN) {
  console.warn('TELEGRAM_BOT_TOKEN o\'rnatilmagan. Telegram bot xabarnomalari o\'chirilgan.');
}

function signAction(action: 'confirm' | 'cancel', orderId: string): string {
  return crypto.createHmac('sha256', HMAC_SECRET).update(`${action}:${orderId}`).digest('hex').slice(0, 16);
}

function verifyAction(action: 'confirm' | 'cancel', orderId: string, sig: string): boolean {
  return signAction(action, orderId) === sig;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export async function notifyNewOrder(adminTelegramChatId: number | string, order: any) {
  if (!bot) return;

  const confirmSig = signAction('confirm', order.id);
  const cancelSig = signAction('cancel', order.id);

  const items = order.items || [];
  const itemList = items
    .map((i: any) => {
      const name = escapeHtml(i.product?.name || 'Mahsulot');
      const qty = i.qty;
      const price = Number(i.priceAtSale).toLocaleString();
      return `▫️ ${name}: ${qty} x ${price} so'm`;
    })
    .join('\n');

  const cashierName = escapeHtml(order.cashier?.name || 'Noma\'lum');
  const shortId = order.id ? order.id.slice(-6) : '';
  const totalStr = Number(order.totalAmount || 0).toLocaleString();

  const text =
    `🔔 <b>YANGI BUYURTMA #${shortId}</b>\n\n` +
    `Kassir: ${cashierName}\n` +
    `Jami summa: <b>${totalStr} so'm</b>\n\n` +
    `<b>Tarkibi:</b>\n${itemList || 'Mahsulotlar mavjud emas'}\n`;

  try {
    await bot.sendMessage(adminTelegramChatId, text, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Tasdiqlash', callback_data: `ord:confirm:${order.id}:${confirmSig}` },
            { text: '❌ Rad etish', callback_data: `ord:cancel:${order.id}:${cancelSig}` }
          ]
        ]
      }
    });
  } catch (err: any) {
    console.error('Telegramga xabar yuborishda xatolik:', err.message);
  }
}

if (bot) {
  bot.on('callback_query', async (query) => {
    const { data, message, id } = query;
    if (!data || !data.startsWith('ord:')) return;

    const parts = data.split(':');
    if (parts.length !== 4) {
      return bot.answerCallbackQuery(id, { text: 'Noto\'g\'ri buyruq formati' });
    }

    const [, action, orderId, sig] = parts;

    if (action !== 'confirm' && action !== 'cancel') {
      return bot.answerCallbackQuery(id, { text: 'Noto\'g\'ri buyruq' });
    }

    if (!verifyAction(action, orderId, sig)) {
      return bot.answerCallbackQuery(id, { text: 'Xavfsizlik xatosi: Token yaroqsiz!' });
    }

    try {
      // Haqiqiy buyurtmani topib uning tenantId sini olamiz
      const order = await prisma.order.findUnique({
        where: { id: orderId }
      });

      if (!order) {
        return bot.answerCallbackQuery(id, { text: 'Buyurtma topilmadi' });
      }

      const tenantId = order.tenantId;

      if (action === 'confirm') {
        await OrderService.confirmOrder(orderId, tenantId);
        await bot.answerCallbackQuery(id, { text: 'Buyurtma tasdiqlandi!' });
        if (message) {
          await bot.editMessageText(
            `${message.text}\n\n✅ <b>BUYURTMA ADMIN TOMONIDAN TASDIQLANDI</b>`,
            {
              chat_id: message.chat.id,
              message_id: message.message_id,
              parse_mode: 'HTML'
            }
          );
        }
      } else if (action === 'cancel') {
        await OrderService.cancelOrder(orderId, tenantId, 'Telegram bot orqali rad etildi');
        await bot.answerCallbackQuery(id, { text: 'Buyurtma bekor qilindi!' });
        if (message) {
          await bot.editMessageText(
            `${message.text}\n\n❌ <b>BUYURTMA RAD ETILDI VA BEKOR QILINDI</b>`,
            {
              chat_id: message.chat.id,
              message_id: message.message_id,
              parse_mode: 'HTML'
            }
          );
        }
      }
    } catch (error: any) {
      await bot.answerCallbackQuery(id, { text: `Xato: ${error.message}` });
    }
  });
}