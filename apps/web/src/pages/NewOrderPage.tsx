import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

interface Product {
  id: string;
  name: string;
  sku: string;
  price: string | number;
  stock: number;
}

interface CartItem {
  product: Product;
  qty: number;
}

export const NewOrderPage: React.FC = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    fetch('/api/products', { credentials: 'include' })
      .then((res) => {
        if (!res.ok) throw new Error('Mahsulotlarni yuklab bo\'lmadi');
        return res.json();
      })
      .then((data) => {
        if (Array.isArray(data)) {
          setProducts(data);
        } else if (data && Array.isArray(data.products)) {
          setProducts(data.products);
        } else {
          setProducts([]);
        }
      })
      .catch((err) => {
        console.error(err);
        setErrorMessage('Mahsulotlar ro\'yxatini olishda xatolik yuz berdi');
      })
      .finally(() => setLoading(false));
  }, []);

  const addToCart = (product: Product) => {
    if (product.stock <= 0) {
      alert(`"${product.name}" omborda mavjud emas!`);
      return;
    }

    setCart((prev) => {
      const exists = prev.find((item) => item.product.id === product.id);
      if (exists) {
        if (exists.qty >= product.stock) {
          alert(`"${product.name}" dan omborda faqat ${product.stock} dona mavjud!`);
          return prev;
        }
        return prev.map((item) =>
          item.product.id === product.id ? { ...item, qty: item.qty + 1 } : item
        );
      }
      return [...prev, { product, qty: 1 }];
    });
  };

  const updateQty = (productId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.product.id === productId) {
            const newQty = item.qty + delta;
            if (newQty > item.product.stock) {
              alert(`"${item.product.name}" dan omborda faqat ${item.product.stock} dona mavjud!`);
              return item;
            }
            return newQty > 0 ? { ...item, qty: newQty } : null;
          }
          return item;
        })
        .filter(Boolean) as CartItem[]
    );
  };

  const total = cart.reduce((acc, item) => acc + Number(item.product.price) * item.qty, 0);

  const handleSubmit = async () => {
    if (cart.length === 0) return alert('Savat bo\'sh!');

    setSubmitting(true);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          items: cart.map((i) => ({ productId: i.product.id, qty: i.qty }))
        })
      });

      const data = await res.json();

      if (res.ok) {
        navigate(`/orders/${data.id}`);
      } else {
        setErrorMessage(data.error || 'Buyurtma yaratishda xatolik yuz berdi');
        alert(`Xatolik: ${data.error || 'Buyurtma yaratib bo\'lmadi'}`);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Serverga ulanishda xatolik');
      alert('Serverga ulanishda xatolik yuz berdi');
    } finally {
      setSubmitting(false);
    }
  };

  const filteredProducts = products.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.sku && p.sku.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="p-6 max-w-7xl mx-auto grid grid-cols-3 gap-6">
      {/* Mahsulotlar qidiruvi */}
      <div className="col-span-2 bg-white p-6 rounded shadow space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-bold text-gray-800">Kassa / Mahsulotlar</h2>
          <span className="text-sm text-gray-500">{products.length} ta mahsulot</span>
        </div>

        {errorMessage && (
          <div className="p-3 bg-red-100 border border-red-300 text-red-700 rounded text-sm">
            {errorMessage}
          </div>
        )}

        <input
          type="text"
          placeholder="Mahsulot qidirish (nomi yoki SKU)..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full border p-2 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        {loading ? (
          <p className="text-gray-500 py-8 text-center">Mahsulotlar yuklanmoqda...</p>
        ) : filteredProducts.length === 0 ? (
          <p className="text-gray-500 py-8 text-center">Mahsulot topilmadi</p>
        ) : (
          <div className="grid grid-cols-3 gap-4 max-h-[600px] overflow-y-auto pr-1">
            {filteredProducts.map((p) => {
              const isOutOfStock = p.stock <= 0;
              return (
                <div
                  key={p.id}
                  onClick={() => !isOutOfStock && addToCart(p)}
                  className={`border p-4 rounded transition select-none ${
                    isOutOfStock
                      ? 'bg-gray-50 opacity-60 cursor-not-allowed border-gray-200'
                      : 'cursor-pointer hover:border-blue-500 hover:shadow-sm'
                  }`}
                >
                  <h4 className="font-bold text-gray-800 line-clamp-1">{p.name}</h4>
                  <div className="flex justify-between items-center mt-1">
                    <span className="text-xs text-gray-500 font-mono">{p.sku}</span>
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                        isOutOfStock
                          ? 'bg-red-100 text-red-700'
                          : p.stock <= 3
                          ? 'bg-orange-100 text-orange-700'
                          : 'bg-green-100 text-green-700'
                      }`}
                    >
                      {isOutOfStock ? 'Tugagan' : `Qoldiq: ${p.stock}`}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-blue-600 mt-2">
                    {Number(p.price).toLocaleString()} so'm
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Savat (POS Checkout) */}
      <div className="bg-white p-6 rounded shadow flex flex-col justify-between">
        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-gray-800">Savat</h2>
            {cart.length > 0 && (
              <button
                onClick={() => setCart([])}
                className="text-xs text-red-500 hover:underline"
              >
                Tozalash
              </button>
            )}
          </div>

          <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
            {cart.length === 0 ? (
              <p className="text-gray-400 text-sm py-12 text-center">Savat bo'sh. Mahsulot tanlang.</p>
            ) : (
              cart.map((item) => (
                <div key={item.product.id} className="flex justify-between items-center border-b pb-2">
                  <div className="flex-1 mr-2">
                    <p className="font-medium text-sm text-gray-800 line-clamp-1">{item.product.name}</p>
                    <p className="text-xs text-gray-500">
                      {Number(item.product.price).toLocaleString()} so'm x {item.qty} ={' '}
                      <span className="font-semibold text-gray-700">
                        {(Number(item.product.price) * item.qty).toLocaleString()} so'm
                      </span>
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => updateQty(item.product.id, -1)}
                      className="w-7 h-7 flex items-center justify-center border rounded hover:bg-gray-100 font-bold"
                    >
                      -
                    </button>
                    <span className="w-6 text-center text-sm font-semibold">{item.qty}</span>
                    <button
                      onClick={() => updateQty(item.product.id, 1)}
                      className="w-7 h-7 flex items-center justify-center border rounded hover:bg-gray-100 font-bold"
                    >
                      +
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="border-t pt-4 mt-4">
          <div className="flex justify-between text-lg font-bold mb-4 text-gray-800">
            <span>Jami to'lov:</span>
            <span className="text-blue-600">{total.toLocaleString()} so'm</span>
          </div>
          <button
            onClick={handleSubmit}
            disabled={submitting || cart.length === 0}
            className={`w-full py-3 rounded font-bold text-white transition ${
              submitting || cart.length === 0
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-green-600 hover:bg-green-700 shadow'
            }`}
          >
            {submitting ? 'Yaratilmoqda...' : 'Buyurtmani yaratish'}
          </button>
        </div>
      </div>
    </div>
  );
};