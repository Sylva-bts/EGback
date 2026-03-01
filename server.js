require("dotenv").config();
const express = require("express");
const path = require("path");
const connectDB = require("./config/database");
const corsMiddleware = require("./config/cors");

const app = express();

// Verify critical environment variables at startup
if (!process.env.JWT_SECRET) {
  console.error("🔴 ERREUR: JWT_SECRET n'est pas défini dans les variables d'environnement!");
  console.error("Veuillez définir JWT_SECRET dans votre fichier .env");
  process.exit(1);
}

if (!process.env.OXAPAY_MERCHANT_API_KEY) {
  console.warn("⚠️ AVERTISSEMENT: OXAPAY_MERCHANT_API_KEY non défini");
}

if (!process.env.OXAPAY_PAYOUT_API_KEY) {
  console.warn("⚠️ AVERTISSEMENT: OXAPAY_PAYOUT_API_KEY non défini");
}

console.log("✅ Variables d'environnement chargées");

// Connexion à MongoDB
connectDB();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(corsMiddleware);

// Static files
app.use(express.static(path.join(__dirname, '../public')));

// Routes
app.use("/api/auth", require("./routes/auth"));
app.use("/api/payments", require("./routes/payments"));

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route non trouvée" });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  const statusCode = err.statusCode || 500;
  const message = err.message || "Erreur serveur";
  res.status(statusCode).json({ success: false, message });
});

// Server
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
  console.log(`🚀 Serveur lancé sur le port ${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM reçu. Arrêt du serveur...");
  server.close(() => {
    console.log("Serveur arrêté");
    process.exit(0);
  });
});
