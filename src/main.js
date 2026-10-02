import { Game, TEAM_COLORS, QUALITY, DRAW_DISTANCE } from './game.js';
import { Sound } from './audio.js';
import { Net, randomCode, normalizeCode, LOST } from './net.js';
import { every } from './ticker.js';
import { HostMatch, makeBots, STATE_RATE, RELAY_STATE_RATE } from './match.js';
import { MAPS, MAP_IDS } from './map.js';
import { esc } from './hud.js';
import { STYLE, STYLES, DEFAULT_STYLE } from './style-mc.js';

const COLORS = ['#ff8a1f', '#e0493d', '#3d82e0', '#46d17a', '#b45de0', '#f2c230', '#29c7c7', '#e05da8', '#9aa3ad'];
const PREFS_KEY = 'gunarena-prefs';
const DEFAULT_PREFS = {
  name: '', color: COLORS[0], sensitivity: 1, adsSens: 1, invertY: false, aimMode: 'hold', crouchMode: 'hold', sprintMode: 'hold',
  style: DEFAULT_STYLE, fov: 78, quality: 'medium', renderScale: 100, drawDist: 'mid', viewBob: true, screenShake: true, showFps: false,
  volume: 0.7, fxVolume: 1, uiVolume: 1,
};
const INPUT_MODES = { hold: 'Удерживать', toggle: 'Переключать' };
const DEFAULT_ROOM = { map: MAP_IDS[0], mode: 'tdm', scoreLimit: 20, timeLimit: 10, maxPlayers: 4, bots: 0, botSkill: 'normal' };
const MODE_NAMES = { dm: 'Все против всех', tdm: 'Команда на команду' };
const SKILL_NAMES = { easy: 'Лёгкие', normal: 'Средние', hard: 'Сложные' };
const KEEP_PARAMS = ['peerHost', 'peerPort', 'peerPath', 'peerSecure', 'nolock'];
const HOST_TICK_MS = 16;
const NET_INFO_MS = 2000;

const $ = (id) => document.getElementById(id);

function loadPrefs() {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* приватный режим */ }
}

const prefs = loadPrefs();
if (!prefs.name) prefs.name = `Игрок${Math.floor(100 + Math.random() * 900)}`;

const sound = new Sound();
sound.setVolume(prefs.volume, prefs.fxVolume, prefs.uiVolume);
const game = new Game($('view'), sound, prefs);

const state = {
  net: null,
  host: false,
  online: false,
  code: '',
  localId: null,
  lobby: { players: [], settings: { ...DEFAULT_ROOM }, state: 'lobby' },
  match: null,
  mid: 0,
  lastEnd: null,
  stopHostLoop: null,
  stopNetInfo: null,
  netInfo: new Map(),
  inGame: false,
  loading: false,
  queue: [],
  ready: false,
  roomForm: { ...DEFAULT_ROOM },
  formMode: 'create',
  settingsBack: 'menu',
  chat: [],
};

// ——— экраны ———
const SCREENS = ['menu', 'create', 'join', 'lobby', 'settings', 'pause', 'results', 'loading'];
let current = 'menu';
function show(name) {
  current = name;
  for (const s of SCREENS) $(`screen-${s}`).classList.toggle('hidden', s !== name);
}
function hideScreens() {
  current = null;
  for (const s of SCREENS) $(`screen-${s}`).classList.add('hidden');
}

let noticeTimer = 0;
function notice(text) {
  const n = $('notice');
  n.textContent = text;
  n.classList.add('show');
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => n.classList.remove('show'), 3200);
}

function loading(text) {
  $('loading-text').textContent = text;
  show('loading');
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = document.createElement('textarea');
    t.value = text;
    document.body.appendChild(t);
    t.select();
    document.execCommand('copy');
    t.remove();
  }
}

function inviteLink(code) {
  const q = new URLSearchParams();
  const cur = new URLSearchParams(location.search);
  for (const k of KEEP_PARAMS) if (cur.has(k)) q.set(k, cur.get(k));
  q.set('room', code);
  return `${location.origin}${location.pathname}?${q}`;
}

document.addEventListener('pointerdown', () => sound.unlock(), { capture: true });
for (const b of document.querySelectorAll('[data-go]')) {
  b.addEventListener('click', () => {
    if (b.dataset.go === 'create') openRoomForm('create');
    else if (b.dataset.go === 'settings') openSettings('menu');
    else show(b.dataset.go);
  });
}

