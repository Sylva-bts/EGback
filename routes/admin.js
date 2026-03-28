const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const AdminUser = require("../models/AdminUser");
const AdminActionLog = require("../models/AdminActionLog");
const Transaction = require("../models/Transaction");
const User = require("../models/User");
const WorldChatMessage = require("../models/WorldChatMessage");
const adminAuthMiddleware = require("../middleware/adminAuthMiddleware");
const OxaPayService = require("../payement/oxapay.service");
const { ensureAdminUser } = require("../utils/adminBootstrap");
const { getGameSettings, saveGameSettings, DEFAULT_GAME_SETTINGS } = require("../utils/gameSettings");

const router = express.Router();
const ObjectId = mongoose.Types.ObjectId;

function toMoney(value) {
  return Number((Number(value || 0)).toFixed(2));
}

function buildAdminToken(admin) {
  return jwt.sign(
    {
      adminId: admin._id,
      role: "admin"
    },
    process.env.JWT_SECRET,
    { expiresIn: "12h" }
  );
}

function escapeCsv(value) {
  const text = String(value ?? "");
  if (/[,"\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function pickDateRange(query) {
  const createdAt = {};

  if (query.from) {
    createdAt.$gte = new Date(query.from);
  }

  if (query.to) {
    const end = new Date(query.to);
    end.setHours(23, 59, 59, 999);
    createdAt.$lte = end;
  }

  return Object.keys(createdAt).length ? { createdAt } : {};
}

function sanitizeAdmin(admin) {
  return {
    id: admin._id,
    email: admin.email,
    displayName: admin.displayName,
    role: admin.role,
    lastLoginAt: admin.lastLoginAt
  };
}

function buildUserCard(user) {
  const totalDebited = toMoney(user.gameStats?.totalDebited || 0);
  const totalCredited = toMoney(user.gameStats?.totalCredited || 0);
  const rtp = totalDebited > 0 ? toMoney((totalCredited / totalDebited) * 100) : 0;

  return {
    id: user._id,
    username: user.username,
    email: user.email,
    balance: toMoney(user.balance),
    isBanned: Boolean(user.isBanned),
    banReason: user.banReason || "",
    bannedAt: user.bannedAt,
    lastSeenAt: user.lastSeenAt,
    createdAt: user.createdAt,
    powers: user.powers || {},
    adminGameControl: {
      forcedCrashValue: user.adminGameControl?.forcedCrashValue ?? null,
      notes: user.adminGameControl?.notes || "",
      updatedAt: user.adminGameControl?.updatedAt || null
    },
    gameStats: {
      totalDebited,
      totalCredited,
      rtp
    }
  };
}

async function logAdminAction(adminId, action, summary, extra = {}) {
  await AdminActionLog.create({
    admin: adminId,
    action,
    summary,
    targetType: extra.targetType || "",
    targetId: extra.targetId || "",
    metadata: extra.metadata || {}
  });
}

function normalizeWithdrawalStatus(status) {
  const value = String(status || "").trim().toLowerCase();

  if (["completed", "success", "paid"].includes(value)) {
    return "completed";
  }

  if (["rejected", "failed", "cancelled", "canceled"].includes(value)) {
    return "rejected";
  }

  return "pending";
}

function extractPayoutId(payload) {
  return String(
    payload?.trans_id ||
      payload?.track_id ||
      payload?.payout_id ||
      payload?.id ||
      payload?.order_id ||
      ""
  ).trim();
}

function mergeDeep(base, override) {
  if (!override || typeof override !== "object" || Array.isArray(override)) {
    return override === undefined ? base : override;
  }

  const output = Array.isArray(base) ? [...base] : { ...(base || {}) };
  Object.keys(override).forEach((key) => {
    const baseValue = output[key];
    const overrideValue = override[key];

    if (
      baseValue &&
      overrideValue &&
      typeof baseValue === "object" &&
      typeof overrideValue === "object" &&
      !Array.isArray(baseValue) &&
      !Array.isArray(overrideValue)
    ) {
      output[key] = mergeDeep(baseValue, overrideValue);
      return;
    }

    output[key] = overrideValue;
  });

  return output;
}

async function getDashboardData() {
  const [usersCount, activePlayers, depositsAgg, withdrawalsAgg, betsAgg, cashoutsAgg, powerAgg, affiliateAgg, chartRows, topOdds, pendingWithdraws] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ lastSeenAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } }),
    Transaction.aggregate([{ $match: { type: "deposit", status: { $in: ["paid", "completed"] } } }, { $group: { _id: null, total: { $sum: "$amount_fiat" } } }]),
    Transaction.aggregate([{ $match: { type: "withdraw", status: "completed" } }, { $group: { _id: null, total: { $sum: "$amount_fiat" } } }]),
    Transaction.aggregate([{ $match: { type: "game_bet", status: "completed" } }, { $group: { _id: null, total: { $sum: "$amount_fiat" } } }]),
    Transaction.aggregate([{ $match: { type: "game_cashout", status: "completed" } }, { $group: { _id: null, total: { $sum: "$amount_fiat" } } }]),
    Transaction.aggregate([{ $match: { type: "power_purchase", status: { $in: ["paid", "completed"] } } }, { $group: { _id: null, total: { $sum: "$amount_fiat" } } }]),
    Transaction.aggregate([{ $match: { type: "affiliate_credit", status: "completed" } }, { $group: { _id: null, total: { $sum: "$amount_fiat" } } }]),
    Transaction.aggregate([
      {
        $match: {
          createdAt: { $gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) }
        }
      },
      {
        $project: {
          day: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }
          },
          user: "$user",
          type: "$type",
          amount_fiat: "$amount_fiat"
        }
      },
      {
        $group: {
          _id: "$day",
          totalGains: {
            $sum: {
              $cond: [{ $eq: ["$type", "game_cashout"] }, "$amount_fiat", 0]
            }
          },
          totalLosses: {
            $sum: {
              $cond: [{ $eq: ["$type", "game_bet"] }, "$amount_fiat", 0]
            }
          },
          players: { $addToSet: "$user" }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]),
    Transaction.aggregate([
      { $match: { type: "game_cashout", multiplier: { $gt: 0 } } },
      {
        $group: {
          _id: { $round: ["$multiplier", 1] },
          hits: { $sum: 1 }
        }
      },
      { $sort: { hits: -1, _id: 1 } },
      { $limit: 8 }
    ]),
    Transaction.countDocuments({ type: "withdraw", status: "pending" })
  ]);

  const totalDeposits = toMoney(depositsAgg[0]?.total || 0);
  const totalWithdrawals = toMoney(withdrawalsAgg[0]?.total || 0);
  const totalBets = toMoney(betsAgg[0]?.total || 0);
  const totalCashouts = toMoney(cashoutsAgg[0]?.total || 0);
  const totalPowerSales = toMoney(powerAgg[0]?.total || 0);
  const affiliatePayouts = toMoney(affiliateAgg[0]?.total || 0);
  const estimatedProfit = toMoney(totalBets + totalPowerSales - totalCashouts - affiliatePayouts);
  const houseEdge = totalBets > 0 ? toMoney((estimatedProfit / totalBets) * 100) : 0;
  const globalRtp = totalBets > 0 ? toMoney((totalCashouts / totalBets) * 100) : 0;

  return {
    cards: {
      totalUsers: usersCount,
      activePlayers,
      totalDeposits,
      totalWithdrawals,
      estimatedProfit,
      houseEdge,
      globalRtp,
      pendingWithdraws
    },
    charts: chartRows.map((row) => ({
      day: row._id,
      activePlayers: row.players.length,
      gains: toMoney(row.totalGains),
      losses: toMoney(row.totalLosses)
    })),
    topOdds: topOdds.map((item) => ({
      multiplier: item._id,
      hits: item.hits
    }))
  };
}

