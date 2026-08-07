/**
 * Shared Challonge API v2.1 client.
 * Used by both challonge.js (CLI) and server.js (live scoreboard).
 */

const fetch = require('node-fetch');

const BASE_URL = 'https://api.challonge.com/v2.1';

function authHeaders() {
  // Option 1: API v1 key (default — good for your own tournaments)
  if (process.env.CHALLONGE_API_KEY) {
    return {
      'Authorization-Type': 'v1',
      'Authorization': process.env.CHALLONGE_API_KEY,
    };
  }

  // Option 2: OAuth bearer token (acting on behalf of another user)
  if (process.env.CHALLONGE_OAUTH_TOKEN) {
    return {
      'Authorization-Type': 'v2',
      'Authorization': `Bearer ${process.env.CHALLONGE_OAUTH_TOKEN}`,
    };
  }

  throw new Error(
    'No credentials found. Set CHALLONGE_API_KEY or CHALLONGE_OAUTH_TOKEN in your .env file.'
  );
}

async function challongeRequest(method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/vnd.api+json',
      'Accept': 'application/json',
      ...authHeaders(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    // JSON:API error shape: { errors: [{ title, detail, status, ... }] }
    const detail = json.errors?.map(e => e.detail || e.title).join('; ') || res.statusText;
    const err = new Error(`Challonge API error ${res.status}: ${detail}`);
    err.status = res.status;
    throw err;
  }

  return json;
}

// ---------------------------------------------------------------
// Resource helpers
// ---------------------------------------------------------------

function listTournaments() {
  return challongeRequest('GET', '/tournaments.json');
}

function createTournament(name) {
  const body = {
    data: {
      type: 'tournaments',
      attributes: { name, tournament_type: 'single elimination', private: false },
    },
  };
  return challongeRequest('POST', '/tournaments.json', body);
}

/**
 * List matches for a tournament.
 * @param {string} tournamentId
 * @param {string} [state] - e.g. 'open', 'underway', 'complete', 'pending'
 */
function listMatches(tournamentId, state) {
  const qs = state ? `?state=${encodeURIComponent(state)}` : '';
  return challongeRequest('GET', `/tournaments/${tournamentId}/matches.json${qs}`);
}

function listParticipants(tournamentId) {
  return challongeRequest('GET', `/tournaments/${tournamentId}/participants.json`);
}

/* Yaow!
 * Fetch every page of participants (List Participants may paginate on
 * large brackets — see per_page in the docs). Returns the same shape as
 * a single-page response: { data: [...] }.
 */
async function listAllParticipants(tournamentId) {
  const all = [];
  let page = 1;
  const perPage = 100;
  // Loop until a page comes back with fewer than perPage entries.
  while (true) {
    const res = await challongeRequest(
      'GET',
      `/tournaments/${tournamentId}/participants.json?page=${page}&per_page=${perPage}`
    );
    const pageData = res.data || [];
    all.push(...pageData);
    if (pageData.length < perPage) break;
    page += 1;
  }
  return { data: all };
}


function listStations(tournamentId) {
  return challongeRequest('GET', `/tournaments/${tournamentId}/stations.json`);
}

module.exports = {
  BASE_URL,
  challongeRequest,
  listTournaments,
  createTournament,
  listMatches,
  listParticipants,
  listAllParticipants,
  listStations,
};