// ——— главное меню ———
const nick = $('nick');
nick.value = prefs.name;
nick.addEventListener('input', () => {
  prefs.name = nick.value.trim().slice(0, 16);
  savePrefs();
});
function currentName() {
  return (nick.value.trim() || prefs.name || 'Игрок').slice(0, 16);
}

function renderColors() {
  $('colors').innerHTML = COLORS.map((c) => `<button style="background:${c}" data-c="${c}" class="${c === prefs.color ? 'sel' : ''}" aria-label="цвет"></button>`).join('');
}
$('colors').addEventListener('click', (e) => {
  const c = e.target.dataset?.c;
  if (!c) return;
  prefs.color = c;
  savePrefs();
  renderColors();
});
renderColors();

$('btn-training').addEventListener('click', () => openRoomForm('training'));

// ——— форма комнаты ———
function segment(el, values, labels, value, onPick) {
  el.innerHTML = values.map((v, i) => `<button data-v="${v}" class="${String(v) === String(value) ? 'sel' : ''}">${labels ? labels[i] : v}</button>`).join('');
  el.onclick = (e) => {
    const v = e.target.dataset?.v;
    if (v === undefined) return;
    onPick(v);
  };
}

function renderRoomForm() {
  const f = state.roomForm;
  $('map-cards').innerHTML = Object.entries(MAPS).map(([id, m]) => `<button class="card ${id}${f.map === id ? ' sel' : ''}" data-map="${id}"><b>${m.name}</b><small>${m.desc}</small></button>`).join('');
  $('map-cards').onclick = (e) => {
    const c = e.target.closest('[data-map]');
    if (!c) return;
    f.map = c.dataset.map;
    renderRoomForm();
  };
  segment($('opt-mode'), ['dm', 'tdm'], [MODE_NAMES.dm, MODE_NAMES.tdm], f.mode, (v) => { f.mode = v; renderRoomForm(); });
  segment($('opt-score'), [10, 20, 30, 50], null, f.scoreLimit, (v) => { f.scoreLimit = Number(v); renderRoomForm(); });
  segment($('opt-time'), [5, 10, 15, 20], null, f.timeLimit, (v) => { f.timeLimit = Number(v); renderRoomForm(); });
  segment($('opt-max'), [2, 4, 6, 8], null, f.maxPlayers, (v) => { f.maxPlayers = Number(v); renderRoomForm(); });
  segment($('opt-skill'), ['easy', 'normal', 'hard'], [SKILL_NAMES.easy, SKILL_NAMES.normal, SKILL_NAMES.hard], f.botSkill, (v) => { f.botSkill = v; renderRoomForm(); });
  $('opt-bots').value = f.bots;
  $('bots-val').textContent = f.bots;
  $('opt-max').parentElement.classList.toggle('hidden', state.formMode === 'training');
}
$('opt-bots').addEventListener('input', (e) => {
  state.roomForm.bots = Number(e.target.value);
  $('bots-val').textContent = state.roomForm.bots;
});

function openRoomForm(mode) {
  state.formMode = mode;
  if (mode === 'edit') state.roomForm = { ...state.lobby.settings };
  else state.roomForm = { ...DEFAULT_ROOM, bots: mode === 'training' ? 3 : 0 };
  $('create-title').textContent = { create: 'Новая комната', training: 'Тренировка с ботами', edit: 'Настройки матча' }[mode];
  $('create-go').textContent = mode === 'edit' ? 'Сохранить' : mode === 'training' ? 'Начать' : 'Создать';
  $('create-error').textContent = '';
  renderRoomForm();
  show('create');
}

$('create-back').addEventListener('click', () => show(state.formMode === 'edit' ? 'lobby' : 'menu'));
$('create-go').addEventListener('click', async () => {
  const settings = { ...state.roomForm };
  if (state.formMode === 'edit') {
    state.lobby.settings = settings;
    rebalanceTeams();
    broadcastLobby();
    preloadMap(settings.map);
    show('lobby');
    return;
  }
  prefs.name = currentName();
  savePrefs();
  $('create-go').disabled = true;
  try {
    await createRoom(settings, state.formMode !== 'training');
    if (state.formMode === 'training') startMatchHost();
  } catch (err) {
    $('create-error').textContent = err.message;
    show('create');
  } finally {
    $('create-go').disabled = false;
  }
});

