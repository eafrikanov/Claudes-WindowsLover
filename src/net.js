import { TURN } from './config.js';
import { every } from './ticker.js';

const PREFIX = 'wlarena-v2-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomCode() {
  let s = '';
  for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

export function normalizeCode(s) {
  return (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
}

// Для локальной проверки можно указать свой PeerServer: ?peerHost=localhost&peerPort=9000&peerPath=/
// ?relay=ws://127.0.0.1:8888 — свой MQTT-брокер, ?nop2p=1 — сразу через ретранслятор,
// ?p2pfail=1 — имитация сети, где прямое соединение не открывается.
const query = () => new URLSearchParams(location.search);
const p2pAllowed = () => query().get('nop2p') !== '1';

const DEFAULT_ICE = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
];

let iceCache = null;
async function iceServers() {
  if (iceCache) return iceCache;
  let extra = [];
  if (TURN.meteredApp && TURN.meteredApiKey) {
    try {
      const r = await fetch(`https://${TURN.meteredApp}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(TURN.meteredApiKey)}`);
      if (r.ok) extra = await r.json();
    } catch (err) {
      console.warn('TURN credentials', err);
    }
  }
  iceCache = [...DEFAULT_ICE, ...extra];
  return iceCache;
}

async function peerOptions() {
  const q = query();
  const config = q.get('p2pfail') === '1'
    ? { iceServers: [], iceTransportPolicy: 'relay' }
    : { iceServers: await iceServers() };
  const opts = { debug: 1, config };
  if (q.get('peerHost')) {
    opts.host = q.get('peerHost');
    opts.port = Number(q.get('peerPort') || 9000);
    opts.path = q.get('peerPath') || '/';
    opts.secure = q.get('peerSecure') === '1';
  }
  return opts;
}

// Публичные MQTT-брокеры без регистрации. Порт 443 у shiftr проходит через большинство школьных фильтров.
const BROKERS = [
  { url: 'wss://public.cloud.shiftr.io', username: 'public', password: 'public' },
  { url: 'wss://broker.emqx.io:8084/mqtt' },
  { url: 'wss://broker.hivemq.com:8884/mqtt' },
  { url: 'wss://test.mosquitto.org:8081' },
];
const TOPIC = 'gunarena/v2/';
const CONTROL = new Set(['join', 'accept', 'ping', 'bye']);
// Второй канал WebRTC без упорядочивания для потока 'st': потерянный пакет не задерживает следующие
// и не стоит в очереди с событиями игры. В PeerJS 1.5 reliable: false — это ordered: false.
const STREAM = 'st';

// У каждого игрока до двух каналов к хосту: прямой (WebRTC) и через брокер. Обе стороны раз в PING_MS
// шлют по каждому каналу ping с отметкой «слышу тебя» и эхом чужого ping для замера задержки.
// Канал жив, пока с него приходят пакеты и другая сторона подтверждает, что слышит нас.
const PING_MS = 500;
const STALE_MS = 2500;
// Столько ждём возвращения игрока без связи, прежде чем убрать его из комнаты
export const GRACE_MS = 30000;
// Молчащий дольше канал клиент пересоздаёт
const DEAD_MS = 6000;
const RETRY_MIN_MS = 5000;
const RETRY_MAX_MS = 60000;
const P2P_WAIT_MS = 7000;
const JOIN_TIMEOUT_MS = 20000;
const RELAY_MIN_MS = 8000;
const RELAY_MAX_MS = 12000;
// После первого ответа ещё немного ждём остальные брокеры и берём самый быстрый
const PICK_MS = 500;
// Ретранслятор выбираем вместо прямого канала, только если он быстрее с запасом
const RELAY_PENALTY_MS = 40;
const SWITCH_GAP_MS = 40;
const SWITCH_HOLD_MS = 5000;
const STATS_MS = 4000;

const now = () => performance.now();

