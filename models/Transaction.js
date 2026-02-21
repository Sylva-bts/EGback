const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    type: {
        type: String,
        enum: ['deposit', 'withdraw'],
        required: true
    },
    crypto: {
        type: String,
        required: true,
        enum: ['TRX', 'USDT', 'BTC', 'ETH', 'BNB']
    },
    amount_fiat: {
        type: Number,
        required: true
    },
    amount_crypto: {
        type: Number
    },
    address: {
        type: String
    },
    invoice_id: {
        type: String
    },
    status: {
        type: String,
        enum: ['pending', 'paid', 'completed', 'rejected', 'expired', 'failed'],
        default: 'pending'
    },
    transaction_hash: {
        type: String
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

module.exports = mongoose.model('Transaction', transactionSchema);
