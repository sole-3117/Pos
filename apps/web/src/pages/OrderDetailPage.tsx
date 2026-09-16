import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';

interface OrderItem {
  id: string;
  qty: number;
  priceAtSale: string | number;
  product?: {
    id: string;
    name: string;
    sku: string;
  };
}

interface Payment {
  id: string;
  amount: string | number;
  method: string;
  status: string;
  createdAt: string;
}

interface Order {
  id: string;
  status: 'NEW' | 'CONFIRMED' | 'PREPARING' | 'COMPLETED' | 'CANCELLED';
  paymentStatus: 'UNPAID' | 'PARTIAL' | 'PAID';
  totalAmount: string | number;
  cancelReason?: string | null;
  createdAt: string;
  items: OrderItem[];
  payments: Payment[];
  cashier?: {
    id: string;
    name: string;
  };
}

export const OrderDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const [cancelModal, setCancelModal] = useState(false);
  const [reason, setReason] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'online'>('cash');

  const loadOrder = async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/orders/${id}`, { credentials: 'include' });
      const data = await res.json();
      if (res.ok) {
        setOrder(data);
        setPageError(null);
      } else {
        setPageError(data.error || 'Buyurtma topilmadi');
      }
    } catch (err: any) {
      setPageError(err.message || 'Server bilan bog\'lanishda xatolik');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOrder();
  }, [id]);

  const handleConfirm = async () => {
    if (!id || actionLoading) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/orders/${id}/confirm`, {
        method: 'PATCH',
        credentials: 'include'
      });
      const data = await res.json();
      if (res.ok) {
        await loadOrder();
      } else {
        alert(`Xatolik: ${data.error || 'Buyurtmani tasdiqlab bo\'lmadi'}`);
      }
    } catch (err: any) {
      alert(`Server xatosi: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleNextStatus = async (nextStatus: string) => {
    if (!id || actionLoading) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/orders/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: nextStatus })
      });
      const data = await res.json();
      if (res.ok) {
        await loadOrder();
      } else {
        alert(`Xatolik: ${data.error || 'Statusni o\'zgartirib bo\'lmadi'}`);
      }
    } catch (err: any) {
      alert(`Server xatosi: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!id || actionLoading) return;
    if (!reason.trim()) return alert('Bekor qilish sababini yozing!');

    setActionLoading(true);
    try {
      const res = await fetch(`/api/orders/${id}/cancel`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ reason: reason.trim() })
      });
      const data = await res.json();
      if (res.ok) {
        setCancelModal(false);
        setReason('');
        await loadOrder();
      } else {
        alert(`Bekor qilishda xatolik: ${data.error || 'Xatolik yuz berdi'}`);
      }
    } catch (err: any) {
      alert(`Server xatosi: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleAddPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || actionLoading) return;

    const numAmount = Number(paymentAmount);
    if (isNaN(numAmount) || numAmount <= 0) {
      return alert('Iltimos, to\'g\'ri musbat summa kiriting');
    }

    setActionLoading(true);
    try {
      const res = await fetch(`/api/orders/${id}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ amount: numAmount, method: paymentMethod })
      });
      const data = await res.json();
      if (res.ok) {
        setPaymentAmount('');
        await loadOrder();
      } else {
        alert(`To'lov qo'shishda xatolik: ${data.error || 'Xatolik yuz berdi'}`);
      }
    } catch (err: any) {
      alert(`Server xatosi: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-gray-500">Buyurtma yuklanmoqda...</div>;
  }

  if (pageError || !order) {
    return (
      <div className="p-8 max-w-lg mx-auto text-center space-y-4">
        <div className="text-red-600 font-bold text-lg">{pageError || 'Buyurtma topilmadi'}</div>
        <Link to="/orders" className="text-blue-600 hover:underline inline-block">
          ← Buyurtmalar ro'yxatiga qaytish
        </Link>
      </div>
    );
  }

  const totalPaid = (order.payments || [])
    .filter((p) => p.status === 'success')
    .reduce((acc, p) => acc + Number(p.amount), 0);

  const totalAmountNum = Number(order.totalAmount);
  const remainingBalance = Math.max(0, totalAmountNum - totalPaid);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header va Amallar */}
      <div className="flex flex-wrap justify-between items-center bg-white p-6 rounded shadow gap-4">
        <div>
          <div className="flex items-center gap-3">
            <Link to="/orders" className="text-gray-400 hover:text-gray-600 text-sm">
              ← Ro'yxat
            </Link>
            <h1 className="text-2xl font-bold text-gray-800 font-mono">
              Buyurtma #{order.id.slice(-6)}
            </h1>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Kassir: <span className="font-semibold text-gray-700">{order.cashier?.name || 'Noma\'lum'}</span> |{' '}
            Sana: <span>{new Date(order.createdAt).toLocaleString('uz-UZ')}</span>
          </p>
          <div className="flex gap-2 mt-2">
            <span
              className={`px-2.5 py-0.5 rounded text-xs font-bold ${
                order.status === 'NEW'
                  ? 'bg-yellow-100 text-yellow-800'
                  : order.status === 'CONFIRMED'
                  ? 'bg-blue-100 text-blue-800'
                  : order.status === 'PREPARING'
                  ? 'bg-purple-100 text-purple-800'
                  : order.status === 'COMPLETED'
                  ? 'bg-green-100 text-green-800'
                  : 'bg-red-100 text-red-800'
              }`}
            >
              Holat: {order.status}
            </span>
            <span
              className={`px-2.5 py-0.5 rounded text-xs font-bold ${
                order.paymentStatus === 'PAID'
                  ? 'bg-green-100 text-green-800'
                  : order.paymentStatus === 'PARTIAL'
                  ? 'bg-orange-100 text-orange-800'
                  : 'bg-gray-100 text-gray-800'
              }`}
            >
              To'lov: {order.paymentStatus}
            </span>
          </div>
          {order.cancelReason && (
            <p className="text-xs text-red-600 mt-2 bg-red-50 p-2 rounded border border-red-200">
              Bekor qilish sababi: {order.cancelReason}
            </p>
          )}
        </div>

        {/* Tugmalar */}
        <div className="flex flex-wrap gap-2">
          {order.status === 'NEW' && (
            <button
              onClick={handleConfirm}
              disabled={actionLoading}
              className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 font-medium disabled:opacity-50"
            >
              Tasdiqlash
            </button>
          )}
          {order.status === 'CONFIRMED' && (
            <button
              onClick={() => handleNextStatus('PREPARING')}
              disabled={actionLoading}
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 font-medium disabled:opacity-50"
            >
              Tayyorlashga o'tkazish
            </button>
          )}
          {order.status === 'PREPARING' && (
            <button
              onClick={() => handleNextStatus('COMPLETED')}
              disabled={actionLoading}
              className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700 font-medium disabled:opacity-50"
            >
              Yakunlash
            </button>
          )}
          {order.status !== 'COMPLETED' && order.status !== 'CANCELLED' && (
            <button
              onClick={() => setCancelModal(true)}
              disabled={actionLoading}
              className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 font-medium disabled:opacity-50"
            >
              Bekor qilish
            </button>
          )}
          <a
            href={`/api/orders/${order.id}/receipt.pdf`}
            target="_blank"
            rel="noreferrer"
            className="border border-gray-300 px-4 py-2 rounded hover:bg-gray-50 text-gray-700 inline-block font-medium"
          >
            Chek (PDF)
          </a>
        </div>
      </div>

      {/* Mahsulotlar ro'yxati */}
      <div className="bg-white p-6 rounded shadow">
        <h2 className="text-lg font-bold mb-4 text-gray-800">Tarkibdagi Mahsulotlar</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b text-sm text-gray-500">
                <th className="py-2">Nomi</th>
                <th className="py-2">Narx</th>
                <th className="py-2">Miqdor</th>
                <th className="py-2 text-right">Summa</th>
              </tr>
            </thead>
            <tbody>
              {order.items?.map((i) => (
                <tr key={i.id} className="border-b text-sm">
                  <td className="py-3">
                    <p className="font-medium text-gray-800">{i.product?.name || 'Mahsulot'}</p>
                    {i.product?.sku && <span className="text-xs text-gray-400 font-mono">{i.product.sku}</span>}
                  </td>
                  <td className="py-3">{Number(i.priceAtSale).toLocaleString()} so'm</td>
                  <td className="py-3 font-semibold">{i.qty} dona</td>
                  <td className="py-3 text-right font-semibold text-gray-800">
                    {(Number(i.priceAtSale) * i.qty).toLocaleString()} so'm
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col items-end mt-4 pt-4 border-t space-y-1">
          <div className="text-sm text-gray-500">
            Jami summa: <span className="font-semibold text-gray-800">{totalAmountNum.toLocaleString()} so'm</span>
          </div>
          <div className="text-sm text-green-600">
            To'langan summa: <span className="font-semibold">{totalPaid.toLocaleString()} so'm</span>
          </div>
          <div className="text-lg font-bold text-blue-600">
            Qoldiq summa: {remainingBalance.toLocaleString()} so'm
          </div>
        </div>
      </div>

      {/* To'lovlar bloki */}
      <div className="bg-white p-6 rounded shadow space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-bold text-gray-800">To'lovlar Tarixi</h2>
          {remainingBalance === 0 && (
            <span className="bg-green-100 text-green-800 text-xs px-2.5 py-1 rounded-full font-bold">
              To'liq to'langan
            </span>
          )}
        </div>

        {/* To'lov qabul qilish formasi */}
        {order.status !== 'CANCELLED' && remainingBalance > 0 && (
          <form onSubmit={handleAddPayment} className="flex flex-wrap gap-4 p-4 bg-gray-50 rounded border">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-semibold text-gray-600 mb-1">To'lov summasi (so'm)</label>
              <input
                type="number"
                placeholder={remainingBalance.toString()}
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                className="w-full border p-2 rounded text-sm bg-white"
                required
              />
            </div>
            <div className="w-40">
              <label className="block text-xs font-semibold text-gray-600 mb-1">Usul</label>
              <select
                value={paymentMethod}
                onChange={(e: any) => setPaymentMethod(e.target.value)}
                className="w-full border p-2 rounded text-sm bg-white"
              >
                <option value="cash">Naqd</option>
                <option value="card">Plastik karta</option>
                <option value="online">Online to'lov</option>
              </select>
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={actionLoading}
                className="bg-blue-600 text-white px-5 py-2 rounded text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
              >
                To'lov qabul qilish
              </button>
            </div>
          </form>
        )}

        {/* Oldingi to'lovlar jadvali */}
        {order.payments && order.payments.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-gray-500">
                  <th className="py-2">Vaqt</th>
                  <th className="py-2">Usul</th>
                  <th className="py-2">Holati</th>
                  <th className="py-2 text-right">Summa</th>
                </tr>
              </thead>
              <tbody>
                {order.payments.map((p) => (
                  <tr key={p.id} className="border-b">
                    <td className="py-2 text-gray-600">{new Date(p.createdAt).toLocaleString('uz-UZ')}</td>
                    <td className="py-2 capitalize font-medium">{p.method}</td>
                    <td className="py-2">
                      <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded">
                        {p.status}
                      </span>
                    </td>
                    <td className="py-2 text-right font-semibold">
                      {Number(p.amount).toLocaleString()} so'm
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-400 text-sm italic">Hozircha hech qanday to'lov qabul qilinmagan.</p>
        )}
      </div>

      {/* Bekor qilish modali */}
      {cancelModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white p-6 rounded-lg w-full max-w-md space-y-4 shadow-xl">
            <h3 className="font-bold text-lg text-gray-800">Buyurtmani bekor qilish</h3>
            <p className="text-sm text-gray-500">
              Buyurtma bekor qilinganda tasdiqlangan tovarlar avtomatik ravishda ombor qoldig'iga qaytariladi.
            </p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full border p-2.5 rounded text-sm focus:ring-2 focus:ring-red-500 focus:outline-none"
              rows={3}
              placeholder="Bekor qilish sababini kiriting (masalan: mijoz xaridni rad etdi)..."
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setCancelModal(false)}
                disabled={actionLoading}
                className="px-4 py-2 border rounded text-sm hover:bg-gray-50"
              >
                Yopish
              </button>
              <button
                onClick={handleCancel}
                disabled={actionLoading}
                className="px-4 py-2 bg-red-600 text-white rounded text-sm font-semibold hover:bg-red-700 disabled:opacity-50"
              >
                {actionLoading ? 'Bekor qilinmoqda...' : 'Bekor qilishni tasdiqlash'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};