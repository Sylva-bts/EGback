const Transaction = require("../models/Transaction");
const User = require("../models/User");
const depositController = require("./deposit.controller");

function normalizeWebhookStatus(status) {
    return String(status || "").trim().toLowerCase();
}

exports.oxapayWebhook = async (req, res) => {
    try {
        const secret = req.headers["x-webhook-secret"];

        if (secret !== process.env.OXAPAY_WEBHOOK_SECRET) {
            console.log("Webhook unauthorized - invalid secret");
            return res.status(403).json({ message: "Webhook non autorise" });
        }

        const { status, order_id, amount, invoice_id } = req.body;
        const normalizedStatus = normalizeWebhookStatus(status);

        console.log("Webhook received:", { status, order_id, invoice_id, amount });

        const transaction = await Transaction.findOne({
            $or: [
                { order_id: order_id },
                { invoice_id: order_id },
                { invoice_id: invoice_id }
            ]
        });

        if (!transaction) {
            console.log("Transaction not found for:", order_id || invoice_id);
            return res.status(200).send("OK");
        }

        if (normalizedStatus === "paid" || normalizedStatus === "completed") {
            const user = await User.findById(transaction.user);

            if (user && transaction.status !== "paid" && transaction.status !== "completed") {
                if (transaction.type === "deposit") {
                    await depositController.applyConfirmedDeposit(transaction._id, amount || transaction.amount_crypto);
                } else {
                    transaction.status = "paid";
                    transaction.amount_crypto = amount || transaction.amount_crypto;
                    transaction.updatedAt = new Date();
                    await transaction.save();

                    if (transaction.type === "power_purchase" && transaction.powerKey) {
                    user.powers[transaction.powerKey] = (user.powers?.[transaction.powerKey] || 0) + (transaction.powerUnits || 0);
                    } else {
                        user.balance += transaction.amount_fiat;
                    }

                    await user.save();
                }
                console.log(`Payment confirmed for user ${user.email} (${transaction.type})`);
            }
        } else if (normalizedStatus === "expired") {
            transaction.status = "expired";
            transaction.updatedAt = new Date();
            await transaction.save();
            console.log("Invoice expired:", order_id || invoice_id);
        } else if (normalizedStatus === "failed") {
            transaction.status = "failed";
            transaction.updatedAt = new Date();
            await transaction.save();
            console.log("Invoice failed:", order_id || invoice_id);
        }

        return res.status(200).send("OK");
    } catch (error) {
        console.error("Webhook error:", error);
        return res.status(500).send("Erreur webhook");
    }
};
