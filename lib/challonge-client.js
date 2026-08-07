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
    const detail = extractErrorDetail(json) || res.statusText;
    const err = new Error(`Challonge API error ${res.status}: ${detail}`);
    err.status = res.status;
    err.body = json; // full raw body, in case the message alone isn't enough to debug
    throw err;
  }
 
  return json;
}
 
/**
 * Challonge error bodies aren't consistently shaped across every endpoint.
 * Known shapes seen so far:
 *   - JSON:API array:      { errors: [{ title, detail, status, ... }] }
 *   - Rails validation obj: { errors: { state: ["is not included in the list"], ... } }
 *   - Plain string:         { errors: "some message" }
 * This normalizes any of them into one readable string instead of assuming
 * .map() exists.
 */
function extractErrorDetail(json) {
  const errors = json?.errors;
  if (!errors) return null;
 
  if (Array.isArray(errors)) {
    // JSON:API shape
    return errors.map(e => (typeof e === 'string' ? e : e.detail || e.title || JSON.stringify(e))).join('; ');
  }
 
  if (typeof errors === 'string') {
    return errors;
  }
 
  if (typeof errors === 'object') {
    // Rails-style { field: [messages] } — flatten to "field: message" pairs
    return Object.entries(errors)
      .map(([field, messages]) => {
        const msgs = Array.isArray(messages) ? messages.join(', ') : String(messages);
        return `${field} ${msgs}`;
      })
      .join('; ');
  }
 
  return String(errors);
}

// ---------------------------------------------------------------
// Resource helpers
// ---------------------------------------------------------------

// underway bs
function changeMatchState(tournamentId, matchId, state) {
  const body = {
    data: {
      type: 'MatchState',
      attributes: { state },
    },
  };
  return challongeRequest(
    'PUT',
    `/tournaments/${tournamentId}/matches/${matchId}/change_state.json`,
    body
  );
}

function markMatchUnderway(tournamentId, matchId) {
  return changeMatchState(tournamentId, matchId, 'pending');
}

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