// ——— хост ———
async function createRoom(settings, online) {
  const net = new Net();
  state.net = net;
  state.host = true;
  state.online = online;
  state.chat = [];
  if (online) {
    loading('Создаём комнату…');
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      state.code = randomCode();
      try {
        await net.host(state.code);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
      }
    }
    if (lastErr) {
      state.net = null;
      throw lastErr;
    }
  } else {
    await net.startOffline();
    state.code = '';
  }
  state.localId = net.id;
  state.lobby = {
    settings,
    state: 'lobby',
    players: [{ id: net.id, name: prefs.name, color: prefs.color, team: 0, ready: true, host: true }],
  };
  net.onJoin = () => {};
  net.onMessage = hostOnMessage;
  net.onResync = sendSync;
  net.onLeave = (id) => {
    const p = state.lobby.players.find((x) => x.id === id);
    state.lobby.players = state.lobby.players.filter((x) => x.id !== id);
    state.match?.leave(id);
    if (p) systemChat(`${p.name} вышел`);
    broadcastLobby();
  };
  preloadMap(settings.map);
  broadcastLobby();
  if (online) {
    state.stopNetInfo = every(NET_INFO_MS, sendNetInfo);
    show('lobby');
  }
}

// Вернувшемуся игроку или сменившему канал — всё, что он мог пропустить
function sendSync(id) {
  if (!state.lobby.players.some((p) => p.id === id)) return;
  state.net.sendTo(id, lobbyMessage());
  if (state.lobby.state === 'game' && state.match) state.net.sendTo(id, { t: 'sync', mid: state.mid, start: startMessage() });
  else if (state.lastEnd) state.net.sendTo(id, state.lastEnd);
}

function startMessage() {
  const s = state.lobby.settings;
  return { t: 'start', mid: state.mid, map: s.map, settings: s, roster: state.match.roster(), snapshot: state.match.snapshot() };
}

function sendNetInfo() {
  if (!state.host || !state.online || !state.net) return;
  const l = state.net.info().map((i) => [i.id, i.ms, i.kind]);
  l.push([state.localId, 0, 'host']);
  const msg = { t: 'net', l };
  state.net.broadcast(msg);
  applyNetInfo(msg);
}

function applyNetInfo(msg) {
  if (!Array.isArray(msg.l)) return;
  const lost = (m) => [...m].filter(([, v]) => v.kind === 'lost').map(([id]) => id).join();
  const before = lost(state.netInfo);
  state.netInfo = new Map(msg.l.map(([id, ms, kind]) => [id, { ms, kind }]));
  game.netInfo = state.netInfo;
  if (current === 'lobby' && lost(state.netInfo) !== before) renderLobby();
}

function teamCounts() {
  const c = [0, 0];
  for (const p of state.lobby.players) c[p.team]++;
  return c;
}

function rebalanceTeams() {
  if (state.lobby.settings.mode !== 'tdm') return;
  const c = teamCounts();
  for (const p of state.lobby.players) {
    if (Math.abs(c[0] - c[1]) <= 1) break;
    const big = c[0] > c[1] ? 0 : 1;
    if (p.team === big && !p.host) { p.team = 1 - big; c[big]--; c[1 - big]++; }
  }
}

function lobbyMessage() {
  return { t: 'lobby', code: state.code, settings: state.lobby.settings, players: state.lobby.players, state: state.lobby.state };
}

function broadcastLobby() {
  if (!state.host) return;
  state.net.broadcast(lobbyMessage());
  renderLobby();
}

function systemChat(text) {
  addChat({ sys: true, text });
  if (state.host) state.net.broadcast({ t: 'chat', sys: true, text });
}

function hostOnMessage(id, msg) {
  const lobby = state.lobby;
  const m = state.match;
  switch (msg.t) {
    case 'hello': {
      const humans = lobby.players.length;
      if (humans >= lobby.settings.maxPlayers) {
        state.net.sendTo(id, { t: 'full' });
        state.net.kick(id);
        return;
      }
      const c = teamCounts();
      const p = {
        id,
        name: String(msg.name || 'Игрок').slice(0, 16),
        color: COLORS.includes(msg.color) ? msg.color : COLORS[0],
        team: lobby.settings.mode === 'tdm' && c[1] < c[0] ? 1 : 0,
        ready: false,
        host: false,
      };
      lobby.players.push(p);
      state.net.sendTo(id, { t: 'welcome', id });
      state.net.sendTo(id, lobbyMessage());
      for (const line of state.chat.slice(-20)) state.net.sendTo(id, { t: 'chat', ...line });
      systemChat(`${p.name} зашёл в комнату`);
      if (lobby.state === 'game' && m) {
        state.net.sendTo(id, startMessage());
        m.join({ id: p.id, name: p.name, color: p.color, team: p.team });
      }
      broadcastLobby();
      break;
    }
    case 'ready': {
      const p = lobby.players.find((x) => x.id === id);
      if (p) p.ready = !!msg.v;
      broadcastLobby();
      break;
    }
    case 'team': {
      const p = lobby.players.find((x) => x.id === id);
      if (p && lobby.state === 'lobby') p.team = msg.team ? 1 : 0;
      broadcastLobby();
      break;
    }
    case 'chat': {
      const p = lobby.players.find((x) => x.id === id);
      const text = String(msg.text || '').slice(0, 120).trim();
      if (!p || !text) return;
      const line = { name: p.name, text };
      addChat(line);
      state.net.broadcast({ t: 'chat', ...line });
      break;
    }
    case 'resync': sendSync(id); break;
    case 'st': m?.onState(id, msg); break;
    case 'shot': m?.onShot(id, msg); break;
    case 'hit': m?.onHit(id, msg); break;
    case 'pick': m?.onPick(id, msg.i); break;
    case 'boom': m?.onBoom(id, msg); break;
    default:
  }
}