function brokerList() {
  const url = query().get('relay');
  return url ? [{ url }] : BROKERS;
}

function randomId(prefix) {
  return prefix + Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');
}

function link(t) {
  return { heard: t, ack: t, rtt: 0, echo: null };
}

const fresh = (l, t) => !!l && t - l.heard < STALE_MS && t - l.ack < STALE_MS;

// Состояние связи с одной стороной: у хоста — с каждым игроком, у игрока — с хостом
function remote(id, key) {
  return {
    id, key, conn: null, stream: null, broker: null, p2p: null, relay: null,
    route: null, online: true, lostAt: 0, switchAt: 0, turn: false, heard: false,
  };
}

// Одна попытка на брокер: недоступный не должен переподключаться в фоне и сыпать ошибками в консоль
function connectBroker(b) {
  return new Promise((resolve, reject) => {
    if (!window.mqtt) {
      reject(new Error('mqtt'));
      return;
    }
    const client = window.mqtt.connect(b.url, {
      username: b.username,
      password: b.password,
      connectTimeout: 8000,
      reconnectPeriod: 0,
      keepalive: 20,
    });
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.end(true);
      reject(new Error(b.url));
    };
    const timer = setTimeout(fail, 9000);
    client.on('error', fail);
    client.on('close', fail);
    client.once('connect', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.off('error', fail);
      client.off('close', fail);
      client.on('error', () => {});
      client.options.reconnectPeriod = 3000;
      resolve(client);
    });
  });
}

function publish(client, topic, packet) {
  if (client?.connected) client.publish(topic, JSON.stringify(packet), { qos: 0 });
}

// Брокеры публичные: в топик может писать кто угодно, поэтому всё непохожее на наш пакет отбрасываем
function parse(raw) {
  if (!raw || raw.length > 262144) return null;
  let p;
  try {
    p = JSON.parse(raw.toString());
  } catch {
    return null;
  }
  if (!p || typeof p !== 'object' || typeof p.f !== 'string' || !p.f || p.f.length > 64) return null;
  if ('m' in p) return p.m && typeof p.m === 'object' && !Array.isArray(p.m) ? p : null;
  return CONTROL.has(p.c) ? p : null;
}

const validId = (s) => typeof s === 'string' && s.length > 0 && s.length <= 64;

const ERRORS = {
  'unavailable-id': 'Комната с таким кодом уже существует',
  'peer-unavailable': 'Комната не найдена. Проверьте код',
  network: 'Нет связи с сервером соединений',
  'server-error': 'Сервер соединений недоступен',
  'socket-error': 'Ошибка соединения',
  'browser-incompatible': 'Браузер не поддерживает WebRTC',
};

const BLOCKED = 'Комната найдена, но соединиться с хостом не удалось. Похоже, сеть (например, школьный Wi‑Fi) блокирует прямое соединение между устройствами. Раздайте интернет с телефона на оба компьютера или настройте ретранслятор.';
const NO_SERVER = 'Сервер соединений не отвечает. Проверьте интернет';
export const LOST = 'Соединение с хостом потеряно';

function describe(err) {
  return ERRORS[err?.type] || err?.message || 'Не удалось подключиться';
}

export class Net {
  constructor() {
    this.peer = null;
    this.remotes = new Map();
    this.server = null;
    this.brokers = [];
    this.stopTick = null;
    this.statsAt = 0;
    this.session = 0;
    this.code = '';
    this.isHost = false;
    this.offline = false;
    this.failed = false;
    this.id = null;
    this.key = null;
    this.p2pBusy = false;
    this.p2pRetryAt = 0;
    this.p2pBackoff = RETRY_MIN_MS;
    this.relayBusy = false;
    this.relayRetryAt = 0;
    this.relayBackoff = RETRY_MIN_MS;
    this.onMessage = () => {};
    this.onJoin = () => {};
    this.onLeave = () => {};
    this.onClosed = () => {};
    // Хост: канал к игроку сменился или связь вернулась — часть событий могла потеряться
    this.onResync = () => {};
    // Клиент: изменились route или online
    this.onStatus = () => {};
  }

