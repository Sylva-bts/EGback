const Transaction = require("../models/Transaction");
const User = require("../models/User");

exports.oxapayWebhook = async (req, res) => {
    try {
        const secret = req.headers["x-webhook-secret"];

        if (secret !== process.env.OXAPAY_WEBHOOK_SECRET) {
            console.log("Webhook unauthorized - invalid secret");
            return res.status(403).json({ message: "Webhook non autorisé" });
        }

        const { status, order_id, amount, invoice_id } = req.body;

        console.log("Webhook received:", { status, order_id, invoice_id, amount });

        // Find transaction by order_id or invoice_id
        const transaction = await Transaction.findOne({
            $or: [{ invoice_id: order_id }, { invoice_id: invoice_id }]
        });

        if (!transaction) {
            console.log("Transaction not found for:", order_id || invoice_id);
            return res.status(200).send("OK");
        }

        if (status === "Paid" || status === "Completed") {
            // Credit user balance
            const user = await User.findById(transaction.user);
            
            if (user && transaction.status !== 'paid' && transaction.status !== 'completed') {
                // Update transaction status
                transaction.status = 'paid';
                transaction.amount_crypto = amount || transaction.amount_crypto;
                transaction.updatedAt = new Date();
                await transaction.save();

                // Credit balance
                user.balance += transaction.amount_fiat;
                await user.save();

                console.log(`✅ Balance credited: $${transaction.amount_fiat} for user ${user.email}`);
            }
        } else if (status === "Expired") {
            transaction.status = 'expired';
            transaction.updatedAt = new Date();
            await transaction.save();
            console.log("Invoice expired:", order_id || invoice_id);
        } else if (status === "Failed") {
            transaction.status = 'failed';
            transaction.updatedAt = new Date();
            await transaction.save();
            console.log("Invoice failed:", order_id || invoice_id);
        }

        res.status(200).send("OK");

    } catch (error) {
        console.error("Webhook error:", error);
        res.status(500).send("Erreur webhook");
    }
};
