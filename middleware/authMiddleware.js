const jwt = require("jsonwebtoken");

module.exports = (req, res, next) => {
  // Check if JWT_SECRET is configured
  if (!process.env.JWT_SECRET) {
    console.error("[Auth] ERREUR: JWT_SECRET n'est pas configuré dans les variables d'environnement!");
    return res.status(500).json({ message: "Erreur de configuration serveur" });
  }

  // Get token from header
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    console.log("[Auth] Aucun header Authorization fourni");
    return res.status(401).json({ message: "Accès refusé - Token requis" });
  }

  // Check Bearer format
  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    console.log("[Auth] Format token invalide:", authHeader);
    return res.status(401).json({ message: "Format token invalide - Utilisez: Bearer <token>" });
  }

  const token = parts[1];

  if (!token) {
    return res.status(401).json({ message: "Token manquant" });
  }

  try {
    // Verify and decode token (ignore expiration for backward compatibility)
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      ignoreExpiration: true
    });
    
    // Ensure user ID is available
    if (!decoded.id) {
      console.log("[Auth] Token décodé sans ID:", decoded);
      return res.status(401).json({ message: "Token invalide - Pas d'ID utilisateur" });
    }
    
    // Attach user to request
    req.user = { id: decoded.id };
    console.log("[Auth] Utilisateur authentifié:", req.user.id);
    
    next();
  } catch (error) {
    console.error("[Auth] Erreur vérification token:", error.message);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ message: "Token invalide - Veuillez vous reconnecter" });
    }
    
    res.status(401).json({ message: "Erreur d'authentification - Veuillez vous reconnecter" });
  }
};