async function getAlerts() {
  const pendingWithdraws = await Transaction.find({ type: "withdraw", status: "pending" })
    .sort({ createdAt: -1 })
    .limit(8)
    .populate("user", "username email");

  return pendingWithdraws.map((item) => ({
    id: item._id,
    type: "withdraw_pending",
    message: `Retrait en attente: ${item.user?.username || "Joueur"} - $${toMoney(item.amount_fiat)}`,
    createdAt: item.createdAt
  }));
}

router.post("/login", async (req, res) => {
  try {
    await ensureAdminUser();

    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const admin = await AdminUser.findOne({ email });

    if (!admin) {
      return res.status(401).json({ success: false, message: "Identifiants admin invalides" });
    }

    const isMatch = await bcrypt.compare(password, admin.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Identifiants admin invalides" });
    }

    admin.lastLoginAt = new Date();
    await admin.save();
    await logAdminAction(admin._id, "admin.login", "Connexion admin reussie");

    const token = buildAdminToken(admin);

    return res.json({
      success: true,
      token,
      admin: sanitizeAdmin(admin)
    });
  } catch (error) {
    console.error("Admin login error:", error);
    return res.status(500).json({ success: false, message: "Connexion admin impossible" });
  }
});

router.use(adminAuthMiddleware);

router.get("/bootstrap", async (req, res) => {
  try {
    const [dashboard, settings, alerts, logs, users, transactions] = await Promise.all([
      getDashboardData(),
      getGameSettings(),
      getAlerts(),
      AdminActionLog.find().sort({ createdAt: -1 }).limit(8).populate("admin", "displayName email"),
      User.find().sort({ createdAt: -1 }).limit(12),
      Transaction.find().sort({ createdAt: -1 }).limit(12).populate("user", "username email")
    ]);

    return res.json({
      success: true,
      admin: req.admin,
      dashboard,
      settings,
      alerts,
      users: users.map(buildUserCard),
      transactions,
      logs: logs.map((log) => ({
        id: log._id,
        action: log.action,
        summary: log.summary,
        createdAt: log.createdAt,
        admin: log.admin?.displayName || log.admin?.email || "Admin"
      }))
    });
  } catch (error) {
    console.error("Admin bootstrap error:", error);
    return res.status(500).json({ success: false, message: "Chargement admin impossible" });
  }
});

