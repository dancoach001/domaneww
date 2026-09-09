const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

// Optional Supabase integration
let supabase = null;
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || '';

if (SUPABASE_URL && SUPABASE_KEY) {
  try {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    console.log('[Database] Connected to Supabase at:', SUPABASE_URL);
  } catch (err) {
    console.warn('[Database] Failed to initialize Supabase client:', err.message);
  }
}

function throwSupabaseError(operation, error) {
  if (error) {
    throw new Error(`Supabase ${operation} failed: ${error.message || error}`);
  }
}

async function uploadStorageFile(filePath, buffer, contentType) {
  if (!supabase) {
    return null;
  }

  const { error } = await supabase.storage
    .from('doma-uploads')
    .upload(filePath, buffer, {
      contentType,
      upsert: false,
    });

  throwSupabaseError('storage upload', error);
  const { data } = supabase.storage.from('doma-uploads').getPublicUrl(filePath);
  return data.publicUrl;
}

async function deleteStorageFile(filePath) {
  if (!supabase || !filePath) {
    return;
  }

  const { error } = await supabase.storage.from('doma-uploads').remove([filePath]);
  throwSupabaseError('storage delete', error);
}

// Ensure local storage directories exist
const dataDir = path.join(__dirname, 'data');
const uploadsDir = path.join(__dirname, 'public', 'uploads');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Local SQLite Database initialization
const dbPath = path.join(dataDir, 'doma.db');
const localDb = new DatabaseSync(dbPath);

