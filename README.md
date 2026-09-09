# NPFL + Doma United dashboard

This project provides a local Node.js + Express backend that scrapes the official NPFL fixtures/results page and exposes the data at `/api/npfl/matches`.

## Features

- Official NPFL website scraper via Cheerio
- In-memory cache to avoid repeated scraping
- Matches page with filters and search
- Separate Doma United team view
- Responsive football-themed design
- Friendly empty/error states without fake data
- Provider-ready Live Stream page with admin controls

## Setup

1. Install dependencies:
   npm install
2. Start the app:
   npm start
3. Open the app in a browser:
   http://localhost:3000/matches.html

## Shared admin content storage

News, gallery images, squad players, and custom matches use Supabase when the
server has `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` configured. Run the
SQL in `schema.sql` in the Supabase SQL editor, create a `.env` from
`.env.example`, and restart the server. The service-role key must remain only
in the server environment; never place it in `public/` files.

Without those variables the app uses its local SQLite/file fallback for local
development, which is not shared between separate deployments or devices.

## Live streaming

Run the new `live_streams` table and its policies from `schema.sql` in Supabase.
The existing public `doma-uploads` bucket is reused for stream thumbnails, so
no new bucket is required. Keep `SUPABASE_SERVICE_ROLE_KEY` on Render only.

An administrator signs in at `/admin-login.html`, opens **Live Stream**, enters
the provider embed/player or HLS URL, adds match details and an optional
thumbnail, then checks **Activate stream as LIVE** and saves. Visitors use
`/live.html`; the page polls every 30 seconds and also listens for server
events. Render never relays video bytes. YouTube watch URLs are converted to
embeds, iframe URLs open in an iframe, HLS/video URLs use a browser player, and
RTMP or unsupported ingest URLs show an external provider-player fallback.

Deploy with:

```text
npm install
npm run build
npm start
```

## API routes

- `GET /api/npfl/matches` — NPFL fixtures/results JSON
- `GET /api/npfl/table` — standings placeholder response; official standings are not currently available from the source

## Notes

- The app intentionally does not use the broken API-season endpoint.
- Doma United is shown as a team inside the full NPFL dataset and also on a dedicated team view.
- No fake scores or fictional fixtures are created.