router.get("/dashboard", async (req, res) => {
  try {
    return res.json({ success: true, dashboard: await getDashboardData() });
  } catch (error) {
    console.error("Admin dashboard error:", error);
    return res.status(500).json({ success: false, message: "Dashboard indisponible" });
  }
});

router.get("/alerts", async (req, res) => {
  try {
    return res.json({ success: true, alerts: await getAlerts() });
  } catch (error) {
    console.error("Admin alerts error:", error);
    return res.status(500).json({ success: false, message: "Alertes indisponibles" });
  }
});

router.get("/users", async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const search = String(req.query.search || "").trim();
    const status = String(req.query.status || "").trim();

    const query = {};
    if (search) {
      query.$or = [
        { username: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } }
      ];
    }

    if (status === "banned") {
      query.isBanned = true;
    } else if (status === "active") {
      query.isBanned = false;
    }

    const [items, total] = await Promise.all([
      User.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      User.countDocuments(query)
    ]);

    return res.json({
      success: true,
      users: items.map(buildUserCard),
      pagination: {
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit))
      }
    });
  } catch (error) {
    console.error("Admin users error:", error);
    return res.status(500).json({ success: false, message: "Chargement des joueurs impossible" });
  }
});

router.get("/users/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: "Joueur introuvable" });
    }

    const history = await Transaction.find({ user: user._id }).sort({ createdAt: -1 }).limit(50);

    return res.json({
      success: true,
      user: {
        ...buildUserCard(user),
        passwordInfo: "Mot de passe hashé en base. Affichage en clair impossible.",
        affiliate: {
          totalEarned: toMoney(user.affiliateTotalEarned),
          lockedBalance: toMoney(user.affiliateLockedBalance),
          unlockedTotal: toMoney(user.affiliateUnlockedTotal),
          referredBy: user.referredBy
        }
      },
      history
    });
  } catch (error) {
    console.error("Admin user detail error:", error);
    return res.status(500).json({ success: false, message: "Details joueur indisponibles" });
  }
});

