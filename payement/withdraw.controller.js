const OxaPayService = require("./oxapay.service");
const Transaction = require("../models/Transaction");
const User = require("../models/User");
const bcrypt = require("bcrypt");
const { getGameSettings } = require("../utils/gameSettings");

const MIN_WITHDRAWAL = 0.5;

function toMoney(value) {
    return Number((Number(value || 0)).toFixed(2));
}

const addressValidators = {
    TRX: (addr) => addr.startsWith("T") && addr.length === 34,
    USDT: (addr) => addr.startsWith("T") && addr.length === 34,
    BTC: (addr) => (addr.startsWith("1") || addr.startsWith("3") || addr.startsWith("bc1")) && addr.length >= 26 && addr.length <= 62,
    ETH: (addr) => addr.startsWith("0x") && addr.length === 42,
    BNB: (addr) => addr.startsWith("0x") && addr.length === 42
};

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

function normalizeWithdrawalStatus(status) {
    const value = String(status || "").trim().toLowerCase();

    if (value === "completed" || value === "success" || value === "paid") {
        return "completed";
    }

    if (value === "rejected" || value === "failed" || value === "cancelled" || value === "canceled") {
        return "rejected";
    }

    return "pending";
}

function parseAmount(value) {
    if (typeof value === "number") {
        return value;
    }

    return Number(String(value || "").replace(",", ".").trim());
}

exports.createWithdrawal = async (req, res) => {
    try {
        const settings = await getGameSettings();
        const amount = parseAmount(req.body.amount);
        const address = String(req.body.address || "").trim();
        const crypto = String(req.body.crypto || "").trim().toUpperCase();
        const password = String(req.body.password || "");
        const userId = req.user.id;

        if (!settings.features?.withdrawalsEnabled) {
            return res.status(403).json({ success: false, message: "Les retraits sont temporairement suspendus" });
        }

        if (!Number.isFinite(amount) || amount <= 0) {
            return res.status(400).json({ success: false, message: "Montant invalide" });
        }

        const validCryptos = ["USDT", "TRX", "BTC", "ETH"];
        if (!crypto || !validCryptos.includes(crypto)) {
            return res.status(400).json({ success: false, message: "Retrait disponible uniquement en USDT, TRX, BTC et ETH pour le moment." });
        }

        if (!address) {
            return res.status(400).json({ success: false, message: "Adresse wallet requise" });
        }

        if (!addressValidators[crypto] || !addressValidators[crypto](address)) {
            return res.status(400).json({ success: false, message: `Format d'adresse ${crypto} invalide` });
        }

        if (!password || String(password).length < 6) {
            return res.status(400).json({ success: false, message: "Mot de passe de validation requis" });
        }

        if (amount < MIN_WITHDRAWAL) {
            return res.status(400).json({
                success: false,
                message: `Montant minimum: $${MIN_WITHDRAWAL} USD`
            });
        }

        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({ success: false, message: "Utilisateur non trouve" });
        }

        const passwordOk = await bcrypt.compare(String(password), user.password);
        if (!passwordOk) {
            return res.status(401).json({ success: false, message: "Mot de passe de validation incorrect" });
        }

        const lockedAffiliateBalance = toMoney(user.affiliateLockedBalance);
        const withdrawableBalance = toMoney((user.balance || 0) - lockedAffiliateBalance);

        if (withdrawableBalance < amount) {
            return res.status(400).json({
                success: false,
                message: `Retrait impossible. Solde retirable actuel: $${withdrawableBalance.toFixed(2)}. Les gains d'affiliation restants doivent d'abord etre mises et joues.`
            });
        }

        user.balance = toMoney((user.balance || 0) - amount);
        await user.save();

        const transaction = new Transaction({
            user: userId,
            type: "withdraw",
            crypto,
            amount_fiat: amount,
            address,
            status: "pending",
            provider: "manual_review"
        });

        await transaction.save();

        return res.json({
            success: true,
            message: "Retrait en attente de validation par un administrateur",
            data: {
                transaction_id: transaction._id,
                amount,
                crypto,
                address,
                status: transaction.status
            }
        });
    } catch (error) {
        console.error("Create withdrawal error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.checkWithdrawalStatus = async (req, res) => {
    try {
        const { transaction_id } = req.params;

        if (!transaction_id) {
            return res.status(400).json({ success: false, message: "Transaction ID requis" });
        }

        const transaction = await Transaction.findOne({
            _id: transaction_id,
            user: req.user.id
        });

        if (!transaction) {
            return res.status(404).json({ success: false, message: "Transaction non trouvee" });
        }

        if (transaction.status === "completed" || transaction.status === "rejected") {
            return res.json({
                success: true,
                data: {
                    status: transaction.status,
                    amount_fiat: transaction.amount_fiat,
                    crypto: transaction.crypto,
                    updatedAt: transaction.updatedAt
                }
            });
        }

        const payoutLookupId = transaction.invoice_id || transaction.order_id;

        if (payoutLookupId) {
            try {
                const payoutStatus = await OxaPayService.checkPayoutStatus(payoutLookupId);

                let newStatus = normalizeWithdrawalStatus(payoutStatus?.status);
                if (!payoutStatus?.status) {
                    newStatus = transaction.status;
                }

                if (newStatus === "rejected" && transaction.status === "pending") {
                    const user = await User.findById(transaction.user);
                    if (user) {
                        user.balance = toMoney((user.balance || 0) + transaction.amount_fiat);
                        await user.save();
                    }
                }

                if (newStatus !== transaction.status) {
                    transaction.status = newStatus;
                    transaction.updatedAt = new Date();
                    await transaction.save();
                }

                return res.json({
                    success: true,
                    data: {
                        status: newStatus,
                        amount_fiat: transaction.amount_fiat,
                        crypto: transaction.crypto,
                        updatedAt: transaction.updatedAt
                    }
                });
            } catch (oxaError) {
                return res.json({
                    success: true,
                    data: {
                        status: transaction.status,
                        amount_fiat: transaction.amount_fiat,
                        crypto: transaction.crypto,
                        updatedAt: transaction.updatedAt
                    }
                });
            }
        }

        return res.json({
            success: true,
            data: {
                status: transaction.status,
                amount_fiat: transaction.amount_fiat,
                crypto: transaction.crypto,
                updatedAt: transaction.updatedAt
            }
        });
    } catch (error) {
        console.error("Check withdrawal status error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};
