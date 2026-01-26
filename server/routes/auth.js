const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

const router = express.Router();

// INSCRIPTION
router.post("/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // Vérification
    const userExists = await User.findOne({ email });
    if (userExists)
      return res.status(400).json({ message: "Utilisateur déjà existant" });

    // Hash du mot de passe
    const hashedPassword = await bcrypt.hash(password, 10);

    // Création utilisateur
    const user = new User({
      username,
      email,
      password: hashedPassword
    });

    await user.save();

    res.status(201).json({ message: "Inscription réussie ✅" });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// CONNEXION
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    // Vérifier utilisateur
    const user = await User.findOne({ email });
    if (!user)
      return res.status(400).json({ message: "Utilisateur introuvable" });

    // Vérifier mot de passe
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return res.status(400).json({ message: "Mot de passe incorrect" });

    // Générer token JWT
    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.json({
      message: "Connexion réussie ✅",
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email
      }
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