router.get("/users/by-username/:username", async (req, res) => {
  try {
    const username = String(req.params.username || "").trim();
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ success: false, message: "Joueur introuvable" });
    }

    const history = await Transaction.find({ user: user._id }).sort({ createdAt: -1 }).limit(50);

    return res.json({
      success: true,
      user: {
        ...buildUserCard(user),
        passwordInfo: "Mot de passe hashÃ© en base. Affichage en clair impossible.",
        affiliate: {
          totalEarned: toMoney(user.affiliateTotalEarned),
          lockedBalance: toMoney(user.affiliateLockedBalance),
          unlockedTotal: toMoney(user.affiliateUnlockedTotal),
          referredBy: user.referredBy
        }
      },
      history
    });
  } catch (error) {
    console.error("Admin user detail by username error:", error);
    return res.status(500).json({ success: false, message: "Details joueur indisponibles" });
  }
});

router.patch("/users/:id/balance", async (req, res) => {
  try {
    const amount = Number(req.body.amount);
    const reason = String(req.body.reason || "Ajustement admin").trim();
    const mode = String(req.body.mode || "set").trim();
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ success: false, message: "Joueur introuvable" });
    }

    if (!Number.isFinite(amount)) {
      return res.status(400).json({ success: false, message: "Montant invalide" });
    }

    const previousBalance = toMoney(user.balance);
    if (mode === "delta") {
      user.balance = toMoney((user.balance || 0) + amount);
    } else {
      user.balance = toMoney(Math.max(0, amount));
    }

    await user.save();

    await logAdminAction(req.admin.id, "user.balance.update", `${user.username}: ${previousBalance} -> ${user.balance}`, {
      targetType: "user",
      targetId: String(user._id),
      metadata: { previousBalance, nextBalance: user.balance, mode, reason }
    });

    return res.json({ success: true, user: buildUserCard(user) });
  } catch (error) {
    console.error("Admin balance update error:", error);
    return res.status(500).json({ success: false, message: "Modification du solde impossible" });
  }
});

router.patch("/users/by-username/:username/balance", async (req, res) => {
  try {
    const amount = Number(req.body.amount);
    const reason = String(req.body.reason || "Ajustement admin").trim();
    const mode = String(req.body.mode || "set").trim();
    const username = String(req.params.username || "").trim();
    const user = await User.findOne({ username });

    if (!user) {
      return res.status(404).json({ success: false, message: "Joueur introuvable" });
    }

    if (!Number.isFinite(amount)) {
      return res.status(400).json({ success: false, message: "Montant invalide" });
    }

    const previousBalance = toMoney(user.balance);
    if (mode === "delta") {
      user.balance = toMoney((user.balance || 0) + amount);
    } else {
      user.balance = toMoney(Math.max(0, amount));
    }

    await user.save();

    await logAdminAction(req.admin.id, "user.balance.update", `${user.username}: ${previousBalance} -> ${user.balance}`, {
      targetType: "user",
      targetId: String(user._id),
      metadata: { previousBalance, nextBalance: user.balance, mode, reason }
    });

    return res.json({ success: true, user: buildUserCard(user) });
  } catch (error) {
    console.error("Admin balance update by username error:", error);
    return res.status(500).json({ success: false, message: "Modification du solde impossible" });
  }
});