localDb.exec(`
  CREATE TABLE IF NOT EXISTS news (
    id TEXT PRIMARY KEY,
    headline TEXT NOT NULL,
    category TEXT DEFAULT 'Club',
    summary TEXT,
    content TEXT,
    cover_image TEXT,
    saved_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS gallery (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    bio TEXT,
    src TEXT NOT NULL,
    saved_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    player_name TEXT NOT NULL,
    position TEXT NOT NULL,
    number TEXT,
    status TEXT DEFAULT 'Starting XI',
    photo TEXT,
    saved_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY,
    home_team TEXT NOT NULL,
    away_team TEXT NOT NULL,
    date TEXT NOT NULL,
    time TEXT,
    venue TEXT,
    status TEXT DEFAULT 'Upcoming',
    home_score TEXT,
    away_score TEXT,
    matchday TEXT,
    home_logo TEXT,
    away_logo TEXT,
    saved_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS live_streams (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    provider TEXT DEFAULT 'youtube',
    live_provider TEXT DEFAULT 'api-football',
    fixture_id TEXT,
    published INTEGER DEFAULT 1,
    home_team TEXT,
    away_team TEXT,
    match_date TEXT,
    match_time TEXT,
    event_name TEXT,
    teams TEXT,
    competition TEXT,
    stream_url TEXT NOT NULL,
    thumbnail_url TEXT,
    scheduled_start TEXT,
    status TEXT DEFAULT 'offline',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

for (const column of [
  ['provider', "TEXT DEFAULT 'youtube'"],
  ['home_team', 'TEXT'],
  ['away_team', 'TEXT'],
  ['match_date', 'TEXT'],
  ['match_time', 'TEXT'],
  ['live_provider', "TEXT DEFAULT 'api-football'"],
  ['fixture_id', 'TEXT'],
  ['published', 'INTEGER DEFAULT 1'],
]) {
  try {
    localDb.exec(`ALTER TABLE live_streams ADD COLUMN ${column[0]} ${column[1]}`);
  } catch (error) {
    if (!String(error.message).includes('duplicate column name')) throw error;
  }
}

console.log('[Database] Local SQLite ready at:', dbPath);

// ==============================================================================
// NEWS API
// ==============================================================================

async function getNews() {
  if (supabase) {
    const { data, error } = await supabase
      .from('news')
      .select('*')
      .order('saved_at', { ascending: false });

    throwSupabaseError('news read', error);
    if (Array.isArray(data)) {
      return data.map(row => ({
        id: row.id,
        headline: row.headline,
        category: row.category,
        summary: row.summary,
        content: row.content,
        coverImage: row.cover_image || row.coverImage,
        savedAt: row.saved_at || row.savedAt
      }));
    }
  }

  const stmt = localDb.prepare('SELECT * FROM news ORDER BY saved_at DESC');
  return stmt.all().map(row => ({
    id: row.id,
    headline: row.headline,
    category: row.category,
    summary: row.summary,
    content: row.content,
    coverImage: row.cover_image,
    savedAt: row.saved_at
  }));
}

async function saveNews(item) {
  const record = {
    id: item.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    headline: item.headline || 'Club update',
    category: item.category || 'Club',
    summary: item.summary || '',
    content: item.content || '',
    coverImage: item.coverImage || '',
    savedAt: item.savedAt || new Date().toISOString()
  };

  if (supabase) {
    const { error } = await supabase.from('news').upsert({
      id: record.id,
      headline: record.headline,
      category: record.category,
      summary: record.summary,
      content: record.content,
      cover_image: record.coverImage,
      saved_at: record.savedAt
    });
    throwSupabaseError('news write', error);
  }

  const stmt = localDb.prepare(`
    INSERT INTO news (id, headline, category, summary, content, cover_image, saved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      headline = excluded.headline,
      category = excluded.category,
      summary = excluded.summary,
      content = excluded.content,
      cover_image = excluded.cover_image,
      saved_at = excluded.saved_at
  `);

  stmt.run(
    record.id,
    record.headline,
    record.category,
    record.summary,
    record.content,
    record.coverImage,
    record.savedAt
  );

  return record;
}

async function deleteNews(id) {
  if (supabase) {
    const { error } = await supabase.from('news').delete().eq('id', id);
    throwSupabaseError('news delete', error);
  }
  const stmt = localDb.prepare('DELETE FROM news WHERE id = ?');
  stmt.run(id);
  return { success: true };
}

// ==============================================================================
// GALLERY API
// ==============================================================================

async function getGallery() {
  if (supabase) {
    const { data, error } = await supabase
      .from('gallery')
      .select('*')
      .order('saved_at', { ascending: false });

    throwSupabaseError('gallery read', error);
    if (Array.isArray(data)) {
      return data.map(row => ({
        id: row.id,
        name: row.name,
        bio: row.bio,
        src: row.src,
        savedAt: row.saved_at || row.savedAt
      }));
    }
  }

  const stmt = localDb.prepare('SELECT * FROM gallery ORDER BY saved_at DESC');
  return stmt.all().map(row => ({
    id: row.id,
    name: row.name,
    bio: row.bio,
    src: row.src,
    savedAt: row.saved_at
  }));
}

async function saveGallery(item) {
  const record = {
    id: item.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: item.name || 'Gallery image',
    bio: item.bio || '',
    src: item.src || '',
    savedAt: item.savedAt || new Date().toISOString()
  };

  if (supabase) {
    const { error } = await supabase.from('gallery').upsert({
      id: record.id,
      name: record.name,
      bio: record.bio,
      src: record.src,
      saved_at: record.savedAt
    });
    throwSupabaseError('gallery write', error);
  }

  const stmt = localDb.prepare(`
    INSERT INTO gallery (id, name, bio, src, saved_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      bio = excluded.bio,
      src = excluded.src,
      saved_at = excluded.saved_at
  `);

  stmt.run(record.id, record.name, record.bio, record.src, record.savedAt);
  return record;
}

async function deleteGallery(id) {
  if (supabase) {
    const { error } = await supabase.from('gallery').delete().eq('id', id);
    throwSupabaseError('gallery delete', error);
  }
  const stmt = localDb.prepare('DELETE FROM gallery WHERE id = ?');
  stmt.run(id);
  return { success: true };
}

// ==============================================================================
// PLAYERS (SQUAD) API
// ==============================================================================

async function getPlayers() {
  if (supabase) {
    const { data, error } = await supabase
      .from('players')
      .select('*')
      .order('saved_at', { ascending: false });

    throwSupabaseError('players read', error);
    if (Array.isArray(data)) {
      return data.map(row => ({
        id: row.id,
        playerName: row.player_name || row.playerName,
        position: row.position,
        number: row.number,
        status: row.status,
        photo: row.photo,
        savedAt: row.saved_at || row.savedAt
      }));
    }
  }

  const stmt = localDb.prepare('SELECT * FROM players ORDER BY saved_at DESC');
  return stmt.all().map(row => ({
    id: row.id,
    playerName: row.player_name,
    position: row.position,
    number: row.number,
    status: row.status,
    photo: row.photo,
    savedAt: row.saved_at
  }));
}

async function savePlayer(item) {
  const record = {
    id: item.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    playerName: item.playerName || '',
    position: item.position || 'Forward',
    number: item.number || '',
    status: item.status || 'Starting XI',
    photo: item.photo || '',
    savedAt: item.savedAt || new Date().toISOString()
  };

  if (supabase) {
    const { error } = await supabase.from('players').upsert({
      id: record.id,
      player_name: record.playerName,
      position: record.position,
      number: record.number,
      status: record.status,
      photo: record.photo,
      saved_at: record.savedAt
    });
    throwSupabaseError('players write', error);
  }

  const stmt = localDb.prepare(`
    INSERT INTO players (id, player_name, position, number, status, photo, saved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      player_name = excluded.player_name,
      position = excluded.position,
      number = excluded.number,
      status = excluded.status,
      photo = excluded.photo,
      saved_at = excluded.saved_at
  `);

  stmt.run(
    record.id,
    record.playerName,
    record.position,
    record.number,
    record.status,
    record.photo,
    record.savedAt
  );

  return record;
}

async function deletePlayer(id) {
  if (supabase) {
    const { error } = await supabase.from('players').delete().eq('id', id);
    throwSupabaseError('players delete', error);
  }
  const stmt = localDb.prepare('DELETE FROM players WHERE id = ?');
  stmt.run(id);
  return { success: true };
}

// ==============================================================================
// MATCHES API
// ==============================================================================

async function getMatches() {
  if (supabase) {
    const { data, error } = await supabase
      .from('matches')
      .select('*')
      .order('date', { ascending: true });

    throwSupabaseError('matches read', error);
    if (Array.isArray(data)) {
      return data.map(row => ({
        id: row.id,
        homeTeam: row.home_team || row.homeTeam,
        awayTeam: row.away_team || row.awayTeam,
        date: row.date,
        time: row.time,
        venue: row.venue,
        status: row.status,
        homeScore: row.home_score || row.homeScore,
        awayScore: row.away_score || row.awayScore,
        matchday: row.matchday,
        homeLogo: row.home_logo || row.homeLogo,
        awayLogo: row.away_logo || row.awayLogo,
        savedAt: row.saved_at || row.savedAt
      }));
    }
  }

  const stmt = localDb.prepare('SELECT * FROM matches ORDER BY date ASC');
  return stmt.all().map(row => ({
    id: row.id,
    homeTeam: row.home_team,
    awayTeam: row.away_team,
    date: row.date,
    time: row.time,
    venue: row.venue,
    status: row.status,
    homeScore: row.home_score,
    awayScore: row.away_score,
    matchday: row.matchday,
    homeLogo: row.home_logo,
    awayLogo: row.away_logo,
    savedAt: row.saved_at
  }));
}

async function saveMatch(item) {
  const record = {
    id: item.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    homeTeam: item.homeTeam || 'Doma United FC',
    awayTeam: item.awayTeam || '',
    date: item.date || new Date().toISOString().split('T')[0],
    time: item.time || '',
    venue: item.venue || '',
    status: item.status || 'Upcoming',
    homeScore: item.homeScore !== undefined && item.homeScore !== null ? String(item.homeScore) : '',
    awayScore: item.awayScore !== undefined && item.awayScore !== null ? String(item.awayScore) : '',
    matchday: item.matchday || '',
    homeLogo: item.homeLogo || '',
    awayLogo: item.awayLogo || '',
    savedAt: item.savedAt || new Date().toISOString()
  };

  if (supabase) {
    const { error } = await supabase.from('matches').upsert({
      id: record.id,
      home_team: record.homeTeam,
      away_team: record.awayTeam,
      date: record.date,
      time: record.time,
      venue: record.venue,
      status: record.status,
      home_score: record.homeScore,
      away_score: record.awayScore,
      matchday: record.matchday,
      home_logo: record.homeLogo,
      away_logo: record.awayLogo,
      saved_at: record.savedAt
    });
    throwSupabaseError('matches write', error);
  }

  const stmt = localDb.prepare(`
    INSERT INTO matches (
      id, home_team, away_team, date, time, venue, status,
      home_score, away_score, matchday, home_logo, away_logo, saved_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      home_team = excluded.home_team,
      away_team = excluded.away_team,
      date = excluded.date,
      time = excluded.time,
      venue = excluded.venue,
      status = excluded.status,
      home_score = excluded.home_score,
      away_score = excluded.away_score,
      matchday = excluded.matchday,
      home_logo = excluded.home_logo,
      away_logo = excluded.away_logo,
      saved_at = excluded.saved_at
  `);

  stmt.run(
    record.id,
    record.homeTeam,
    record.awayTeam,
    record.date,
    record.time,
    record.venue,
    record.status,
    record.homeScore,
    record.awayScore,
    record.matchday,
    record.homeLogo,
    record.awayLogo,
    record.savedAt
  );

  return record;
}

async function deleteMatch(id) {
  if (supabase) {
    const { error } = await supabase.from('matches').delete().eq('id', id);
    throwSupabaseError('matches delete', error);
  }
  const stmt = localDb.prepare('DELETE FROM matches WHERE id = ?');
  stmt.run(id);
  return { success: true };
}

// ============================================================================
// LIVE STREAMS API
// ============================================================================

function mapLiveStream(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    provider: row.provider || 'youtube',
    liveProvider: row.live_provider || 'api-football',
    fixtureId: row.fixture_id || '',
    published: row.published !== 0,
    homeTeam: row.home_team || '',
    awayTeam: row.away_team || '',
    matchDate: row.match_date || '',
    matchTime: row.match_time || '',
    eventName: row.event_name || row.eventName || '',
    teams: row.teams || '',
    competition: row.competition || '',
    streamUrl: row.stream_url || row.streamUrl || '',
    thumbnailUrl: row.thumbnail_url || row.thumbnailUrl || '',
    scheduledStart: row.scheduled_start || row.scheduledStart || '',
    status: ['live', 'upcoming', 'offline'].includes(String(row.status || '').toLowerCase()) ? String(row.status).toLowerCase() : 'offline',
    createdAt: row.created_at || row.createdAt,
    updatedAt: row.updated_at || row.updatedAt,
  };
}

async function getLiveStreams() {
  if (supabase) {
    const { data, error } = await supabase
      .from('live_streams')
      .select('*')
      .order('scheduled_start', { ascending: true, nullsFirst: false });
    throwSupabaseError('live streams read', error);
    return Array.isArray(data) ? data.map(mapLiveStream) : [];
  }

  return localDb.prepare('SELECT * FROM live_streams ORDER BY scheduled_start ASC').all().map(mapLiveStream);
}

async function saveLiveStream(item) {
  const now = new Date().toISOString();
  const record = {
    id: item.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: String(item.title || 'Doma United FC live stream').trim(),
    description: String(item.description || '').trim(),
    provider: String(item.provider || 'youtube').trim().toLowerCase(),
    liveProvider: String(item.liveProvider || 'api-football').trim().toLowerCase(),
    fixtureId: String(item.fixtureId || '').trim(),
    published: item.published === false || String(item.published).toLowerCase() === 'false' ? 0 : 1,
    homeTeam: String(item.homeTeam || '').trim(),
    awayTeam: String(item.awayTeam || '').trim(),
    matchDate: String(item.matchDate || '').trim(),
    matchTime: String(item.matchTime || '').trim(),
    eventName: String(item.eventName || '').trim(),
    teams: String(item.teams || '').trim(),
    competition: String(item.competition || '').trim(),
    streamUrl: String(item.streamUrl || '').trim(),
    thumbnailUrl: String(item.thumbnailUrl || '').trim(),
    scheduledStart: String(item.scheduledStart || '').trim(),
    status: ['live', 'upcoming', 'offline'].includes(String(item.status || '').toLowerCase()) ? String(item.status).toLowerCase() : 'offline',
    createdAt: item.createdAt || now,
    updatedAt: now,
  };

  if (!record.streamUrl) throw new Error('A stream URL is required.');

  if (supabase) {
    if (record.status === 'live') {
      const { error: deactivateError } = await supabase.from('live_streams').update({ status: 'offline', updated_at: now }).eq('status', 'live').neq('id', record.id);
      throwSupabaseError('live stream activation', deactivateError);
    }
    const { error } = await supabase.from('live_streams').upsert({
      id: record.id,
      title: record.title,
      description: record.description,
      provider: record.provider,
      live_provider: record.liveProvider,
      fixture_id: record.fixtureId || null,
      published: record.published,
      home_team: record.homeTeam,
      away_team: record.awayTeam,
      match_date: record.matchDate || null,
      match_time: record.matchTime || null,
      event_name: record.eventName,
      teams: record.teams,
      competition: record.competition,
      stream_url: record.streamUrl,
      thumbnail_url: record.thumbnailUrl,
      scheduled_start: record.scheduledStart || null,
      status: record.status,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
    });
    throwSupabaseError('live stream write', error);
  }

  if (record.status === 'live') {
    localDb.prepare('UPDATE live_streams SET status = ?, updated_at = ? WHERE status = ? AND id <> ?').run('offline', now, 'live', record.id);
  }

  localDb.prepare(`
    INSERT INTO live_streams (id, title, description, provider, live_provider, fixture_id, published, home_team, away_team, match_date, match_time, event_name, teams, competition, stream_url, thumbnail_url, scheduled_start, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title, description = excluded.description, provider = excluded.provider,
      live_provider = excluded.live_provider, fixture_id = excluded.fixture_id, published = excluded.published,
      home_team = excluded.home_team, away_team = excluded.away_team, match_date = excluded.match_date,
      match_time = excluded.match_time, event_name = excluded.event_name,
      teams = excluded.teams, competition = excluded.competition, stream_url = excluded.stream_url,
      thumbnail_url = excluded.thumbnail_url, scheduled_start = excluded.scheduled_start,
      status = excluded.status, updated_at = excluded.updated_at
  `).run(record.id, record.title, record.description, record.provider, record.homeTeam, record.awayTeam,
    record.matchDate, record.matchTime, record.eventName, record.teams, record.competition, record.streamUrl,
    record.thumbnailUrl, record.scheduledStart, record.status, record.createdAt, record.updatedAt);

  return record;
}

async function deleteLiveStream(id) {
  if (supabase) {
    const { error } = await supabase.from('live_streams').delete().eq('id', id);
    throwSupabaseError('live stream delete', error);
  }
  localDb.prepare('DELETE FROM live_streams WHERE id = ?').run(id);
  return { success: true };
}

module.exports = {
  isSupabaseConfigured: () => Boolean(supabase),
  uploadStorageFile,
  deleteStorageFile,
  getNews,
  saveNews,
  deleteNews,
  getGallery,
  saveGallery,
  deleteGallery,
  getPlayers,
  savePlayer,
  deletePlayer,
  getMatches,
  saveMatch,
  deleteMatch
  ,getLiveStreams,
  saveLiveStream,
  deleteLiveStream
};
