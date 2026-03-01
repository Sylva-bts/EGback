const axios = require("axios");

/**
 * OxaPay Service - Refactored for OxaPay API v1
 * 
 * Key changes:
 * - API keys now sent via headers (not body) - fixes 403 error
 * - Correct endpoints: /v1/payment/invoice and /v1/payout
 * - Proper error handling with 401/403 support
 * - White-label support
 * - Environment validation
 */

// ==================== CONFIGURATION ====================

// ✅ CORRIGÉ: Extraire seulement le domaine de l'URL si OXAPAY_BASE_URL contient un chemin
const getBaseUrl = () => {
    const envUrl = process.env.OXAPAY_BASE_URL;
    if (!envUrl) {
        return "https://api.oxapay.com";
    }
    // Extraire le domaine (protocol + host) seulement
    try {
        const url = new URL(envUrl);
        return `${url.protocol}//${url.host}`;
    } catch (e) {
        // Si l'URL n'est pas valide, utiliser par défaut
        console.error(`[OxaPay] OXAPAY_BASE_URL invalide: ${envUrl}, utilisation par défaut`);
        return "https://api.oxapay.com";
    }
};

const BASE_URL = getBaseUrl();

// Les endpoints sont construits une seule fois au démarrage
const ENDPOINTS = {
    createInvoice: `${BASE_URL}/v1/payment/invoice`,
    checkInvoiceStatus: `${BASE_URL}/v1/payment/invoice/status`,
    sendPayout: `${BASE_URL}/v1/payout`,
    checkPayoutStatus: `${BASE_URL}/v1/payout/status`
};

console.log(`[OxaPay] Base URL: ${BASE_URL}`);
console.log(`[OxaPay] Endpoints:`, ENDPOINTS);

// API Keys from environment
const getMerchantKey = () => {
    const key = process.env.OXAPAY_MERCHANT_API_KEY;
    if (!key) {
        throw new Error("OXAPAY_MERCHANT_API_KEY environment variable is required for deposits");
    }
    return key;
};

const getPayoutKey = () => {
    const key = process.env.OXAPAY_PAYOUT_API_KEY;
    if (!key) {
        throw new Error("OXAPAY_PAYOUT_API_KEY environment variable is required for withdrawals");
    }
    return key;
};

// Axios instance with timeout
const createAxiosInstance = (timeout = 30000) => {
    return axios.create({
        timeout,
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }
    });
};

// Supported cryptocurrencies mapping
const CRYPTO_MAP = {
    'TRX': 'TRX',
    'USDT': 'USDT',
    'BTC': 'BTC',
    'ETH': 'ETH',
    'BNB': 'BNB'
};

// ==================== HELPER FUNCTIONS ====================

const handleAxiosError = (error, context) => {
    console.error(`[OxaPay] ${context}:`, error.message);
    
    if (error.response) {
        const status = error.response.status;
        const data = error.response.data;
        
        console.error(`[OxaPay] Status: ${status}, Response:`, data);
        
        if (status === 401) {
            throw new Error("Clé API OxaPay invalide (401 Unauthorized)");
        }
        if (status === 403) {
            throw new Error("Accès interdit (403 Forbidden) - Vérifiez les permissions de votre clé API");
        }
        if (status === 404) {
            throw new Error("Ressource OxaPay non trouvée (404)");
        }
        if (status === 429) {
            throw new Error("Trop de requêtes vers OxaPay (429) - Veuillez patienter");
        }
        
        const message = data?.message || data?.error || `Erreur OxaPay: ${status}`;
        throw new Error(message);
    }
    
    if (error.request) {
        throw new Error("Pas de réponse d'OxaPay - Vérifiez votre connexion réseau");
    }
    
    throw new Error(`Erreur OxaPay: ${error.message}`);
};

// ==================== OXA PAY SERVICE CLASS ====================

class OxaPayService {

    async createInvoice(amount, crypto, orderId) {
        const context = "createInvoice";
        
        try {
            console.log(`[OxaPay] Creating invoice: amount=${amount}, crypto=${crypto}, orderId=${orderId}`);
            console.log(`[OxaPay] Using endpoint: ${ENDPOINTS.createInvoice}`);
            
            const response = await createAxiosInstance().post(ENDPOINTS.createInvoice, {
                amount: parseFloat(amount),
                currency: "USD",
                to_currency: CRYPTO_MAP[crypto] || "USDT",
                order_id: orderId,
                lifetime: parseInt(process.env.OXAPAY_INVOICE_LIFETIME) || 30,
                fee_paid_by_payer: process.env.OXAPAY_FEE_PAID_BY_PAYER === 'true',
                description: process.env.OXAPAY_INVOICE_DESCRIPTION || `Deposit order ${orderId}`
            }, {
                headers: {
                    merchant_api_key: getMerchantKey()
                }
            });

            console.log(`[OxaPay] Invoice created successfully:`, response.data);
            return response.data;
            
        } catch (error) {
            throw handleAxiosError(error, context);
        }
    }

    async checkInvoiceStatus(invoiceId) {
        const context = "checkInvoiceStatus";
        
        try {
            console.log(`[OxaPay] Checking invoice status: ${invoiceId}`);
            console.log(`[OxaPay] Using endpoint: ${ENDPOINTS.checkInvoiceStatus}`);
            
            const response = await createAxiosInstance().post(ENDPOINTS.checkInvoiceStatus, {
                invoice_id: invoiceId
            }, {
                headers: {
                    merchant_api_key: getMerchantKey()
                }
            });

            console.log(`[OxaPay] Invoice status:`, response.data);
            return response.data;
            
        } catch (error) {
            throw handleAxiosError(error, context);
        }
    }

    async sendPayout(amount, crypto, address) {
        const context = "sendPayout";
        
        try {
            console.log(`[OxaPay] Sending payout: amount=${amount}, crypto=${crypto}, address=${address}`);
            console.log(`[OxaPay] Using payout endpoint: ${ENDPOINTS.sendPayout}`);
            
            const response = await createAxiosInstance().post(ENDPOINTS.sendPayout, {
                amount: parseFloat(amount),
                currency: CRYPTO_MAP[crypto] || "USDT",
                address: address,
                network: CRYPTO_MAP[crypto] || "TRX",
                description: process.env.OXAPAY_PAYOUT_DESCRIPTION || `Withdrawal to ${address}`
            }, {
                headers: {
                    payout_api_key: getPayoutKey()
                }
            });

            console.log(`[OxaPay] Payout sent successfully:`, response.data);
            return response.data;
            
        } catch (error) {
            throw handleAxiosError(error, context);
        }
    }

    async checkPayoutStatus(payoutId) {
        const context = "checkPayoutStatus";
        
        try {
            console.log(`[OxaPay] Checking payout status: ${payoutId}`);
            console.log(`[OxaPay] Using payout status endpoint: ${ENDPOINTS.checkPayoutStatus}`);
            
            const response = await createAxiosInstance().post(ENDPOINTS.checkPayoutStatus, {
                trans_id: payoutId
            }, {
                headers: {
                    payout_api_key: getPayoutKey()
                }
            });

            console.log(`[OxaPay] Payout status:`, response.data);
            return response.data;
            
        } catch (error) {
            throw handleAxiosError(error, context);
        }
    }
}

module.exports = new OxaPayService();