router.patch("/users/:id/odds", async (req, res) => {
  try {
    const rawValue = req.body.forcedCrashValue;
    const note = String(req.body.note || "").trim();
    const forcedCrashValue = rawValue === null || rawValue === "" ? null : Number(rawValue);

    if (forcedCrashValue !== null && (!Number.isFinite(forcedCrashValue) || forcedCrashValue < 1)) {
      return res.status(400).json({ success: false, message: "Cote invalide" });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          "adminGameControl.forcedCrashValue": forcedCrashValue === null ? null : toMoney(forcedCrashValue),
          "adminGameControl.notes": note,
          "adminGameControl.updatedAt": new Date()
        }
      },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ success: false, message: "Joueur introuvable" });
    }

    await logAdminAction(
      req.admin.id,
      "user.odds.update",
      `Cote joueur modifiee pour ${user.username}`,
      {
        targetType: "user",
        targetId: String(user._id),
        metadata: {
          forcedCrashValue: user.adminGameControl.forcedCrashValue,
          note
        }
      }
    );

    return res.json({ success: true, user: buildUserCard(user) });
  } catch (error) {
    console.error("Admin odds update error:", error);
    return res.status(500).json({ success: false, message: "Modification de la cote joueur impossible" });
  }
});

router.patch("/users/by-username/:username/odds", async (req, res) => {
  try {
    const username = String(req.params.username || "").trim();
    const rawValue = req.body.forcedCrashValue;
    const note = String(req.body.note || "").trim();
    const forcedCrashValue = rawValue === null || rawValue === "" ? null : Number(rawValue);

    if (forcedCrashValue !== null && (!Number.isFinite(forcedCrashValue) || forcedCrashValue < 1)) {
      return res.status(400).json({ success: false, message: "Cote invalide" });
    }

    const user = await User.findOneAndUpdate(
      { username },
      {
        $set: {
          "adminGameControl.forcedCrashValue": forcedCrashValue === null ? null : toMoney(forcedCrashValue),
          "adminGameControl.notes": note,
          "adminGameControl.updatedAt": new Date()
        }
      },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ success: false, message: "Joueur introuvable" });
    }

    await logAdminAction(
      req.admin.id,
      "user.odds.update",
      `Cote joueur modifiee pour ${user.username}`,
      {
        targetType: "user",
        targetId: String(user._id),
        metadata: {
          forcedCrashValue: user.adminGameControl.forcedCrashValue,
          note
        }
      }
    );

    return res.json({ success: true, user: buildUserCard(user) });
  } catch (error) {
    console.error("Admin odds update by username error:", error);
    return res.status(500).json({ success: false, message: "Modification de la cote joueur impossible" });
  }
});

router.patch("/users/:id/ban", async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: "Joueur introuvable" });
    }

    user.isBanned = true;
    user.banReason = String(req.body.reason || "Restriction admin").trim();
    user.bannedAt = new Date();
    await user.save();

    await logAdminAction(req.admin.id, "user.ban", `Utilisateur banni: ${user.username}`, {
      targetType: "user",
      targetId: String(user._id),
      metadata: { reason: user.banReason }
    });

    return res.json({ success: true, user: buildUserCard(user) });
  } catch (error) {
    console.error("Admin ban error:", error);
    return res.status(500).json({ success: false, message: "Bannissement impossible" });
  }
});

router.patch("/users/by-username/:username/ban", async (req, res) => {
  try {
    const username = String(req.params.username || "").trim();
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ success: false, message: "Joueur introuvable" });
    }

    user.isBanned = true;
    user.banReason = String(req.body.reason || "Restriction admin").trim();
    user.bannedAt = new Date();
    await user.save();

    await logAdminAction(req.admin.id, "user.ban", `Utilisateur banni: ${user.username}`, {
      targetType: "user",
      targetId: String(user._id),
      metadata: { reason: user.banReason }
    });

    return res.json({ success: true, user: buildUserCard(user) });
  } catch (error) {
    console.error("Admin ban by username error:", error);
    return res.status(500).json({ success: false, message: "Bannissement impossible" });
  }
});

router.patch("/users/:id/unban", async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: "Joueur introuvable" });
    }

    user.isBanned = false;
    user.banReason = "";
    user.bannedAt = null;
    await user.save();

    await logAdminAction(req.admin.id, "user.unban", `Utilisateur debanni: ${user.username}`, {
      targetType: "user",
      targetId: String(user._id)
    });

    return res.json({ success: true, user: buildUserCard(user) });
  } catch (error) {
    console.error("Admin unban error:", error);
    return res.status(500).json({ success: false, message: "Debannissement impossible" });
  }
});

