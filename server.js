const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const NPFL_URL = 'https://npfl.com.ng/fixtures-results/';
const NPFL_TABLE_URL = 'https://npfl.com.ng/npfl-table/';
const CACHE_TTL = 5 * 60 * 1000;

const cache = {
  matches: null,
  expiresAt: 0,
  inFlight: null,
  standings: null,
  standingsExpiresAt: 0,
  standingsInFlight: null,
};

function normalizeTeamName(name) {
  if (!name || typeof name !== 'string') return '';

  return name
    .replace(/&/g, ' and ')
    .replace(/\bFC\b/gi, '')
    .replace(/\bFootball Club\b/gi, '')
    .replace(/\bSports Club\b/gi, '')
    .replace(/\bSC\b/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .trim()
    .toLowerCase();
}

function parseStandingNumber(value) {
  const number = Number.parseInt(String(value || '').replace(/[^-\d]/g, ''), 10);
  return Number.isNaN(number) ? 0 : number;
}

function extractStandingsFromHtml(html) {
  const $ = cheerio.load(html);
  const requiredHeaders = ['pos', 'club', 'p', 'w', 'd', 'l', 'f', 'a', 'gd', 'pts'];
  const table = $('table.sp-league-table').filter((_, element) => {
    const headers = $(element).find('thead th').map((__, header) => {
      return $(header).attr('data-label') || $(header).text();
    }).get().map((header) => header.replace(/\s+/g, ' ').trim().toLowerCase());

    return requiredHeaders.every((header) => headers.includes(header));
  }).first();

  if (!table.length) {
    throw new Error('The official NPFL standings table was not found');
  }

  const standings = table.find('tbody tr[class*="sp-row"]').map((_, row) => {
    const cell = (selector) => $(row).find(selector).first().text().replace(/\s+/g, ' ').trim();
    const team = cell('td.data-name');

    if (!team) return null;

    return {
      position: parseStandingNumber(cell('td.data-rank')),
      team,
      played: parseStandingNumber(cell('td.data-p')),
      wins: parseStandingNumber(cell('td.data-w')),
      draws: parseStandingNumber(cell('td.data-d')),
      losses: parseStandingNumber(cell('td.data-l')),
      goalsFor: parseStandingNumber(cell('td.data-f')),
      goalsAgainst: parseStandingNumber(cell('td.data-a')),
      goalDifference: parseStandingNumber(cell('td.data-gd')),
      points: parseStandingNumber(cell('td.data-pts')),
    };
  }).get().filter(Boolean);

  if (!standings.length) {
    throw new Error('The official NPFL standings table contained no clubs');
  }

  return standings;
}

async function fetchNpflStandings() {
  const response = await axios.get(NPFL_TABLE_URL, {
    timeout: 30000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });

  if (!response.data || typeof response.data !== 'string') {
    throw new Error('NPFL website returned an empty standings response');
  }

  return {
    success: true,
    source: NPFL_TABLE_URL,
    standings: extractStandingsFromHtml(response.data),
  };
}

async function getCachedStandings() {
  const now = Date.now();

  if (cache.standings && now < cache.standingsExpiresAt) {
    return cache.standings;
  }

  if (cache.standingsInFlight) {
    return cache.standingsInFlight;
  }

  cache.standingsInFlight = fetchNpflStandings()
    .then((data) => {
      cache.standings = data;
      cache.standingsExpiresAt = Date.now() + CACHE_TTL;
      return data;
    })
    .catch((error) => {
      cache.standings = null;
      cache.standingsExpiresAt = 0;
      throw error;
    })
    .finally(() => {
      cache.standingsInFlight = null;
    });

  return cache.standingsInFlight;
}

function dedupeMatches(matches) {
  const seen = new Set();
  return matches.filter((match) => {
    const key = [
      normalizeTeamName(match.homeTeam),
      normalizeTeamName(match.awayTeam),
      match.date || '',
      match.time || '',
    ].join('|');

    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function parsePlainDate(dateText, fallback = '') {
  if (!dateText) return fallback;

  const clean = dateText
    .replace(/\s+/g, ' ')
    .trim();

  const dateMatch = clean.match(/\b(\d{4}-\d{2}-\d{2}|\d{4}\/\d{2}\/\d{2}|\d{1,2}[-/ ]\w+[-/ ]\d{4})\b/i);

  if (dateMatch) {
    const value = dateMatch[1];
    if (value.includes('-')) return value;
    if (value.includes('/')) {
      const [d, m, y] = value.split('/');
      return `${y}-${m}-${d}`;
    }
  }

  const dateObj = new Date(clean);
  if (!Number.isNaN(dateObj.getTime())) {
    return dateObj.toISOString().split('T')[0];
  }

  return fallback;
}

function parsePlainTime(timeText, fallback = '') {
  if (!timeText) return fallback;

  const normalized = timeText.replace(/\s+/g, ' ').trim();
  const timeMatch = normalized.match(/(\d{1,2}:\d{2})(?:\s*(?:AM|PM))?/i);

  if (timeMatch) {
    return timeMatch[1];
  }

  const isoMatch = normalized.match(/(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/i);
  if (isoMatch) {
    return isoMatch[2];
  }

  return fallback;
}

function buildMatchday(value) {
  if (!value) return 'Matchday N/A';
  const text = String(value).trim();
  if (/matchday|match day|round/i.test(text)) return text;
  return `Matchday ${text}`;
}

function parseEventText(rawText) {
  const text = (rawText || '').replace(/\s+/g, ' ').trim();

  if (!text) return { homeTeam: '', awayTeam: '' };

  const matchPattern = /(.+?)\s+vs\.?\s+(.+?)(?:\s+\|\s+.+)?$/i;
  const simple = text.match(matchPattern);

  if (simple) {
    return {
      homeTeam: simple[1].trim(),
      awayTeam: simple[2].trim(),
    };
  }

  const separator = text.includes(' - ') ? ' - ' : null;
  if (separator) {
    const [home, away] = text.split(separator);
    return { homeTeam: home.trim(), awayTeam: away.trim() };
  }

  return { homeTeam: text, awayTeam: '' };
}

function extractScore(rawText) {
  if (!rawText) return null;

  const match = rawText.match(/(\d+)\s*[-–]\s*(\d+)/);
  if (!match) return null;

  return {
    home: Number(match[1]),
    away: Number(match[2]),
  };
}

function inferStatus(match, rawText) {
  const text = (rawText || '').toLowerCase();
  const score = extractScore(rawText);

  if (/postponed|cancelled|canceled/i.test(text)) {
    return 'postponed';
  }

  if (/ft|full[- ]time|finished|final/i.test(text) || score) {
    return 'finished';
  }

  if (/live|1st|2nd|ht|halftime|in play|playing/i.test(text)) {
    return 'live';
  }

  return 'upcoming';
}

function getMatchdayFromContext($, row, fallback) {
  const candidate = $(row)
    .find('td[data-label="Match Day"], td.data-round, td.data-matchday, .matchday, [data-label="Matchday"], [data-label="Round"]')
    .first()
    .text();

  if (candidate && candidate.trim()) {
    return buildMatchday(candidate);
  }

  const byRel = $(row).closest('table').find('th, td').filter((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    return /Match Day|Matchday|Round/i.test(text);
  }).first().text();

  if (byRel && byRel.trim()) {
    return buildMatchday(byRel);
  }

  return fallback;
}

function extractMatchesFromHtml(html) {
  const $ = cheerio.load(html);
  const selectors = [
    'tr.sp-row',
    'tr.event',
    'li.sp-event',
    '[itemtype="http://schema.org/SportsEvent"]',
    '.sp-event',
    '.fixture-row',
    '.match-item',
    '.match-row',
  ];

  const rows = [];
  selectors.forEach((selector) => {
    $(selector).each((_, element) => {
      rows.push(element);
    });
  });

  const uniqueRows = rows.filter((row, index, collection) => {
    const current = $.html(row);
    return collection.findIndex((item) => $.html(item) === current) === index;
  });

  const matches = [];

  uniqueRows.forEach((row) => {
    const rowText = $(row).text().replace(/\s+/g, ' ').trim();
    if (!rowText || rowText.length < 12 || !/(vs|v\.)/i.test(rowText)) {
      return;
    }

    const eventEl = $(row).find('td.data-event, .data-event, [itemprop="name"], .match-name, .event-name').first();
    const eventText = eventEl.length ? eventEl.text() : rowText;
    const teams = parseEventText(eventText);

    if (!teams.homeTeam || !teams.awayTeam) {
      return;
    }

    const dateEl = $(row).find('td.data-date, [itemprop="startDate"], .data-date').first();
    const isoDate = dateEl.attr('content') || dateEl.attr('datetime') || '';
    const dateText = dateEl.text() || isoDate;
    const matchDate = parsePlainDate(isoDate || dateText, '');

    const timeEl = $(row).find('td.data-time, .data-time, [itemprop="startTime"], .time').first();
    const rawTimeText = (timeEl.length ? timeEl.text() : rowText).replace(/\s+/g, ' ').trim();
    const time = parsePlainTime(rawTimeText, '');

    const venueEl = $(row).find('td.data-venue, .data-venue, .venue, [data-label="Venue"]').first();
    const venue = venueEl.length ? venueEl.text().replace(/\s+/g, ' ').trim() : '';

    const scoreText = $(row).find('td.data-time, .data-time, .result, .score').first().text();
    const score = extractScore(scoreText || rowText);
    const status = inferStatus({ score }, scoreText || rowText);
    const matchday = getMatchdayFromContext($, row, 'Matchday N/A');

    const cleanedMatch = {
      homeTeam: teams.homeTeam.replace(/\s+/g, ' ').trim(),
      awayTeam: teams.awayTeam.replace(/\s+/g, ' ').trim(),
      date: matchDate || new Date().toISOString().split('T')[0],
      time: time || '00:00',
      venue: venue || 'Venue to be confirmed',
      matchday: buildMatchday(matchday),
      status,
      score,
    };

    if (cleanedMatch.homeTeam && cleanedMatch.awayTeam) {
      matches.push(cleanedMatch);
    }
  });

  return dedupeMatches(matches);
}

async function fetchNpflMatches() {
  const response = await axios.get(NPFL_URL, {
    timeout: 30000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });

  if (!response.data || typeof response.data !== 'string') {
    throw new Error('NPFL website returned an empty response');
  }

  const matches = extractMatchesFromHtml(response.data);
  if (!matches.length) {
    return {
      success: true,
      source: 'NPFL',
      matches: [],
      standings: [],
      message: 'No NPFL matches were returned by the official source.',
    };
  }

  return {
    success: true,
    source: 'NPFL',
    matches,
    standings: [],
    message: 'NPFL fixtures retrieved from the official website.',
  };
}

async function getCachedMatches() {
  const now = Date.now();

  if (cache.matches && now < cache.expiresAt) {
    return cache.matches;
  }

  if (cache.inFlight) {
    return cache.inFlight;
  }

  cache.inFlight = fetchNpflMatches()
    .then((data) => {
      cache.matches = data;
      cache.expiresAt = Date.now() + CACHE_TTL;
      return data;
    })
    .catch((error) => {
      cache.matches = null;
      cache.expiresAt = 0;
      throw error;
    })
    .finally(() => {
      cache.inFlight = null;
    });

  return cache.inFlight;
}

app.use(cors());
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/npfl/matches', async (req, res) => {
  try {
    const payload = await getCachedMatches();
    res.json(payload);
  } catch (error) {
    console.error('NPFL match fetch failed:', error.message);
    res.status(500).json({
      success: false,
      error: 'Unable to retrieve NPFL fixture data',
      source: 'NPFL',
      matches: [],
    });
  }
});

async function handleNpflStandings(req, res) {
  try {
    const payload = await getCachedStandings();
    res.json(payload);
  } catch (error) {
    console.error('NPFL standings fetch failed:', error.message);
    res.status(500).json({
      success: false,
      source: NPFL_TABLE_URL,
      standings: [],
      error: 'Unable to load NPFL standings data right now.',
    });
  }
}

app.get('/api/npfl/standings', handleNpflStandings);
app.get('/api/npfl/table', handleNpflStandings);

app.get('/health', (req, res) => {
  res.json({ ok: true, status: 'NPFL scraper running' });
});

app.listen(PORT, () => {
  console.log(`NPFL app running on http://localhost:${PORT}`);
});
