# Man Matters Companion

A product-aware hair-routine companion for the Mosaic Wellness Fellowship Builder Challenge. It gives customers a focused photo check-in, selected-product guidance, intended-routine tracking, and history-aware follow-up support.

## What it does

- Compresses a hair/scalp photo in the browser before analysis.
- Sends Gemini requests only through the Node server; the API key is never exposed to the browser.
- Uses selected Man Matters products, routine, application timing, and recent check-ins to personalize each response.
- Stores journey information locally in the browser.
- Includes clear safety boundaries and encourages clinical care for concerning symptoms.

## Run locally

```powershell
npm install
Copy-Item .env.example .env
# Add GEMINI_API_KEY to .env
npm run server
```

In another terminal:

```powershell
npm run dev
```

For a production-style local run:

```powershell
npm run build
node --env-file=.env server.mjs
```

## Deploy

Deploy as a Node web service. Set `GEMINI_API_KEY` and optional `GEMINI_MODEL=gemini-3.8-flash` in the host's secret/environment-variable dashboard. Build with `npm ci && npm run build`, then start with `npm start`.

Never commit `.env` or any customer contact details.
