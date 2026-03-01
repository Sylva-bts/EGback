const axios = require("axios");

/**
 * OxaPay Service - Refactored for OxaPay API v1
 * 
 * IMPORTANT: API keys must be sent via HEADERS, never in the body!
 * - Deposit: Use merchant_api_key header
 * - Payout: Use payout_api_key header
 */

class OxaPayService {
    constructor() {
        // Base URL - supports sandbox mode
        this.isSandbox = process.env.OXAPAY_SANDBOX === 'true';
        this.BASE_URL = this.isSandbox 
            ? "https://api.oxapay.com" 
            : "https://api.oxapay.com";
        
        // Axios instance with default config
        this.axiosInstance = axios.create({
            timeout: 30000, // 30 seconds timeout
            headers: {
                'Content-Type': 'application/json'
            }
        });

        // Supported cryptocurrencies
        this.CRYPTO_MAP = {
            'TRX': 'TRX',
            'USDT': 'USDT',
            'BTC': 'BTC',
            'ETH': 'ETH',
            'BNB': 'BNB'
        };
    }

    /**
     * Validate required environment variables
     */
    _validateEnv() {
        const merchantKey = process.env.OXAPAY_MERCHANT_API_KEY;
        const payoutKey = process.env.OXAPAY_PAYOUT_API_KEY;
        
        if (!merchantKey) {
            throw new Error("OXAPAY_MERCHANT_API_KEY non configurée. Veuillez configurer la clé API dans les variables d'environnement.");
        }
        
        if (!payoutKey) {
            throw new Error("OXAPAY_PAYOUT_API_KEY non configurée. Veuillez configurer la clé API dans les variables d'environnement.");
        }
        
        return { merchantKey, payoutKey };
    }

    /**
     * Handle axios errors with clear messages
     */
    _handleError(error, operation) {
        console.error(`❌ OxaPay ${operation} Error:`);
        console.error("Message:", error.message);
        
        if (error.response) {
            // Server responded with error status
            console.error("Status:", error.response.status);
            console.error("Data:", JSON.stringify(error.response.data));
            
            if (error.response.status === 401) {
                throw new Error("Clé API OxaPay invalide. Veuillez vérifier votre OXAPAY_MERCHANT_API_KEY.");
            } else if (error.response.status === 403) {
                throw new Error("Accès refusé par OxaPay (403 Forbidden). Vérifiez les permissions de votre clé API.");
            } else if (error.response.status === 422) {
                throw new Error(`Données invalides envoyées à OxaPay: ${JSON.stringify(error.response.data)}`);
            } else {
                throw new Error(`Erreur OxaPay ${error.response.status}: ${error.response.data?.message || error.message}`);
            }
        } else if (error.request) {
            // Request made but no response
            console.error("Network Error: Pas de réponse reçue d'OxaPay");
            throw new Error("Impossible de se connecter à OxaPay. Vérifiez votre connexion internet.");
        } else {
            // Error in request setup
            throw new Error(`Erreur de configuration: ${error.message}`);
        }
    }

    /**
     * Create Invoice (DÉPÔT/DEPOSIT)
     * Endpoint: POST /v1/payment/invoice
     * API Key: merchant_api_key (HEADER)
     * 
     * @param {number} amount - Amount in USD
     * @param {string} crypto - Cryptocurrency (TRX, USDT, BTC, ETH, BNB)
     * @param {string} orderId - Order ID for tracking
     * @param {object} options - Optional parameters
     * @returns {object} Invoice data
     */
    async createInvoice(amount, crypto, orderId, options = {}) {
        const { merchantKey } = this._validateEnv();
        
        try {
            console.log("=== 🔍 OxaPay Create Invoice DEBUG ===");
            console.log("Mode:", this.isSandbox ? "SANDBOX" : "PRODUCTION");
            console.log("Endpoint: POST /v1/payment/invoice");
            console.log("MERCHANT_KEY:", merchantKey ? "✅ Configurée" : "❌ NON CONFIGUREE!");
            console.log("Amount:", amount);
            console.log("Crypto:", crypto);
            console.log("Order ID:", orderId);
            console.log("======================================");

            // Build request body (NO API KEY IN BODY!)
            const requestBody = {
                amount: parseFloat(amount).toFixed(2),
                currency: options.currency || 'USD',
                order_id: orderId,
                pay_currency: this.CRYPTO_MAP[crypto] || 'USDT',
                lifetime: options.lifetime || 900, // 15 minutes
                callback_url: options.callbackUrl || process.env.OXAPAY_WEBHOOK_URL,
                
                // Optional fields
                ...(options.feePaidByPayer !== undefined && { fee_paid_by_payer: options.feePaidByPayer ? 1 : 0 }),
                ...(options.toCurrency && { to_currency: options.toCurrency }),
                ...(options.description && { description: options.description })
            };

            // Remove undefined values
            Object.keys(requestBody).forEach(key => 
                requestBody[key] === undefined && delete requestBody[key]
            );

            console.log("📤 Requête OxaPay (body):", JSON.stringify(requestBody, null, 2));

            const response = await this.axiosInstance.post(
                `${this.BASE_URL}/v1/payment/invoice`,
                requestBody,
                {
                    headers: {
                        'merchant_api_key': merchantKey  // API KEY IN HEADER, NOT BODY!
                    }
                }
            );

            console.log("📥 Réponse OxaPay:", JSON.stringify(response.data, null, 2));

            // Check OxaPay response code (100 = success)
            if (response.data.code !== 100) {
                const errorMsg = response.data.message || response.data.result || "Erreur OxaPay";
                console.error("❌ OxaPay error response:", errorMsg);
                throw new Error(errorMsg);
            }

            console.log("✅ Facture créée avec succès!");
            return response.data;

        } catch (error) {
            this._handleError(error, "Create Invoice");
        }
    }