  get route() {
    return this.server?.route || null;
  }

  get online() {
    return this.server ? this.server.online : true;
  }

  startOffline() {
    this.isHost = true;
    this.offline = true;
    this.id = 'local';
    return Promise.resolve(this.id);
  }

  topic(sub) {
    return TOPIC + this.code + '/' + sub;
  }

  outTopic(r) {
    return this.isHost ? this.topic('c/' + r.id) : this.topic('host');
  }

  startTick() {
    this.stopTick?.();
    this.stopTick = every(PING_MS, () => (this.isHost ? this.hostTick() : this.clientTick()));
  }

  // ——— общая часть: каналы, ping, выбор маршрута ———

  attachP2P(r, conn) {
    if (r.conn && r.conn !== conn) {
      const old = r.conn;
      r.conn = null;
      old.close();
    }
    const t = now();
    r.conn = conn;
    r.p2p = link(t);
    this.update(r, t);
    this.ping(r, 'p2p', t);
  }

  dropP2P(r) {
    const { conn, stream } = r;
    r.conn = null;
    r.stream = null;
    r.p2p = null;
    conn?.close();
    stream?.close();
    this.update(r, now());
  }

  attachRelay(r, client, rtt = 0) {
    const t = now();
    r.broker = client;
    r.relay = link(t);
    r.relay.rtt = rtt;
    this.update(r, t);
    this.ping(r, 'relay', t);
  }

  receive(r, kind, p) {
    const l = r[kind];
    if (!l) return;
    const t = now();
    l.heard = t;
    r.heard = true;
    const control = kind === 'relay' ? !('m' in p) : p.t === undefined;
    if (!control) {
      this.onMessage(this.isHost ? r.id : 'host', kind === 'relay' ? p.m : p);
      return;
    }
    if (p.c === 'bye') {
      if (this.isHost) this.drop(r.id);
      else this.fail(LOST);
      return;
    }
    if (p.c !== 'ping') return;
    if (p.h) l.ack = t;
    if (Number.isFinite(p.e) && Number.isFinite(p.d)) {
      const s = t - p.e - p.d;
      if (s >= 0 && s < 10000) l.rtt = l.rtt ? l.rtt * 0.75 + s * 0.25 : s;
    }
    if (Number.isFinite(p.ts)) l.echo = { ts: p.ts, at: t };
  }

  ping(r, kind, t) {
    const l = r[kind];
    if (!l) return;
    const pkt = { c: 'ping', ts: Math.round(t), h: t - l.heard < STALE_MS ? 1 : 0 };
    if (l.echo) {
      pkt.e = l.echo.ts;
      pkt.d = Math.round(t - l.echo.at);
      l.echo = null;
    }
    if (kind === 'p2p') {
      if (r.conn?.open) r.conn.send(pkt);
    } else {
      publish(r.broker, this.outTopic(r), { f: this.id, ...pkt });
    }
  }

  update(r, t) {
    const okP = !!r.conn?.open && fresh(r.p2p, t);
    const okR = !!r.broker?.connected && fresh(r.relay, t);
    const prev = r.route;
    const wasOnline = r.online;
    let next = prev;
    if (okP && okR) next = this.preferred(r, t);
    else if (okP) next = 'p2p';
    else if (okR) next = 'relay';
    else if (!prev) next = r.conn ? 'p2p' : r.broker ? 'relay' : null;
    r.online = okP || okR;
    if (r.online) r.lostAt = 0;
    else if (!r.lostAt) r.lostAt = t;
    if (next !== prev) {
      r.route = next;
      r.switchAt = t;
    }
    if (next === prev && r.online === wasOnline) return;
    if (!this.isHost) this.onStatus();
    else if (prev && r.online && (next !== prev || !wasOnline)) this.onResync(r.id);
  }

