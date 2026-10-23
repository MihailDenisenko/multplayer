const assert = require('node:assert/strict');
const { loadEnvConfig } = require('@next/env');
const { Client } = require('pg');
loadEnvConfig(process.cwd());
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
async function request(path, body, token) {
  const response = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.equal(response.status, 200, `${path}: ${(await response.clone().text()).slice(0, 200)}`);
  return response.json();
}
async function checkGame(direction) {
  let code;
  try {
    assert.equal((await request('/api/health')).ok, true);
    const host = await request('/api/rooms', { name: 'Smoke host', folds: 13, direction });
    code = host.roomCode;
    const players = [host];
    for (let i = 1; i < 3; i++) players.push(await request('/api/rooms/join', { code, name: `Smoke ${i}` }));
    const statePath = p => `/api/rooms/${code}/state?token=${encodeURIComponent(p.token)}`;
    assert.equal((await request(statePath(host))).players.length, 3);
    await request(`/api/rooms/${code}/start`, {}, host.token);
    const invalid = await fetch(`${base}/api/rooms/${code}/submit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${host.token}` },
      body: JSON.stringify({ sheetId: (await request(statePath(host))).mySheet.sheetId }),
    });
    assert.equal(invalid.status, 400, 'Invalid submissions must not use a fold');
    assert.equal((await request(statePath(host))).room.foldsDone, 0);
    let accepted = 0;
    const bySheet = new Map();
    for (let turn = 0; turn < 100 && accepted < 36; turn++) {
      for (const player of players) {
        const state = await request(statePath(player));
        assert.equal(state.room.foldsDone, accepted);
        assert.equal(state.finished, false);
        if (state.mySheet && state.mySheet.foldsDone < 12) {
          const sheet = state.mySheet;
          assert.equal(sheet.foldsDone, bySheet.get(sheet.sheetId) || 0);
          assert.equal(sheet.progress.target, 13);
          const response = await request(`/api/rooms/${code}/submit`, {
            sheetId: sheet.sheetId, questionText: 'Where?', keyword: 'where', answerText: 'Here.',
          }, player.token);
          bySheet.set(sheet.sheetId, sheet.foldsDone + 1);
          accepted++;
          assert.equal(response.state.room.foldsDone, accepted);
          assert.equal(response.state.finished, false, 'Finishing requires all sheets, not 13 submissions total');
        }
      }
    }
    assert.equal(accepted, 36, '3 sheets must each receive 12 folds');
    const candidates = [];
    for (const player of players) {
      const state = await request(statePath(player));
      assert.equal(state.mySheet.foldsDone, 12);
      assert.equal(state.mySheet.stage, 'final_answer');
      candidates.push({ player, sheet: state.mySheet });
    }
    assert.equal(new Set(candidates.map(c=>c.sheet.sheetId)).size, 3);
    const first = candidates.shift();
    const firstFinish = await request(`/api/rooms/${code}/submit`, { sheetId: first.sheet.sheetId, answerText: 'The end.' }, first.player.token);
    assert.equal(firstFinish.state.finished, false, 'Other sheets still need their final fold');
    assert.equal(firstFinish.state.sheetsProgress.finished, 1);
    const contenders = [...candidates, candidates[0]];
    const lastResponses = await Promise.all(contenders.map(({ player, sheet }) => fetch(`${base}/api/rooms/${code}/submit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${player.token}` },
      body: JSON.stringify({ sheetId: sheet.sheetId, answerText: 'The end.' }),
    })));
    assert.equal(lastResponses.filter(r=>r.status === 200).length, 2, 'Distinct final sheets may both finish');
    assert.equal(lastResponses.filter(r=>r.status === 403 || r.status === 409).length, 1, 'Duplicate fold must be rejected');
    for (const player of players) {
      const finalState = await request(statePath(player));
      assert.equal(finalState.room.foldsDone, 39);
      assert.equal(finalState.finished, true);
      assert.equal(finalState.mySheet, null);
      assert.deepEqual(finalState.sheetsProgress, { finished: 3, total: 3 });
    }
    const results = await request(`/api/rooms/${code}/results?token=${encodeURIComponent(host.token)}`);
    assert.equal(results.sheets.length, 3);
    assert.ok(results.sheets.every(s => s.entries.length === 24));
    console.log(`PASS ${direction}: 13 folds per sheet (39 total), independent sheet completion, concurrent finals and duplicate protection`);
  } finally {
    if (code) {
      const db = new Client({ connectionString: process.env.DATABASE_URL });
      await db.connect();
      try { await db.query('DELETE FROM rooms WHERE code = $1', [code]); }
      finally { await db.end(); }
    }
  }
}
async function main() {
  await checkGame('cw');
  await checkGame('ccw');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
