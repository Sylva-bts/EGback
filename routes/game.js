const express = require("express");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const authMiddleware = require("../middleware/authMiddleware");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const WorldChatMessage = require("../models/WorldChatMessage");
const OxaPayService = require("../payement/oxapay.service");
const { getGameSettings } = require("../utils/gameSettings");

const router = express.Router();
const AFFILIATE_RATE = 0.15;

function toMoney(value) {
  return Number((Number(value || 0)).toFixed(2));
}

async function getPowerCatalog() {
  const settings = await getGameSettings();

  return {
    freeze: {
      name: settings.powers?.freeze?.label || "Gel",
      priceUsd: Number(settings.powers?.freeze?.priceUsd || 20),
      units: Number(settings.powers?.freeze?.units || 2),
      enabled: Boolean(settings.powers?.freeze?.enabled)
    },
    shield: {
      name: settings.powers?.shield?.label || "Bouclier",
      priceUsd: Number(settings.powers?.shield?.priceUsd || 3),
      units: Number(settings.powers?.shield?.units || 2),
      enabled: Boolean(settings.powers?.shield?.enabled)
    },
    second_chance: {
      name: settings.powers?.second_chance?.label || "Seconde chance",
      priceUsd: Number(settings.powers?.second_chance?.priceUsd || 60),
      units: Number(settings.powers?.second_chance?.units || 2),
      enabled: Boolean(settings.powers?.second_chance?.enabled)
    },
    vision: {
      name: settings.powers?.vision?.label || "Vision",
      priceUsd: Number(settings.powers?.vision?.priceUsd || 10),
      units: Number(settings.powers?.vision?.units || 2),
      enabled: Boolean(settings.powers?.vision?.enabled)
    }
  };
}

function sanitizeUser(user) {
  return {
    id: user._id,
    username: user.username,
    email: user.email,
    balance: toMoney(user.balance),
    powers: {
      freeze: user.powers?.freeze || 0,
      shield: user.powers?.shield || 0,
      second_chance: user.powers?.second_chance || 0,
      vision: user.powers?.vision || 0
    }
  };
}

function getEffectiveForcedCrashValue(settings, user) {
  const userForced = Number(user?.adminGameControl?.forcedCrashValue);
  if (Number.isFinite(userForced) && userForced >= 1) {
    return userForced;
  }

  const globalForced = Number(settings?.ghost?.forcedCrashValue);
  if (Number.isFinite(globalForced) && globalForced >= 1) {
    return globalForced;
  }

  return null;
}

function mapWorldActivity(transaction) {
  return {
    id: transaction._id,
    type: transaction.type === "game_cashout" ? "gain" : "bet",
    username: transaction.user?.username || "Joueur",
    betAmount: toMoney(transaction.betAmount || transaction.amount_fiat),
    gain: transaction.type === "game_cashout" ? toMoney(transaction.amount_fiat) : 0,
    multiplier: transaction.type === "game_cashout" ? toMoney(transaction.multiplier) : 0,
    createdAt: transaction.createdAt
  };
}

async function settleReferralCommission(user) {
  if (!user?.referredBy) {
    user.gameStats = user.gameStats || {};
    user.gameStats.referredNetLossSettled = toMoney(Math.max(
      0,
      (user.gameStats?.totalDebited || 0) - (user.gameStats?.totalCredited || 0)
    ));
    return;
  }

  user.gameStats = user.gameStats || {};

  const totalDebited = toMoney(user.gameStats.totalDebited);
  const totalCredited = toMoney(user.gameStats.totalCredited);
  const currentNetLoss = toMoney(Math.max(0, totalDebited - totalCredited));
  const alreadySettledLoss = toMoney(user.gameStats.referredNetLossSettled);
  const deltaLoss = toMoney(currentNetLoss - alreadySettledLoss);

  if (deltaLoss > 0) {
    const referrer = await User.findById(user.referredBy);

    if (referrer) {
      const commission = toMoney(deltaLoss * AFFILIATE_RATE);

      referrer.balance = toMoney((referrer.balance || 0) + commission);
      referrer.affiliateTotalEarned = toMoney((referrer.affiliateTotalEarned || 0) + commission);
      referrer.affiliateLockedBalance = toMoney((referrer.affiliateLockedBalance || 0) + commission);
      await referrer.save();

      await Transaction.create({
        user: referrer._id,
        type: "affiliate_credit",
        amount_fiat: commission,
        status: "completed",
        provider: "affiliate",
        relatedUser: user._id
      });
    }
  }

  user.gameStats.referredNetLossSettled = currentNetLoss;
}

