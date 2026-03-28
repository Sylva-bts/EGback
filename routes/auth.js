const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();
const AFFILIATE_RATE = 0.15;

function toMoney(value) {
  return Number((Number(value || 0)).toFixed(2));
}

function buildReferralLink(user) {
  const baseUrl = process.env.PUBLIC_APP_URL || process.env.PUBLIC_BASE_URL || "";
  const fallbackPath = "/index.html";
  const code = encodeURIComponent(user?.referralCode || "");

  if (!code) {
    return "";
  }

  if (!baseUrl) {
    return `${fallbackPath}?ref=${code}`;
  }

  return `${String(baseUrl).replace(/\/$/, "")}${fallbackPath}?ref=${code}`;
}

async function sanitizeUser(user) {
  const referredUsersCount = await User.countDocuments({ referredBy: user._id });
  const affiliateTotalEarned = toMoney(user.affiliateTotalEarned);
  const affiliateLockedBalance = toMoney(user.affiliateLockedBalance);
  const affiliateUnlockedTotal = toMoney(user.affiliateUnlockedTotal);

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
    },
    affiliation: {
      rate: AFFILIATE_RATE,
      referralCode: user.referralCode || "",
      referralLink: buildReferralLink(user),
      referredBy: user.referredBy || null,
      referredUsersCount,
      totalEarned: affiliateTotalEarned,
      lockedBalance: affiliateLockedBalance,
      unlockedTotal: affiliateUnlockedTotal,
      withdrawableBalance: toMoney(Math.max(0, (user.balance || 0) - affiliateLockedBalance)),
      wageringProgress: toMoney(Math.min(affiliateUnlockedTotal, affiliateTotalEarned)),
      wageringRemaining: affiliateLockedBalance
    },
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

async function generateReferralCode(username) {
  const base = String(username || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6) || "GHOSTR";

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
    const candidate = `${base}${suffix}`.slice(0, 12);
    const exists = await User.exists({ referralCode: candidate });

    if (!exists) {
      return candidate;
    }
  }

  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase().slice(0, 12);
}

async function ensureReferralCode(user) {
  if (user?.referralCode) {
    return user.referralCode;
  }

  user.referralCode = await generateReferralCode(user?.username);
  await user.save();
  return user.referralCode;
}

router.post("/register", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const referralCode = String(req.body.referralCode || "").trim().toUpperCase();

    if (username.length < 3) {
      return res.status(400).json({ message: "Nom d'utilisateur invalide" });
    }
    if (!email.includes("@")) {
      return res.status(400).json({ message: "Email invalide" });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: "Mot de passe trop court" });
    }

    const userExists = await User.findOne({
      $or: [
        { email },
        { username }
      ]
    });

    if (userExists) {
      return res.status(400).json({ message: "Utilisateur deja existant" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    let referredBy = null;

    if (referralCode) {
      const referringUser = await User.findOne({ referralCode });

      if (!referringUser) {
        return res.status(400).json({ message: "Code d'affiliation invalide" });
      }

      referredBy = referringUser._id;
    }

    const user = new User({
      username,
      email,
      password: hashedPassword,
      referralCode: await generateReferralCode(username),
      referredBy
    });

    await user.save();

    return res.status(201).json({
      message: "Inscription reussie",
      user: await sanitizeUser(user)
    });
  } catch (error) {
    console.error("Register error:", error);
    return res.status(500).json({ message: "Erreur serveur lors de l'inscription" });
  }
});

router.post("/login", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: "Utilisateur introuvable" });
    }

    if (user.isBanned) {
      return res.status(403).json({ message: "Compte suspendu par un administrateur" });
    }

    await ensureReferralCode(user);

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Mot de passe incorrect" });
    }

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET);
    user.lastSeenAt = new Date();
    await user.save();

    return res.json({
      message: "Connexion reussie",
      token,
      user: await sanitizeUser(user)
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ message: "Erreur serveur lors de la connexion" });
  }
});

router.get("/profile", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: "Utilisateur introuvable" });
    }

    await ensureReferralCode(user);

    return res.json({
      message: "Profil charge",
      user: await sanitizeUser(user)
    });
  } catch (error) {
    console.error("Get profile error:", error);
    return res.status(500).json({ message: "Erreur serveur lors du chargement du profil" });
  }
});

router.patch("/profile", authMiddleware, async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const currentPassword = String(req.body.currentPassword || "");
    const newPassword = String(req.body.newPassword || "");

    if (username.length < 3) {
      return res.status(400).json({ message: "Nom d'utilisateur invalide" });
    }

    if (!email.includes("@")) {
      return res.status(400).json({ message: "Email invalide" });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: "Utilisateur introuvable" });
    }

    await ensureReferralCode(user);

    const duplicateUser = await User.findOne({
      _id: { $ne: user._id },
      $or: [
        { username },
        { email }
      ]
    });

    if (duplicateUser) {
      return res.status(400).json({ message: "Ce nom d'utilisateur ou cet email est deja utilise" });
    }

    if (newPassword) {
      if (newPassword.length < 6) {
        return res.status(400).json({ message: "Le nouveau mot de passe doit contenir au moins 6 caracteres" });
      }

      if (!currentPassword) {
        return res.status(400).json({ message: "Le mot de passe actuel est requis pour le modifier" });
      }

      const isMatch = await bcrypt.compare(currentPassword, user.password);
      if (!isMatch) {
        return res.status(400).json({ message: "Mot de passe actuel incorrect" });
      }

      user.password = await bcrypt.hash(newPassword, 10);
    }

    user.username = username;
    user.email = email;
    await user.save();

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET);

    return res.json({
      message: "Profil mis a jour",
      token,
      user: await sanitizeUser(user)
    });
  } catch (error) {
    console.error("Update profile error:", error);
    return res.status(500).json({ message: "Erreur serveur lors de la mise a jour du profil" });
  }
});

module.exports = router;
