const axios = require('axios');

const API_BASE_URL = 'https://v3.football.api-sports.io';
const cache = new Map();
const LIVE_CACHE_MS = 15000;
const OTHER_CACHE_MS = 60000;

function providerError(response) {
  const message = response?.errors && Object.values(response.errors)[0];
  return message || 'Live football provider request failed.';
}

async function request(endpoint, fixtureId) {
  const apiKey = process.env.LIVE_FOOTBALL_API_KEY;
  if (!apiKey) {
    const error = new Error('Live football data is not configured. Add LIVE_FOOTBALL_API_KEY.');
    error.code = 'LIVE_PROVIDER_NOT_CONFIGURED';
    throw error;
  }

  const response = await axios.get(`${API_BASE_URL}/${endpoint}`, {
    headers: { 'x-apisports-key': apiKey },
    params: { fixture: fixtureId },
    timeout: 10000,
  });
  if (response.data?.errors && Object.keys(response.data.errors).length) throw new Error(providerError(response.data));
  return response.data?.response || [];
}

async function cached(endpoint, fixtureId, live) {
  const key = `${endpoint}:${fixtureId}`;
  const now = Date.now();
  const previous = cache.get(key);
  const ttl = live ? LIVE_CACHE_MS : OTHER_CACHE_MS;
  if (previous && now - previous.timestamp < ttl) return previous.value;
  const value = await request(endpoint, fixtureId);
  cache.set(key, { timestamp: now, value });
  return value;
}

function eventMinute(event) {
  if (!event?.time?.elapsed) return null;
  return event.time.extra ? `${event.time.elapsed}+${event.time.extra}'` : `${event.time.elapsed}'`;
}

function mapEvents(events) {
  return events.map(event => ({
    minute: eventMinute(event),
    type: event.type || '',
    detail: event.detail || '',
    player: event.player?.name || '',
    assist: event.assist?.name || '',
    team: event.team?.name || '',
  }));
}

function mapLineup(lineup) {
  return {
    team: lineup.team?.name || '',
    logo: lineup.team?.logo || '',
    formation: lineup.formation || '',
    startingXI: (lineup.startXI || []).map(entry => ({
      name: entry.player?.name || '', number: entry.player?.number ?? '', position: entry.player?.pos || '',
    })),
    substitutes: (lineup.substitutes || []).map(entry => ({
      name: entry.player?.name || '', number: entry.player?.number ?? '', position: entry.player?.pos || '',
    })),
  };
}

function mapStats(statistics) {
  return statistics.map(teamStats => ({
    team: teamStats.team?.name || '',
    logo: teamStats.team?.logo || '',
    values: (teamStats.statistics || []).filter(item => item.value !== null && item.value !== '').map(item => ({ type: item.type, value: item.value })),
  }));
}

async function getFixture(fixtureId) {
  const [fixtureRows, events, lineups, statistics] = await Promise.all([
    cached('fixtures', fixtureId, true),
    cached('fixtures/events', fixtureId, true),
    cached('fixtures/lineups', fixtureId, false),
    cached('fixtures/statistics', fixtureId, false),
  ]);
  const fixture = fixtureRows[0];
  if (!fixture) {
    const error = new Error('The football provider has no fixture for this ID.');
    error.code = 'LIVE_FIXTURE_NOT_FOUND';
    throw error;
  }

  const status = fixture.fixture?.status || {};
  return {
    provider: 'api-football',
    fixtureId: String(fixture.fixture?.id || fixtureId),
    match: {
      homeTeam: fixture.teams?.home?.name || '', awayTeam: fixture.teams?.away?.name || '',
      homeLogo: fixture.teams?.home?.logo || '', awayLogo: fixture.teams?.away?.logo || '',
      homeScore: fixture.goals?.home, awayScore: fixture.goals?.away,
      status: status.short || '', statusLong: status.long || '', elapsed: status.elapsed ?? null, extra: status.extra ?? null,
      venue: fixture.fixture?.venue?.name || '', city: fixture.fixture?.venue?.city || '',
      referee: fixture.fixture?.referee || '', date: fixture.fixture?.date || '',
    },
    events: mapEvents(events),
    lineups: lineups.map(mapLineup),
    statistics: mapStats(statistics),
    fetchedAt: new Date().toISOString(),
  };
}

async function getLiveFixture(fixtureId) {
  return getFixture(String(fixtureId).trim());
}

module.exports = { getLiveFixture };