function emitFromHost(msg, except, route) {
  if (msg.t === 'end') {
    msg.mid = state.mid;
    state.lastEnd = msg;
  }
  if (state.online) state.net.broadcast(msg, except, route);
  if (except !== state.localId && route !== 'relay') dispatchGame(msg);
}

function routeHostLocal(msg) {
  hostOnMessage(state.localId, msg);
}

async function startMatchHost() {
  const lobby = state.lobby;
  const s = lobby.settings;
  const teams = s.mode === 'tdm';
  const humans = lobby.players.map((p) => ({ id: p.id, name: p.name, color: p.color, team: teams ? p.team : 0 }));
  const bots = makeBots(s.bots, teams);
  if (teams) {
    const c = [0, 0];
    for (const h of humans) c[h.team]++;
    for (const b of bots) { b.team = c[0] <= c[1] ? 0 : 1; c[b.team]++; }
  }
  const roster = [...humans, ...bots];
  lobby.state = 'game';
  state.mid++;
  state.lastEnd = null;
  broadcastLobby();
  state.net.broadcast({ t: 'start', mid: state.mid, map: s.map, settings: s, roster });
  await beginMatch({ mid: state.mid, map: s.map, settings: s, roster });
  const match = new HostMatch({ map: game.map, settings: s, roster, localId: state.localId, emit: emitFromHost });
  state.match = match;
  match.start();
  startHostLoop(match);
}

// Матч хоста идёт по таймеру, а не по кадрам: не замирает в свёрнутой вкладке и не замедляется при низком FPS
function startHostLoop(match) {
  stopHostLoop();
  let last = performance.now();
  state.stopHostLoop = every(HOST_TICK_MS, () => {
    const t = performance.now();
    let dt = Math.min(1, (t - last) / 1000);
    last = t;
    while (dt > 1e-4) {
      const step = Math.min(dt, 0.05);
      match.update(step);
      dt -= step;
    }
  });
}

function stopHostLoop() {
  state.stopHostLoop?.();
  state.stopHostLoop = null;
}

// ——— клиент ———
async function joinRoom(code) {
  const net = new Net();
  state.net = net;
  state.host = false;
  state.online = true;
  state.code = code;
  state.ready = false;
  state.chat = [];
  net.onMessage = (_, msg) => clientOnMessage(msg);
  net.onClosed = (reason) => {
    leaveRoom();
    notice(reason === LOST ? 'Хост закрыл комнату или связь потеряна' : reason);
  };
  let wasOnline = true;
  let wasRoute = null;
  net.onStatus = () => {
    $('net-banner').classList.toggle('hidden', net.online);
    game.stateRate = net.route === 'relay' ? RELAY_STATE_RATE : STATE_RATE;
    // Хост и сам пришлёт снимок, но его ответ мог потеряться вместе с обрывом
    if (net.online && (!wasOnline || (wasRoute && net.route !== wasRoute))) net.send({ t: 'resync' });
    wasOnline = net.online;
    wasRoute = net.route;
  };
  loading('Подключаемся…');
  await net.join(code);
  state.localId = net.id;
  net.send({ t: 'hello', name: prefs.name, color: prefs.color });
}