  preferred(r, t) {
    const cur = r.route;
    const a = r.p2p.rtt;
    const b = r.relay.rtt + RELAY_PENALTY_MS;
    if (!r.p2p.rtt || !r.relay.rtt) return cur || 'p2p';
    const best = b < a ? 'relay' : 'p2p';
    if (!cur || best === cur) return best;
    if (t - r.switchAt < SWITCH_HOLD_MS || Math.abs(a - b) < SWITCH_GAP_MS) return cur;
    return best;
  }

  rsend(r, msg) {
    if (r.conn?.open && (r.route !== 'relay' || !r.broker?.connected)) {
      (msg.t === STREAM && r.stream?.open ? r.stream : r.conn).send(msg);
    } else if (r.broker) {
      publish(r.broker, this.outTopic(r), { f: this.id, m: msg });
    }
  }

  // Прощание по всем каналам; соединения закрываются чуть позже, чтобы bye успел уйти
  farewell(r, conns) {
    if (r.conn?.open) r.conn.send({ c: 'bye' });
    publish(r.broker, this.outTopic(r), { f: this.id, c: 'bye' });
    if (r.conn) conns.push(r.conn);
    if (r.stream) conns.push(r.stream);
  }

  // ——— хост ———

  // Комната создана, если поднялся хотя бы один транспорт: PeerJS или любой брокер
  host(code) {
    this.shutdown();
    const s = this.session;
    this.isHost = true;
    this.code = code;
    this.id = PREFIX + code;
    const p2p = p2pAllowed();
    return new Promise((resolve, reject) => {
      let settled = false;
      let left = p2p ? 2 : 1;
      let p2pErr = null;
      const ok = () => {
        if (settled || s !== this.session) return;
        settled = true;
        this.startTick();
        resolve(this.id);
      };
      const bad = (err) => {
        if (settled || s !== this.session) return;
        if (--left > 0) return;
        settled = true;
        this.shutdown();
        reject(p2pErr || err);
      };
      if (p2p) {
        this.hostP2P(code, s).then(ok, (err) => {
          p2pErr = new Error(describe(err));
          if (err?.type === 'unavailable-id' && !settled && s === this.session) {
            settled = true;
            this.shutdown();
            reject(p2pErr);
          } else {
            bad(p2pErr);
          }
        });
      }
      this.hostRelay(s).then(ok, bad);
    });
  }

  async hostP2P(code, s) {
    const opts = await peerOptions();
    if (s !== this.session) throw new Error('cancelled');
    return new Promise((resolve, reject) => {
      const peer = new window.Peer(PREFIX + code, opts);
      this.peer = peer;
      let opened = false;
      peer.on('open', () => {
        opened = true;
        resolve();
      });
      peer.on('connection', (conn) => this.acceptConnection(conn));
      peer.on('error', (err) => {
        if (!opened) {
          peer.destroy();
          if (this.peer === peer) this.peer = null;
          reject(err);
        } else {
          console.warn('peer error', err);
        }
      });
      peer.on('disconnected', () => {
        if (opened && !peer.destroyed) peer.reconnect();
      });
    });
  }

  hostRelay(s) {
    const list = brokerList();
    const topic = this.topic('host');
    return new Promise((resolve, reject) => {
      let failed = 0;
      const miss = () => {
        if (++failed === list.length) reject(new Error(ERRORS.network));
      };
      for (const b of list) {
        connectBroker(b).then((client) => {
          if (s !== this.session) {
            client.end(true);
            return;
          }
          this.brokers.push(client);
          client.on('message', (_, raw) => this.hostPacket(client, parse(raw)));
          client.subscribe(topic, { qos: 0 }, (err) => (err ? miss() : resolve()));
        }, miss);
      }
    });
  }

  addRemote(id, key) {
    const r = remote(id, key);
    this.remotes.set(id, r);
    this.onJoin(id);
    return r;
  }

