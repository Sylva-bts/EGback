const bcrypt = require("bcrypt");
const AdminUser = require("../models/AdminUser");

async function ensureAdminUser() {
  const email = String(process.env.ADMIN_EMAIL || "admin@escape.local").trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || "Admin123456!").trim();
  const displayName = String(process.env.ADMIN_DISPLAY_NAME || "Escape the Ghost Control").trim();

  let admin = await AdminUser.findOne({ email });
  if (admin) {
    return admin;
  }

  const hasAnyAdmin = await AdminUser.exists({});
  if (hasAnyAdmin) {
    return null;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  admin = await AdminUser.create({
    email,
    passwordHash,
    displayName,
    role: "superadmin"
  });

  console.log(`[Admin] Compte bootstrap cree pour ${email}`);
  return admin;
}

module.exports = { ensureAdminUser };
