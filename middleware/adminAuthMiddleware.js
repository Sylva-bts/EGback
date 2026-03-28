const jwt = require("jsonwebtoken");
const AdminUser = require("../models/AdminUser");

module.exports = async (req, res, next) => {
  if (!process.env.JWT_SECRET) {
    return res.status(500).json({ success: false, message: "Configuration JWT manquante" });
  }

  const authHeader = req.headers.authorization || "";
  const [scheme, token] = authHeader.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ success: false, message: "Acces admin refuse - Token requis" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded.adminId || decoded.role !== "admin") {
      return res.status(401).json({ success: false, message: "Token admin invalide" });
    }

    const admin = await AdminUser.findById(decoded.adminId).select("-passwordHash");
    if (!admin) {
      return res.status(401).json({ success: false, message: "Compte admin introuvable" });
    }

    req.admin = {
      id: admin._id,
      email: admin.email,
      displayName: admin.displayName,
      role: admin.role
    };

    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: "Session admin invalide" });
  }
};
