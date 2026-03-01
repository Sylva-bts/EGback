const axios = require("axios");

const BASE_URL = process.env.OXAPAY_BASE_URL || "https://api.oxapay.com";
const MERCHANT_KEY = process.env.OXAPAY_MERCHANT_API_KEY;
const PAYOUT_KEY = process.env.OXAPAY_PAYOUT_API_KEY;

// Supported cryptocurrencies mapping
const CRYPTO_MAP = {
    'TRX': 'TRX',
    'USDT': 'USDT',
    'BTC': 'BTC',
    'ETH': 'ETH',
    'BNB': 'BNB'
};

class OxaPayService {

    // 🔹 Création facture (DÉPÔT)
    async createInvoice(amount, crypto, orderId) {
        try {
            // Debug: Log the request details
            console.log("=== 🔍 OxaPay Create Invoice DEBUG ===");
            console.log("BASE_URL:", BASE_URL);
            console.log("MERCHANT_KEY:", MERCHANT_KEY ? "✅ Configurée" : "❌ NON CONFIGUREE!");
            console.log("amount:", amount);
            console.log("crypto:", crypto);
            console.log("orderId:", orderId);
            console.log("WEBHOOK_URL:", process.env.OXAPAY_WEBHOOK_URL || "❌ Non configurée (utilise défaut)");
            console.log("=====================================");

            if (!MERCHANT_KEY) {
                console.error("❌ ERREUR: OXAPAY_MERCHANT_API_KEY n'est pas configurée!");
                throw new Error("OXAPAY_MERCHANT_API_KEY non configurée. Veuillez configurer la clé API dans les variables d'environnement.");
            }

            // OxaPay API request with required fields
            const callbackUrl = process.env.OXAPAY_WEBHOOK_URL || "https://tonsite.com/payments/webhook";
            
            const requestData = {
                merchant: MERCHANT_KEY,
                amount: parseFloat(amount).toFixed(2),
                currency: 'USD', // OxaPay uses USD as base
                order_id: orderId,
                callback_url: callbackUrl,
                pay_currency: CRYPTO_MAP[crypto] || 'USDT',
                life_time: 900, // 15 minutes in seconds (OxaPay requirement)
                // Additional optional fields
                description: `Deposit order ${orderId}`,
                fee_paid_by_payer: 0 // 0 = payer pays fee, 1 = merchant pays fee
            };

            console.log("📤 Envoi requête OxaPay:", JSON.stringify(requestData, null, 2));

            const response = await axios.post(`${BASE_URL}/merchant/invoice`, requestData, {
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: 30000 // 30 seconds timeout
            });

            console.log("📥 Réponse OxaPay:", JSON.stringify(response.data, null, 2));

            // Check response code - OxaPay returns code 100 for success
            if (response.data.code !== 100) {
                const errorMsg = response.data.message || response.data.result || "Erreur OxaPay";
                console.error("❌ OxaPay error response:", errorMsg);
                throw new Error(errorMsg);
            }

            console.log("✅ Facture créée avec succès!");
            return response.data;
        } catch (error) {
            // Detailed error logging
            console.error("=====================================");
            console.error("❌ ERREUR OxaPay Create Invoice:");
            console.error("Message:", error.message);
            if (error.response) {
                console.error("Status:", error.response.status);
                console.error("Data:", JSON.stringify(error.response.data));
            } else if (error.request) {
                console.error("Network Error: Pas de réponse reçue");
            }
            console.error("=====================================");
            
            // Provide more helpful error message
            if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
                throw new Error("❌ Impossible de se connecter à OxaPay. Vérifiez votre connexion internet.");
            } else if (error.response?.status === 401) {
                throw new Error("❌ Clé API OxaPay invalide. Veuillez vérifier votre OXAPAY_MERCHANT_API_KEY.");
            } else if (error.response?.status === 403) {
                throw new Error("❌ Accès refusé par OxaPay. Vérifiez les permissions de votre clé API.");
            } else {
                throw new Error(error.response?.data?.message || error.message || "❌ Erreur création facture OxaPay");
            }
        }
    }

    // 🔹 Vérifier statut facture
    async checkInvoiceStatus(invoiceId) {
        try {
            console.log("Checking OxaPay invoice status:", invoiceId);

            const response = await axios.post(`${BASE_URL}/merchant/invoice/status`, {
                merchant: MERCHANT_KEY,
                invoice_id: invoiceId
            }, {
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: 15000
            });

            console.log("OxaPay status response:", JSON.stringify(response.data, null, 2));

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
            if (!PAYOUT_KEY) {
                throw new Error("OXAPAY_PAYOUT_API_KEY non configurée");
            }

            console.log("=== OxaPay Payout Debug ===");
            console.log("PAYOUT_KEY:", PAYOUT_KEY ? "configured" : "NOT CONFIGURED!");
            console.log("amount:", amount);
            console.log("crypto:", crypto);
            console.log("address:", address);
            console.log("==============================");

            const response = await axios.post(`${BASE_URL}/payout`, {
                key: PAYOUT_KEY,
                amount: amount,
                currency: CRYPTO_MAP[crypto] || 'USDT',
                address: address
            }, {
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            });

            console.log("OxaPay payout response:", JSON.stringify(response.data, null, 2));

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
            }, {
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: 15000
            });

            return response.data;
        } catch (error) {
            console.error("OxaPay checkPayoutStatus error:", error.response?.data || error.message);
            throw new Error(error.response?.data?.message || "Erreur vérification payout");
        }
    }
}

module.exports = new OxaPayService();
