const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

process.env.ADMIN_PANEL_LANDING = "true";

console.log("Lancement du serveur admin Escape the Ghost...");
console.log("Panel admin local: http://localhost:5000");

require("./ServerR.js");