function clientOnMessage(msg) {
  switch (msg.t) {
    case 'welcome':
      state.localId = msg.id;
      break;
    case 'lobby': {
      const prevMap = state.lobby.settings?.map;
      state.lobby = { settings: msg.settings, players: msg.players, state: msg.state };
      state.code = msg.code;
      if (current === 'loading' && !state.inGame && !state.loading) show('lobby');
      if (prevMap !== msg.settings.map && !state.inGame) preloadMap(msg.settings.map);
      renderLobby();
      break;
    }
    case 'chat':
      addChat(msg);
      break;
    case 'start':
      beginMatch(msg);
      break;
    case 'sync':
      if ((state.inGame || state.loading) && state.mid === msg.mid) dispatchGame(msg);
      else beginMatch(msg.start);
      break;
    case 'net':
      applyNetInfo(msg);
      break;
    case 'full':
      leaveRoom();
      notice('Комната заполнена');
      break;
    case 'kicked':
      leaveRoom();
      notice('Хост исключил вас из комнаты');
      break;
    default:
      dispatchGame(msg);
  }
}

$('join-go').addEventListener('click', doJoin);
$('join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });
$('join-code').addEventListener('input', (e) => { e.target.value = normalizeCode(e.target.value); });

async function doJoin() {
  const code = normalizeCode($('join-code').value);
  $('join-error').textContent = '';
  if (code.length !== 5) {
    $('join-error').textContent = 'Код состоит из 5 символов';
    return;
  }
  prefs.name = currentName();
  savePrefs();
  try {
    await joinRoom(code);
  } catch (err) {
    state.net = null;
    show('join');
    $('join-error').textContent = err.message;
  }
}

// ——— общий ход матча ———
function dispatchGame(msg) {
  if (msg.t === 'end') {
    // Повтор итогов после переподключения нужен, только если игрок ещё в том матче
    if ((state.inGame || state.loading) && msg.mid === state.mid) onMatchEnd(msg);
    return;
  }
  // Состояния, накопленные за загрузку карты, устарели и только сбили бы оценку задержки
  if (state.loading) {
    if (msg.t !== 'st') state.queue.push(msg);
  } else if (state.inGame) {
    game.handle(msg);
  }
}

async function beginMatch({ mid, map, settings, roster, snapshot }) {
  if (state.inGame) {
    game.stopMatch();
    state.inGame = false;
  }
  state.mid = mid;
  state.loading = true;
  state.queue = [];
  loading(`Загрузка карты «${MAPS[map].name}»…`);
  await new Promise((r) => setTimeout(r, 50));
  game.send = state.host ? routeHostLocal : (msg) => state.net?.send(msg);
  game.stateRate = !state.host && state.net?.route === 'relay' ? RELAY_STATE_RATE : STATE_RATE;
  await game.startMatch({ mapId: map, localId: state.localId, roster, settings, snapshot });
  state.loading = false;
  state.inGame = true;
  hideScreens();
  const q = state.queue;
  state.queue = [];
  for (const msg of q) dispatchGame(msg);
}

function onMatchEnd(msg) {
  if (state.loading) {
    state.queue.push(msg);
    return;
  }
  stopHostLoop();
  game.stopMatch();
  state.inGame = false;
  state.match = null;
  const me = state.localId;
  const rows = msg.results;
  let title = 'Матч окончен';
  if (msg.teams) {
    const [a, b] = msg.teams;
    title = a === b ? 'Ничья' : `Победили ${a > b ? 'синие' : 'красные'} · ${Math.max(a, b)}:${Math.min(a, b)}`;
  } else if (rows[0]) {
    title = rows[0].id === me ? 'Вы победили!' : `Победил ${rows[0].name}`;
  }
  $('results-title').textContent = title;
  const mine = rows.find((r) => r.id === me);
  $('results-sub').textContent = mine ? `Ваш счёт · убийства: ${mine.kills} · смерти: ${mine.deaths}` : '';
  $('results-body').innerHTML = rows.map((r, i) => {
    const color = msg.teams ? TEAM_COLORS[r.team] : r.color;
    const kd = r.deaths ? (r.kills / r.deaths).toFixed(2) : r.kills.toFixed(2);
    return `<tr class="${r.id === me ? 'me' : ''}"><td><span class="rank r${i + 1}">${i + 1}</span></td><td><span style="color:${color}">●</span> ${esc(r.name)}</td><td>${r.kills}</td><td>${r.deaths}</td><td>${kd}</td></tr>`;
  }).join('');
  show('results');
  if (state.host) {
    state.lobby.state = 'lobby';
    for (const p of state.lobby.players) if (!p.host) p.ready = false;
    broadcastLobby();
  } else {
    state.ready = false;
  }
}

$('results-ok').addEventListener('click', () => {
  if (!state.net) show('menu');
  else if (state.host && !state.online) { leaveRoom(); show('menu'); }
  else { renderLobby(); show('lobby'); }
});

function leaveRoom() {
  stopHostLoop();
  state.stopNetInfo?.();
  state.stopNetInfo = null;
  state.netInfo = new Map();
  game.netInfo = state.netInfo;
  state.lastEnd = null;
  $('net-banner').classList.add('hidden');
  if (state.inGame || game.running) game.stopMatch();
  state.inGame = false;
  state.loading = false;
  state.match = null;
  state.net?.close();
  state.net = null;
  state.host = false;
  show('menu');
}

// ——— лобби ———
function playerRow(p) {
  const me = p.id === state.localId;
  const tags = [];
  if (p.host) tags.push('<span class="tag host">хост</span>');
  else if (state.netInfo.get(p.id)?.kind === 'lost') tags.push('<span class="tag">нет связи</span>');
  else tags.push(p.ready ? '<span class="tag ready">готов</span>' : '<span class="tag">не готов</span>');
  const kick = state.host && !p.host ? `<button class="kick" data-kick="${esc(p.id)}" title="Исключить">✕</button>` : '';
  const color = state.lobby.settings.mode === 'tdm' ? TEAM_COLORS[p.team] : p.color;
  return `<div class="player${me ? ' me' : ''}"><span class="dot" style="background:${color}"></span><span class="nm">${esc(p.name)}${me ? ' (вы)' : ''}</span>${tags.join('')}${kick}</div>`;
}

function renderLobby() {
  const { players, settings } = state.lobby;
  const tdm = settings.mode === 'tdm';
  $('lobby-kind').textContent = state.online ? 'Код комнаты' : 'Тренировка';
  $('lobby-code').textContent = state.online ? state.code : 'ОФЛАЙН';
  $('copy-code').classList.toggle('hidden', !state.online);
  $('copy-link').classList.toggle('hidden', !state.online);
  $('lobby-count').textContent = `${players.length}/${settings.maxPlayers}`;
  const botsLine = settings.bots ? `<div class="muted small">+ ботов: ${settings.bots} (${SKILL_NAMES[settings.botSkill].toLowerCase()})</div>` : '';
  if (tdm) {
    $('lobby-teams').innerHTML = [0, 1].map((t) => `<div class="team-block t${t}"><div class="team-name">${t ? 'Красные' : 'Синие'}</div>${players.filter((p) => p.team === t).map(playerRow).join('') || '<div class="muted small">пусто</div>'}</div>`).join('') + botsLine;
  } else {
    $('lobby-teams').innerHTML = players.map(playerRow).join('') + botsLine;
  }
  $('switch-team').classList.toggle('hidden', !tdm);
  $('lobby-settings').innerHTML = [
    ['Карта', MAPS[settings.map].name],
    ['Режим', MODE_NAMES[settings.mode]],
    ['Лимит', `${settings.scoreLimit} убийств`],
    ['Время', `${settings.timeLimit} мин`],
    ['Боты', settings.bots ? `${settings.bots}, ${SKILL_NAMES[settings.botSkill].toLowerCase()}` : 'нет'],
  ].map(([k, v]) => `<span>${k}</span><span>${v}</span>`).join('');
  $('edit-settings').classList.toggle('hidden', !state.host);
  $('lobby-start').classList.toggle('hidden', !state.host);
  $('lobby-ready').classList.toggle('hidden', state.host);
  $('lobby-ready').classList.toggle('on', state.ready);
  $('lobby-ready').textContent = state.ready ? 'Готов ✓' : 'Готов';
  const inGame = state.lobby.state === 'game';
  $('lobby-start').textContent = inGame ? 'Идёт матч' : 'Начать матч';
  $('lobby-start').disabled = inGame;
  const others = players.filter((p) => !p.host);
  const readyCount = others.filter((p) => p.ready).length;
  let hint = '';
  if (state.host && state.online) {
    hint = others.length ? `Готовы ${readyCount} из ${others.length}. Можно начинать в любой момент.` : 'Отправьте друзьям код или ссылку. Можно начать и с ботами.';
  } else if (!state.host) {
    hint = inGame ? 'Матч уже идёт. Подключаем…' : 'Ждём, пока хост начнёт матч.';
  }
  $('lobby-hint').textContent = hint;
  $('chat-log').parentElement.querySelectorAll('.section-title')[1].classList.toggle('hidden', !state.online);
  $('chat-log').classList.toggle('hidden', !state.online);
  $('chat-input').classList.toggle('hidden', !state.online);
}

$('lobby-teams').addEventListener('click', (e) => {
  const id = e.target.dataset?.kick;
  if (!id || !state.host) return;
  state.net.sendTo(id, { t: 'kicked' });
  state.net.kick(id);
});
$('copy-code').addEventListener('click', async () => { await copy(state.code); notice('Код скопирован'); });
$('copy-link').addEventListener('click', async () => { await copy(inviteLink(state.code)); notice('Ссылка-приглашение скопирована'); });
$('edit-settings').addEventListener('click', () => openRoomForm('edit'));
$('lobby-leave').addEventListener('click', leaveRoom);
$('lobby-start').addEventListener('click', () => { if (state.host && state.lobby.state === 'lobby') startMatchHost(); });
$('lobby-ready').addEventListener('click', () => {
  state.ready = !state.ready;
  state.net.send({ t: 'ready', v: state.ready });
  renderLobby();
});
$('switch-team').addEventListener('click', () => {
  const me = state.lobby.players.find((p) => p.id === state.localId);
  if (!me) return;
  if (state.host) {
    me.team = 1 - me.team;
    broadcastLobby();
  } else {
    state.net.send({ t: 'team', team: 1 - me.team });
  }
});

function addChat(line) {
  state.chat.push(line);
  if (state.chat.length > 60) state.chat.shift();
  const log = $('chat-log');
  const div = document.createElement('div');
  if (line.sys) {
    div.className = 'sys';
    div.textContent = line.text;
  } else {
    div.innerHTML = `<b>${esc(line.name)}:</b> ${esc(line.text)}`;
  }
  log.appendChild(div);
  while (log.children.length > 60) log.firstChild.remove();
  log.scrollTop = log.scrollHeight;
}

$('chat-input').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const text = e.target.value.trim();
  if (!text) return;
  e.target.value = '';
  if (state.host) hostOnMessage(state.localId, { t: 'chat', text });
  else state.net.send({ t: 'chat', text });
});