  hostPacket(client, p) {
    if (!p || p.f === this.id) return;
    const id = p.f;
    const r = this.remotes.get(id);
    const reply = (pkt) => publish(client, this.topic('c/' + id), { f: this.id, ...pkt });
    if (p.c === 'join') {
      if (!validId(p.k) || (r && r.key !== p.k)) return;
      // Возвращается игрок, которого хост уже убрал: пусть уходит, а не висит без места в комнате
      if (!r && !p.j) {
        reply({ c: 'bye' });
        return;
      }
      reply({ c: 'accept', e: p.ts });
      const rr = r || this.addRemote(id, p.k);
      if (!rr.relay) this.attachRelay(rr, client);
      return;
    }
    if (!r) {
      if ('m' in p || p.c === 'ping') reply({ c: 'bye' });
      return;
    }
    if (!r.relay) return;
    // Клиент стучится во все брокеры, а работает через самый быстрый: отвечаем туда, откуда пришёл пакет
    r.broker = client;
    this.receive(r, 'relay', p);
  }

  acceptConnection(conn) {
    const m = conn.metadata || {};
    if (!validId(m.id) || !validId(m.k) || m.id === this.id) {
      conn.close();
      return;
    }
    const own = () => {
      const r = this.remotes.get(m.id);
      return r && r.key === m.k ? r : null;
    };
    if (m.s) {
      conn.on('open', () => {
        const r = own();
        if (!r) {
          conn.close();
          return;
        }
        if (r.stream && r.stream !== conn) r.stream.close();
        r.stream = conn;
      });
      conn.on('data', (msg) => {
        const r = own();
        if (r?.stream === conn && msg?.t === STREAM) this.receive(r, 'p2p', msg);
      });
      const gone = () => {
        const r = own();
        if (r?.stream === conn) r.stream = null;
      };
      conn.on('close', gone);
      conn.on('error', gone);
      return;
    }
    conn.on('open', () => {
      let r = this.remotes.get(m.id);
      if (r && r.key !== m.k) {
        conn.close();
        return;
      }
      if (!r) {
        if (!m.j) {
          conn.send({ c: 'bye' });
          setTimeout(() => conn.close(), 300);
          return;
        }
        r = this.addRemote(m.id, m.k);
      }
      this.attachP2P(r, conn);
    });
    conn.on('data', (msg) => {
      const r = own();
      if (r?.conn === conn && msg && typeof msg === 'object') this.receive(r, 'p2p', msg);
    });
    const gone = () => {
      const r = own();
      if (r?.conn === conn) this.dropP2P(r);
    };
    conn.on('close', gone);
    conn.on('error', gone);
  }

  hostTick() {
    const t = now();
    for (const r of [...this.remotes.values()]) {
      // Игрок давно не пользуется ретранслятором — перестаём слать туда ping
      if (r.relay && t - r.relay.heard > GRACE_MS) {
        r.relay = null;
        r.broker = null;
      }
      this.update(r, t);
      if (!r.online && t - r.lostAt > GRACE_MS) {
        this.drop(r.id);
        continue;
      }
      this.ping(r, 'p2p', t);
      this.ping(r, 'relay', t);
    }
    if (t >= this.statsAt) {
      this.statsAt = t + STATS_MS;
      for (const r of this.remotes.values()) if (r.conn?.open) this.checkTurn(r);
    }
  }

  // Прямое соединение может идти через TURN-сервер: так и показываем в таблице
  async checkTurn(r) {
    const pc = r.conn?.peerConnection;
    if (!pc?.getStats) return;
    try {
      const stats = await pc.getStats();
      let pair = null;
      stats.forEach((s) => {
        if (s.type === 'transport' && s.selectedCandidatePairId) pair = stats.get(s.selectedCandidatePairId);
      });
      if (!pair) {
        stats.forEach((s) => {
          if (s.type === 'candidate-pair' && (s.selected || (s.nominated && s.state === 'succeeded'))) pair = s;
        });
      }
      if (!pair) return;
      const type = (id) => stats.get(id)?.candidateType;
      r.turn = type(pair.localCandidateId) === 'relay' || type(pair.remoteCandidateId) === 'relay';
    } catch {
      /* соединение закрылось во время запроса */
    }
  }

