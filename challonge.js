#!/usr/bin/env node
/**
 * Challonge API v2.1 CLI
 * -----------------------------------------------------------------
 * Commands:
 *   node challonge.js list
 *   node challonge.js create "Tournament Name"
 *   node challonge.js participants <tournamentId>
 *   node challonge.js matches <tournamentId> [state]
 *
 * Setup:
 *   1. npm install
 *   2. Get a v1 key at https://challonge.com/settings/developer
 *   3. Copy .env.example to a new file named .env and fill in CHALLONGE_API_KEY
 */

require('dotenv').config();

const {
  listTournaments,
  createTournament,
  listParticipants,
  listMatches,
} = require('./lib/challonge-client');

async function cmdList() {
  const result = await listTournaments();
  const tournaments = result.data || [];
  console.log(`Found ${tournaments.length} tournament(s):`);
  tournaments.forEach(t => {
    console.log(`  - ${t.attributes?.name} (id: ${t.id}, state: ${t.attributes?.state})`);
  });
}

async function cmdCreate(name) {
  const result = await createTournament(name);
  console.log('Created tournament:', result.data?.attributes?.name, `(id: ${result.data?.id})`);
}

async function cmdParticipants(tournamentId) {
  const result = await listParticipants(tournamentId);
  const participants = result.data || [];
  console.log(`Found ${participants.length} participant(s) in tournament ${tournamentId}`);
  participants.forEach(p => console.log(`  - ${p.attributes?.name} (id: ${p.id})`));
}

async function cmdMatches(tournamentId, state) {
  const result = await listMatches(tournamentId, state);
  const matches = result.data || [];
  console.log(`Found ${matches.length} match(es)${state ? ` with state="${state}"` : ''}:`);
  matches.forEach(m => {
    const a = m.attributes || {};
    console.log(`  - Match ${m.id}: round ${a.round}, state=${a.state}, scores=${a.scores || 'n/a'}`);
  });
}

async function main() {
  const [, , command, ...args] = process.argv;

  try {
    switch (command) {
      case 'list':
        await cmdList();
        break;
      case 'create':
        if (!args[0]) throw new Error('Usage: node challonge.js create "Tournament Name"');
        await cmdCreate(args[0]);
        break;
      case 'participants':
        if (!args[0]) throw new Error('Usage: node challonge.js participants <tournamentId>');
        await cmdParticipants(args[0]);
        break;
      case 'matches':
        if (!args[0]) throw new Error('Usage: node challonge.js matches <tournamentId> [state]');
        await cmdMatches(args[0], args[1]);
        break;
      default:
        console.log('Usage:');
        console.log('  node challonge.js list');
        console.log('  node challonge.js create "Tournament Name"');
        console.log('  node challonge.js participants <tournamentId>');
        console.log('  node challonge.js matches <tournamentId> [state]');
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
