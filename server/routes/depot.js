
const axios = require('axios');

const url = 'https://api.oxapay.com/v1/payment/invoice';

const data = {
   amount: 100,
   currency: "USD",
   lifetime: 30,
   fee_paid_by_payer: 1,
   under_paid_coverage: 2.5,
   to_currency: "USDT",
   auto_withdrawal: false,
   mixed_payment: true,
   return_url: "https://example.com/success",
   order_id: "ORD-12345",
   thanks_message: "Thanks message",
   description: "Order #12345",
   sandbox: false
};

const headers = {
 'merchant_api_key': 'LJJY5O-CRTMKU-VQIKOO-8FYLZL',
 'Content-Type': 'application/json',
};

axios.post(url, data, { headers })
 .then((response) => {
   console.log(response.data);
 })
 .catch((error) => {
   console.error(error);
 });