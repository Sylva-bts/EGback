const OxaPayService = require("./oxapay.service");
const Transaction = require("../models/Transaction");
const User = require("../models/User");

// Minimum withdrawal amounts in USD (unified at $0.5 USD)
const MIN_WITHDRAWAL = 0.5;

// Validate crypto address formats
const addressValidators = {
    'TRX': (addr) => addr.startsWith('T') && addr.length === 34,
    'USDT': (addr) => addr.startsWith('T') && addr.length === 34, // TRC20
    'BTC': (addr) => (addr.startsWith('1') || addr.startsWith('3') || addr.startsWith('bc1')) && addr.length >= 26 && addr.length <= 62,
    'ETH': (addr) => addr.startsWith('0x') && addr.length === 42,
    'BNB': (addr) => addr.startsWith('0x') && addr.length === 42
};

exports.createWithdrawal = async (req, res) => {
    try {
        const { amount, address, crypto } = req.body;
        const userId = req.user.id;

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

        // Validate address
        if (!address) {
            return res.status(400).json({ success: false, message: "Adresse wallet requise" });
        }

        if (!addressValidators[cryptoUpper] || !addressValidators[cryptoUpper](address)) {
            return res.status(400).json({ success: false, message: `Format d'adresse ${cryptoUpper} invalide` });
        }

        // Check minimum amount
        if (amount < MIN_WITHDRAWAL) {
            return res.status(400).json({ 
                success: false, 
                message: `Montant minimum: $${MIN_WITHDRAWAL} USD` 
            });
        }

        // Get user and check balance
        const user = await User.findById(userId);
        
        if (!user) {
            return res.status(404).json({ success: false, message: "Utilisateur non trouvé" });
        }

        if (user.balance < amount) {
            return res.status(400).json({ 
                success: false, 
                message: `Solde insuffisant. Solde actuel: $${user.balance.toFixed(2)}` 
            });
        }

        // Deduct from balance first (prevent double spending)
        user.balance -= amount;
        await user.save();

        try {
            // Send payout via OxaPay
            const payout = await OxaPayService.sendPayout(
                amount,
                cryptoUpper,
                address
            );

            // Save transaction to database
            const transaction = new Transaction({
                user: userId,
                type: 'withdraw',
                crypto: cryptoUpper,
                amount_fiat: amount,
                address: address,
                invoice_id: payout.trans_id || payout.order_id,
                status: 'pending',
                transaction_hash: payout.txid
            });

            await transaction.save();

            res.json({
                success: true,
                message: "Retrait en cours de traitement",
                data: {
                    transaction_id: transaction._id,
                    payout_id: payout.trans_id,
                    amount: amount,
                    crypto: cryptoUpper,
                    address: address,
                    status: 'pending'
                }
            });

        } catch (oxaError) {
            // Refund balance if OxaPay fails
            user.balance += amount;
            await user.save();

            throw oxaError;
        }

    } catch (error) {
        console.error("Create withdrawal error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Check withdrawal status
exports.checkWithdrawalStatus = async (req, res) => {
    try {
        const { transaction_id } = req.params;
        
        if (!transaction_id) {
            return res.status(400).json({ success: false, message: "Transaction ID requis" });
        }

        // Find transaction in database
        const transaction = await Transaction.findOne({ 
            _id: transaction_id,
            user: req.user.id 
        });

        if (!transaction) {
            return res.status(404).json({ success: false, message: "Transaction non trouvée" });
        }

        // If already completed/rejected, return current status
        if (transaction.status === 'completed' || transaction.status === 'rejected') {
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

        // Check with OxaPay if we have a payout ID
        if (transaction.invoice_id) {
            try {
                const payoutStatus = await OxaPayService.checkPayoutStatus(transaction.invoice_id);
                
                // Map OxaPay status to our status
                let newStatus = transaction.status;
                if (payoutStatus.status === 'Completed' || payoutStatus.status === 'Success') {
                    newStatus = 'completed';
                } else if (payoutStatus.status === 'Rejected' || payoutStatus.status === 'Failed') {
                    newStatus = 'rejected';
                    
                    // Refund balance if rejected
                    if (transaction.status === 'pending') {
                        const user = await User.findById(transaction.user);
                        if (user) {
                            user.balance += transaction.amount_fiat;
                            await user.save();
                        }
                    }
                }

                // Update if changed
                if (newStatus !== transaction.status) {
                    transaction.status = newStatus;
                    transaction.updatedAt = new Date();
                    await transaction.save();
                }

                res.json({
                    success: true,
                    data: {
                        status: newStatus,
                        amount_fiat: transaction.amount_fiat,
                        crypto: transaction.crypto,
                        updatedAt: transaction.updatedAt
                    }
                });

            } catch (oxaError) {
                // If OxaPay check fails, return current DB status
                res.json({
                    success: true,
                    data: {
                        status: transaction.status,
                        amount_fiat: transaction.amount_fiat,
                        crypto: transaction.crypto,
                        updatedAt: transaction.updatedAt
                    }
                });
            }
        } else {
            res.json({
                success: true,
                data: {
                    status: transaction.status,
                    amount_fiat: transaction.amount_fiat,
                    crypto: transaction.crypto,
                    updatedAt: transaction.updatedAt
                }
            });
        }

    } catch (error) {
        console.error("Check withdrawal status error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};
