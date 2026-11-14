// Lazzaa server: Express serves the game files, "ws" keeps the rooms.
// Nothing is stored: rooms live in memory and disappear when they are closed or the server restarts.
// The room creator's browser runs the round; this server only keeps the room list and passes messages along.
const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const ALLOWED = (process.env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);   // empty = any site may connect
const MAX_ROOMS = +process.env.MAX_ROOMS || 40;
const MAX_PLAYERS = 12;
const GRACE_MS = 30000;            // how long a dropped player (page reload, short network cut) keeps their place
const LIM = { ch: [3, 6], ru: [10, 14] };
const LEVELS = ['easy', 'normal', 'hard', 'intelligent'];

const app = express();
app.get('/health', (req, res) => res.json({ ok: true, rooms: rooms.size, players: [...rooms.values()].reduce((n, r) => n + r.players.length, 0) }));
app.use(express.static(path.join(__dirname, 'public'), { setHeaders: res => res.setHeader('Cache-Control', 'no-cache') }));
const server = http.createServer(app);

const rooms = new Map();
const clamp = (v, a, b) => Math.max(a, Math.min(b, Math.round(+v) || a));
const rid = n => { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < n; i++) s += A[Math.floor(Math.random() * A.length)]; return s; };
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
const send = (ws, o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };

function view(room) {
  return {
    code: room.code, host: room.host, ch: room.ch, ru: room.ru, level: room.level, mode: room.mode, playing: room.playing, max: MAX_PLAYERS,
    players: room.players.map(p => ({ id: p.id, name: p.name, color: p.color, hat: p.hat, role: room.mode === 'random' ? null : p.role, on: !!p.ws, ready: p.ready }))
  };
}
function tell(room) { for (const p of room.players) send(p.ws, { t: 'room', room: view(room), you: p.id }); }
function closeRoom(room, why) {
  for (const p of room.players) { clearTimeout(p.timer); send(p.ws, { t: 'closed', why }); if (p.ws) p.ws.player = null; }
  rooms.delete(room.code);
}
function removePlayer(room, p) {
  clearTimeout(p.timer);
  const i = room.players.indexOf(p); if (i >= 0) room.players.splice(i, 1);
  if (p.ws) { p.ws.player = null; p.ws.room = null; }
  if (room.game.has(p.id)) { room.game.delete(p.id); const h = room.players.find(q => q.id === room.host); if (h) send(h.ws, { t: 'gone', id: p.id }); }
  if (!room.players.length) { rooms.delete(room.code); return; }
  if (p.id === room.host) { closeRoom(room, 'The host left, so the room was closed.'); return; }
  tell(room);
}
function attach(ws, room, p) {
  if (p.ws && p.ws !== ws) { p.ws.player = null; p.ws.room = null; try { p.ws.close(); } catch (e) { } }
  clearTimeout(p.timer); p.ws = ws; p.ready = true; ws.player = p; ws.room = room;
  if (room.game.has(p.id)) {                       // came back to the room screen while the round is still running
    room.game.delete(p.id);
    if (p.id === room.host) stopRound(room, 'The host left the round, so it was stopped.');
    else { const h = room.players.find(q => q.id === room.host); if (h) send(h.ws, { t: 'gone', id: p.id }); }
  }
  send(ws, { t: 'joined', code: room.code, key: p.key, you: p.id });
  tell(room);
}
function stopRound(room, why) {
  if (!room.playing) return; room.playing = false;
  for (const p of room.players) if (room.game.has(p.id) && p.id !== room.host) send(p.ws, { t: 'abort', why });
}
function startRound(room) {
  const ready = room.players.filter(p => p.ws && p.ready);
  let humans;
  if (room.mode === 'random') {                    // deal the seats blindly: nobody knows who is what until the round begins
    const seats = []; for (let i = 0; i < room.ch; i++) seats.push('chaser'); for (let i = 0; i < room.ru; i++) seats.push('runner');
    for (let i = seats.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [seats[i], seats[j]] = [seats[j], seats[i]]; }
    humans = ready.map((p, i) => ({ p, role: seats[i] }));
  } else {
    let c = 0, r = 0;
    humans = ready.map(p => {
      let role = p.role === 'chaser' ? 'chaser' : 'runner';
      if (role === 'chaser' && c >= room.ch) role = 'runner'; if (role === 'runner' && r >= room.ru) role = 'chaser';
      if (role === 'chaser') c++; else r++;
      return { p, role };
    });
  }
  room.playing = true; room.game = new Set(humans.map(h => h.p.id));
  const list = humans.map(h => ({ id: h.p.id, name: h.p.name, color: h.p.color, hat: h.p.hat, role: h.role }));
  const seed = Math.floor(Math.random() * 2 ** 31);
  for (const h of humans) { h.p.ready = false; send(h.p.ws, { t: 'start', seed, ch: room.ch, ru: room.ru, level: room.level, humans: list, you: h.p.id, host: h.p.id === room.host }); }
  tell(room);
}

