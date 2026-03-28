const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },
    password: {
        type: String,
        required: true
    },
    isBanned: {
        type: Boolean,
        default: false
    },
    banReason: {
        type: String,
        default: ""
    },
    bannedAt: {
        type: Date,
        default: null
    },
    balance: {
        type: Number,
        default: 1000
    },
    lastSeenAt: {
        type: Date,
        default: null
    },
    firstDepositBonusApplied: {
        type: Boolean,
        default: false
    },
    firstDepositBonusAt: {
        type: Date,
        default: null
    },
    referralCode: {
        type: String,
        unique: true,
        sparse: true,
        uppercase: true,
        trim: true
    },
    referredBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    affiliateTotalEarned: {
        type: Number,
        default: 0
    },
    affiliateLockedBalance: {
        type: Number,
        default: 0
    },
    affiliateUnlockedTotal: {
        type: Number,
        default: 0
    },
    gameStats: {
        totalDebited: {
            type: Number,
            default: 0
        },
        totalCredited: {
            type: Number,
            default: 0
        },
        referredNetLossSettled: {
            type: Number,
            default: 0
        }
    },
    powers: {
        freeze: {
            type: Number,
            default: 0
        },
        shield: {
            type: Number,
            default: 0
        },
        second_chance: {
            type: Number,
            default: 0
        },
        vision: {
            type: Number,
            default: 0
        }
    },
    adminGameControl: {
        forcedCrashValue: {
            type: Number,
            default: null
        },
        notes: {
            type: String,
            default: ""
        },
        updatedAt: {
            type: Date,
            default: null
        }
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

userSchema.pre("save", function updateTimestamp(next) {
    this.updatedAt = new Date();
    next();
});

module.exports = mongoose.model('User', userSchema);
