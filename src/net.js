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
  const q = new URLSearchParams(location.search);
  const opts = { debug: 1, config: { iceServers: await iceServers() } };
  if (q.get('peerHost')) {
    opts.host = q.get('peerHost');
    opts.port = Number(q.get('peerPort') || 9000);
    opts.path = q.get('peerPath') || '/';
    opts.secure = q.get('peerSecure') === '1';
  }
  return opts;
}

const ERRORS = {
  'unavailable-id': 'Комната с таким кодом уже существует',
  'peer-unavailable': 'Комната не найдена. Проверьте код',
  network: 'Нет связи с сервером соединений',
  'server-error': 'Сервер соединений недоступен',
  'socket-error': 'Ошибка соединения',
  'browser-incompatible': 'Браузер не поддерживает WebRTC',
};

function describe(err) {
  return ERRORS[err?.type] || err?.message || 'Не удалось подключиться';
}

export class Net {
  constructor() {
    this.peer = null;
    this.conns = new Map();
    this.hostConn = null;
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

  async host(code) {
    this.isHost = true;
    const opts = await peerOptions();
    return new Promise((resolve, reject) => {
      const peer = new window.Peer(PREFIX + code, opts);
      this.peer = peer;
      let opened = false;
      peer.on('open', (id) => {
        opened = true;
        this.id = id;
        resolve(id);
      });
      peer.on('connection', (conn) => this.acceptConnection(conn));
      peer.on('error', (err) => {
        if (!opened) {
          peer.destroy();
          reject(new Error(describe(err)));
        } else {
          console.warn('peer error', err);
        }
      });
      peer.on('disconnected', () => {
        if (opened && !peer.destroyed) peer.reconnect();
      });
    });
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

  async join(code) {
    this.isHost = false;
    const opts = await peerOptions();
    return new Promise((resolve, reject) => {
      const peer = new window.Peer(opts);
      this.peer = peer;
      let done = false;
      const fail = (msg) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        peer.destroy();
        reject(new Error(msg));
      };
      const timer = setTimeout(() => fail(this.id
        ? 'Комната найдена, но соединиться с хостом не удалось. Похоже, сеть (например, школьный Wi‑Fi) блокирует прямое соединение между устройствами. Раздайте интернет с телефона на оба компьютера или настройте ретранслятор.'
        : 'Сервер соединений не отвечает. Проверьте интернет'), 20000);
      peer.on('open', (id) => {
        this.id = id;
        const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
        this.hostConn = conn;
        conn.on('open', () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(id);
        });
        conn.on('data', (msg) => this.onMessage('host', msg));
        conn.on('close', () => { if (done) this.onClosed('Соединение с хостом потеряно'); });
      });
      peer.on('error', (err) => {
        if (!done) fail(describe(err));
        else if (err.type !== 'peer-unavailable') console.warn('peer error', err);
      });
    });
  }

  send(msg) {
    if (this.hostConn?.open) this.hostConn.send(msg);
  }

  sendTo(id, msg) {
    const c = this.conns.get(id);
    if (c?.open) c.send(msg);
  }

  broadcast(msg, except) {
    for (const [id, c] of this.conns) if (id !== except && c.open) c.send(msg);
  }

  kick(id) {
    const c = this.conns.get(id);
    if (c) setTimeout(() => c.close(), 200);
  }

  close() {
    this.onClosed = () => {};
    for (const c of this.conns.values()) c.close();
    this.conns.clear();
    this.hostConn?.close();
    this.peer?.destroy();
    this.peer = null;
  }
}
