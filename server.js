const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const dotenv = require('dotenv');
const multer = require('multer');
const db = require('./db.js');

dotenv.config();

// Ensure public uploads directory exists
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer storage for uploaded images
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `upload-${uniqueSuffix}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed.'));
    }
  },
});

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
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// ==============================================================================
// ADMIN AUTHENTICATION
// ==============================================================================

const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || 'suleimansaiduumar@gmail.com').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'dancoach001';
const activeAdminTokens = new Set(['admin-active-session']);

function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim() || req.headers['x-admin-token'];

  if (!token || !activeAdminTokens.has(token)) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Valid admin authentication token required.',
    });
  }
  next();
}

app.post('/api/auth/login', (req, res) => {
  const { identity, password } = req.body || {};
  const cleanIdentity = String(identity || '').trim().toLowerCase();

  if (cleanIdentity === ADMIN_USERNAME && String(password) === ADMIN_PASSWORD) {
    const token = crypto.randomBytes(32).toString('hex');
    activeAdminTokens.add(token);
    return res.json({
      success: true,
      token,
      message: 'Login successful.',
      user: { email: ADMIN_USERNAME },
    });
  }

  return res.status(401).json({
    success: false,
    error: 'Invalid username or password.',
  });
});

app.get('/api/auth/check', (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim() || req.headers['x-admin-token'];
  const isValid = Boolean(token && activeAdminTokens.has(token));
  res.json({ authenticated: isValid });
});

// ==============================================================================
// REAL-TIME SERVER-SENT EVENTS (SSE)
// ==============================================================================

const sseClients = new Set();

app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  res.write(`data: ${JSON.stringify({ type: 'connected', time: Date.now() })}\n\n`);
  sseClients.add(res);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

function broadcastEvent(type, action, data = null) {
  const payload = JSON.stringify({ type, action, data, timestamp: Date.now() });
  for (const client of sseClients) {
    try {
      client.write(`data: ${payload}\n\n`);
    } catch (err) {
      sseClients.delete(client);
    }
  }
}

// ==============================================================================
// FILE UPLOADS (Gallery, Player Photos, News Covers)
// ==============================================================================

app.post('/api/upload', requireAdmin, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ success: false, error: err.message });
    }

    if (req.file) {
      const publicUrl = `/uploads/${req.file.filename}`;
      return res.json({ success: true, url: publicUrl });
    }

    // Support base64 upload fallback
    if (req.body && req.body.image && typeof req.body.image === 'string' && req.body.image.startsWith('data:image/')) {
      try {
        const matches = req.body.image.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
        if (matches) {
          const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
          const buffer = Buffer.from(matches[2], 'base64');
          const filename = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
          fs.writeFileSync(path.join(uploadsDir, filename), buffer);
          return res.json({ success: true, url: `/uploads/${filename}` });
        }
      } catch (e) {
        return res.status(500).json({ success: false, error: 'Failed to process image buffer.' });
      }
    }

    return res.status(400).json({ success: false, error: 'No image file uploaded.' });
  });
});

// ==============================================================================
// NEWS REST API
// ==============================================================================

app.get('/api/news', async (req, res) => {
  try {
    const news = await db.getNews();
    res.json({ success: true, data: news });
  } catch (error) {
    console.error('Error fetching news:', error.message);
    res.status(500).json({ success: false, error: 'Unable to load news records.' });
  }
});

app.post('/api/news', requireAdmin, async (req, res) => {
  try {
    const record = await db.saveNews(req.body || {});
    broadcastEvent('news', 'create', record);
    res.json({ success: true, data: record });
  } catch (error) {
    console.error('Error creating news:', error.message);
    res.status(500).json({ success: false, error: 'Failed to save news article.' });
  }
});

app.put('/api/news/:id', requireAdmin, async (req, res) => {
  try {
    const record = await db.saveNews({ ...req.body, id: req.params.id });
    broadcastEvent('news', 'update', record);
    res.json({ success: true, data: record });
  } catch (error) {
    console.error('Error updating news:', error.message);
    res.status(500).json({ success: false, error: 'Failed to update news article.' });
  }
});

app.delete('/api/news/:id', requireAdmin, async (req, res) => {
  try {
    await db.deleteNews(req.params.id);
    broadcastEvent('news', 'delete', { id: req.params.id });
    res.json({ success: true, message: 'News article deleted.' });
  } catch (error) {
    console.error('Error deleting news:', error.message);
    res.status(500).json({ success: false, error: 'Failed to delete news article.' });
  }
});

// ==============================================================================
// GALLERY REST API
// ==============================================================================

app.get('/api/gallery', async (req, res) => {
  try {
    const gallery = await db.getGallery();
    res.json({ success: true, data: gallery });
  } catch (error) {
    console.error('Error fetching gallery:', error.message);
    res.status(500).json({ success: false, error: 'Unable to load gallery records.' });
  }
});

app.post('/api/gallery', requireAdmin, async (req, res) => {
  try {
    const record = await db.saveGallery(req.body || {});
    broadcastEvent('gallery', 'create', record);
    res.json({ success: true, data: record });
  } catch (error) {
    console.error('Error saving gallery item:', error.message);
    res.status(500).json({ success: false, error: 'Failed to save gallery item.' });
  }
});

// Batch/multiple gallery upload endpoint
app.post('/api/gallery/upload', requireAdmin, (req, res) => {
  upload.array('images', 20)(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ success: false, error: err.message });
    }

    const files = req.files || [];
    if (!files.length) {
      return res.status(400).json({ success: false, error: 'No gallery images were uploaded.' });
    }

    try {
      const title = req.body.title || '';
      const bio = req.body.bio || '';
      const savedItems = [];

      for (const file of files) {
        const item = await db.saveGallery({
          name: title || file.originalname.replace(/\.[^/.]+$/, ''),
          bio,
          src: `/uploads/${file.filename}`,
        });
        savedItems.push(item);
      }

      broadcastEvent('gallery', 'create_batch', savedItems);
      return res.json({ success: true, count: savedItems.length, data: savedItems });
    } catch (saveError) {
      console.error('Error saving gallery images:', saveError.message);
      return res.status(500).json({ success: false, error: 'Failed to record uploaded gallery images.' });
    }
  });
});

app.put('/api/gallery/:id', requireAdmin, async (req, res) => {
  try {
    const record = await db.saveGallery({ ...req.body, id: req.params.id });
    broadcastEvent('gallery', 'update', record);
    res.json({ success: true, data: record });
  } catch (error) {
    console.error('Error updating gallery item:', error.message);
    res.status(500).json({ success: false, error: 'Failed to update gallery item.' });
  }
});

app.delete('/api/gallery/:id', requireAdmin, async (req, res) => {
  try {
    await db.deleteGallery(req.params.id);
    broadcastEvent('gallery', 'delete', { id: req.params.id });
    res.json({ success: true, message: 'Gallery item deleted.' });
  } catch (error) {
    console.error('Error deleting gallery item:', error.message);
    res.status(500).json({ success: false, error: 'Failed to delete gallery item.' });
  }
});

// ==============================================================================
// PLAYERS (SQUAD) REST API
// ==============================================================================

app.get('/api/players', async (req, res) => {
  try {
    const players = await db.getPlayers();
    res.json({ success: true, data: players });
  } catch (error) {
    console.error('Error fetching players:', error.message);
    res.status(500).json({ success: false, error: 'Unable to load player records.' });
  }
});

app.post('/api/players', requireAdmin, async (req, res) => {
  try {
    const record = await db.savePlayer(req.body || {});
    broadcastEvent('players', 'create', record);
    res.json({ success: true, data: record });
  } catch (error) {
    console.error('Error saving player:', error.message);
    res.status(500).json({ success: false, error: 'Failed to save player profile.' });
  }
});

app.put('/api/players/:id', requireAdmin, async (req, res) => {
  try {
    const record = await db.savePlayer({ ...req.body, id: req.params.id });
    broadcastEvent('players', 'update', record);
    res.json({ success: true, data: record });
  } catch (error) {
    console.error('Error updating player:', error.message);
    res.status(500).json({ success: false, error: 'Failed to update player profile.' });
  }
});

app.delete('/api/players/:id', requireAdmin, async (req, res) => {
  try {
    await db.deletePlayer(req.params.id);
    broadcastEvent('players', 'delete', { id: req.params.id });
    res.json({ success: true, message: 'Player profile deleted.' });
  } catch (error) {
    console.error('Error deleting player:', error.message);
    res.status(500).json({ success: false, error: 'Failed to delete player profile.' });
  }
});

// ==============================================================================
// CUSTOM MATCHES REST API
// ==============================================================================

app.get('/api/admin-matches', async (req, res) => {
  try {
    const matches = await db.getMatches();
    res.json({ success: true, data: matches });
  } catch (error) {
    console.error('Error fetching matches:', error.message);
    res.status(500).json({ success: false, error: 'Unable to load matches.' });
  }
});

app.post('/api/admin-matches', requireAdmin, async (req, res) => {
  try {
    const record = await db.saveMatch(req.body || {});
    broadcastEvent('matches', 'create', record);
    res.json({ success: true, data: record });
  } catch (error) {
    console.error('Error saving match:', error.message);
    res.status(500).json({ success: false, error: 'Failed to save match.' });
  }
});

app.put('/api/admin-matches/:id', requireAdmin, async (req, res) => {
  try {
    const record = await db.saveMatch({ ...req.body, id: req.params.id });
    broadcastEvent('matches', 'update', record);
    res.json({ success: true, data: record });
  } catch (error) {
    console.error('Error updating match:', error.message);
    res.status(500).json({ success: false, error: 'Failed to update match.' });
  }
});

app.delete('/api/admin-matches/:id', requireAdmin, async (req, res) => {
  try {
    await db.deleteMatch(req.params.id);
    broadcastEvent('matches', 'delete', { id: req.params.id });
    res.json({ success: true, message: 'Match deleted.' });
  } catch (error) {
    console.error('Error deleting match:', error.message);
    res.status(500).json({ success: false, error: 'Failed to delete match.' });
  }
});

// ==============================================================================
// PUBLIC NPFL & COMBINED MATCHES
// ==============================================================================

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/npfl/matches', async (req, res) => {
  try {
    const payload = await getCachedMatches();
    // Also include custom admin-saved matches
    const custom = await db.getMatches();
    const formattedCustom = custom.map((m) => {
      const hasScores = m.homeScore !== '' && m.awayScore !== '';
      return {
        id: m.id,
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        date: m.date,
        time: m.time || '00:00',
        venue: m.venue || 'Venue to be confirmed',
        matchday: m.matchday || 'Doma United Fixture',
        status: (m.status || 'upcoming').toLowerCase(),
        score: hasScores ? { home: Number(m.homeScore), away: Number(m.awayScore) } : null,
        homeLogo: m.homeLogo || '',
        awayLogo: m.awayLogo || '',
        isCustom: true,
      };
    });

    const combinedMatches = dedupeMatches([...formattedCustom, ...(payload.matches || [])]);

    res.json({
      ...payload,
      matches: combinedMatches,
    });
  } catch (error) {
    console.error('NPFL match fetch failed:', error.message);
    // Even if scraping fails, return custom matches
    try {
      const custom = await db.getMatches();
      return res.json({
        success: true,
        source: 'Custom',
        matches: custom,
        standings: [],
      });
    } catch (dbErr) {
      res.status(500).json({
        success: false,
        error: 'Unable to retrieve fixture data',
        source: 'NPFL',
        matches: [],
      });
    }
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
  res.json({
    ok: true,
    status: 'Doma United server running',
    supabase: db.isSupabaseConfigured(),
  });
});

app.listen(PORT, () => {
  console.log(`Doma United app running on http://localhost:${PORT}`);
});

