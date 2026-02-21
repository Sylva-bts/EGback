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
            // OxaPay uses fiat currency for invoice, crypto amount is calculated by their system
            const response = await axios.post(`${BASE_URL}/merchant/invoice`, {
                merchant: MERCHANT_KEY,
                amount: amount,
                currency: 'USD', // OxaPay uses USD as base
                order_id: orderId,
                callback_url: process.env.OXAPAY_WEBHOOK_URL || "https://tonsite.com/payments/webhook",
                pay_currency: CRYPTO_MAP[crypto] || 'USDT' // User will pay with selected crypto
            });

            if (response.data.code !== 100) {
                throw new Error(response.data.message || "Erreur OxaPay");
            }

            return response.data;
        } catch (error) {
            console.error("OxaPay createInvoice error:", error.response?.data || error.message);
            throw new Error(error.response?.data?.message || "Erreur création facture OxaPay");
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
