module.exports = {
  development: {
    mongodb: process.env.MONGO_URI,
    port: process.env.PORT || 5000,
    nodeEnv: "development",
  },
  production: {
    mongodb: process.env.MONGO_URI,
    port: process.env.PORT || 5000,
    nodeEnv: "production",
  },
};