router.patch("/users/by-username/:username/unban", async (req, res) => {
  try {
    const username = String(req.params.username || "").trim();
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ success: false, message: "Joueur introuvable" });
    }

    user.isBanned = false;
    user.banReason = "";
    user.bannedAt = null;
    await user.save();

    await logAdminAction(req.admin.id, "user.unban", `Utilisateur debanni: ${user.username}`, {
      targetType: "user",
      targetId: String(user._id)
    });

    return res.json({ success: true, user: buildUserCard(user) });
  } catch (error) {
    console.error("Admin unban by username error:", error);
    return res.status(500).json({ success: false, message: "Debannissement impossible" });
  }
});

router.get("/transactions", async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const search = String(req.query.search || "").trim();
    const type = String(req.query.type || "").trim();
    const status = String(req.query.status || "").trim();
    const query = { ...pickDateRange(req.query) };

    if (type) {
      query.type = type;
    }

    if (status) {
      query.status = status;
    }

    if (search) {
      const users = await User.find({
        $or: [
          { username: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } }
        ]
      }).select("_id");
      query.user = { $in: users.map((item) => item._id) };
    }

    const [items, total] = await Promise.all([
      Transaction.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("user", "username email")
        .populate("adminDecisionBy", "displayName email"),
      Transaction.countDocuments(query)
    ]);

    return res.json({
      success: true,
      transactions: items,
      pagination: {
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit))
      }
    });
  } catch (error) {
    console.error("Admin transactions error:", error);
    return res.status(500).json({ success: false, message: "Transactions indisponibles" });
  }
});

router.patch("/transactions/:id/approve-withdraw", async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.id);
    if (!transaction || transaction.type !== "withdraw") {
      return res.status(404).json({ success: false, message: "Retrait introuvable" });
    }

    if (transaction.status !== "pending") {
      return res.status(400).json({ success: false, message: "Ce retrait a deja ete traite" });
    }

    const payoutReference = transaction.order_id || String(transaction._id);
    const payout = await OxaPayService.sendPayout(transaction.amount_fiat, transaction.crypto, transaction.address, payoutReference);
    const payoutId = extractPayoutId(payout);
    const payoutStatus = normalizeWithdrawalStatus(payout?.status);

    transaction.invoice_id = payoutId || transaction.invoice_id;
    transaction.order_id = String(payout?.order_id || "").trim() || payoutReference;
    transaction.transaction_hash = String(payout?.txid || payout?.tx_hash || "").trim() || transaction.transaction_hash;
    transaction.status = payoutStatus;
    transaction.updatedAt = new Date();
    transaction.adminDecisionAt = new Date();
    transaction.adminDecisionBy = req.admin.id;
    transaction.adminNotes = String(req.body.note || "Retrait valide par un administrateur").trim();
    await transaction.save();

    if (payoutStatus === "rejected") {
      const user = await User.findById(transaction.user);
      if (user) {
        user.balance = toMoney((user.balance || 0) + transaction.amount_fiat);
        await user.save();
      }
    }

    await logAdminAction(req.admin.id, "withdraw.approve", `Retrait ${transaction._id} valide`, {
      targetType: "transaction",
      targetId: String(transaction._id),
      metadata: { status: payoutStatus, amount: transaction.amount_fiat }
    });

    return res.json({ success: true, transaction });
  } catch (error) {
    console.error("Admin approve withdrawal error:", error);
    return res.status(500).json({ success: false, message: error.message || "Validation du retrait impossible" });
  }
});

