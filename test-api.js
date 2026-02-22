const axios = require('axios');

const BASE_URL = 'http://localhost:5000';

let authToken = '';
let userId = '';

async function testAPI() {
    console.log('========================================');
    console.log('🧪 TEST API - Connexion et Paiements');
    console.log('========================================\n');

    try {
        // Test 1: Health Check
        console.log('📌 Test 1: Health Check');
        const health = await axios.get(`${BASE_URL}/api/health`);
        console.log('✅ Serveur actif:', health.data);
        console.log('');

        // Test 2: Inscription
        console.log('📌 Test 2: Inscription');
        const registerData = {
            username: `testuser_${Date.now()}`,
            email: `test_${Date.now()}@test.com`,
            password: 'test123456'
        };
        try {
            const register = await axios.post(`${BASE_URL}/api/auth/register`, registerData);
            console.log('✅ Inscription réussie:', register.data);
        } catch (err) {
            if (err.response?.status === 400) {
                console.log('⚠️  Utilisateur déjà existant, on continue avec login...');
            } else {
                console.log('❌ Erreur inscription:', err.response?.data || err.message);
            }
        }
        console.log('');

        // Test 3: Connexion
        console.log('📌 Test 3: Connexion');
        try {
            const login = await axios.post(`${BASE_URL}/api/auth/login`, {
                email: registerData.email,
                password: registerData.password
            });
            authToken = login.data.token;
            userId = login.data.user.id;
            console.log('✅ Connexion réussie!');
            console.log('   User ID:', userId);
            console.log('   Token:', authToken.substring(0, 50) + '...');
        } catch (err) {
            console.log('❌ Erreur connexion:', err.response?.data || err.message);
            console.log('   Note: Vous devez peut-être vous inscrire d\'abord via l\'interface');
        }
        console.log('');

        // Test 4: Get Balance (avec auth)
        if (authToken) {
            console.log('📌 Test 4: Obtenir le solde');
            try {
                const balance = await axios.get(`${BASE_URL}/api/payments/balance`, {
                    headers: { Authorization: `Bearer ${authToken}` }
                });
                console.log('✅ Solde actuel:', balance.data.data);
            } catch (err) {
                console.log('❌ Erreur:', err.response?.data || err.message);
            }
            console.log('');
        }

        // Test 5: Create Deposit (avec auth)
        if (authToken) {
            console.log('📌 Test 5: Créer un dépôt');
            try {
                const deposit = await axios.post(`${BASE_URL}/api/payments/deposit`, 
                    { amount: 10, crypto: 'USDT' },
                    { headers: { Authorization: `Bearer ${authToken}` } }
                );
                console.log('✅ Dépôt créé:', deposit.data.data);
            } catch (err) {
                console.log('❌ Erreur dépôt:', err.response?.data || err.message);
            }
            console.log('');
        }

        // Test 6: Get Transactions (avec auth)
        if (authToken) {
            console.log('📌 Test 6: Obtenir l\'historique des transactions');
            try {
                const transactions = await axios.get(`${BASE_URL}/api/payments/transactions`, {
                    headers: { Authorization: `Bearer ${authToken}` }
                });
                console.log('✅ Transactions:', transactions.data.data);
            } catch (err) {
                console.log('❌ Erreur:', err.response?.data || err.message);
            }
            console.log('');
        }

        console.log('========================================');
        console.log('🏁 Tests terminés!');
        console.log('========================================');

    } catch (err) {
        console.error('❌ Erreur générale:', err.message);
    }
    
    process.exit(0);
}

testAPI();
