const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { pool, initDB } = require("./db");
const auth = require("./auth");

const app = express();
app.use(express.json());

// DB init
initDB();

// 🔑 LOGIN
app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  const user = await pool.query(
    "SELECT * FROM users WHERE username=$1",
    [username]
  );

  if (!user.rows.length) {
    return res.status(401).json({ error: "Login noto‘g‘ri" });
  }

  const ok = await bcrypt.compare(password, user.rows[0].password);
  if (!ok) {
    return res.status(401).json({ error: "Parol noto‘g‘ri" });
  }

  const token = jwt.sign(
    { id: user.rows[0].id, role: user.rows[0].role },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );

  res.json({ token, role: user.rows[0].role });
});

// 👤 ADMIN USER YARATISH (faqat bir marta)
app.post("/seed-admin", async (req, res) => {
  const hash = await bcrypt.hash("admin123", 10);

  await pool.query(
    "INSERT INTO users (username,password,role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
    ["admin", hash, "admin"]
  );

  res.json({ message: "Admin tayyor: admin / admin123" });
});

// 💰 SOTUV QO‘SHISH
app.post("/sales", auth(), async (req, res) => {
  const { total, discount } = req.body;

  await pool.query(
    "INSERT INTO sales (user_id,total,discount) VALUES ($1,$2,$3)",
    [req.user.id, total, discount || 0]
  );

  res.json({ message: "Sotuv saqlandi" });
});

// 💸 XARAJAT QO‘SHISH
app.post("/expenses", auth(), async (req, res) => {
  const { type, amount, comment } = req.body;

  if (type === "bayram" && req.user.role !== "admin") {
    return res.status(403).json({ error: "Faqat admin" });
  }

  await pool.query(
    "INSERT INTO expenses (type,amount,comment,user_id) VALUES ($1,$2,$3,$4)",
    [type, amount, comment, req.user.id]
  );

  res.json({ message: "Xarajat qo‘shildi" });
});

// 📊 ADMIN HISOBOT
app.get("/report", auth("admin"), async (req, res) => {
  const sales = await pool.query("SELECT SUM(total-discount) FROM sales");
  const expenses = await pool.query("SELECT SUM(amount) FROM expenses");

  res.json({
    tushum: sales.rows[0].sum || 0,
    xarajat: expenses.rows[0].sum || 0,
    foyda: (sales.rows[0].sum || 0) - (expenses.rows[0].sum || 0)
  });
});

app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 POS backend ishga tushdi");
});