  // Для таблицы счёта: задержка и тип канала до каждого игрока
  info() {
    return [...this.remotes.values()].map((r) => {
      const l = r.route ? r[r.route] : null;
      const kind = !r.online ? 'lost' : r.route === 'relay' ? 'relay' : r.turn ? 'turn' : 'p2p';
      return { id: r.id, ms: l?.rtt ? Math.round(l.rtt) : 0, kind };
    });
  }

  drop(id) {
    const r = this.remotes.get(id);
    if (!r) return;
    this.remotes.delete(id);
    const conns = [];
    this.farewell(r, conns);
    setTimeout(() => conns.forEach((c) => c.close()), 300);
    this.onLeave(id);
  }

  // ——— клиент ———

  // Сначала прямое соединение, при неудаче — через MQTT-ретранслятор. Второй канал поднимается в фоне.
  async join(code) {
    this.shutdown();
    const s = this.session;
    this.isHost = false;
    this.code = code;
    this.id = randomId('u');
    this.key = randomId('k');
    this.server = remote(PREFIX + code, this.key);
    const deadline = Date.now() + JOIN_TIMEOUT_MS;
    let p2p = null;
    if (p2pAllowed()) {
      p2p = await this.joinP2P(s);
      if (s !== this.session) throw new Error(LOST);
      if (p2p.ok) {
        this.startTick();
        return this.id;
      }
    }
    const wait = Math.min(Math.max(deadline - Date.now(), RELAY_MIN_MS), RELAY_MAX_MS);
    const res = await this.pickBroker(s, 1, wait);
    if (s !== this.session) throw new Error(LOST);
    if (!res.client) {
      this.shutdown();
      let msg = NO_SERVER;
      if (p2p?.found) msg = BLOCKED;
      else if (p2p?.missing || res.reached) msg = ERRORS['peer-unavailable'];
      else if (p2p?.err) msg = describe(p2p.err);
      throw new Error(msg);
    }
    this.attachRelay(this.server, res.client, res.rtt);
    this.p2pBackoff = RETRY_MIN_MS * 3;
    this.p2pRetryAt = now() + this.p2pBackoff;
    this.startTick();
    return this.id;
  }

  async joinP2P(s) {
    let peer;
    try {
      peer = await this.openPeer(s);
    } catch (err) {
      return { err };
    }
    const res = await this.connectHost(peer, 1, s);
    if (res.conn) return { ok: true };
    if (this.peer === peer) this.peer = null;
    peer.destroy();
    const missing = res.err?.type === 'peer-unavailable';
    return { found: !missing, missing, err: res.err };
  }

  async openPeer(s) {
    const opts = await peerOptions();
    if (s !== this.session) throw new Error(LOST);
    return new Promise((resolve, reject) => {
      const peer = new window.Peer(opts);
      this.peer = peer;
      const fail = (err) => {
        clearTimeout(timer);
        peer.off('open', open);
        if (this.peer === peer) this.peer = null;
        peer.destroy();
        reject(err);
      };
      const open = () => {
        clearTimeout(timer);
        peer.off('error', fail);
        peer.on('error', (err) => {
          if (err?.type !== 'peer-unavailable') console.warn('peer error', err);
        });
        resolve(peer);
      };
      const timer = setTimeout(() => fail(new Error(NO_SERVER)), P2P_WAIT_MS);
      peer.once('open', open);
      peer.once('error', fail);
    });
  }