router.patch("/transactions/:id/reject-withdraw", async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.id);
    if (!transaction || transaction.type !== "withdraw") {
      return res.status(404).json({ success: false, message: "Retrait introuvable" });
    }

    if (transaction.status !== "pending") {
      return res.status(400).json({ success: false, message: "Ce retrait a deja ete traite" });
    }

    transaction.status = "rejected";
    transaction.adminDecisionAt = new Date();
    transaction.adminDecisionBy = req.admin.id;
    transaction.adminNotes = String(req.body.note || "Retrait refuse par un administrateur").trim();
    await transaction.save();

    const user = await User.findById(transaction.user);
    if (user) {
      user.balance = toMoney((user.balance || 0) + transaction.amount_fiat);
      await user.save();
    }

    await logAdminAction(req.admin.id, "withdraw.reject", `Retrait ${transaction._id} refuse`, {
      targetType: "transaction",
      targetId: String(transaction._id),
      metadata: { amount: transaction.amount_fiat, note: transaction.adminNotes }
    });

    return res.json({ success: true, transaction });
  } catch (error) {
    console.error("Admin reject withdrawal error:", error);
    return res.status(500).json({ success: false, message: "Refus du retrait impossible" });
  }
});

router.get("/settings", async (req, res) => {
  try {
    return res.json({ success: true, settings: await getGameSettings() });
  } catch (error) {
    console.error("Admin get settings error:", error);
    return res.status(500).json({ success: false, message: "Parametres indisponibles" });
  }
});

router.patch("/settings", async (req, res) => {
  try {
    const currentSettings = await getGameSettings();
    const nextSettings = mergeDeep(currentSettings, req.body || {});
    const savedSettings = await saveGameSettings(nextSettings, req.admin.id);

    await logAdminAction(req.admin.id, "settings.update", "Parametres du jeu modifies", {
      targetType: "settings",
      targetId: "escape_the_ghost_runtime",
      metadata: req.body || {}
    });

    return res.json({ success: true, settings: savedSettings });
  } catch (error) {
    console.error("Admin update settings error:", error);
    return res.status(500).json({ success: false, message: "Mise a jour des parametres impossible" });
  }
});

router.post("/settings/force-crash", async (req, res) => {
  try {
    const crashValue = Math.max(1, Number(req.body.crashValue) || 1.01);
    const currentSettings = await getGameSettings();
    currentSettings.ghost.forcedCrashValue = toMoney(crashValue);
    const savedSettings = await saveGameSettings(currentSettings, req.admin.id);

    await logAdminAction(req.admin.id, "ghost.force_crash", `Cote forcee a ${savedSettings.ghost.forcedCrashValue}`, {
      targetType: "settings",
      targetId: "ghost"
    });

    return res.json({ success: true, settings: savedSettings });
  } catch (error) {
    console.error("Admin force crash error:", error);
    return res.status(500).json({ success: false, message: "Impossible de forcer la cote" });
  }
});

router.post("/settings/clear-force-crash", async (req, res) => {
  try {
    const currentSettings = await getGameSettings();
    currentSettings.ghost.forcedCrashValue = null;
    const savedSettings = await saveGameSettings(currentSettings, req.admin.id);

    await logAdminAction(req.admin.id, "ghost.clear_force_crash", "Cote forcee retiree", {
      targetType: "settings",
      targetId: "ghost"
    });

    return res.json({ success: true, settings: savedSettings });
  } catch (error) {
    console.error("Admin clear force crash error:", error);
    return res.status(500).json({ success: false, message: "Impossible de retirer la cote forcee" });
  }
});

router.delete("/world-chat/:id", async (req, res) => {
  try {
    const messageId = String(req.params.id || "").trim();
    if (!ObjectId.isValid(messageId)) {
      return res.status(400).json({ success: false, message: "ID de message invalide" });
    }

    const deletedMessage = await WorldChatMessage.findByIdAndDelete(messageId).populate("user", "username email");
    if (!deletedMessage) {
      return res.status(404).json({ success: false, message: "Message du monde introuvable" });
    }

    await logAdminAction(req.admin.id, "world_chat.delete", `Message monde supprime pour ${deletedMessage.user?.username || "Joueur"}`, {
      targetType: "world_chat_message",
      targetId: String(deletedMessage._id),
      metadata: {
        userId: String(deletedMessage.user?._id || ""),
        username: deletedMessage.user?.username || "",
        message: deletedMessage.message
      }
    });

    return res.json({
      success: true,
      deletedMessage: {
        id: deletedMessage._id,
        username: deletedMessage.user?.username || "Joueur",
        message: deletedMessage.message,
        createdAt: deletedMessage.createdAt
      }
    });
  } catch (error) {
    console.error("Admin world chat delete error:", error);
    return res.status(500).json({ success: false, message: "Suppression du message impossible" });
  }
});

