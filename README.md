# NPFL + Doma United dashboard

This project provides a local Node.js + Express backend that scrapes the official NPFL fixtures/results page and exposes the data at `/api/npfl/matches`.

## Features

- Official NPFL website scraper via Cheerio
- In-memory cache to avoid repeated scraping
- Matches page with filters and search
- Separate Doma United team view
- Responsive football-themed design
- Friendly empty/error states without fake data

## Setup

1. Install dependencies:
   npm install
2. Start the app:
   npm start
3. Open the app in a browser:
   http://localhost:3000/matches.html

## API routes

- `GET /api/npfl/matches` — NPFL fixtures/results JSON
- `GET /api/npfl/table` — standings placeholder response; official standings are not currently available from the source

## Notes

- The app intentionally does not use the broken API-season endpoint.
- Doma United is shown as a team inside the full NPFL dataset and also on a dedicated team view.
- No fake scores or fictional fixtures are created.