let preloadToken = 0;
async function preloadMap(id) {
  if (state.inGame || state.loading || game.mapId === id) return;
  const token = ++preloadToken;
  await new Promise((r) => setTimeout(r, 30));
  if (token !== preloadToken || state.inGame || state.loading) return;
  await game.load(id);
}

// ——— пауза и настройки ———
game.onPause = (paused) => {
  if (!state.inGame) return;
  if (paused) {
    $('pause-code').textContent = state.online ? `Комната ${state.code}` : 'Тренировка';
    $('pause-invite').classList.toggle('hidden', !state.online);
    show('pause');
  } else {
    hideScreens();
  }
};
$('pause-resume').addEventListener('click', () => game.setPaused(false));
$('pause-settings').addEventListener('click', () => openSettings('pause'));
$('pause-invite').addEventListener('click', async () => { await copy(inviteLink(state.code)); notice('Ссылка-приглашение скопирована'); });
$('pause-leave').addEventListener('click', () => {
  if (state.host && state.online && !confirm('Вы хост. Если выйти, комната закроется для всех. Выйти?')) return;
  leaveRoom();
});

function openSettings(back) {
  state.settingsBack = back;
  renderSettings();
  show('settings');
}

function renderSettings() {
  $('set-sens').value = prefs.sensitivity;
  $('set-sens-num').value = prefs.sensitivity;
  $('set-ads').value = prefs.adsSens;
  $('set-fov').value = prefs.fov;
  $('set-scale').value = prefs.renderScale;
  $('set-vol').value = prefs.volume;
  $('set-fxvol').value = prefs.fxVolume;
  $('set-uivol').value = prefs.uiVolume;
  $('set-invert').checked = prefs.invertY;
  $('set-bob').checked = prefs.viewBob;
  $('set-shake').checked = prefs.screenShake;
  $('set-fps').checked = prefs.showFps;
  renderSettingsLabels();
  const pick = (key) => (v) => { prefs[key] = v; applySettings(); renderSettings(); };
  const modes = Object.keys(INPUT_MODES);
  segment($('set-aim-mode'), modes, Object.values(INPUT_MODES), prefs.aimMode, pick('aimMode'));
  segment($('set-crouch-mode'), modes, Object.values(INPUT_MODES), prefs.crouchMode, pick('crouchMode'));
  segment($('set-sprint-mode'), modes, Object.values(INPUT_MODES), prefs.sprintMode, pick('sprintMode'));
  segment($('set-style'), Object.keys(STYLES), Object.values(STYLES), prefs.style, (v) => { prefs.style = v; savePrefs(); renderSettings(); });
  $('style-hint').textContent = prefs.style === STYLE ? '' : state.settingsBack === 'pause'
    ? 'Применится при следующем запуске игры'
    : 'Применится после «Готово», страница перезагрузится';
  segment($('set-quality'), Object.keys(QUALITY), Object.values(QUALITY).map((q) => q.label), prefs.quality, pick('quality'));
  segment($('set-draw'), Object.keys(DRAW_DISTANCE), Object.values(DRAW_DISTANCE).map((d) => d.label), prefs.drawDist, pick('drawDist'));
}

