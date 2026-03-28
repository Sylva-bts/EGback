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
const CALLBACK_URL = String(process.env.OXAPAY_CALLBACK_URL || "").trim();
const RETURN_URL = String(process.env.OXAPAY_RETURN_URL || "").trim();

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

const NETWORK_MAP = {
    TRX: 'Tron',
    USDT: 'TRC20',
    BTC: 'Bitcoin',
    ETH: 'Ethereum',
    BNB: 'BSC'
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
        
        const rawMessage = data?.message || data?.error || `Erreur OxaPay: ${status}`;
        const message = String(rawMessage || "").toLowerCase().includes("there was an issue with the submitted data")
            ? "OxaPay a refuse la demande. Verifiez la cle Payout, la 2FA du compte OxaPay, les IP autorisees, les limites de transfert et l'adresse USDT TRC20."
            : rawMessage;
        throw new Error(message);
    }
    
    if (error.request) {
        throw new Error("Pas de réponse d'OxaPay - Vérifiez votre connexion réseau");
    }
    
    throw new Error(`Erreur OxaPay: ${error.message}`);
};

const normalizeApiPayload = (payload) => {
    if (!payload || typeof payload !== "object") {
        return {};
    }
    return payload.data && typeof payload.data === "object" ? payload.data : payload;
};

// ==================== OXA PAY SERVICE CLASS ====================

class OxaPayService {

    async createInvoice(amount, crypto, orderId) {
        const context = "createInvoice";
        
        try {
            console.log(`[OxaPay] Creating invoice: amount=${amount}, crypto=${crypto}, orderId=${orderId}`);
            console.log(`[OxaPay] Using endpoint: ${ENDPOINTS.createInvoice}`);
            
            const payload = {
                amount: Number(parseFloat(amount).toFixed(2)),
                currency: "USD",
                to_currency: CRYPTO_MAP[crypto] || "USDT",
                order_id: orderId,
                lifetime: parseInt(process.env.OXAPAY_INVOICE_LIFETIME || "30", 10),
                fee_paid_by_payer: process.env.OXAPAY_FEE_PAID_BY_PAYER === "true" ? 1 : 0,
                under_paid_coverage: 0,
                mixed_payment: false,
                description: process.env.OXAPAY_INVOICE_DESCRIPTION || `Deposit order ${orderId}`
            };

            if (CALLBACK_URL) {
                payload.callback_url = CALLBACK_URL;
            }
            if (RETURN_URL) {
                payload.return_url = RETURN_URL;
            }

            const response = await createAxiosInstance().post(ENDPOINTS.createInvoice, payload, {
                headers: {
                    merchant_api_key: getMerchantKey()
                }
            });

            const raw = response.data || {};
            const normalized = raw.data || raw;

            if (!normalized.payment_url) {
                console.error("[OxaPay] Invalid invoice response:", raw);
                throw new Error(raw.message || "OxaPay n'a pas renvoye de lien de paiement");
            }

            console.log(`[OxaPay] Invoice created successfully:`, normalized);
            return normalized;
            
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

    async sendPayout(amount, crypto, address, orderId = "") {
        const context = "sendPayout";
        
        try {
            console.log(`[OxaPay] Sending payout: amount=${amount}, crypto=${crypto}, address=${address}`);
            console.log(`[OxaPay] Using payout endpoint: ${ENDPOINTS.sendPayout}`);

            const payload = {
                amount: Number(parseFloat(amount).toFixed(8)),
                currency: CRYPTO_MAP[crypto] || "USDT",
                address: String(address || '').trim(),
                network: NETWORK_MAP[crypto] || "TRX",
                description: process.env.OXAPAY_PAYOUT_DESCRIPTION || `Withdrawal to ${String(address || '').trim()}`
            };

            if (String(orderId || "").trim()) {
                payload.order_id = String(orderId).trim();
            }

            const response = await createAxiosInstance().post(ENDPOINTS.sendPayout, payload, {
                headers: {
                    payout_api_key: getPayoutKey()
                }
            });

            const raw = response.data || {};
            const normalized = normalizeApiPayload(raw);

            console.log(`[OxaPay] Payout sent successfully:`, normalized);
            return normalized;
            
        } catch (error) {
            throw handleAxiosError(error, context);
        }
    }

    async checkPayoutStatus(payoutId) {
        const context = "checkPayoutStatus";
        
        try {
            const normalizedPayoutId = String(payoutId || "").trim();

            console.log(`[OxaPay] Checking payout status: ${normalizedPayoutId}`);
            console.log(`[OxaPay] Using payout status endpoint: ${ENDPOINTS.checkPayoutStatus}`);

            const response = await createAxiosInstance().post(ENDPOINTS.checkPayoutStatus, {
                track_id: normalizedPayoutId,
                payout_id: normalizedPayoutId,
                trans_id: normalizedPayoutId,
                order_id: normalizedPayoutId
            }, {
                headers: {
                    payout_api_key: getPayoutKey()
                }
            });

            const raw = response.data || {};
            const normalized = normalizeApiPayload(raw);

            console.log(`[OxaPay] Payout status:`, normalized);
            return normalized;
            
        } catch (error) {
            throw handleAxiosError(error, context);
        }
    }
}

module.exports = new OxaPayService();
