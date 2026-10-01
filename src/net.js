import { TURN } from './config.js';

const PREFIX = 'wlarena-v1-';
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
const TOPIC = 'gunarena/v1/';
const PING_MS = 2000;
const HOST_SILENCE_MS = 8000;
const CLIENT_SILENCE_MS = 10000;
const P2P_WAIT_MS = 7000;
const JOIN_TIMEOUT_MS = 20000;
const RELAY_MIN_MS = 8000;
const RELAY_MAX_MS = 12000;
const CONTROL = new Set(['join', 'accept', 'ping', 'bye']);

function brokerList() {
  const url = query().get('relay');
  return url ? [{ url }] : BROKERS;
}

function relayId() {
  return 'r' + Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');
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
const LOST = 'Соединение с хостом потеряно';

function describe(err) {
  return ERRORS[err?.type] || err?.message || 'Не удалось подключиться';
}

export class Net {
  constructor() {
    this.peer = null;
    this.conns = new Map();
    this.hostConn = null;
    this.relays = new Map();
    this.brokers = [];
    this.relay = null;
    this.relayLast = 0;
    this.pingTimer = 0;
    this.session = 0;
    this.code = '';
    this.mode = null;
    this.isHost = false;
    this.offline = false;
    this.id = null;
    this.onMessage = () => {};
    this.onJoin = () => {};
    this.onLeave = () => {};
    this.onClosed = () => {};
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

  // Комната создана, если поднялся хотя бы один транспорт: PeerJS или любой брокер
  host(code) {
    this.shutdown();
    const s = this.session;
    this.isHost = true;
    this.code = code;
    this.id = PREFIX + code;
    const p2p = query().get('nop2p') !== '1';
    return new Promise((resolve, reject) => {
      let settled = false;
      let left = p2p ? 2 : 1;
      let p2pErr = null;
      const ok = () => {
        if (settled || s !== this.session) return;
        settled = true;
        this.pingTimer = setInterval(() => this.hostTick(), PING_MS);
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
        this.hostP2P(code, s).then(() => {
          this.mode = 'p2p';
          ok();
        }, (err) => {
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
      this.hostRelay(s).then(() => {
        if (!this.mode) this.mode = 'relay';
        ok();
      }, bad);
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

  hostPacket(client, p) {
    if (!p || p.f === this.id || this.conns.has(p.f)) return;
    const id = p.f;
    const rc = this.relays.get(id);
    if (p.c === 'join') {
      publish(client, this.topic('c/' + id), { f: this.id, c: 'accept' });
      if (rc) return;
      this.relays.set(id, { client, last: Date.now() });
      this.onJoin(id);
      return;
    }
    if (!rc) {
      if ('m' in p) publish(client, this.topic('c/' + id), { f: this.id, c: 'bye' });
      return;
    }
    // Клиент шлёт join во все брокеры, а работает через тот, где первым пришёл accept
    rc.client = client;
    rc.last = Date.now();
    if (p.c === 'bye') this.dropRelay(id);
    else if ('m' in p) this.onMessage(id, p.m);
  }

  hostTick() {
    const now = Date.now();
    for (const [id, rc] of this.relays) {
      if (now - rc.last > HOST_SILENCE_MS) this.dropRelay(id);
      else publish(rc.client, this.topic('c/' + id), { f: this.id, c: 'ping' });
    }
  }

  dropRelay(id) {
    if (!this.relays.delete(id)) return;
    this.onLeave(id);
  }

  acceptConnection(conn) {
    conn.on('open', () => {
      this.conns.set(conn.peer, conn);
      this.onJoin(conn.peer);
    });
    conn.on('data', (msg) => this.onMessage(conn.peer, msg));
    const drop = () => {
      if (this.conns.get(conn.peer) === conn) {
        this.conns.delete(conn.peer);
        this.onLeave(conn.peer);
      }
    };
    conn.on('close', drop);
    conn.on('error', drop);
  }

  // Сначала прямое соединение, при неудаче — через MQTT-ретранслятор
  async join(code) {
    this.shutdown();
    const s = this.session;
    this.isHost = false;
    this.code = code;
    const deadline = Date.now() + JOIN_TIMEOUT_MS;
    let p2p = null;
    if (query().get('nop2p') !== '1') {
      p2p = await this.joinP2P(code, s);
      if (s !== this.session) throw new Error(LOST);
      if (p2p.id) {
        this.mode = 'p2p';
        return p2p.id;
      }
    }
    return this.joinRelay(s, deadline, p2p);
  }

  async joinP2P(code, s) {
    const opts = await peerOptions();
    if (s !== this.session) return {};
    return new Promise((resolve) => {
      const peer = new window.Peer(opts);
      this.peer = peer;
      let done = false;
      let found = false;
      let timer = 0;
      const finish = (res) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (!res.id) {
          this.hostConn = null;
          if (this.peer === peer) this.peer = null;
          peer.destroy();
        }
        resolve({ found, ...res });
      };
      const wait = () => {
        clearTimeout(timer);
        timer = setTimeout(() => finish({}), P2P_WAIT_MS);
      };
      wait();
      peer.on('open', (id) => {
        found = true;
        wait();
        const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
        this.hostConn = conn;
        conn.on('open', () => {
          this.id = id;
          finish({ id });
        });
        conn.on('data', (msg) => this.onMessage('host', msg));
        conn.on('close', () => {
          if (done && this.hostConn === conn) this.onClosed(LOST);
        });
      });
      peer.on('error', (err) => {
        if (!done) {
          if (err.type === 'peer-unavailable') found = false;
          finish({ err });
        } else if (err.type !== 'peer-unavailable') {
          console.warn('peer error', err);
        }
      });
    });
  }

  joinRelay(s, deadline, p2p) {
    const id = relayId();
    const hostId = PREFIX + this.code;
    const hostTopic = this.topic('host');
    const list = brokerList();
    const missing = p2p?.err?.type === 'peer-unavailable';
    // Живой хост отвечает через брокер за секунду-две, поэтому долго не ждём даже после долгой попытки P2P
    const wait = Math.min(Math.max(deadline - Date.now(), RELAY_MIN_MS), RELAY_MAX_MS);
    return new Promise((resolve, reject) => {
      const tried = [];
      let done = false;
      let failed = 0;
      let reached = false;
      const finish = (client) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        for (const c of tried) {
          clearInterval(c.knock);
          if (c.mqtt !== client) c.mqtt.end(true);
        }
        if (s !== this.session) {
          client?.end(true);
          reject(new Error(LOST));
          return;
        }
        if (!client) {
          let msg = NO_SERVER;
          if (p2p?.found) msg = BLOCKED;
          else if (missing || reached) msg = ERRORS['peer-unavailable'];
          else if (p2p?.err) msg = describe(p2p.err);
          reject(new Error(msg));
          return;
        }
        this.id = id;
        this.relay = client;
        this.mode = 'relay';
        this.relayLast = Date.now();
        this.pingTimer = setInterval(() => this.clientTick(), PING_MS);
        publish(client, hostTopic, { f: id, c: 'ping' });
        resolve(id);
      };
      const timer = setTimeout(() => finish(null), wait);
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
            if (!done) {
              if (p.c === 'accept') finish(client);
            } else if (this.relay === client) {
              this.clientPacket(p);
            }
          });
          client.subscribe(this.topic('c/' + id), { qos: 0 }, (err) => {
            if (err || done) return;
            const knock = () => publish(client, hostTopic, { f: id, c: 'join' });
            knock();
            entry.knock = setInterval(knock, 1500);
          });
        }, () => {
          if (++failed === list.length) finish(null);
        });
      }
    });
  }

  clientPacket(p) {
    this.relayLast = Date.now();
    if (p.c === 'bye') this.relayLost();
    else if ('m' in p) this.onMessage('host', p.m);
  }

  clientTick() {
    if (Date.now() - this.relayLast > CLIENT_SILENCE_MS) this.relayLost();
    else publish(this.relay, this.topic('host'), { f: this.id, c: 'ping' });
  }

  relayLost() {
    if (!this.relay) return;
    this.relay.end(true);
    this.relay = null;
    clearInterval(this.pingTimer);
    this.onClosed(LOST);
  }

  send(msg) {
    if (this.hostConn?.open) this.hostConn.send(msg);
    else if (this.relay) publish(this.relay, this.topic('host'), { f: this.id, m: msg });
  }

  sendTo(id, msg) {
    const c = this.conns.get(id);
    if (c) {
      if (c.open) c.send(msg);
      return;
    }
    const rc = this.relays.get(id);
    if (rc) publish(rc.client, this.topic('c/' + id), { f: this.id, m: msg });
  }

  broadcast(msg, except) {
    for (const [id, c] of this.conns) if (id !== except && c.open) c.send(msg);
    if (!this.relays.size) return;
    const data = { f: this.id, m: msg };
    for (const [id, rc] of this.relays) if (id !== except) publish(rc.client, this.topic('c/' + id), data);
  }

  kick(id) {
    const c = this.conns.get(id);
    if (c) {
      setTimeout(() => c.close(), 200);
      return;
    }
    const rc = this.relays.get(id);
    if (rc) {
      setTimeout(() => {
        publish(rc.client, this.topic('c/' + id), { f: this.id, c: 'bye' });
        this.dropRelay(id);
      }, 200);
    }
  }

  // Сбрасывает все транспорты; объект можно использовать снова (main.js повторяет host() с новым кодом)
  shutdown() {
    this.session++;
    clearInterval(this.pingTimer);
    for (const c of this.conns.values()) c.close();
    this.conns.clear();
    const hc = this.hostConn;
    this.hostConn = null;
    hc?.close();
    this.peer?.destroy();
    this.peer = null;
    for (const [id, rc] of this.relays) publish(rc.client, this.topic('c/' + id), { f: this.id, c: 'bye' });
    this.relays.clear();
    if (this.relay) publish(this.relay, this.topic('host'), { f: this.id, c: 'bye' });
    for (const b of [...this.brokers, this.relay]) b?.end();
    this.brokers = [];
    this.relay = null;
    this.mode = null;
  }

  close() {
    this.onClosed = () => {};
    this.shutdown();
  }
}
