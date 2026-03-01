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

// Base URL - use custom if provided, otherwise default
const getBaseUrl = () => {
    if (process.env.OXAPAY_BASE_URL) {
        return process.env.OXAPAY_BASE_URL;
    }
    // Default OxaPay API base URL
    return "https://api.oxapay.com";
};

const BASE_URL = getBaseUrl();

console.log(`[OxaPay] Base URL configured: ${BASE_URL}`);

// Check if we're using white-label (custom domain)
const isWhiteLabel = process.env.OXAPAY_BASE_URL && !process.env.OXAPAY_BASE_URL.includes('api.oxapay.com');

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
            console.log(`[OxaPay] isWhiteLabel: ${isWhiteLabel}`);
            
            // Build endpoint based on configuration
            let endpoint;
            if (isWhiteLabel) {
                // White-label: use custom domain directly
                endpoint = `${BASE_URL}/v1/payment/invoice`;
            } else if (process.env.OXAPAY_BASE_URL) {
                // Custom URL provided
                endpoint = `${BASE_URL}/invoice`;
            } else {
                // Default OxaPay API
                endpoint = `${BASE_URL}/v1/payment/invoice`;
            }
            console.log(`[OxaPay] Using endpoint: ${endpoint}`);
            
            const response = await createAxiosInstance().post(endpoint, {
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
            
            // Build endpoint based on configuration
            let endpoint;
            if (isWhiteLabel) {
                endpoint = `${BASE_URL}/v1/payment/invoice/status`;
            } else if (process.env.OXAPAY_BASE_URL) {
                endpoint = `${BASE_URL}/invoice/status`;
            } else {
                endpoint = `${BASE_URL}/v1/payment/invoice/status`;
            }
            console.log(`[OxaPay] Using endpoint: ${endpoint}`);
            
            const response = await createAxiosInstance().post(endpoint, {
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
            
            // Payout endpoint - use BASE_URL or default
            const payoutUrl = isWhiteLabel 
                ? `${BASE_URL}/v1/payout` 
                : (process.env.OXAPAY_BASE_URL || "https://api.oxapay.com") + "/v1/payout";
            console.log(`[OxaPay] Using payout endpoint: ${payoutUrl}`);
            
            const response = await createAxiosInstance().post(payoutUrl, {
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
            
            // Payout status endpoint
            const payoutStatusUrl = isWhiteLabel 
                ? `${BASE_URL}/v1/payout/status` 
                : (process.env.OXAPAY_BASE_URL || "https://api.oxapay.com") + "/v1/payout/status";
            console.log(`[OxaPay] Using payout status endpoint: ${payoutStatusUrl}`);
            
            const response = await createAxiosInstance().post(payoutStatusUrl, {
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
