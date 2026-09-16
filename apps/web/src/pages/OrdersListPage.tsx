import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

const STATUS_TABS = ['ALL', 'NEW', 'CONFIRMED', 'PREPARING', 'COMPLETED', 'CANCELLED'];

interface OrderListItem {
  id: string;
  createdAt: string;
  totalAmount: string | number;
  status: 'NEW' | 'CONFIRMED' | 'PREPARING' | 'COMPLETED' | 'CANCELLED';
  paymentStatus: 'UNPAID' | 'PARTIAL' | 'PAID';
  cashier?: {
    id: string;
    name: string;
  };
}

export const OrdersListPage: React.FC = () => {
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [status, setStatus] = useState<string>('ALL');
  const [loading, setLoading] = useState<boolean>(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const fetchOrders = async () => {
    try {
      const url = status === 'ALL' ? '/api/orders' : `/api/orders?status=${status}`;
      const res = await fetch(url, { credentials: 'include' });
      const data = await res.json();
      if (res.ok) {
        setOrders(data.orders || []);
        setFetchError(null);
      } else {
        setFetchError(data.error || 'Buyurtmalarni yuklab bo\'lmadi');
      }
    } catch (e: any) {
      console.error(e);
      setFetchError('Serverga ulanishda xatolik yuz berdi');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    fetchOrders();

    // 7 soniyalik interval bilan yangilash
    const timer = setInterval(fetchOrders, 7000);
    return () => clearInterval(timer);
  }, [status]);

  const getStatusBadgeClass = (orderStatus: string) => {
    switch (orderStatus) {
      case 'NEW':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'CONFIRMED':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'PREPARING':
        return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'COMPLETED':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'CANCELLED':
        return 'bg-red-100 text-red-800 border-red-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap justify-between items-center mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Buyurtmalar ro'yxati</h1>
          <p className="text-sm text-gray-500">Do'koningizdagi barcha kassa savdo operatsiyalari</p>
        </div>
        <Link
          to="/orders/new"
          className="bg-blue-600 text-white px-4 py-2 rounded-lg shadow hover:bg-blue-700 font-medium transition"
        >
          + Yangi kassa buyurtmasi
        </Link>
      </div>

      {fetchError && (
        <div className="p-3 mb-4 bg-red-50 border border-red-200 text-red-700 rounded text-sm">
          {fetchError}
        </div>
      )}

      {/* Filter tablari */}
      <div className="flex space-x-1 mb-4 border-b border-gray-200 overflow-x-auto">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setStatus(tab)}
            className={`py-2 px-4 font-medium text-sm transition-colors whitespace-nowrap ${
              status === tab
                ? 'border-b-2 border-blue-600 text-blue-600 font-bold'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab === 'ALL' ? 'Barchasi' : tab}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="p-12 text-center text-gray-500 bg-white rounded shadow">
          Buyurtmalar yuklanmoqda...
        </div>
      ) : orders.length === 0 ? (
        <div className="p-12 text-center text-gray-500 bg-white rounded shadow">
          Buyurtmalar topilmadi.
        </div>
      ) : (
        <div className="bg-white rounded shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b text-xs uppercase tracking-wider text-gray-500 font-semibold">
                  <th className="p-3.5">ID</th>
                  <th className="p-3.5">Sana va Vaqt</th>
                  <th className="p-3.5">Kassir</th>
                  <th className="p-3.5">Summa</th>
                  <th className="p-3.5">Status</th>
                  <th className="p-3.5">To'lov holati</th>
                  <th className="p-3.5 text-right">Amallar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {orders.map((o) => (
                  <tr key={o.id} className="hover:bg-gray-50 text-sm transition-colors">
                    <td className="p-3.5 font-mono font-semibold text-blue-600">
                      #{o.id.slice(-6)}
                    </td>
                    <td className="p-3.5 text-gray-600">
                      {new Date(o.createdAt).toLocaleString('uz-UZ', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </td>
                    <td className="p-3.5 font-medium text-gray-800">
                      {o.cashier?.name || 'Noma\'lum'}
                    </td>
                    <td className="p-3.5 font-bold text-gray-900">
                      {Number(o.totalAmount).toLocaleString()} so'm
                    </td>
                    <td className="p-3.5">
                      <span
                        className={`px-2.5 py-1 rounded text-xs font-semibold border ${getStatusBadgeClass(
                          o.status
                        )}`}
                      >
                        {o.status}
                      </span>
                    </td>
                    <td className="p-3.5">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${
                          o.paymentStatus === 'PAID'
                            ? 'bg-green-100 text-green-800'
                            : o.paymentStatus === 'PARTIAL'
                            ? 'bg-orange-100 text-orange-800'
                            : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {o.paymentStatus}
                      </span>
                    </td>
                    <td className="p-3.5 text-right">
                      <Link
                        to={`/orders/${o.id}`}
                        className="inline-block px-3 py-1 bg-blue-50 text-blue-600 rounded hover:bg-blue-100 font-medium text-xs transition"
                      >
                        Batafsil →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
