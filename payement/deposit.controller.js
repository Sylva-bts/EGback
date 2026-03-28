const OxaPayService = require("./oxapay.service");
const Transaction = require("../models/Transaction");
const User = require("../models/User");
const { v4: uuidv4 } = require("uuid");
const { getGameSettings } = require("../utils/gameSettings");

// Minimum deposit amounts in USD (unified at $0.5 USD)
const MIN_DEPOSIT = 0.5;
const FIRST_DEPOSIT_BONUS_RATE = 0.3;

function toMoney(value) {
    return Number((Number(value || 0)).toFixed(2));
}

function mapInvoiceStatus(status, fallbackStatus = "pending") {
    const normalized = String(status || "").trim().toLowerCase();

    if (normalized === "paid" || normalized === "completed") {
        return "paid";
    }

    if (normalized === "expired") {
        return "expired";
    }

    if (normalized === "failed") {
        return "failed";
    }

    return fallbackStatus;
}

async function applyConfirmedDeposit(transactionId, confirmedCryptoAmount) {
    const transaction = await Transaction.findOneAndUpdate(
        {
            _id: transactionId,
            type: "deposit",
            status: { $nin: ["paid", "completed"] }
        },
        {
            $set: {
                status: "paid",
                updatedAt: new Date(),
                ...(confirmedCryptoAmount ? { amount_crypto: confirmedCryptoAmount } : {})
            }
        },
        { new: true }
    );

    if (!transaction) {
        const existingTransaction = await Transaction.findById(transactionId);
        return {
            transaction: existingTransaction,
            user: existingTransaction ? await User.findById(existingTransaction.user) : null,
            bonusAmount: toMoney(existingTransaction?.bonusAmount || 0),
            creditedTotal: existingTransaction
                ? toMoney((existingTransaction.amount_fiat || 0) + (existingTransaction.bonusAmount || 0))
                : 0,
            alreadyApplied: true
        };
    }

    const user = await User.findById(transaction.user);
    if (!user) {
        throw new Error("Utilisateur non trouve pour ce depot");
    }

    let bonusAmount = 0;

    if (!user.firstDepositBonusApplied) {
        bonusAmount = toMoney(transaction.amount_fiat * FIRST_DEPOSIT_BONUS_RATE);
        user.firstDepositBonusApplied = true;
        user.firstDepositBonusAt = new Date();
        transaction.bonusAmount = bonusAmount;
        transaction.bonusApplied = bonusAmount > 0;
    }

    user.balance = toMoney((user.balance || 0) + (transaction.amount_fiat || 0) + bonusAmount);

    await user.save();
    await transaction.save();

    return {
        transaction,
        user,
        bonusAmount,
        creditedTotal: toMoney((transaction.amount_fiat || 0) + bonusAmount),
        alreadyApplied: false
    };
}

exports.createDeposit = async (req, res) => {
    try {
        const { amount, crypto } = req.body;
        const userId = req.user.id;
        const settings = await getGameSettings();

        if (!settings.features?.depositsEnabled) {
            return res.status(403).json({ success: false, message: "Les depots sont temporairement suspendus" });
        }

        // Validate amount
        if (!amount || amount <= 0) {
            return res.status(400).json({ success: false, message: "Montant invalide" });
        }

        // Validate crypto
        const validCryptos = ['TRX', 'USDT', 'BTC', 'ETH', 'BNB'];
        if (!crypto || !validCryptos.includes(crypto.toUpperCase())) {
            return res.status(400).json({ success: false, message: "Cryptomonnaie invalide" });
        }

        const cryptoUpper = crypto.toUpperCase();

        // Check minimum amount
        if (amount < MIN_DEPOSIT) {
            return res.status(400).json({ 
                success: false, 
                message: `Montant minimum: $${MIN_DEPOSIT} USD` 
            });
        }

        const orderId = uuidv4();

        // Create invoice with OxaPay
        const invoice = await OxaPayService.createInvoice(
            amount,
            cryptoUpper,
            orderId
        );

        // Save pending transaction to database
        const transaction = new Transaction({
            user: userId,
            type: 'deposit',
            crypto: cryptoUpper,
            amount_fiat: amount,
            amount_crypto: invoice.pay_amount || invoice.amount,
            address: invoice.address,
            invoice_id: invoice.invoice_id,
            order_id: orderId,
            provider: 'oxapay',
            status: 'pending'
        });

        await transaction.save();

        // Return all needed info to frontend
        res.json({
            success: true,
            message: "Facture créée avec succès",
            data: {
                invoice_id: invoice.invoice_id,
                payment_address: invoice.address,
                amount_crypto: invoice.pay_amount || invoice.amount,
                currency: cryptoUpper,
                payment_url: invoice.payment_url,
                expire_time: invoice.expire_time,
                status: 'pending'
            }
        });

    } catch (error) {
        console.error("Create deposit error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Check deposit status
exports.checkDepositStatus = async (req, res) => {
    try {
        const { invoice_id } = req.params;
        
        if (!invoice_id) {
            return res.status(400).json({ success: false, message: "Invoice ID requis" });
        }

        // Find transaction in database
        const transaction = await Transaction.findOne({ 
            invoice_id: invoice_id,
            user: req.user.id 
        });

        if (!transaction) {
            return res.status(404).json({ success: false, message: "Transaction non trouvée" });
        }

        // If already confirmed, return current status
        if (transaction.status === 'paid' || transaction.status === 'completed') {
            return res.json({
                success: true,
                data: {
                    status: transaction.status,
                    amount_fiat: transaction.amount_fiat,
                    amount_crypto: transaction.amount_crypto,
                    updatedAt: transaction.updatedAt
                }
            });
        }

        // Check with OxaPay
        try {
            const invoiceStatus = await OxaPayService.checkInvoiceStatus(invoice_id);
            
            // Map OxaPay status to our status
            let newStatus = mapInvoiceStatus(invoiceStatus.status, transaction.status);

            // Update if changed
            let depositSettlement = null;
            if (newStatus === "paid" && transaction.status !== "paid" && transaction.status !== "completed") {
                depositSettlement = await applyConfirmedDeposit(transaction._id, invoiceStatus.amount || transaction.amount_crypto);
            } else if (newStatus !== transaction.status) {
                transaction.status = newStatus;
                transaction.updatedAt = new Date();
                await transaction.save();
            }

            res.json({
                success: true,
                data: {
                    status: depositSettlement?.transaction?.status || newStatus,
                    amount_fiat: transaction.amount_fiat,
                    amount_crypto: depositSettlement?.transaction?.amount_crypto || transaction.amount_crypto,
                    bonus_amount: depositSettlement?.bonusAmount || toMoney(transaction.bonusAmount || 0),
                    credited_total: depositSettlement?.creditedTotal || toMoney((transaction.amount_fiat || 0) + (transaction.bonusAmount || 0)),
                    updatedAt: depositSettlement?.transaction?.updatedAt || transaction.updatedAt
                }
            });

        } catch (oxaError) {
            // If OxaPay check fails, return current DB status
            res.json({
                success: true,
                data: {
                    status: transaction.status,
                    amount_fiat: transaction.amount_fiat,
                    amount_crypto: transaction.amount_crypto,
                    updatedAt: transaction.updatedAt
                }
            });
        }

    } catch (error) {
        console.error("Check deposit status error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.applyConfirmedDeposit = applyConfirmedDeposit;
