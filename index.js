const http = require('http');
const mineflayer = require('mineflayer');

const cfg = {
  host: process.env.MC_HOST || 'localhost',
  port: parseInt(process.env.MC_PORT || '25565', 10),
  username: process.env.MC_USERNAME || 'RenderBot',
  password: process.env.MC_PASSWORD || undefined,
  auth: process.env.MC_AUTH || 'offline', // offline | microsoft
  version: process.env.MC_VERSION || false, // ornek: "1.20.4" (bos = otomatik)
  httpPort: parseInt(process.env.PORT || '10000', 10),
};

const state = {
  status: 'starting', // starting | connecting | online | offline
  startedAt: Date.now(),
  connectedAt: null,
  reconnects: 0,
  lastError: null,
};

let bot = null;
let afkTimer = null;
let reconnectTimer = null;
let attempts = 0;

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function startAfk() {
  stopAfk();
  afkTimer = setInterval(() => {
    if (!bot || !bot.entity) return;
    bot.look(Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.6, false);
    bot.setControlState('jump', true);
    setTimeout(() => bot && bot.setControlState('jump', false), 400);
  }, 25000);
}

function stopAfk() {
  if (afkTimer) clearInterval(afkTimer);
  afkTimer = null;
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  attempts += 1;
  const delay = Math.min(5000 * 2 ** (attempts - 1), 60000);
  log(`${delay / 1000}sn sonra tekrar baglanilacak (deneme #${attempts})`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    state.reconnects += 1;
    createBot();
  }, delay);
}

function createBot() {
  state.status = 'connecting';
  log(`Baglaniliyor: ${cfg.host}:${cfg.port} kullanici=${cfg.username}`);

  bot = mineflayer.createBot({
    host: cfg.host,
    port: cfg.port,
    username: cfg.username,
    password: cfg.password,
    auth: cfg.auth,
    version: cfg.version,
    hideErrors: false,
  });

  bot.once('spawn', () => {
    attempts = 0;
    state.status = 'online';
    state.connectedAt = Date.now();
    state.lastError = null;
    log('Sunucuya girildi.');
    startAfk();
  });

  bot.on('chat', (username, message) => {
    if (username === bot.username) return;
    log(`<${username}> ${message}`);
    if (message === '!ping') bot.chat('pong!');
    if (message === '!pos' && bot.entity) {
      const p = bot.entity.position;
      bot.chat(`x=${p.x.toFixed(1)} y=${p.y.toFixed(1)} z=${p.z.toFixed(1)}`);
    }
  });

  bot.on('kicked', (reason) => {
    state.lastError = `kicked: ${typeof reason === 'string' ? reason : JSON.stringify(reason)}`;
    log('Atildi:', state.lastError);
  });

  bot.on('error', (err) => {
    state.lastError = err.message;
    log('Hata:', err.message);
  });

  bot.on('end', (reason) => {
    log('Baglanti koptu:', reason);
    state.status = 'offline';
    state.connectedAt = null;
    stopAfk();
    bot = null;
    scheduleReconnect();
  });
}

// ---- Health server ----
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  if (url === '/healthz') {
    const body = JSON.stringify({
      ok: true,
      bot: state.status,
      uptimeSec: Math.floor((Date.now() - state.startedAt) / 1000),
      botOnlineSec: state.connectedAt
        ? Math.floor((Date.now() - state.connectedAt) / 1000)
        : 0,
      reconnects: state.reconnects,
      lastError: state.lastError,
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(body);
  }

  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Minecraft bot calisiyor. Saglik kontrolu: /healthz\n');
});

server.listen(cfg.httpPort, '0.0.0.0', () => {
  log(`Health server ${cfg.httpPort} portunda`);
});

createBot();

process.on('SIGTERM', () => {
  log('SIGTERM alindi, kapatiliyor...');
  stopAfk();
  if (bot) bot.quit();
  server.close(() => process.exit(0));
});

process.on('uncaughtException', (e) => log('uncaughtException:', e));
process.on('unhandledRejection', (e) => log('unhandledRejection:', e));