router.get("/logs", async (req, res) => {
  try {
    const logs = await AdminActionLog.find()
      .sort({ createdAt: -1 })
      .limit(Math.min(100, Math.max(1, Number(req.query.limit) || 40)))
      .populate("admin", "displayName email");

    return res.json({
      success: true,
      logs: logs.map((log) => ({
        id: log._id,
        action: log.action,
        summary: log.summary,
        targetType: log.targetType,
        targetId: log.targetId,
        metadata: log.metadata,
        createdAt: log.createdAt,
        admin: log.admin?.displayName || log.admin?.email || "Admin"
      }))
    });
  } catch (error) {
    console.error("Admin logs error:", error);
    return res.status(500).json({ success: false, message: "Logs indisponibles" });
  }
});

router.get("/exports/users", async (req, res) => {
  try {
    const format = String(req.query.format || "json").trim().toLowerCase();
    const users = await User.find().sort({ createdAt: -1 });
    const rows = users.map((user) => ({
      id: String(user._id),
      username: user.username,
      email: user.email,
      balance: toMoney(user.balance),
      isBanned: Boolean(user.isBanned),
      createdAt: user.createdAt,
      lastSeenAt: user.lastSeenAt,
      totalDebited: toMoney(user.gameStats?.totalDebited || 0),
      totalCredited: toMoney(user.gameStats?.totalCredited || 0)
    }));

    if (format === "csv") {
      const headers = Object.keys(rows[0] || {
        id: "",
        username: "",
        email: "",
        balance: "",
        isBanned: "",
        createdAt: "",
        lastSeenAt: "",
        totalDebited: "",
        totalCredited: ""
      });
      const csv = [
        headers.join(","),
        ...rows.map((row) => headers.map((header) => escapeCsv(row[header])).join(","))
      ].join("\n");

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=escape-the-ghost-users.csv");
      return res.send(csv);
    }

    return res.json({ success: true, items: rows });
  } catch (error) {
    console.error("Admin export users error:", error);
    return res.status(500).json({ success: false, message: "Export utilisateurs impossible" });
  }
});

router.get("/exports/transactions", async (req, res) => {
  try {
    const format = String(req.query.format || "json").trim().toLowerCase();
    const transactions = await Transaction.find({ ...pickDateRange(req.query) })
      .sort({ createdAt: -1 })
      .limit(2000)
      .populate("user", "username email");

    const rows = transactions.map((transaction) => ({
      id: String(transaction._id),
      type: transaction.type,
      status: transaction.status,
      username: transaction.user?.username || "",
      email: transaction.user?.email || "",
      amount_fiat: toMoney(transaction.amount_fiat),
      crypto: transaction.crypto || "",
      createdAt: transaction.createdAt
    }));

    if (format === "csv") {
      const headers = Object.keys(rows[0] || {
        id: "",
        type: "",
        status: "",
        username: "",
        email: "",
        amount_fiat: "",
        crypto: "",
        createdAt: ""
      });
      const csv = [
        headers.join(","),
        ...rows.map((row) => headers.map((header) => escapeCsv(row[header])).join(","))
      ].join("\n");

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=escape-the-ghost-transactions.csv");
      return res.send(csv);
    }

    return res.json({ success: true, items: rows });
  } catch (error) {
    console.error("Admin export transactions error:", error);
    return res.status(500).json({ success: false, message: "Export transactions impossible" });
  }
});

router.get("/defaults", (req, res) => {
  return res.json({ success: true, defaults: DEFAULT_GAME_SETTINGS });
});

module.exports = router;
