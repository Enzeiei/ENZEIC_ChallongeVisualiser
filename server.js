#!/usr/bin/env node
/**
 * Live match scoreboard server.
 * ---
 * - Polls the Challonge API server-side (respects your rate limit —
 *   NOT called directly from the browser).
 * - Merges matches + participants + stations into one clean payload.
 * - Serves a static scoreboard page that reads from our own cache.
 * - Exposes controls to turn auto-polling off/on and to trigger a
 *   single manual poll on demand.
 *
 * Setup:
 *   1. npm install
 *   2. Copy .env.example to .env and fill in CHALLONGE_API_KEY and
 *      CHALLONGE_TOURNAMENT_ID
 *   3. node server.js
 *   4. Open http://localhost:3000
 *      (or whatever localhost you change it to thereafter) 
*/

require('dotenv').config();
const path = require('path');
const express = require('express');
const { listMatches, listAllParticipants, listStations } = require('./lib/challonge-client');

const PORT = process.env.PORT || 3000;
const TOURNAMENT_ID = process.env.CHALLONGE_TOURNAMENT_ID;
const DEFAULT_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS) || 20000;
const MIN_INTERVAL_MS = 5000; // guardrail so the toggle UI can't spam the API/rate limit

if (!TOURNAMENT_ID) {
  console.error('Missing CHALLONGE_TOURNAMENT_ID in .env — set it to the tournament you want to display.');
  process.exit(1);
}

// ---
// In-memory state: this is what the frontend reads from
// ---
const state = {
  autoPollEnabled: true,
  intervalMs: DEFAULT_INTERVAL_MS,
  lastPolledAt: null,
  lastError: null,
  isPolling: false,
  matches: [],
};

let timer = null;

// ---
// Poll + merge logic
// ---
async function pollChallonge() {
  state.isPolling = true;
  try {
    const [openRes, pendingRes, participantsRes, stationsRes] = await Promise.all([
      listMatches(TOURNAMENT_ID, 'open'),
      listMatches(TOURNAMENT_ID, 'pending'),
      // listMatches(TOURNAMENT_ID, 'complete'),
      listAllParticipants(TOURNAMENT_ID),
      listStations(TOURNAMENT_ID).catch(() => ({ data: [] })),
    ]);

    const matchesData = [...(openRes.data || []), ...(pendingRes.data || [])];

    const participantsById = {};
    for (const p of participantsRes.data || []) {
      participantsById[p.id] = p.attributes?.name || `Participant ${p.id}`;
    } // name yoink?

    const stationsById = {};
    for (const s of stationsRes.data || []) {
      stationsById[s.id] = s.attributes?.identifier || s.attributes?.number || `Station ${s.id}`;
    }

    const merged = matchesData.map(m => {
      const a = m.attributes || {};
      const player1Id = m.relationships?.player1?.data?.id;   // fixed: read from the match resource itself
      const player2Id = m.relationships?.player2?.data?.id;
      const stationId = m.relationships?.station?.data?.id;
      
      // If we have an ID but it's still not in the participants map after
      // pagination, dump the raw match + known IDs so the mismatch is visible.
      const unresolved =
        (player1Id && !(player1Id in participantsById)) ||
        (player2Id && !(player2Id in participantsById));
      if (unresolved && !loggedUnresolvedSample) {
        loggedUnresolvedSample = true;
        console.warn('--- Unresolved participant ID(s) — raw match for inspection ---');
        console.warn(JSON.stringify(m, null, 2));
        console.warn('Known participant IDs (sample):', Object.keys(participantsById).slice(0, 10));
      }

      return {
        id: m.id,
        round: a.round,
        identifier: a.identifier,
        state: a.state,
        scores: a.scores || null,
        player1: {
          id: player1Id || null,
          name: player1Id ? (participantsById[player1Id] || `Player ${player1Id}`) : 'TBD',
        },
        player2: {
          id: player2Id || null,
          name: player2Id ? (participantsById[player2Id] || `Player ${player2Id}`) : 'TBD',
        },
        station: stationId ? (stationsById[stationId] || null) : null,
        updatedAt: a.timestamps?.updated_at || null,
      };
    });

    state.matches = merged;
    state.lastError = null;
    state.lastPolledAt = new Date().toISOString();
  } catch (err) {
    state.lastError = err.message;
    console.error('Poll failed:', err.message);
  } finally {
    state.isPolling = false;
  }
  return state;
}

// ---
// Auto-poll timer control
// ---
function startAutoPoll() {
  stopAutoPoll();
  state.autoPollEnabled = true;
  timer = setInterval(pollChallonge, state.intervalMs);
  console.log(`Auto-poll ON (every ${state.intervalMs / 1000}s)`);
}

function stopAutoPoll() {
  if (timer) clearInterval(timer);
  timer = null;
  state.autoPollEnabled = false;
}

// ---
// HTTP API
// ---
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Current cached data — this is what the scoreboard page polls (cheap, local, no Challonge call)
app.get('/api/matches', (req, res) => {
  res.json({
    matches: state.matches,
    lastPolledAt: state.lastPolledAt,
    lastError: state.lastError,
    isPolling: state.isPolling,
    autoPollEnabled: state.autoPollEnabled,
    intervalMs: state.intervalMs,
  });
});

// instant manual poll, regardless of auto-poll setting
app.post('/api/poll', async (req, res) => {
  await pollChallonge();
  res.json({
    matches: state.matches,
    lastPolledAt: state.lastPolledAt,
    lastError: state.lastError,
    autoPollEnabled: state.autoPollEnabled,
    intervalMs: state.intervalMs,
  });
});

// Turn auto-polling on/off, and optionally change the interval
app.post('/api/settings', (req, res) => {
  const { autoPollEnabled, intervalMs } = req.body || {};

  if (typeof intervalMs === 'number') {
    state.intervalMs = Math.max(MIN_INTERVAL_MS, intervalMs);
  }

  if (autoPollEnabled === true) {
    startAutoPoll();
  } else if (autoPollEnabled === false) {
    stopAutoPoll();
    console.log('Auto-poll OFF — use "Poll now" or POST /api/poll to refresh manually.');
  } else if (typeof intervalMs === 'number' && state.autoPollEnabled) {
    // interval changed while running — restart with new interval
    startAutoPoll();
  }

  res.json({ autoPollEnabled: state.autoPollEnabled, intervalMs: state.intervalMs });
});

app.get('/api/settings', (req, res) => {
  res.json({ autoPollEnabled: state.autoPollEnabled, intervalMs: state.intervalMs });
});

app.listen(PORT, async () => {
  console.log(`Scoreboard server running at http://localhost:${PORT}`);
  await pollChallonge(); // fetch once immediately on boot
  startAutoPoll();
});

process.on('SIGINT', () => {
  stopAutoPoll();
  process.exit(0);
});
