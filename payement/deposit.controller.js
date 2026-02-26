const OxaPayService = require("./oxapay.service");
const Transaction = require("../models/Transaction");
const { v4: uuidv4 } = require("uuid");

// Minimum deposit amounts in USD (unified at $0.5 USD)
const MIN_DEPOSIT = 0.5;

exports.createDeposit = async (req, res) => {
    try {
        const { amount, crypto } = req.body;
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

        // Check minimum amount
        if (amount < MIN_DEPOSIT) {
            return res.status(400).json({ 
                success: false, 
                message: `Montant minimum: $${MIN_DEPOSIT} USD` 
            });
        }

        const orderId = uuidv4();

        // Create invoice with OxaPay
        console.log("Creating OxaPay invoice for deposit...");
        const invoice = await OxaPayService.createInvoice(
            amount,
            cryptoUpper,
            orderId
        );

        console.log("Invoice created, response:", invoice);

        // OxaPay peut retourner les données de différentes façons
        // Format 1: invoice.result.pay_address (nouveau format)
        // Format 2: invoice.pay_address (ancien format)
        // Format 3: invoice.address (autre format)
        
        const payAddress = invoice.result?.pay_address || invoice.pay_address || invoice.address;
        const payAmount = invoice.result?.pay_amount || invoice.pay_amount || invoice.amount;
        const invoiceId = invoice.result?.invoice_id || invoice.invoice_id || invoice.result?.trackId;
        const paymentUrl = invoice.result?.payment_url || invoice.payment_url || invoice.link;
        const expireTime = invoice.result?.expire_time || invoice.expire_time;

        // Validate required fields
        if (!payAddress) {
            console.error("Missing pay_address in OxaPay response:", invoice);
            throw new Error("Réponse invalide d'OxaPay: adresse de paiement manquante");
        }

        // Save pending transaction to database
        const transaction = new Transaction({
            user: userId,
            type: 'deposit',
            crypto: cryptoUpper,
            amount_fiat: amount,
            amount_crypto: payAmount,
            address: payAddress,
            invoice_id: invoiceId,
            status: 'pending'
        });

        await transaction.save();

        // Return all needed info to frontend
        res.json({
            success: true,
            message: "Facture créée avec succès",
            data: {
                invoice_id: invoiceId,
                payment_address: payAddress,
                amount_crypto: payAmount,
                currency: cryptoUpper,
                payment_url: paymentUrl,
                expire_time: expireTime,
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
            let newStatus = transaction.status;
            if (invoiceStatus.status === 'Paid' || invoiceStatus.status === 'Completed') {
                newStatus = 'paid';
            } else if (invoiceStatus.status === 'Expired') {
                newStatus = 'expired';
            } else if (invoiceStatus.status === 'Failed') {
                newStatus = 'failed';
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
                    amount_crypto: transaction.amount_crypto,
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
