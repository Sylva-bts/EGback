const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log("MongoDB connected");

    try {
      const collection = mongoose.connection.db.collection("transactions");
      const indexes = await collection.indexes();
      const hasLegacyInvoiceIdIndex = indexes.some((index) => index.name === "invoiceId_1");

      if (hasLegacyInvoiceIdIndex) {
        await collection.dropIndex("invoiceId_1");
        console.log("[MongoDB] Dropped legacy index invoiceId_1");
      }
    } catch (indexError) {
      console.warn("[MongoDB] Index cleanup skipped:", indexError.message);
    }
  } catch (err) {
    console.error("MongoDB error:", err.message);
    process.exit(1);
  }
};

module.exports = connectDB;