function unlockAffiliateFundsForWager(user, wagerAmount) {
  const lockedBalance = toMoney(user.affiliateLockedBalance);
  const unlockAmount = toMoney(Math.min(lockedBalance, wagerAmount));

  if (unlockAmount <= 0) {
    return;
  }

  user.affiliateLockedBalance = toMoney(lockedBalance - unlockAmount);
  user.affiliateUnlockedTotal = toMoney((user.affiliateUnlockedTotal || 0) + unlockAmount);
}

async function readOptionalUser(req) {
  try {
    const authHeader = String(req.headers.authorization || "");
    const [scheme, token] = authHeader.split(" ");

    if (scheme !== "Bearer" || !token || !process.env.JWT_SECRET) {
      return null;
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET, { ignoreExpiration: true });
    if (!decoded?.id) {
      return null;
    }

    return User.findById(decoded.id).select("_id adminGameControl");
  } catch (error) {
    return null;
  }
}

router.get("/world/activity", async (req, res) => {
  try {
    const transactions = await Transaction.find({
      type: { $in: ["game_bet", "game_cashout"] }
    })
      .sort({ createdAt: -1 })
      .limit(20)
      .populate("user", "username");

    return res.json({
      items: transactions.map(mapWorldActivity)
    });
  } catch (error) {
    console.error("World activity error:", error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

router.get("/world/chat", async (req, res) => {
  try {
    const settings = await getGameSettings();
    if (!settings.features?.worldChatEnabled) {
      return res.json({ items: [] });
    }

    const messages = await WorldChatMessage.find()
      .sort({ createdAt: -1 })
      .limit(40)
      .populate("user", "username");

    return res.json({
      items: messages.reverse().map((message) => ({
        id: message._id,
        username: message.user?.username || "Joueur",
        message: message.message,
        createdAt: message.createdAt
      }))
    });
  } catch (error) {
    console.error("World chat fetch error:", error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

router.get("/game/runtime", async (req, res) => {
  try {
    const settings = await getGameSettings();
    const user = await readOptionalUser(req);
    const ghostSettings = {
      ...settings.ghost,
      forcedCrashValue: user?.adminGameControl?.forcedCrashValue ?? settings.ghost?.forcedCrashValue ?? null
    };
    return res.json({
      ghost: ghostSettings,
      features: settings.features
    });
  } catch (error) {
    console.error("Game runtime error:", error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

router.use(authMiddleware);

router.get("/me", async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) {
      return res.status(404).json({ message: "Utilisateur non trouve" });
    }

    return res.json({ user: sanitizeUser(user), catalog: await getPowerCatalog() });
  } catch (error) {
    console.error("Get profile error:", error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

router.get("/get-powers", async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) {
      return res.status(404).json({ message: "Utilisateur non trouve" });
    }

    return res.json({
      powers: sanitizeUser(user).powers,
      balance: Number((user.balance || 0).toFixed(2)),
      catalog: await getPowerCatalog()
    });
  } catch (error) {
    console.error("Get powers error:", error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

router.post("/use-power", async (req, res) => {
  try {
    const settings = await getGameSettings();
    const powerCatalog = await getPowerCatalog();
    const powerKey = String(req.body.powerKey || "").trim().toLowerCase();
    if (!powerCatalog[powerKey]) {
      return res.status(400).json({ message: "Pouvoir inconnu" });
    }
    if (!powerCatalog[powerKey].enabled) {
      return res.status(403).json({ message: "Ce pouvoir est desactive" });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: "Utilisateur non trouve" });
    }

    const forcedCrashValue = getEffectiveForcedCrashValue(settings, user);
    if (forcedCrashValue !== null) {
      return res.status(403).json({
        message: "pouvoir indisponible"
      });
    }

    if ((user.powers?.[powerKey] || 0) <= 0) {
      return res.status(400).json({ message: "Aucune unite disponible pour ce pouvoir" });
    }

    user.powers[powerKey] -= 1;
    await user.save();

    return res.json({
      message: `${powerCatalog[powerKey].name} active`,
      powers: sanitizeUser(user).powers,
      balance: Number((user.balance || 0).toFixed(2))
    });
  } catch (error) {
    console.error("Use power error:", error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

router.post("/buy-power", async (req, res) => {
  try {
    const powerCatalog = await getPowerCatalog();
    const powerKey = String(req.body.powerKey || "").trim().toLowerCase();
    const paymentMethod = String(req.body.paymentMethod || "").trim().toLowerCase();

    if (!powerCatalog[powerKey]) {
      return res.status(400).json({ message: "Pouvoir inconnu" });
    }
    if (!powerCatalog[powerKey].enabled) {
      return res.status(403).json({ message: "Ce pouvoir est desactive" });
    }

    if (!["wallet", "oxapay"].includes(paymentMethod)) {
      return res.status(400).json({ message: "Methode de paiement invalide" });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: "Utilisateur non trouve" });
    }

    const purchase = powerCatalog[powerKey];

    if (paymentMethod === "wallet") {
      if ((user.balance || 0) < purchase.priceUsd) {
        return res.status(400).json({ message: "Solde insuffisant" });
      }

      user.balance = Number((user.balance - purchase.priceUsd).toFixed(2));
      user.powers[powerKey] = (user.powers?.[powerKey] || 0) + purchase.units;
      await user.save();

      await Transaction.create({
        user: user._id,
        type: "power_purchase",
        amount_fiat: purchase.priceUsd,
        status: "completed",
        provider: "wallet",
        powerKey,
        powerUnits: purchase.units
      });

      return res.json({
        status: "paid",
        provider: "wallet",
        user: sanitizeUser(user)
      });
    }

    const orderId = crypto.randomUUID();
    const invoice = await OxaPayService.createInvoice(purchase.priceUsd, "USDT", orderId);

    await Transaction.create({
      user: user._id,
      type: "power_purchase",
      crypto: "USDT",
      amount_fiat: purchase.priceUsd,
      amount_crypto: invoice.pay_amount || invoice.amount,
      address: invoice.address,
      invoice_id: invoice.invoice_id,
      order_id: orderId,
      status: "pending",
      provider: "oxapay",
      powerKey,
      powerUnits: purchase.units
    });

    return res.status(201).json({
      status: "pending",
      provider: "oxapay",
      paymentUrl: invoice.payment_url,
      payment_url: invoice.payment_url,
      url: invoice.payment_url,
      invoiceId: invoice.invoice_id,
      user: sanitizeUser(user)
    });
  } catch (error) {
    console.error("Buy power error:", error);
    return res.status(502).json({ message: error.message || "Erreur serveur" });
  }
});

router.post("/game/debit", async (req, res) => {
  try {
    const amount = Number(req.body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: "Montant invalide" });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: "Utilisateur non trouve" });
    }

    if ((user.balance || 0) < amount) {
      return res.status(400).json({ message: "Solde insuffisant" });
    }

    user.balance = toMoney((user.balance || 0) - amount);
    user.gameStats = user.gameStats || {};
    user.gameStats.totalDebited = toMoney((user.gameStats.totalDebited || 0) + amount);
    unlockAffiliateFundsForWager(user, amount);
    await settleReferralCommission(user);
    await user.save();

    await Transaction.create({
      user: user._id,
      type: "game_bet",
      amount_fiat: amount,
      betAmount: amount,
      status: "completed",
      provider: "wallet"
    });

    return res.json({
      message: "Mise debitee",
      user: sanitizeUser(user)
    });
  } catch (error) {
    console.error("Game debit error:", error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

router.post("/game/credit", async (req, res) => {
  try {
    const amount = Number(req.body.amount);
    const betAmount = Number(req.body.betAmount);
    const multiplier = Number(req.body.multiplier);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: "Montant invalide" });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: "Utilisateur non trouve" });
    }

    user.balance = toMoney((user.balance || 0) + amount);
    user.gameStats = user.gameStats || {};
    user.gameStats.totalCredited = toMoney((user.gameStats.totalCredited || 0) + amount);
    await settleReferralCommission(user);
    await user.save();

    await Transaction.create({
      user: user._id,
      type: "game_cashout",
      amount_fiat: amount,
      betAmount: Number.isFinite(betAmount) && betAmount > 0 ? betAmount : 0,
      multiplier: Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 0,
      status: "completed",
      provider: "wallet"
    });

    return res.json({
      message: "Gain credite",
      user: sanitizeUser(user)
    });
  } catch (error) {
    console.error("Game credit error:", error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

router.post("/world/chat", async (req, res) => {
  try {
    const settings = await getGameSettings();
    const message = String(req.body.message || "").trim();
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({ message: "Utilisateur non trouve" });
    }

    if (!message) {
      return res.status(400).json({ message: "Message vide" });
    }

    if (message.length > 180) {
      return res.status(400).json({ message: "Message trop long" });
    }

    const savedMessage = await WorldChatMessage.create({
      user: user._id,
      message
    });

    await savedMessage.populate("user", "username");

    return res.status(201).json({
      item: {
        id: savedMessage._id,
        username: savedMessage.user?.username || "Joueur",
        message: savedMessage.message,
        createdAt: savedMessage.createdAt
      }
    });
  } catch (error) {
    console.error("World chat post error:", error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

module.exports = router;
