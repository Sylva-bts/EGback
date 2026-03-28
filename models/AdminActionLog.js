const mongoose = require("mongoose");

const adminActionLogSchema = new mongoose.Schema({
  admin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "AdminUser",
    required: true
  },
  action: {
    type: String,
    required: true,
    trim: true
  },
  targetType: {
    type: String,
    default: "",
    trim: true
  },
  targetId: {
    type: String,
    default: "",
    trim: true
  },
  summary: {
    type: String,
    default: "",
    trim: true
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model("AdminActionLog", adminActionLogSchema);
