const jwt = require("jsonwebtoken");

function auth(requiredRole = null) {
  return (req, res, next) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Token yo‘q" });

    try {
      const data = jwt.verify(token, process.env.JWT_SECRET);
      req.user = data;

      if (requiredRole && data.role !== requiredRole) {
        return res.status(403).json({ error: "Ruxsat yo‘q" });
      }

      next();
    } catch {
      res.status(401).json({ error: "Token noto‘g‘ri" });
    }
  };
}

module.exports = auth;