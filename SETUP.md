# GhostR Server Setup

## Start locally

```bash
cd server
npm install
copy .env.example .env
npm run dev
```

## Required env vars

- `MONGODB_URI`
- `JWT_SECRET`
- `OXAPAY_MERCHANT_API_KEY`
- `OXAPAY_PAYOUT_API_KEY`
- `OXAPAY_CALLBACK_URL`
- `OXAPAY_RETURN_URL`

## Main entrypoint

Use `ServerR.js` for local dev and deployment.