  // j = 1 — первый вход в комнату, 0 — возвращение того же игрока
  connectHost(peer, j, s) {
    const r = this.server;
    return new Promise((resolve) => {
      const conn = peer.connect(r.id, { reliable: true, serialization: 'json', metadata: { id: this.id, k: this.key, j } });
      let done = false;
      const finish = (res) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        peer.off('error', onErr);
        if (!res.conn) conn.close();
        resolve(res);
      };
      const onErr = (err) => {
        if (err?.type === 'peer-unavailable') finish({ err });
      };
      const timer = setTimeout(() => finish({}), P2P_WAIT_MS);
      peer.on('error', onErr);
      conn.on('open', () => {
        if (done || s !== this.session) {
          finish({});
          conn.close();
          return;
        }
        this.attachP2P(r, conn);
        this.openStream(peer);
        finish({ conn });
      });
      conn.on('data', (msg) => {
        if (s === this.session && r.conn === conn && msg && typeof msg === 'object') this.receive(r, 'p2p', msg);
      });
      const gone = () => {
        finish({});
        if (s === this.session && r.conn === conn) {
          this.dropP2P(r);
          this.clientTick();
        }
      };
      conn.on('close', gone);
      conn.on('error', gone);
    });
  }

  openStream(peer) {
    const r = this.server;
    const conn = peer.connect(r.id, { reliable: false, serialization: 'json', metadata: { id: this.id, k: this.key, s: 1 } });
    r.stream = conn;
    conn.on('data', (msg) => {
      if (r.stream === conn && msg?.t === STREAM) this.receive(r, 'p2p', msg);
    });
    conn.on('error', () => {});
    conn.on('close', () => {
      if (r.stream === conn) r.stream = null;
    });
  }

  // Подключается ко всем брокерам, стучится к хосту и оставляет брокер с самым быстрым ответом
  pickBroker(s, j, wait) {
    const hostId = this.server.id;
    const hostTopic = this.topic('host');
    const list = brokerList();
    return new Promise((resolve) => {
      const tried = [];
      let done = false;
      let failed = 0;
      let reached = false;
      let rejected = false;
      let best = null;
      let pick = 0;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        clearTimeout(pick);
        if (rejected || s !== this.session) best = null;
        for (const c of tried) {
          clearInterval(c.knock);
          if (c.mqtt !== best?.client) c.mqtt.end(true);
        }
        resolve({ ...best, reached, rejected });
      };
      const timer = setTimeout(finish, wait);
      for (const b of list) {
        connectBroker(b).then((client) => {
          if (done) {
            client.end(true);
            return;
          }
          reached = true;
          const entry = { mqtt: client, knock: 0 };
          tried.push(entry);
          client.on('message', (_, raw) => {
            const p = parse(raw);
            if (!p || p.f !== hostId) return;
            if (done) {
              if (s === this.session && this.server?.broker === client) this.receive(this.server, 'relay', p);
              return;
            }
            if (p.c === 'bye') {
              rejected = true;
              finish();
            } else if (p.c === 'accept') {
              const rtt = Number.isFinite(p.e) ? Math.max(1, now() - p.e) : 999;
              if (!best || rtt < best.rtt) best = { client, rtt };
              if (!pick) pick = setTimeout(finish, PICK_MS);
            }
          });
          client.subscribe(this.topic('c/' + this.id), { qos: 0 }, (err) => {
            if (err || done) return;
            const knock = () => publish(client, hostTopic, { f: this.id, c: 'join', k: this.key, j, ts: Math.round(now()) });
            knock();
            entry.knock = setInterval(knock, 1500);
          });
        }, () => {
          if (++failed === list.length) finish();
        });
      }
    });
  }

  clientTick() {
    const r = this.server;
    if (!r || this.failed) return;
    const t = now();
    this.update(r, t);
    if (!r.online && t - r.lostAt > GRACE_MS) {
      this.fail(LOST);
      return;
    }
    this.ping(r, 'p2p', t);
    this.ping(r, 'relay', t);
    this.ensureP2P(r, t);
    this.ensureRelay(r, t);
  }

  // Прямой канал умер или его не было: пробуем поднять заново, с растущей паузой между попытками
  ensureP2P(r, t) {
    if (!p2pAllowed() || this.p2pBusy || t < this.p2pRetryAt) return;
    if (r.conn?.open && r.p2p && t - r.p2p.heard < DEAD_MS) return;
    const s = this.session;
    this.p2pBusy = true;
    this.retryP2P(s).then((ok) => {
      if (s !== this.session) return;
      this.p2pBusy = false;
      this.p2pBackoff = ok ? RETRY_MIN_MS : Math.min(RETRY_MAX_MS, this.p2pBackoff * 2);
      this.p2pRetryAt = now() + this.p2pBackoff;
    });
  }

  async retryP2P(s) {
    const r = this.server;
    if (r.conn) this.dropP2P(r);
    try {
      let peer = this.peer;
      if (!peer || peer.destroyed || peer.disconnected) {
        peer?.destroy();
        peer = await this.openPeer(s);
      }
      if (s !== this.session) return false;
      return !!(await this.connectHost(peer, 0, s)).conn;
    } catch {
      return false;
    }
  }

  // Запасной канал через брокер держим всегда: если прямой оборвётся, переход будет мгновенным
  ensureRelay(r, t) {
    if (this.relayBusy || t < this.relayRetryAt || !r.heard) return;
    if (r.broker?.connected && r.relay && t - r.relay.heard < DEAD_MS) return;
    const s = this.session;
    this.relayBusy = true;
    this.pickBroker(s, 0, RELAY_MAX_MS).then((res) => {
      if (s !== this.session) {
        res.client?.end(true);
        return;
      }
      this.relayBusy = false;
      if (res.rejected) {
        this.fail(LOST);
        return;
      }
      if (res.client) {
        const old = r.broker;
        this.attachRelay(r, res.client, res.rtt);
        if (old && old !== res.client) old.end(true);
        this.relayBackoff = RETRY_MIN_MS;
      } else {
        this.relayBackoff = Math.min(RETRY_MAX_MS, this.relayBackoff * 2);
      }
      this.relayRetryAt = now() + this.relayBackoff;
    });
  }

  fail(reason) {
    if (this.failed) return;
    this.failed = true;
    this.onClosed(reason);
  }

  send(msg) {
    if (this.server) this.rsend(this.server, msg);
  }

  sendTo(id, msg) {
    const r = this.remotes.get(id);
    if (r) this.rsend(r, msg);
  }

  // route: 'p2p' — только игрокам на прямом канале, 'relay' — только на ретрансляторе, иначе всем
  broadcast(msg, except, route) {
    for (const r of this.remotes.values()) {
      if (r.id === except || (route && r.route !== route)) continue;
      this.rsend(r, msg);
    }
  }

  kick(id) {
    setTimeout(() => this.drop(id), 200);
  }

  // Сбрасывает все транспорты; объект можно использовать снова (main.js повторяет host() с новым кодом)
  shutdown() {
    this.session++;
    this.stopTick?.();
    this.stopTick = null;
    const conns = [];
    for (const r of this.remotes.values()) this.farewell(r, conns);
    if (this.server) this.farewell(this.server, conns);
    const peer = this.peer;
    this.peer = null;
    setTimeout(() => {
      for (const c of conns) c.close();
      peer?.destroy();
    }, 300);
    for (const b of [...this.brokers, this.server?.broker]) b?.end();
    this.remotes.clear();
    this.server = null;
    this.brokers = [];
    this.failed = false;
    this.p2pBusy = false;
    this.relayBusy = false;
    this.p2pRetryAt = 0;
    this.relayRetryAt = 0;
    this.p2pBackoff = RETRY_MIN_MS;
    this.relayBackoff = RETRY_MIN_MS;
  }

  close() {
    this.onClosed = () => {};
    this.onStatus = () => {};
    this.shutdown();
  }
}
