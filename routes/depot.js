const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const mogoose = require('mongoose');

const app = express();
app.use(bodyParser.json());

const UserSchema = new mongoose.Schema({
    email: { type: String, unique: true },
    balance: { type: Number, default: 0 }, // solde en TRX
});

module.exports = mongoose.model('User', UserSchema);

// Simule un solde utilisateur
let userBalance = {}; // { "email": 100 }

// Endpoint pour créer la transaction
app.post('/api/transaction', async (req, res) => {
    try {
        const { email, montant } = req.body;

        if(!email || !montant || montant <= 0) {
            return res.status(400).json({ error: 'Données invalides' });
        }

        const data = {
            amount: montant,
            currency: "USD",          // Montant affiché en USD
            to_currency: "TRX",       // Converti en TRX
            lifetime: 30,
            fee_paid_by_payer: 1,
            under_paid_coverage: 2.5,
            auto_withdrawal: false,
            mixed_payment: true,
            return_url: `https://tonsite.com/success?email=${email}`, // Retour après paiement
            order_id: `ORD-${Date.now()}`,
            thanks_message: "Merci pour votre paiement !",
            description: `Dépôt de ${montant} USD en TRX`,
            sandbox: false
        };

        const headers = {
            'merchant_api_key': 'LJJY5O-CRTMKU-VQIKOO-8FYLZL',
            'Content-Type': 'application/json'
        };

        const response = await axios.post('https://api.oxapay.com/v1/payment/invoice', data, { headers });

        const paymentUrl = response.data?.data?.payment_url;

        if(paymentUrl) {
            res.json({ payment_url: paymentUrl });
        } else {
            res.status(500).json({ error: 'Impossible de générer le lien de paiement' });
        }
    } catch (error) {
        console.error(error.response?.data || error.message);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Endpoint de callback OxaPay (webhook)
app.post('/api/webhook', (req, res) => {
    const { email, amount, status } = req.body;

    if(status === 'paid') {
        // Augmente le solde de l'utilisateur
        userBalance[email] = (userBalance[email] || 0) + amount;
        console.log(`Solde de ${email}: ${userBalance[email]} TRX`);
    }

    res.json({ received: true });
});

app.listen(5000, () => console.log('Server running on http://localhost:5000'));
