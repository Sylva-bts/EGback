const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    type: {
        type: String,
        enum: ['deposit', 'withdraw', 'power_purchase', 'game_bet', 'game_cashout', 'affiliate_credit'],
        required: true
    },
    crypto: {
        type: String,
        required: false,
        enum: ['TRX', 'USDT', 'BTC', 'ETH', 'BNB']
    },
    amount_fiat: {
        type: Number,
        required: true
    },
    amount_crypto: {
        type: Number
    },
    bonusAmount: {
        type: Number,
        default: 0
    },
    bonusApplied: {
        type: Boolean,
        default: false
    },
    address: {
        type: String
    },
    invoice_id: {
        type: String,
        default: undefined
    },
    order_id: {
        type: String,
        default: undefined
    },
    status: {
        type: String,
        enum: ['pending', 'paid', 'completed', 'rejected', 'expired', 'failed'],
        default: 'pending'
    },
    adminNotes: {
        type: String,
        default: ""
    },
    adminDecisionAt: {
        type: Date,
        default: null
    },
    adminDecisionBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AdminUser',
        default: undefined
    },
    provider: {
        type: String
    },
    powerKey: {
        type: String
    },
    powerUnits: {
        type: Number,
        default: 0
    },
    betAmount: {
        type: Number,
        default: 0
    },
    multiplier: {
        type: Number,
        default: 0
    },
    relatedUser: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: undefined
    },
    transaction_hash: {
        type: String,
        default: undefined
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

transactionSchema.pre("save", function cleanNullableFields(next) {
    const nullableFields = ["invoice_id", "order_id", "address", "transaction_hash", "provider", "powerKey", "relatedUser", "adminDecisionBy"];

    nullableFields.forEach((field) => {
        if (this[field] === null || this[field] === "") {
            this[field] = undefined;
        }
    });

    next();
});

module.exports = mongoose.model('Transaction', transactionSchema);