function renderSettingsLabels() {
  const pct = (v) => `${Math.round(v * 100)}%`;
  $('sens-val').textContent = Number(prefs.sensitivity).toFixed(2);
  $('ads-val').textContent = `×${Number(prefs.adsSens).toFixed(2)}`;
  $('fov-val').textContent = prefs.fov;
  $('scale-val').textContent = `${prefs.renderScale}%`;
  $('vol-val').textContent = pct(prefs.volume);
  $('fx-val').textContent = pct(prefs.fxVolume);
  $('ui-val').textContent = pct(prefs.uiVolume);
}

// Качество перестраивает карту, поэтому применяется только по «Готово»; остальное — сразу.
function applySettings() {
  savePrefs();
  game.applyPrefs(prefs);
}

function setSens(v) {
  prefs.sensitivity = Math.round(Math.min(5, Math.max(0.05, v)) * 100) / 100;
  renderSettingsLabels();
  applySettings();
}

const RANGES = { 'set-ads': 'adsSens', 'set-fov': 'fov', 'set-scale': 'renderScale', 'set-vol': 'volume', 'set-fxvol': 'fxVolume', 'set-uivol': 'uiVolume' };
for (const [id, key] of Object.entries(RANGES)) {
  $(id).addEventListener('input', (e) => { prefs[key] = Number(e.target.value); renderSettingsLabels(); applySettings(); });
}
const CHECKS = { 'set-invert': 'invertY', 'set-bob': 'viewBob', 'set-shake': 'screenShake', 'set-fps': 'showFps' };
for (const [id, key] of Object.entries(CHECKS)) {
  $(id).addEventListener('change', (e) => { prefs[key] = e.target.checked; applySettings(); });
}
$('set-sens').addEventListener('input', (e) => { setSens(Number(e.target.value)); $('set-sens-num').value = prefs.sensitivity; });
$('set-sens-num').addEventListener('input', (e) => {
  const v = Number(e.target.value);
  if (e.target.value === '' || !Number.isFinite(v) || v < 0.05 || v > 5) return;
  setSens(v);
  $('set-sens').value = prefs.sensitivity;
});
$('set-sens-num').addEventListener('change', (e) => {
  const v = Number(e.target.value);
  if (e.target.value !== '' && Number.isFinite(v)) setSens(v);
  e.target.value = prefs.sensitivity;
  $('set-sens').value = prefs.sensitivity;
});
$('settings-done').addEventListener('click', async () => {
  savePrefs();
  if (state.settingsBack !== 'pause' && prefs.style !== STYLE) {
    const url = new URL(location.href);
    url.searchParams.delete('style');
    url.searchParams.delete('preset');
    location.replace(url);
    return;
  }
  const reload = game.applyPrefs(prefs);
  if (state.settingsBack === 'pause') {
    if (reload) notice('Качество графики применится со следующей карты');
    show('pause');
    return;
  }
  show(state.settingsBack);
  if (reload && game.mapId) {
    const id = game.mapId;
    game.mapId = null;
    await preloadMap(id);
  }
});

// ——— старт ———
async function boot() {
  loading('Генерируем текстуры…');
  await new Promise((r) => setTimeout(r, 50));
  try {
    await game.load(MAP_IDS[0]);
  } catch (err) {
    console.error(err);
    $('loading-text').textContent = 'Не удалось запустить WebGL. Обновите браузер или включите аппаратное ускорение.';
    return;
  }
  const room = normalizeCode(new URLSearchParams(location.search).get('room'));
  if (room.length === 5) {
    $('join-code').value = room;
    show('join');
  } else {
    show('menu');
  }
}

// Закрытие вкладки: прощаемся сразу, чтобы остальные не ждали возвращения игрока
window.addEventListener('pagehide', () => state.net?.close());

window.__arena = { game, state };
boot();
