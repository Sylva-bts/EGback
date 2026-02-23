const axios = require("axios");

const BASE_URL = process.env.OXAPAY_BASE_URL || "https://api.oxapay.com";
const MERCHANT_KEY = process.env.OXAPAY_MERCHANT_API_KEY;
const PAYOUT_KEY = process.env.OXAPAY_PAYOUT_API_KEY;
const WEBHOOK_URL = process.env.OXAPAY_WEBHOOK_URL;

// Supported cryptocurrencies mapping
const CRYPTO_MAP = {
    'TRX': 'TRX',
    'USDT': 'USDT',
    'BTC': 'BTC',
    'ETH': 'ETH',
    'BNB': 'BNB'
};

// 🔹 Validate API keys on startup
function validateApiKeys() {
    const errors = [];
    
    if (!MERCHANT_KEY) {
        errors.push("OXAPAY_MERCHANT_API_KEY");
    }
    if (!PAYOUT_KEY) {
        errors.push("OXAPAY_PAYOUT_API_KEY");
    }
    if (!WEBHOOK_URL) {
        console.warn("⚠️ OXAPAY_WEBHOOK_URL not set - webhook payments may not work!");
    }
    
    if (errors.length > 0) {
        console.error("❌ Missing OxaPay environment variables:", errors.join(", "));
        console.error("   Please add these to your .env file:");
        console.error("   - OXAPAY_MERCHANT_API_KEY=your_merchant_key");
        console.error("   - OXAPAY_PAYOUT_API_KEY=your_payout_key");
        console.error("   - OXAPAY_WEBHOOK_URL=https://yourdomain.com/api/payments/webhook");
        return false;
    }
    
    console.log("✅ OxaPay API keys validated successfully");
    return true;
}

// Validate on module load
let apiKeysValid = validateApiKeys();

class OxaPayService {

    // 🔹 Création facture (DÉPÔT)
    async createInvoice(amount, crypto, orderId) {
        try {
            // Check if API keys are configured
            if (!MERCHANT_KEY) {
                throw new Error("Clé API OxaPay non configurée. Veuillez vérifier les variables d'environnement.");
            }

            const callbackUrl = WEBHOOK_URL || "https://tonsite.com/payments/webhook";
            console.log("📤 Creating OxaPay invoice:", { amount, crypto, orderId, callbackUrl });

            // OxaPay uses fiat currency for invoice, crypto amount is calculated by their system
            const response = await axios.post(`${BASE_URL}/merchant/invoice`, {
                merchant: MERCHANT_KEY,
                amount: amount,
                currency: 'USD', // OxaPay uses USD as base
                order_id: orderId,
                callback_url: callbackUrl,
                pay_currency: CRYPTO_MAP[crypto] || 'USDT' // User will pay with selected crypto
            }, {
                timeout: 10000 // 10 second timeout
            });

            console.log("📥 OxaPay response:", response.data);

            if (response.data.code !== 100) {
                const errorMsg = response.data.message || `Erreur OxaPay (code: ${response.data.code})`;
                console.error("❌ OxaPay error:", errorMsg);
                throw new Error(errorMsg);
            }

            return response.data;
        } catch (error) {
            if (error.code === 'ECONNABORTED') {
                console.error("❌ OxaPay timeout error");
                throw new Error("Délai d'attente dépassé. Veuillez réessayer.");
            }
            if (error.response?.data?.message) {
                console.error("❌ OxaPay API error:", error.response.data.message);
                throw new Error(error.response.data.message);
            }
            console.error("❌ OxaPay createInvoice error:", error.message);
            throw new Error(error.message || "Erreur création facture OxaPay");
        }
    }

    // 🔹 Vérifier statut facture
    async checkInvoiceStatus(invoiceId) {
        try {
            const response = await axios.post(`${BASE_URL}/merchant/invoice/status`, {
                merchant: MERCHANT_KEY,
                invoice_id: invoiceId
            });

            if (response.data.code !== 100) {
                throw new Error(response.data.message || "Erreur OxaPay");
            }

            return response.data;
        } catch (error) {
            console.error("OxaPay checkStatus error:", error.response?.data || error.message);
            throw new Error(error.response?.data?.message || "Erreur vérification facture");
        }
    }

    // 🔹 Payout (RETRAIT)
    async sendPayout(amount, crypto, address) {
        try {
            const response = await axios.post(`${BASE_URL}/payout`, {
                key: PAYOUT_KEY,
                amount: amount,
                currency: CRYPTO_MAP[crypto] || 'USDT',
                address: address
            });

            if (response.data.code !== 100) {
                throw new Error(response.data.message || "Erreur OxaPay");
            }

            return response.data;
        } catch (error) {
            console.error("OxaPay sendPayout error:", error.response?.data || error.message);
            throw new Error(error.response?.data?.message || "Erreur envoi payout OxaPay");
        }
    }

    // 🔹 Vérifier statut payout
    async checkPayoutStatus(payoutId) {
        try {
            const response = await axios.post(`${BASE_URL}/payout/status`, {
                key: PAYOUT_KEY,
                trans_id: payoutId
            });

            return response.data;
        } catch (error) {
            console.error("OxaPay checkPayoutStatus error:", error.response?.data || error.message);
            throw new Error(error.response?.data?.message || "Erreur vérification payout");
        }
    }
}

module.exports = new OxaPayService();
