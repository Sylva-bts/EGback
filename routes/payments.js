const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const depositController = require("../payement/deposit.controller");
const withdrawController = require("../payement/withdraw.controller");
const webhookController = require("../payement/webhook.controller");

// ==================== WEBHOOK (NO AUTH) ====================
// POST /api/payments/webhook - OxaPay webhook callback
router.post("/webhook", webhookController.oxapayWebhook);

// Apply auth middleware to all routes below
router.use(authMiddleware);

// ==================== DEPOSIT ROUTES ====================

// POST /api/payments/deposit - Create a new deposit invoice
router.post("/deposit", depositController.createDeposit);

// GET /api/payments/status/:invoice_id - Check deposit status
router.get("/status/:invoice_id", depositController.checkDepositStatus);

// ==================== WITHDRAWAL ROUTES ====================

// POST /api/payments/withdraw - Create a new withdrawal
router.post("/withdraw", withdrawController.createWithdrawal);

// GET /api/payments/withdraw/:transaction_id - Check withdrawal status
router.get("/withdraw/:transaction_id", withdrawController.checkWithdrawalStatus);

// ==================== USER BALANCE ====================

// GET /api/payments/balance - Get user balance
router.get("/balance", async (req, res) => {
    try {
        const User = require("../models/User");
        const user = await User.findById(req.user.id).select("-password");
        
        if (!user) {
            return res.status(404).json({ success: false, message: "Utilisateur non trouvé" });
        }

        res.json({
            success: true,
            data: {
                balance: user.balance,
                currency: "USD"
            }
        });
    } catch (error) {
        console.error("Get balance error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==================== TRANSACTION HISTORY ====================

// GET /api/payments/transactions - Get user transaction history
router.get("/transactions", async (req, res) => {
    try {
        const Transaction = require("../models/Transaction");
        const { type, limit = 20, page = 1 } = req.query;
        
        const query = { user: req.user.id };
        if (type) {
            query.type = type;
        }

        const transactions = await Transaction.find(query)
            .sort({ createdAt: -1 })
            .limit(parseInt(limit))
            .skip((parseInt(page) - 1) * parseInt(limit));

        const total = await Transaction.countDocuments(query);

        res.json({
            success: true,
            data: {
                transactions,
                pagination: {
                    total,
                    page: parseInt(page),
                    pages: Math.ceil(total / parseInt(limit))
                }
            }
        });
    } catch (error) {
        console.error("Get transactions error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