function onMessage(ws, m) {
  let room = ws.room, p = ws.player;
  if (m.t === 'create' || m.t === 'join') {
    if (p) return;
    const me = { name: clean(m.name, 12) || 'Player', color: (m.color >>> 0) & 0xffffff, hat: clean(m.hat, 10) || 'none' };
    if (m.t === 'create') {
      if (rooms.size >= MAX_ROOMS) return send(ws, { t: 'err', msg: 'The server is full right now. Try again in a few minutes.' });
      let code; do code = rid(5); while (rooms.has(code));
      room = { code, host: null, ch: 3, ru: 10, level: 'normal', mode: 'choose', playing: false, players: [], game: new Set() };
      rooms.set(code, room);
    } else {
      room = rooms.get(clean(m.code, 8).toUpperCase());
      if (!room) return send(ws, { t: 'err', msg: 'No room with that code. Check the code, or the room was closed.', gone: true });
      const old = m.key && room.players.find(q => q.key === m.key);
      if (old) { Object.assign(old, me); return attach(ws, room, old); }
      if (room.players.length >= MAX_PLAYERS) return send(ws, { t: 'err', msg: 'That room is full (12 players).' });
    }
    p = { id: rid(6), key: rid(20), role: 'runner', ws: null, ready: true, timer: null, ...me };
    room.players.push(p); if (!room.host) room.host = p.id;
    return attach(ws, room, p);
  }
  if (!room || !p || !rooms.has(room.code)) return;
  const host = p.id === room.host;
  if (m.t === 'role') { if (m.role === 'runner' || m.role === 'chaser') { p.role = m.role; tell(room); } }
  else if (m.t === 'set' && host && !room.playing) {
    if (m.ch !== undefined) room.ch = clamp(m.ch, LIM.ch[0], LIM.ch[1]);
    if (m.ru !== undefined) room.ru = clamp(m.ru, LIM.ru[0], LIM.ru[1]);
    if (LEVELS.includes(m.level)) room.level = m.level;
    if (m.mode === 'random' || m.mode === 'choose') room.mode = m.mode;
    tell(room);
  }
  else if (m.t === 'start' && host && !room.playing) startRound(room);
  else if (m.t === 'over' && host) { room.playing = false; tell(room); }
  else if (m.t === 'close' && host) closeRoom(room, 'The host closed the room.');
  else if (m.t === 'leave') removePlayer(room, p);
  else if (m.t === 'in' && !host && room.game.has(p.id)) {            // a player's controls -> the host
    const h = room.players.find(q => q.id === room.host);
    if (h) send(h.ws, { t: 'in', id: p.id, wx: +m.wx || 0, wz: +m.wz || 0, run: !!m.run, cy: +m.cy || 0, a: Array.isArray(m.a) ? m.a.slice(0, 8).map(x => clean(x, 12)) : [] });
  }
}

const wss = new WebSocketServer({
  server, path: '/ws', maxPayload: 512 * 1024,
  verifyClient: info => !ALLOWED.length || ALLOWED.includes(info.origin)
});
wss.on('connection', ws => {
  ws.alive = true; ws.on('pong', () => { ws.alive = true; });
  ws.on('message', (data, isBinary) => {
    const room = ws.room, p = ws.player;
    if (isBinary) {                                                    // the host's picture of the round -> everyone playing in it
      if (!room || !p || p.id !== room.host) return;
      for (const q of room.players) if (q !== p && q.ws && q.ws.readyState === 1 && room.game.has(q.id)) q.ws.send(data, { binary: true });
      return;
    }
    let m; try { m = JSON.parse(data.toString()); } catch (e) { return; }
    if (m && typeof m === 'object') { try { onMessage(ws, m); } catch (e) { console.error(e); } }
  });
  ws.on('close', () => {
    const room = ws.room, p = ws.player; if (!room || !p || p.ws !== ws) return;
    p.ws = null;
    if (room.game.has(p.id)) {
      if (p.id === room.host) { stopRound(room, 'The host lost the connection, so the round was stopped.'); room.game.clear(); }
      else { room.game.delete(p.id); const h = room.players.find(q => q.id === room.host); if (h) send(h.ws, { t: 'gone', id: p.id }); }
    }
    p.timer = setTimeout(() => { if (!p.ws && rooms.get(room.code) === room) removePlayer(room, p); }, GRACE_MS);
    tell(room);
  });
  ws.on('error', () => { });
});
setInterval(() => { for (const ws of wss.clients) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; try { ws.ping(); } catch (e) { } } }, 25000);

server.listen(PORT, '0.0.0.0', () => console.log('Lazzaa is running on port ' + PORT));