    /**
     * Check Invoice Status
     * Endpoint: POST /v1/payment/invoice/status
     * 
     * @param {string} invoiceId - Invoice ID to check
     * @returns {object} Invoice status
     */
    async checkInvoiceStatus(invoiceId) {
        const { merchantKey } = this._validateEnv();
        
        try {
            console.log("=== 🔍 OxaPay Check Invoice Status ===");
            console.log("Invoice ID:", invoiceId);
            console.log("======================================");

            const response = await this.axiosInstance.post(
                `${this.BASE_URL}/v1/payment/invoice/status`,
                { invoice_id: invoiceId },  // Only invoice_id in body
                {
                    headers: {
                        'merchant_api_key': merchantKey  // API KEY IN HEADER!
                    }
                }
            );

            console.log("📥 Réponse OxaPay:", JSON.stringify(response.data, null, 2));

            if (response.data.code !== 100) {
                throw new Error(response.data.message || "Erreur OxaPay");
            }

            return response.data;

        } catch (error) {
            this._handleError(error, "Check Invoice Status");
        }
    }

    /**
     * Send Payout (RETRAIT/WITHDRAWAL)
     * Endpoint: POST /v1/payout
     * API Key: payout_api_key (HEADER)
     * 
     * @param {number} amount - Amount to withdraw
     * @param {string} crypto - Cryptocurrency
     * @param {string} address - Wallet address
     * @param {object} options - Optional parameters
     * @returns {object} Payout result
     */
    async sendPayout(amount, crypto, address, options = {}) {
        const { payoutKey } = this._validateEnv();
        
        try {
            console.log("=== 🔍 OxaPay Send Payout DEBUG ===");
            console.log("Mode:", this.isSandbox ? "SANDBOX" : "PRODUCTION");
            console.log("Endpoint: POST /v1/payout");
            console.log("PAYOUT_KEY:", payoutKey ? "✅ Configurée" : "❌ NON CONFIGUREE!");
            console.log("Amount:", amount);
            console.log("Crypto:", crypto);
            console.log("Address:", address);
            console.log("=====================================");

            // Build request body (NO API KEY IN BODY!)
            const requestBody = {
                amount: parseFloat(amount).toFixed(2),
                currency: this.CRYPTO_MAP[crypto] || 'USDT',
                address: address,
                network: options.network || this._getNetwork(crypto),
                
                // Optional fields
                ...(options.description && { description: options.description })
            };

            // Remove undefined values
            Object.keys(requestBody).forEach(key => 
                requestBody[key] === undefined && delete requestBody[key]
            );

            console.log("📤 Requête OxaPay (body):", JSON.stringify(requestBody, null, 2));

            const response = await this.axiosInstance.post(
                `${this.BASE_URL}/v1/payout`,
                requestBody,
                {
                    headers: {
                        'payout_api_key': payoutKey  // API KEY IN HEADER, NOT BODY!
                    }
                }
            );

            console.log("📥 Réponse OxaPay:", JSON.stringify(response.data, null, 2));

            if (response.data.code !== 100) {
                const errorMsg = response.data.message || response.data.result || "Erreur OxaPay";
                console.error("❌ OxaPay error response:", errorMsg);
                throw new Error(errorMsg);
            }

            console.log("✅ Payout envoyé avec succès!");
            return response.data;

        } catch (error) {
            this._handleError(error, "Send Payout");
        }
    }

    /**
     * Check Payout Status
     * Endpoint: POST /v1/payout/status
     * 
     * @param {string} payoutId - Payout ID to check
     * @returns {object} Payout status
     */
    async checkPayoutStatus(payoutId) {
        const { payoutKey } = this._validateEnv();
        
        try {
            console.log("=== 🔍 OxaPay Check Payout Status ===");
            console.log("Payout ID:", payoutId);
            console.log("=====================================");

            const response = await this.axiosInstance.post(
                `${this.BASE_URL}/v1/payout/status`,
                { trans_id: payoutId },  // Only trans_id in body
                {
                    headers: {
                        'payout_api_key': payoutKey  // API KEY IN HEADER!
                    }
                }
            );

            console.log("📥 Réponse OxaPay:", JSON.stringify(response.data, null, 2));

            if (response.data.code !== 100) {
                throw new Error(response.data.message || "Erreur OxaPay");
            }

            return response.data;

        } catch (error) {
            this._handleError(error, "Check Payout Status");
        }
    }

    /**
     * Get network for cryptocurrency
     */
    _getNetwork(crypto) {
        const networks = {
            'TRX': 'trc20',
            'USDT': 'trc20',
            'BTC': 'btc',
            'ETH': 'erc20',
            'BNB': 'bep20'
        };
        return networks[crypto] || 'trc20';
    }
}

module.exports = new OxaPayService();
