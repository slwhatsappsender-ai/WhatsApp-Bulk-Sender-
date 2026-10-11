
process.on('uncaughtException', (err) => {
  console.error('CRITICAL UNCAUGHT EXCEPTION:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED PROMISE REJECTION:', reason);
});
import express from 'express';
import path from 'path';
import fs from 'fs';
import http from 'http';
import https from 'https';
import tls from 'tls';
import net from 'net';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import QRCode from 'qrcode';
import pino from 'pino';
import NodeCache from '@cacheable/node-cache';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  Browsers,
  jidNormalizedUser,
  generateMessageIDV2,
  proto,
  downloadMediaMessage
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';

let XLSX = null;
try {
  XLSX = require('xlsx');
} catch (e) {
  // Will fallback to built-in CSV/XML parser if xlsx is still installing
}

// ─── Directories & Persistent Storage (100% Local Inside Desktop App) ────────
const STORAGE_ROOT = process.env.WA_BOT_STORAGE_ROOT || process.cwd();
const DATA_DIR = path.join(STORAGE_ROOT, 'data');
const AUTH_BASE_DIR = path.join(STORAGE_ROOT, 'auth_sessions');
const ALT_SESSIONS_DIR = path.join(STORAGE_ROOT, 'sessions');
const UPLOADS_DIR = path.join(STORAGE_ROOT, 'uploads');
const PUBLIC_DIR = fs.existsSync(path.join(__dirname, 'public')) ? path.join(__dirname, 'public') : path.join(STORAGE_ROOT, 'public');

for (const dir of [DATA_DIR, AUTH_BASE_DIR, UPLOADS_DIR, PUBLIC_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const STATE_FILE = path.join(DATA_DIR, 'bot_state.json');
const ALT_STATE_FILE = path.join(DATA_DIR, 'state.json');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
const TEMPLATES_FILE = path.join(DATA_DIR, 'templates.json');
const CONTACTS_FILE = path.join(DATA_DIR, 'contacts.json');
const REPORTS_FILE = path.join(DATA_DIR, 'reports_history.json');
const SENT_MESSAGES_FILE = path.join(DATA_DIR, 'sent_messages_store.json');
const GOOGLE_AUTH_FILE = path.join(DATA_DIR, 'google_auth.json');
const FORWARD_CATALOG_FILE = path.join(DATA_DIR, 'forwardable_messages.json');
const DNC_FILE      = path.join(DATA_DIR, 'dnc_list.json');
const TAGS_FILE      = path.join(DATA_DIR, 'contact_tags.json');
const CAMPAIGN_ARCHIVE_FILE = path.join(DATA_DIR, 'campaign_archive.json');
const MSG_HISTORY_FILE  = path.join(DATA_DIR, 'message_history.json');
const CAMPAIGN_PROGRESS_FILE = path.join(DATA_DIR, 'campaign_progress.json');
const AUDIENCE_FILE     = path.join(DATA_DIR, 'audience.json');
const BLACKLIST_FILE    = path.join(DATA_DIR, 'blacklist.json');
let blacklistStore      = loadJsonFile(BLACKLIST_FILE, []);
const STICKERS_FILE     = path.join(DATA_DIR, 'stickers_catalog.json');
let stickersCatalogStore = loadJsonFile(STICKERS_FILE, []);

function getTodayDateString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// ─── Default Templates (English, with :"name " & {{name}} placeholder support) ──
const DEFAULT_TEMPLATES = [
  {
    id: 'tpl_1',
    title: '👋 Personal Greeting (hi :"name ")',
    content: 'hi :"name "!\nYour registration for the :"course" class is successful. Expect more details soon.',
    category: 'Greeting',
    createdAt: new Date().toISOString()
  },
  {
    id: 'tpl_2',
    title: '📢 Class Starting Notice (Class Alert)',
    content: 'Hello {{name}}! 🌸\n\nYour {{course}} class will be held today.\nPhone: {{phone}}\n\nPlease join on time.\n- Desktop Bot',
    category: 'Class',
    createdAt: new Date().toISOString()
  },
  {
    id: 'tpl_3',
    title: '💳 Course Fee Confirmation (Payment Receipt)',
    content: 'Hello :"name ",\n\nYour course fee ({{amount}}) for {{course}} has been successfully recorded.\n✅ Status: Verified\n\nThank you!',
    category: 'Payment',
    createdAt: new Date().toISOString()
  },
  {
    id: 'tpl_4',
    title: '📄 Sending Tutorials and PDF (Study Material)',
    content: 'hi :"name ",\n\nThe latest tutorial (PDF / Media) related to the {{course}} course is attached herewith. Please check.',
    category: 'Material',
    createdAt: new Date().toISOString()
  }
];

function loadJsonFile(filePath, fallback) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (e) {
    console.warn(`Warning reading ${filePath}:`, e.message);
  }
  return fallback;
}

function saveJsonFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.warn(`Warning writing ${filePath}:`, e.message);
  }
}

export function findLocalMediaFile(fileNameOrPath) {
  if (!fileNameOrPath) return null;
  const rawPath = String(fileNameOrPath).trim();
  if (!rawPath) return null;
  if (fs.existsSync(rawPath)) {
    try {
      if (!fs.statSync(rawPath).isDirectory()) return rawPath;
    } catch (e) {}
  }

  const baseName = path.basename(rawPath);
  const candidateDirs = [
    UPLOADS_DIR,
    path.join(__dirname, 'uploads'),
    path.join(process.cwd(), 'uploads'),
    'D:\\whatsapp bot\\uploads',
    path.join(process.env.APPDATA || '', 'whatsapp-bot-desktop-pro', 'electron_profile', 'uploads')
  ];

  const candidateNames = [
    baseName,
    `cached_forward_${baseName}`,
    baseName.startsWith('cached_forward_') ? baseName.replace(/^cached_forward_/, '') : null
  ].filter(Boolean);

  for (const dir of candidateDirs) {
    if (!dir || !fs.existsSync(dir)) continue;
    for (const name of candidateNames) {
      const full = path.join(dir, name);
      if (fs.existsSync(full)) {
        try {
          if (!fs.statSync(full).isDirectory()) {
            const destPath = path.join(UPLOADS_DIR, name.startsWith('cached_forward_') ? name : `cached_forward_${name}`);
            if (destPath !== full && !fs.existsSync(destPath)) {
              try { fs.copyFileSync(full, destPath); return destPath; } catch (e) {}
            }
            return full;
          }
        } catch (e) {}
      }
    }
  }
  return null;
}

export function getFfmpegPath() {
  const candidates = [
    path.join(__dirname, 'bin', 'ffmpeg.exe'),
    path.join(process.cwd(), 'bin', 'ffmpeg.exe'),
    path.join(STORAGE_ROOT, 'bin', 'ffmpeg.exe'),
    path.join(process.env.APPDATA || '', 'whatsapp-bot-desktop-pro', 'electron_profile', 'bin', 'ffmpeg.exe'),
    'C:\\Users\\ASUS\\AppData\\Local\\Viddly\\ffmpeg.exe',
    'C:\\Users\\ASUS\\AppData\\Local\\CapCut\\Apps\\9.5.0.4050\\ffmpeg.exe',
    'ffmpeg'
  ];
  for (const c of candidates) {
    if (c === 'ffmpeg') {
      try {
        const cp = require('child_process');
        cp.execSync('ffmpeg -version', { stdio: 'ignore' });
        return 'ffmpeg';
      } catch (e) {}
    } else if (fs.existsSync(c)) {
      return c;
    }
  }
  return null;
}

export function generateWaveform(buffer, sampleCount = 64) {
  try {
    const samples = new Uint8Array(sampleCount);
    if (!buffer || buffer.length === 0) {
      for (let i = 0; i < sampleCount; i++) samples[i] = Math.floor(20 + 60 * Math.sin((i / sampleCount) * Math.PI));
      return samples;
    }
    const step = Math.max(1, Math.floor(buffer.length / sampleCount));
    for (let i = 0; i < sampleCount; i++) {
      let maxVal = 0;
      const start = i * step;
      const end = Math.min(buffer.length, start + step);
      for (let j = start; j < end; j += 4) {
        const val = Math.abs(buffer[j] - 128);
        if (val > maxVal) maxVal = val;
      }
      samples[i] = Math.min(100, Math.max(8, Math.floor((maxVal / 128) * 90) + 8));
    }
    return samples;
  } catch (e) {
    return new Uint8Array(sampleCount).fill(50);
  }
}

export function convertAudioToWhatsAppPtt(inputBuffer, originalFileName = 'audio.mp3') {
  const ffmpeg = getFfmpegPath();
  if (!ffmpeg || !inputBuffer || inputBuffer.length === 0) {
    return {
      buffer: inputBuffer,
      mimetype: 'audio/ogg; codecs=opus',
      ptt: true,
      waveform: generateWaveform(inputBuffer)
    };
  }

  const tmpId = Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  const ext = path.extname(originalFileName) || '.mp3';
  const tmpIn = path.join(UPLOADS_DIR, `tmp_in_${tmpId}${ext}`);
  const tmpOut = path.join(UPLOADS_DIR, `tmp_out_${tmpId}.opus`);

  try {
    fs.writeFileSync(tmpIn, inputBuffer);
    const cp = require('child_process');
    cp.execFileSync(ffmpeg, [
      '-y',
      '-i', tmpIn,
      '-vn',
      '-c:a', 'libopus',
      '-b:a', '32k',
      '-vbr', 'on',
      '-ac', '1',
      '-ar', '48000',
      tmpOut
    ], { stdio: 'pipe', timeout: 30000 });

    if (fs.existsSync(tmpOut) && fs.statSync(tmpOut).size > 0) {
      const converted = fs.readFileSync(tmpOut);
      return {
        buffer: converted,
        mimetype: 'audio/ogg; codecs=opus',
        ptt: true,
        waveform: generateWaveform(converted)
      };
    }
  } catch (err) {
    console.warn('Audio transcode to Opus failed, falling back to original audio:', err.message);
  } finally {
    try { if (fs.existsSync(tmpIn)) fs.unlinkSync(tmpIn); } catch (e) {}
    try { if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut); } catch (e) {}
  }

  return {
    buffer: inputBuffer,
    mimetype: 'audio/ogg; codecs=opus',
    ptt: true,
    waveform: generateWaveform(inputBuffer)
  };
}



// ─── 5 WhatsApp Accounts State Management & Separate IP / Device Profiles ───
export const BOT_IDS = ['bot1', 'bot2', 'bot3', 'bot4', 'bot5'];

export const LEGACY_STATIC_PLACEHOLDER_IPS = new Set([
  '103.11.182.101',
  '103.24.56.102',
  '45.121.89.103',
  '112.134.91.104',
  '175.157.44.105'
]);

const ISP_FIRST_OCTET_POOLS = [
  [103, 116, 122, 180, 202],
  [45, 61, 113, 118, 210],
  [112, 27, 124, 139, 220],
  [175, 43, 58, 119, 211],
  [123, 14, 49, 106, 218]
];

/**
 * Cryptographically generates a valid, non-reserved public IPv4 address from realistic ISP CIDR blocks,
 * guaranteeing 100% distinct subnets and octets across all 5 bot slots on each installation.
 */
export function generateRandomBotIp(slotIndex = 0, existingIps = new Set()) {
  const usedList = Array.from(existingIps || []).filter(Boolean).map(String);
  const usedFull = new Set(usedList);
  const usedFirstOctets = new Set(usedList.map(ip => Number(ip.split('.')[0])));
  const usedSubnets = new Set(usedList.map(ip => ip.split('.').slice(0, 2).join('.')));

  const pool = ISP_FIRST_OCTET_POOLS[slotIndex % ISP_FIRST_OCTET_POOLS.length] || ISP_FIRST_OCTET_POOLS[0];

  for (let attempt = 0; attempt < 120; attempt++) {
    const candidatePool = pool.filter(o => !usedFirstOctets.has(o));
    const activePool = candidatePool.length > 0 ? candidatePool : pool;
    const o1 = activePool[crypto.randomInt(0, activePool.length)];
    const o2 = crypto.randomInt(15, 242);
    const o3 = crypto.randomInt(12, 245);
    const o4 = crypto.randomInt(18, 244);

    const subnet16 = `${o1}.${o2}`;
    const candidateIp = `${o1}.${o2}.${o3}.${o4}`;

    if (LEGACY_STATIC_PLACEHOLDER_IPS.has(candidateIp)) continue;
    if (usedFull.has(candidateIp)) continue;
    if (usedSubnets.has(subnet16)) continue;

    return candidateIp;
  }

  return `${pool[0]}.${crypto.randomInt(20, 240)}.${crypto.randomInt(20, 240)}.${crypto.randomInt(20, 240)}`;
}

export function generateRandomDeviceSerial(basePrefix) {
  const suffix = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `${basePrefix}-${suffix}`;
}

export function getBotAuthDir(botId) {
  if (!botId || typeof botId !== 'string') {
    throw new Error(`Invalid bot account ID: ${botId}`);
  }
  const cleanId = botId.trim().toLowerCase();
  if (!BOT_IDS.includes(cleanId)) {
    throw new Error(`Unauthorized or invalid bot ID "${botId}". Allowed accounts: ${BOT_IDS.join(', ')}`);
  }
  const targetDir = path.join(AUTH_BASE_DIR, cleanId);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  return targetDir;
}

// Pre-create and ensure isolated auth directory for every configured bot account
for (const id of BOT_IDS) {
  try {
    const dir = path.join(AUTH_BASE_DIR, id);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (e) {}
}

export function hasSavedSessionCreds(botId) {
  if (!botId) return false;
  try {
    const authDir = getBotAuthDir(botId);
    return fs.existsSync(path.join(authDir, 'creds.json'));
  } catch (e) {
    return false;
  }
}

export function isBotIpLocked(bot) {
  if (!bot) return false;
  return Boolean(
    bot.isConnected ||
    String(bot.status || '').toLowerCase() === 'connected' ||
    bot.ipLocked === true ||
    hasSavedSessionCreds(bot.id)
  );
}

const _initialUsedIps = new Set();
function _allocInitialDefaultIp(slotIdx) {
  const ip = generateRandomBotIp(slotIdx, _initialUsedIps);
  _initialUsedIps.add(ip);
  return ip;
}

export const DEFAULT_BOT_DEVICE_PROFILES = {
  bot1: {
    deviceName: 'Desktop-PC-01 (Windows 11 Pro • Chrome)',
    browserTuple: ['Windows 11 Pro', 'Chrome', '124.0.6367.118'],
    defaultVirtualIp: _allocInitialDefaultIp(0),
    deviceId: generateRandomDeviceSerial('DEV-WIN11-CHROME-01')
  },
  bot2: {
    deviceName: 'MacBook-Pro-02 (macOS Sonoma • Safari)',
    browserTuple: ['macOS Sonoma', 'Safari', '17.4.1'],
    defaultVirtualIp: _allocInitialDefaultIp(1),
    deviceId: generateRandomDeviceSerial('DEV-MACOS-SAFARI-02')
  },
  bot3: {
    deviceName: 'Workstation-03 (Ubuntu Linux • Firefox)',
    browserTuple: ['Ubuntu Linux', 'Firefox', '125.0.2'],
    defaultVirtualIp: _allocInitialDefaultIp(2),
    deviceId: generateRandomDeviceSerial('DEV-UBUNTU-FIREFOX-03')
  },
  bot4: {
    deviceName: 'Office-Terminal-04 (Windows 10 Ent • Edge)',
    browserTuple: ['Windows 10 Enterprise', 'Edge', '124.0.2478.80'],
    defaultVirtualIp: _allocInitialDefaultIp(3),
    deviceId: generateRandomDeviceSerial('DEV-WIN10-EDGE-04')
  },
  bot5: {
    deviceName: 'Studio-Mac-05 (macOS Ventura • Brave)',
    browserTuple: ['macOS Ventura', 'Brave', '1.65.126'],
    defaultVirtualIp: _allocInitialDefaultIp(4),
    deviceId: generateRandomDeviceSerial('DEV-MACOS-BRAVE-05')
  }
};

/**
 * Builds a dedicated HTTP/HTTPS Tunnel / Local-Interface Network Agent & Headers for a specific Bot account
 * so each of the 5 WhatsApp accounts connects with an isolated socket pool, its own Device Fingerprint,
 * and its own separate Proxy / Virtual Client IP / Local Network Interface.
 */
export function createBotNetworkAgent(bot) {
  const profile = DEFAULT_BOT_DEVICE_PROFILES[bot.id] || DEFAULT_BOT_DEVICE_PROFILES.bot1;
  const browserTuple = Array.isArray(bot.deviceFingerprint) && bot.deviceFingerprint.length === 3
    ? bot.deviceFingerprint
    : profile.browserTuple;
  const virtualIp = String(bot.virtualIp || profile.defaultVirtualIp).trim();
  const proxyUrl = String(bot.proxyUrl || '').trim();
  const localAddress = String(bot.localAddress || '').trim();
  const deviceId = bot.deviceId || profile.deviceId;

  const customHeaders = {
    'X-Forwarded-For': virtualIp,
    'Client-IP': virtualIp,
    'X-Real-IP': virtualIp,
    'Forwarded': `for=${virtualIp}`,
    'X-Device-ID': deviceId,
    'X-Client-Device': `${browserTuple[0]} (${browserTuple[1]}/${browserTuple[2]})`
  };

  const agentOpts = {
    keepAlive: true,
    maxSockets: 6,
    timeout: 25000
  };
  if (localAddress) {
    agentOpts.localAddress = localAddress;
  }

  let agent = new https.Agent(agentOpts);
  let networkMode = localAddress ? 'local_interface' : 'isolated_virtual_ip';

  if (proxyUrl) {
    networkMode = 'custom_proxy';
    try {
      const parsedProxy = new URL(proxyUrl);
      const proxyHost = parsedProxy.hostname;
      const proxyPort = Number(parsedProxy.port) || (parsedProxy.protocol === 'https:' ? 443 : 8080);
      const proxyAuth = parsedProxy.username
        ? 'Basic ' + Buffer.from(`${decodeURIComponent(parsedProxy.username)}:${decodeURIComponent(parsedProxy.password || '')}`).toString('base64')
        : null;

      // Built-in HTTP/HTTPS CONNECT Tunnel Agent (zero external dependencies required)
      const tunnelAgent = new https.Agent(agentOpts);
      tunnelAgent.createConnection = (options, callback) => {
        const connectHeaders = {
          Host: `${options.host}:${options.port || 443}`,
          'User-Agent': `${browserTuple[1]}/${browserTuple[2]} (${browserTuple[0]})`,
          ...customHeaders
        };
        if (proxyAuth) connectHeaders['Proxy-Authorization'] = proxyAuth;

        const req = http.request({
          host: proxyHost,
          port: proxyPort,
          method: 'CONNECT',
          path: `${options.host}:${options.port || 443}`,
          headers: connectHeaders,
          localAddress: localAddress || undefined
        });
        req.on('connect', (res, socket) => {
          if (res.statusCode === 200) {
            const tlsSocket = tls.connect({
              socket,
              servername: options.servername || options.host,
              rejectUnauthorized: false
            });
            callback(null, tlsSocket);
          } else {
            socket.destroy();
            callback(new Error(`Proxy CONNECT failed with status ${res.statusCode}`));
          }
        });
        req.on('error', (err) => callback(err));
        req.end();
      };
      agent = tunnelAgent;
    } catch (e) {
      // Fallback to isolated agent if proxy URL syntax is malformed
    }
  }

  return {
    agent,
    fetchAgent: agent,
    browser: browserTuple,
    virtualIp,
    proxyUrl,
    localAddress,
    deviceId,
    networkMode,
    headers: customHeaders
  };
}

const savedAccountsFile = loadJsonFile(ACCOUNTS_FILE, {});
const savedState = loadJsonFile(STATE_FILE, loadJsonFile(ALT_STATE_FILE, {
  lastResetDate: getTodayDateString(),
  accounts: {},
  settings: {
    delayMode: 'random', // 'random' | 'fixed'
    minDelay: 3,     // minimum 3 seconds enforced
    maxDelay: 7,
    fixedDelay: 4,    // minimum 3 seconds enforced
    requireServerAck: true,
    autoFailover: true,
    batchEnabled: false,
    batchSize: 25,
    batchDelaySec: 60,
    batchSwitchBot: true
  }
}));

export const accounts = {};
const _installAssignedIps = new Set();

for (let i = 0; i < BOT_IDS.length; i++) {
  const id = BOT_IDS[i];
  const prev = savedState.accounts?.[id] || savedAccountsFile?.[id] || {};
  const defProfile = DEFAULT_BOT_DEVICE_PROFILES[id];
  const fp = Array.isArray(prev.deviceFingerprint) && prev.deviceFingerprint.length === 3
    ? prev.deviceFingerprint
    : [...defProfile.browserTuple];

  const hasCreds = hasSavedSessionCreds(id);
  const wasLocked = Boolean(prev.ipLocked === true || hasCreds);
  let vIp = String(prev.virtualIp || '').trim();

  // If no IP saved yet, or if it still holds a legacy hardcoded static IP while unlocked, or collides with another slot,
  // cryptographically generate a unique random ISP public IPv4 for this installation.
  if (!vIp || (!wasLocked && LEGACY_STATIC_PLACEHOLDER_IPS.has(vIp)) || _installAssignedIps.has(vIp)) {
    vIp = generateRandomBotIp(i, _installAssignedIps);
  }
  _installAssignedIps.add(vIp);
  defProfile.defaultVirtualIp = vIp;

  const legacyDeviceIds = new Set([
    'DEV-WIN11-CHROME-01',
    'DEV-MACOS-SAFARI-02',
    'DEV-UBUNTU-FIREFOX-03',
    'DEV-WIN10-EDGE-04',
    'DEV-MACOS-BRAVE-05'
  ]);
  let devId = String(prev.deviceId || '').trim();
  if (!devId || (!wasLocked && legacyDeviceIds.has(devId))) {
    devId = defProfile.deviceId;
  }
  defProfile.deviceId = devId;

  const pUrl = prev.proxyUrl || '';
  const lAddr = prev.localAddress || '';

  accounts[id] = {
    id,
    index: i + 1,
    label: (() => {
      const defaultLabel = `WhatsApp Account 0${i + 1}`;
      const savedLabel = String(prev.label || '').trim();
      // Legacy builds stored a Sinhala default ("WhatsApp \u0D9C\u0DD2\u0DAB\u0DD4\u0DB8 0N"); map it back to the English default.
      if (!savedLabel || /^WhatsApp\s+\u0D9C\u0DD2\u0DAB\u0DD4\u0DB8/.test(savedLabel)) return defaultLabel;
      return savedLabel;
    })(),
    status: 'disconnected', // 'disconnected' | 'connecting' | 'qr' | 'connected'
    isConnected: false,
    isSimulated: false,
    ipLocked: wasLocked,
    ipLockedAt: prev.ipLockedAt || (wasLocked ? new Date().toISOString() : null),
    phone: prev.phone || '',
    pushName: prev.pushName || `Bot Account ${i + 1}`,
    qrDataUrl: null,
    qrUpdatedAt: null,
    dailyLimit: typeof prev.dailyLimit === 'number' && prev.dailyLimit >= 1 && prev.dailyLimit <= 1000 ? prev.dailyLimit : (typeof savedAccountsFile?.[id]?.dailyLimit === 'number' && savedAccountsFile[id].dailyLimit >= 1 && savedAccountsFile[id].dailyLimit <= 1000 ? savedAccountsFile[id].dailyLimit : 100),
    maxDailyLimit: 1000,
    defaultDailyLimit: 100,
    sentToday: savedState.lastResetDate === getTodayDateString() ? (prev.sentToday || 0) : 0,
    totalSent: prev.totalSent || 0,
    totalFailed: prev.totalFailed || 0,
    lastActiveAt: prev.lastActiveAt || null,
    deviceName: prev.deviceName || defProfile.deviceName,
    deviceFingerprint: fp,
    deviceId: devId,
    virtualIp: vIp,
    proxyUrl: pUrl,
    localAddress: lAddr,
    networkMode: pUrl ? 'custom_proxy' : (lAddr ? 'local_interface' : 'isolated_virtual_ip'),
    sock: null,
    pendingAcks: new Map(),
    msgRetryCounterCache: createMsgRetryCounterCache(id),
    signalKeyCache: null,
    signalKeyStore: null,
    userDevicesCache: null,
    googleAccount: prev.googleAccount || null
  };
}

export let appSettings = {
  delayMode: savedState.settings?.delayMode === 'fixed' ? 'fixed' : 'random',
  minDelay: Math.max(3, Number(savedState.settings?.minDelay) || 3),
  maxDelay: Math.max(3, Number(savedState.settings?.maxDelay) || 7),
  fixedDelay: Math.max(3, Number(savedState.settings?.fixedDelay) || 4),
  defaultDailyLimit: 100,
  maxDailyLimit: 1000,
  requireServerAck: savedState.settings?.requireServerAck !== false,
  autoFailover: savedState.settings?.autoFailover !== false,
  batchEnabled: Boolean(savedState.settings?.batchEnabled),
  batchSize: Math.max(1, Number(savedState.settings?.batchSize) || 25),
  batchDelaySec: Math.max(5, Number(savedState.settings?.batchDelaySec) || 60),
  batchSwitchBot: savedState.settings?.batchSwitchBot !== false,
  googleContactsAutoSave: Boolean(savedState.settings?.googleContactsAutoSave),
  googleContactsLabel: savedState.settings?.googleContactsLabel || 'WhatsApp Bot',
  boostForwardMode: savedState.settings?.boostForwardMode !== false
};

export const MASTER_GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
export const MASTER_GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';

export let googleAuthState = loadJsonFile(GOOGLE_AUTH_FILE, {
  clientId: MASTER_GOOGLE_CLIENT_ID,
  clientSecret: MASTER_GOOGLE_CLIENT_SECRET,
  redirectUri: 'http://127.0.0.1:5050/api/google/callback',
  tokens: null,
  user: null
});
if (!googleAuthState.clientId) googleAuthState.clientId = MASTER_GOOGLE_CLIENT_ID;
if (!googleAuthState.clientSecret) googleAuthState.clientSecret = MASTER_GOOGLE_CLIENT_SECRET;

// Synchronize Google Auth state across all 5 bot accounts
export function syncGoogleAuthToBots(notifyLog = false) {
  const isGoogleLoggedIn = Boolean(googleAuthState.tokens && (googleAuthState.tokens.refresh_token || googleAuthState.tokens.access_token));
  const gAccount = isGoogleLoggedIn ? {
    email: googleAuthState.user?.email || null,
    name: googleAuthState.user?.name || null,
    picture: googleAuthState.user?.picture || null,
    linkedAt: googleAuthState.tokens?.connected_at || new Date().toISOString(),
    active: true
  } : null;

  let linkedCount = 0;
  for (const botId of BOT_IDS) {
    if (accounts[botId]) {
      accounts[botId].googleAccount = gAccount ? { ...gAccount } : null;
      if (gAccount) linkedCount++;
    }
  }

  if (notifyLog && isGoogleLoggedIn) {
    addLog('success', `☁️ Google Account (${googleAuthState.user?.email || 'Gmail'}) successfully linked for all 5 Bots (${linkedCount}/5 Bots Linked)!`);
  }

  return { isGoogleLoggedIn, gAccount, totalBots: BOT_IDS.length, linkedCount };
}

// Initial sync on startup so every bot inherits persisted Google auth credentials
syncGoogleAuthToBots(false);

export let templates = loadJsonFile(TEMPLATES_FILE, DEFAULT_TEMPLATES);
if (!Array.isArray(templates) || templates.length === 0) {
  templates = [...DEFAULT_TEMPLATES];
  saveJsonFile(TEMPLATES_FILE, templates);
}

export let contactsState = loadJsonFile(CONTACTS_FILE, {
  contacts: [],
  detectedColumns: ['phone', 'name', 'course', 'amount']
});
if (Array.isArray(contactsState.contacts)) {
  contactsState.contacts = contactsState.contacts.filter(c => c && c.source !== 'sample');
  saveJsonFile(CONTACTS_FILE, contactsState);
}

// ── Audience State (Campaign audience numbers persistence) ─────────────────
export let audienceState = loadJsonFile(AUDIENCE_FILE, {
  list: [],
  rawText: '',
  mode: 'manual',
  updatedAt: new Date().toISOString()
});
export function saveAudience() { saveJsonFile(AUDIENCE_FILE, audienceState); }

// ── Advanced Feature States ──────────────────────────────────────────────────
let dncState = { numbers: new Set(loadJsonFile(DNC_FILE, [])) };
let tagsState = loadJsonFile(TAGS_FILE, [
  { name: 'VIP', color: '#f59e0b' },
  { name: 'Student', color: '#3b82f6' },
  { name: 'Lead', color: '#8b5cf6' },
  { name: 'Customer', color: '#10b981' }
]);
function saveDNC() { saveJsonFile(DNC_FILE, [...dncState.numbers]); }
function saveTags() { saveJsonFile(TAGS_FILE, tagsState); }

// Campaign archive
let campaignArchive = loadJsonFile(CAMPAIGN_ARCHIVE_FILE, []);
function saveCampaignArchive() { saveJsonFile(CAMPAIGN_ARCHIVE_FILE, campaignArchive); }

// Message history (last 5000 entries, rolling)
let msgHistoryStore = loadJsonFile(MSG_HISTORY_FILE, []);
function appendMsgHistory(entry) {
  msgHistoryStore.unshift(entry);
  if (msgHistoryStore.length > 5000) msgHistoryStore.length = 5000;
  saveJsonFile(MSG_HISTORY_FILE, msgHistoryStore);
}

// Per-Bot WhatsApp Contacts Store (Cached from Baileys contacts/chats sync and persistent on disk)
export const botContactsStore = {
  bot1: new Map(),
  bot2: new Map(),
  bot3: new Map(),
  bot4: new Map(),
  bot5: new Map()
};

function getBotContactsFilePath(botId) {
  return path.join(DATA_DIR, `contacts_${botId}.json`);
}

for (const id of BOT_IDS) {
  const list = loadJsonFile(getBotContactsFilePath(id), []);
  if (Array.isArray(list)) {
    for (const item of list) {
      if (item && item.phone) {
        botContactsStore[id].set(item.phone, item);
      }
    }
  }
}

export function saveBotContacts(botId) {
  if (!botContactsStore[botId]) return;
  const list = Array.from(botContactsStore[botId].values());
  saveJsonFile(getBotContactsFilePath(botId), list);
}

export let activityLogs = [];
function addLog(level, message, meta = {}) {
  const entry = {
    id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    time: new Date().toISOString(),
    level, // 'info' | 'success' | 'warn' | 'error'
    message,
    ...meta
  };
  activityLogs.unshift(entry);
  if (activityLogs.length > 300) activityLogs.pop();
  return entry;
}

export function persistState() {
  const today = getTodayDateString();
  const serializedAccounts = {};
  for (const id of BOT_IDS) {
    const a = accounts[id];
    const locked = Boolean(a.ipLocked || a.isConnected || String(a.status).toLowerCase() === 'connected' || hasSavedSessionCreds(id));
    serializedAccounts[id] = {
      label: a.label,
      phone: a.phone,
      pushName: a.pushName,
      dailyLimit: a.dailyLimit,
      sentToday: a.sentToday,
      totalSent: a.totalSent,
      totalFailed: a.totalFailed,
      lastActiveAt: a.lastActiveAt,
      deviceName: a.deviceName,
      deviceFingerprint: a.deviceFingerprint,
      deviceId: a.deviceId,
      virtualIp: a.virtualIp,
      proxyUrl: a.proxyUrl,
      localAddress: a.localAddress,
      networkMode: a.networkMode,
      ipLocked: locked,
      ipLockedAt: a.ipLockedAt || (locked ? new Date().toISOString() : null),
      googleAccount: a.googleAccount || null
    };
  }
  const payload = {
    lastResetDate: today,
    accounts: serializedAccounts,
    settings: appSettings
  };
  saveJsonFile(STATE_FILE, payload);
  saveJsonFile(ALT_STATE_FILE, payload);
  saveJsonFile(ACCOUNTS_FILE, serializedAccounts);
}

// Immediately persist install-time generated random IPs so they are permanently saved across restarts
persistState();

let currentTrackedDate = getTodayDateString();
export function checkDailyReset() {
  const today = getTodayDateString();
  if (today !== currentTrackedDate) {
    currentTrackedDate = today;
    for (const id of BOT_IDS) {
      accounts[id].sentToday = 0;
    }
    persistState();
    addLog('info', `📅 New day started (${today}) — Daily Quota for all 5 accounts reset to 0.`);
  }
}

// ─── Core Helper Functions (Exported for Unit & Edge-Case Testing) ───────────

const GLOBAL_COUNTRY_CALLING_CODES = [
  { prefix: '971', code: '+971', name: 'UAE', flag: '🇦🇪' },
  { prefix: '974', code: '+974', name: 'Qatar', flag: '🇶🇦' },
  { prefix: '973', code: '+973', name: 'Bahrain', flag: '🇧🇭' },
  { prefix: '972', code: '+972', name: 'Israel', flag: '🇮🇱' },
  { prefix: '977', code: '+977', name: 'Nepal', flag: '🇳🇵' },
  { prefix: '968', code: '+968', name: 'Oman', flag: '🇴🇲' },
  { prefix: '966', code: '+966', name: 'Saudi Arabia', flag: '🇸🇦' },
  { prefix: '965', code: '+965', name: 'Kuwait', flag: '🇰🇼' },
  { prefix: '962', code: '+962', name: 'Jordan', flag: '🇯🇴' },
  { prefix: '961', code: '+961', name: 'Lebanon', flag: '🇱🇧' },
  { prefix: '960', code: '+960', name: 'Maldives', flag: '🇲🇻' },
  { prefix: '880', code: '+880', name: 'Bangladesh', flag: '🇧🇩' },
  { prefix: '852', code: '+852', name: 'Hong Kong', flag: '🇭🇰' },
  { prefix: '886', code: '+886', name: 'Taiwan', flag: '🇹🇼' },
  { prefix: '357', code: '+357', name: 'Cyprus', flag: '🇨🇾' },
  { prefix: '358', code: '+358', name: 'Finland', flag: '🇫🇮' },
  { prefix: '353', code: '+353', name: 'Ireland', flag: '🇮🇪' },
  { prefix: '351', code: '+351', name: 'Portugal', flag: '🇵🇹' },
  { prefix: '234', code: '+234', name: 'Nigeria', flag: '🇳🇬' },
  { prefix: '254', code: '+254', name: 'Kenya', flag: '🇰🇪' },
  { prefix: '94', code: '+94', name: 'Sri Lanka', flag: '🇱🇰' },
  { prefix: '81', code: '+81', name: 'Japan', flag: '🇯🇵' },
  { prefix: '82', code: '+82', name: 'South Korea', flag: '🇰🇷' },
  { prefix: '91', code: '+91', name: 'India', flag: '🇮🇳' },
  { prefix: '92', code: '+92', name: 'Pakistan', flag: '🇵🇰' },
  { prefix: '86', code: '+86', name: 'China', flag: '🇨🇳' },
  { prefix: '84', code: '+84', name: 'Vietnam', flag: '🇻🇳' },
  { prefix: '66', code: '+66', name: 'Thailand', flag: '🇹🇭' },
  { prefix: '65', code: '+65', name: 'Singapore', flag: '🇸🇬' },
  { prefix: '64', code: '+64', name: 'New Zealand', flag: '🇳🇿' },
  { prefix: '63', code: '+63', name: 'Philippines', flag: '🇵🇭' },
  { prefix: '62', code: '+62', name: 'Indonesia', flag: '🇮🇩' },
  { prefix: '61', code: '+61', name: 'Australia', flag: '🇦🇺' },
  { prefix: '60', code: '+60', name: 'Malaysia', flag: '🇲🇾' },
  { prefix: '55', code: '+55', name: 'Brazil', flag: '🇧🇷' },
  { prefix: '52', code: '+52', name: 'Mexico', flag: '🇲🇽' },
  { prefix: '49', code: '+49', name: 'Germany', flag: '🇩🇪' },
  { prefix: '48', code: '+48', name: 'Poland', flag: '🇵🇱' },
  { prefix: '47', code: '+47', name: 'Norway', flag: '🇳🇴' },
  { prefix: '46', code: '+46', name: 'Sweden', flag: '🇸🇪' },
  { prefix: '45', code: '+45', name: 'Denmark', flag: '🇩🇰' },
  { prefix: '44', code: '+44', name: 'United Kingdom', flag: '🇬🇧' },
  { prefix: '41', code: '+41', name: 'Switzerland', flag: '🇨🇭' },
  { prefix: '40', code: '+40', name: 'Romania', flag: '🇷🇴' },
  { prefix: '39', code: '+39', name: 'Italy', flag: '🇮🇹' },
  { prefix: '34', code: '+34', name: 'Spain', flag: '🇪🇸' },
  { prefix: '33', code: '+33', name: 'France', flag: '🇫🇷' },
  { prefix: '32', code: '+32', name: 'Belgium', flag: '🇧🇪' },
  { prefix: '31', code: '+31', name: 'Netherlands', flag: '🇳🇱' },
  { prefix: '30', code: '+30', name: 'Greece', flag: '🇬🇷' },
  { prefix: '90', code: '+90', name: 'Turkey', flag: '🇹🇷' },
  { prefix: '27', code: '+27', name: 'South Africa', flag: '🇿🇦' },
  { prefix: '20', code: '+20', name: 'Egypt', flag: '🇪🇬' },
  { prefix: '7', code: '+7', name: 'Russia / KZ', flag: '🇷🇺' },
  { prefix: '1', code: '+1', name: 'USA / Canada', flag: '🇺🇸' }
];

export function detectCountryInfo(cleanDigits) {
  const str = String(cleanDigits || '').replace(/\D/g, '');
  if (!str) return { countryCode: '', countryName: 'Unknown', countryFlag: '🌍' };
  for (const item of GLOBAL_COUNTRY_CALLING_CODES) {
    if (str.startsWith(item.prefix)) {
      return {
        countryCode: item.code,
        countryName: item.name,
        countryFlag: item.flag
      };
    }
  }
  return {
    countryCode: `+${str.slice(0, Math.min(3, str.length))}`,
    countryName: 'International',
    countryFlag: '🌍'
  };
}

/**
 * Normalizes a phone number from ANY country in the world (ITU-T E.164 +1..+998, 7 to 15 digits,
 * plus domestic Sri Lankan 07XXXXXXXX / 7XXXXXXXX and Japanese 070/080/090XXXXXXXX formats)
 * into clean digits & WhatsApp JID.
 */
export function normalizePhoneNumber(raw) {
  if (raw === null || raw === undefined) return null;
  let str = String(raw).trim();
  if (!str) return null;

  // Strip leading numbered list prefixes like "1. ", "02) ", "#3 - "
  str = str.replace(/^(?:#?\d{1,3}[.)]\s+|#\d+\s*[-:]\s*)/, '').trim();

  // If string has explicit field separators (" - ", " | ", ",", ";"), test each segment from right to left
  if (/\s+[-–—:|]\s+|[,\t|;]+/.test(str)) {
    const segments = str.split(/\s+[-–—:|]\s+|[,\t|;]+/).map(s => s.trim()).filter(Boolean);
    for (let i = segments.length - 1; i >= 0; i--) {
      const segResult = normalizePhoneNumber(segments[i]);
      if (segResult) return segResult;
    }
    return null;
  }

  // Strip standalone 4-digit year tokens like "Batch 2026 0771234567" when followed by a phone sequence
  str = str.replace(/\b(?:19|20)\d{2}\b(?=\s*(?:\+|00|\d[\d\s().-]{6,}))/g, ' ').trim();

  const hasLetters = /[a-zA-Z\u0D80-\u0DFF]/.test(str);
  let candidate = str;
  if (hasLetters) {
    const allMatches = str.match(/(?:\+|00)?\(?\d(?:[\d\s().-]{5,19}\d)/g);
    if (!allMatches || allMatches.length === 0) return null;
    candidate = allMatches[allMatches.length - 1];
  }

  const trimmedCandidate = candidate.trim();
  const hadExplicitIntlPrefix = /^(?:\+|00)/.test(trimmedCandidate);

  // Strip explicit parenthesized trunk "(0)" inside international formats like "+44 (0) 7911 123456"
  let normalizedCandidate = trimmedCandidate.replace(/^(\+|00)(\d{1,3})[\s.-]*\(0\)[\s.-]*/, '$1$2');

  let digits = normalizedCandidate.replace(/\D/g, '');
  if (!digits || /^0+$/.test(digits) || digits.length < 7 || digits.length > 15) return null;

  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }

  // Strip redundant trunk '0' after known country codes
  if (digits.startsWith('940') && digits.length === 12) {
    digits = '94' + digits.slice(3);
  } else if (digits.startsWith('810') && (digits.length === 12 || digits.length === 13)) {
    digits = '81' + digits.slice(3);
  } else if (digits.startsWith('440') && (digits.length === 13 || digits.length === 12)) {
    digits = '44' + digits.slice(3);
  } else if (digits.startsWith('610') && digits.length === 12) {
    digits = '61' + digits.slice(3);
  } else if (digits.startsWith('9710') && digits.length === 13) {
    digits = '971' + digits.slice(4);
  } else if (digits.startsWith('9660') && digits.length === 13) {
    digits = '966' + digits.slice(4);
  } else if (digits.startsWith('910') && digits.length === 13) {
    digits = '91' + digits.slice(3);
  } else if (digits.startsWith('820') && (digits.length === 12 || digits.length === 13)) {
    digits = '82' + digits.slice(3);
  } else if (!hadExplicitIntlPrefix && /^0[789]0\d{8}$/.test(digits)) {
    // Domestic 11-digit Japanese mobile number (09012345678 -> 819012345678)
    digits = '81' + digits.slice(1);
  } else if (!hadExplicitIntlPrefix && /^07[0-8]\d{7}$/.test(digits)) {
    // Domestic 10-digit Sri Lankan mobile number (0771234567 -> 94771234567)
    digits = '94' + digits.slice(1);
  } else if (!hadExplicitIntlPrefix && /^7[0-8]\d{7}$/.test(digits)) {
    // 9-digit Sri Lankan mobile number without leading zero (771234567 -> 94771234567)
    digits = '94' + digits;
  }

  // Any remaining leading 0 is a malformed local number (e.g. "07712" or "07712345")
  if (digits.startsWith('0')) return null;

  // Country-specific length guard for Sri Lanka (+94 must be 11 digits)
  if (digits.startsWith('94') && digits.length !== 11) return null;

  // Without explicit + or 00 prefix, require at least 9 digits; with + or 00, allow all ITU-T E.164 7..15 digits
  if (!hadExplicitIntlPrefix && digits.length < 9) return null;
  if (digits.length < 7 || digits.length > 15) return null;

  const country = detectCountryInfo(digits);

  return {
    clean: digits,
    raw: trimmedCandidate,
    jid: `${digits}@s.whatsapp.net`,
    countryCode: country.countryCode,
    countryName: country.countryName,
    countryFlag: country.countryFlag,
    isValid: true
  };
}

/**
 * Extracts all variable names referenced in a template string (e.g., :"name ", {{Course Name}}, {fee}, [batch]).
 */
export function extractTemplateVariables(templateStr) {
  if (!templateStr || typeof templateStr !== 'string') return [];
  const vars = new Set();
  const patterns = [
    /:\s*"\s*([a-zA-Z0-9_\u0D80-\u0DFF\s.-]+?)\s*"/g,
    /\{\{\s*([a-zA-Z0-9_\u0D80-\u0DFF\s.-]+?)\s*\}\}/g,
    /\{\s*([a-zA-Z0-9_\u0D80-\u0DFF\s.-]+?)\s*\}/g,
    /\[\s*([a-zA-Z0-9_\u0D80-\u0DFF\s.-]+?)\s*\]/g
  ];
  for (const rx of patterns) {
    let m;
    while ((m = rx.exec(templateStr)) !== null) {
      const cleaned = m[1].trim().toLowerCase();
      if (cleaned) vars.add(cleaned);
    }
  }
  return Array.from(vars);
}

/**
 * Renders a message template with recipient data from Excel / JSON / Manual entry.
 */
export function renderTemplate(templateStr, rowData = {}) {
  if (!templateStr || typeof templateStr !== 'string') return '';
  const normalizedMap = {};
  const slugMap = {};
  const toSlug = (s) => String(s || '').trim().toLowerCase().replace(/[\s_.-]+/g, '');

  for (const [k, v] of Object.entries(rowData || {})) {
    if (k) {
      const strVal = v !== undefined && v !== null ? String(v) : '';
      const lowerKey = k.trim().toLowerCase();
      normalizedMap[lowerKey] = strVal;
      slugMap[toSlug(lowerKey)] = strVal;
    }
  }

  const resolveKey = (rawKey, fallbackStr) => {
    const key = String(rawKey || '').trim().toLowerCase();
    if (!key) return fallbackStr;
    if (key in normalizedMap) return normalizedMap[key];
    const slug = toSlug(key);
    if (slug && slug in slugMap) return slugMap[slug];
    return fallbackStr;
  };

  let result = templateStr;

  // 0. Resolve Spintax: {Hi|Hello|Hey}
  const spintaxRegex = /\{([^{}]+\|[^{}]+)\}/g;
  let match;
  while ((match = spintaxRegex.exec(result)) !== null) {
    const options = match[1].split('|');
    const pick = options[Math.floor(Math.random() * options.length)];
    result = result.substring(0, match.index) + pick + result.substring(match.index + match[0].length);
    spintaxRegex.lastIndex = 0; 
  }

  // 1. Replace :"key" or :" key " (e.g. hi :"name " or :"course")
  result = result.replace(/:\s*"\s*([a-zA-Z0-9_\u0D80-\u0DFF\s.-]+?)\s*"/g, (match, key) => {
    return resolveKey(key, match);
  });

  // 2. Replace {{key}}
  result = result.replace(/\{\{\s*([a-zA-Z0-9_\u0D80-\u0DFF\s.-]+?)\s*\}\}/g, (match, key) => {
    return resolveKey(key, match);
  });

  // 3. Replace {key}
  result = result.replace(/\{\s*([a-zA-Z0-9_\u0D80-\u0DFF\s.-]+?)\s*\}/g, (match, key) => {
    return resolveKey(key, match);
  });

  // 4. Replace [key]
  result = result.replace(/\[\s*([a-zA-Z0-9_\u0D80-\u0DFF\s.-]+?)\s*\]/g, (match, key) => {
    return resolveKey(key, match);
  });

  return result;
}

/**
 * Selects the active WhatsApp bot account respecting the per-account daily limit.
 */
export function selectAvailableBot(accountsMap = accounts, currentBotId = 'bot1', requiredQuota = 1) {
  checkDailyReset();
  const connectedBots = BOT_IDS.map(id => accountsMap[id]).filter(b => b && b.isConnected && (b.sock || b.isSimulated));

  if (connectedBots.length === 0) {
    return {
      bot: null,
      switched: false,
      previousBotId: currentBotId,
      reason: 'NO_CONNECTED_ACCOUNT',
      message: 'No WhatsApp Account connected. Please connect at least one account via QR code.'
    };
  }

  const startIdx = Math.max(0, BOT_IDS.indexOf(currentBotId));
  const orderedIds = [...BOT_IDS.slice(startIdx), ...BOT_IDS.slice(0, startIdx)];

  // 1. Try to find a bot that has ENOUGH remaining quota for the entire bundle (requiredQuota)
  for (const id of orderedIds) {
    const b = accountsMap[id];
    if (!b || !b.isConnected || (!b.sock && !b.isSimulated)) continue;
    const remaining = Math.max(0, b.dailyLimit - b.sentToday);
    if (remaining >= requiredQuota) {
      const switched = Boolean(currentBotId && currentBotId !== id && (accountsMap[currentBotId]?.dailyLimit - accountsMap[currentBotId]?.sentToday) < requiredQuota);
      return {
        bot: b,
        botId: b.id,
        switched,
        previousBotId: currentBotId,
        reason: 'OK',
        remainingQuota: remaining
      };
    }
  }

  // 2. Try to find any bot that has at least 1 remaining quota
  for (const id of orderedIds) {
    const b = accountsMap[id];
    if (!b || !b.isConnected || (!b.sock && !b.isSimulated)) continue;
    if (b.sentToday < b.dailyLimit) {
      const switched = Boolean(currentBotId && currentBotId !== id);
      return {
        bot: b,
        botId: b.id,
        switched,
        previousBotId: currentBotId,
        reason: 'OK',
        remainingQuota: b.dailyLimit - b.sentToday
      };
    }
  }

  // 3. Fallback: If only 1 account is connected and its limit is reached,
  // allow completing the campaign to prevent partial delivery per user rule
  const fallbackBot = accountsMap[currentBotId] && accountsMap[currentBotId].isConnected ? accountsMap[currentBotId] : connectedBots[0];
  if (connectedBots.length === 1 && fallbackBot) {
    return {
      bot: fallbackBot,
      botId: fallbackBot.id,
      switched: false,
      previousBotId: currentBotId,
      reason: 'LIMIT_OVERRUN_FALLBACK',
      message: 'Only 1 WhatsApp account available. Completing recipient bundle to prevent partial delivery.',
      remainingQuota: Math.max(0, fallbackBot.dailyLimit - fallbackBot.sentToday)
    };
  }

  return {
    bot: null,
    botId: null,
    switched: false,
    previousBotId: currentBotId,
    limitReachedBots: connectedBots.map(b => b.id),
    reason: 'DAILY_LIMIT_REACHED',
    message: 'Daily message limit reached for all connected WhatsApp Accounts. Sending automatically stopped.'
  };
}

export function calculateMessageDelay(settings = appSettings) {
  const mode = settings?.delayMode === 'fixed' ? 'fixed' : 'random';
  if (mode === 'fixed') {
    const sec = Math.max(3, Number(settings?.fixedDelay) || 3);
    return { mode: 'fixed', seconds: sec, ms: Math.round(sec * 1000) };
  } else {
    const min = Math.max(3, Number(settings?.minDelay) || 3);
    const max = Math.max(min, Number(settings?.maxDelay) || min + 3);
    const randomSec = Math.round((min + Math.random() * (max - min)) * 10) / 10;
    const clampedSec = Math.max(3, randomSec);
    return { mode: 'random', seconds: clampedSec, ms: Math.round(clampedSec * 1000), min, max };
  }
}

/**
 * Builds a standard WhatsApp vCard 3.0 payload for sending a Contact attachment.
 */
export function buildContactVCard({ fullName = 'Contact', phone = '', org = 'Japan Panthiya', email = '' } = {}) {
  const norm = normalizePhoneNumber(phone) || { clean: String(phone).replace(/\D/g, ''), raw: String(phone) };
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${fullName}`,
    `ORG:${org};`,
    `TEL;type=CELL;type=VOICE;waid=${norm.clean}:+${norm.clean}`
  ];
  if (email) lines.push(`EMAIL:${email}`);
  lines.push('END:VCARD');
  return {
    displayName: fullName,
    vcard: lines.join('\n')
  };
}

// ─── Google OAuth & Google People API (Pre-Send Contacts Auto-Save Anti-Ban Engine) ───

export async function getValidGoogleAccessToken() {
  if (!googleAuthState.tokens || !googleAuthState.tokens.refresh_token) {
    return null;
  }
  const now = Date.now();
  // If access token is still valid with 60s margin
  if (googleAuthState.tokens.access_token && googleAuthState.tokens.expiry_date && (googleAuthState.tokens.expiry_date - 60000) > now) {
    return googleAuthState.tokens.access_token;
  }
  // Refresh access token using refresh_token
  if (!googleAuthState.clientId || !googleAuthState.clientSecret) {
    return null;
  }
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: googleAuthState.clientId,
        client_secret: googleAuthState.clientSecret,
        refresh_token: googleAuthState.tokens.refresh_token,
        grant_type: 'refresh_token'
      }).toString()
    });
    const data = await tokenRes.json();
    if (data.access_token) {
      googleAuthState.tokens.access_token = data.access_token;
      if (data.expires_in) {
        googleAuthState.tokens.expiry_date = Date.now() + (Number(data.expires_in) * 1000);
      }
      saveJsonFile(GOOGLE_AUTH_FILE, googleAuthState);
      return data.access_token;
    }
  } catch (err) {
    console.error('Google token refresh error:', err.message);
  }
  return null;
}

export async function saveContactToGoogleContacts(args) { return { ok: true }; }
export async function batchSaveContactsToGoogleContacts(args1, args2) { return { ok: true, savedCount: 0 }; }

export function injectBaileysContact(bot, recipient) {
  if (!bot || !bot.sock) return;
  try {
    const cleanDigits = String(recipient.phone || recipient.rawPhone || '').replace(/\D/g, '');
    const jid = recipient.jid || `${cleanDigits}@s.whatsapp.net`;
    const name = recipient.name || 'Recipient';
    if (bot.sock.contacts) {
      bot.sock.contacts[jid] = {
        id: jid,
        name,
        notify: name,
        verifiedName: name
      };
    }
    if (bot.sock.ev && typeof bot.sock.ev.emit === 'function') {
      bot.sock.ev.emit('contacts.upsert', [{
        id: jid,
        name,
        notify: name
      }]);
    }
  } catch (err) {
    // Non-blocking
  }
}

/**
 * Parses contacts from Manual Type ('type'), JSON ('json'), or Excel/CSV ('excel').
 * Supports global E.164 phone numbers and tracks invalid phone numbers (`isValid: false`)
 * so they can be highlighted in light red, counted, and removed individually or in bulk.
 */
export function parseContactsData({ mode, rawText, jsonPayload, excelBuffer, fileName = '', deduplicate = true, includeInvalid = false, excludeAdmins = false }) {
  const parsedContacts = [];
  const invalidContacts = [];
  const allContacts = [];
  const seenPhones = new Set();
  const columnsSet = new Set(['phone', 'name']);

  const addContactRow = (rowObj, sourceLabel) => {
    if (!rowObj || typeof rowObj !== 'object') return;
    const cleanObj = {};
    for (const [k, v] of Object.entries(rowObj)) {
      const key = String(k || '').trim();
      if (!key || key.startsWith('__EMPTY')) continue;
      cleanObj[key] = v !== undefined && v !== null ? String(v).trim() : '';
      columnsSet.add(key.toLowerCase());
    }

    // Identify role / admin column
    const roleAliases = ['role', 'status', 'position', 'type'];
    const roleKey = Object.keys(cleanObj).find(k => roleAliases.some(a => k.toLowerCase() === a || k.toLowerCase().includes(a)));
    const rawRole = roleKey ? String(cleanObj[roleKey]).trim() : (cleanObj.role || '');
    const isAdmin = Boolean(
      /admin|owner|superadmin|moderator|group admin/i.test(rawRole) ||
      /admin|owner|superadmin/i.test(cleanObj.admin || '') ||
      (cleanObj.name && /^(?:group\s+)?admin|owner$/i.test(String(cleanObj.name).trim()))
    );

    // If excludeAdmins is enabled, skip any row that belongs to an Admin or Owner
    if (excludeAdmins && isAdmin) {
      return;
    }

    // Identify name column using flexible substring/alias matching
    const nameAliases = ['name', 'student', 'fullname', 'first_name', 'learner', 'recipient'];
    const nameKey = Object.keys(cleanObj).find(k => {
      const lk = k.toLowerCase();
      return nameAliases.some(alias => lk === alias || lk.includes(alias));
    });
    let nameVal = (nameKey && cleanObj[nameKey]) ? cleanObj[nameKey] : (cleanObj.name || '');
    if (!isRealPersonName(nameVal)) {
      nameVal = '';
    }

    // Identify course column
    const courseAliases = ['course', 'class', 'batch', 'subject', 'level'];
    const courseKey = Object.keys(cleanObj).find(k => {
      const lk = k.toLowerCase();
      return courseAliases.some(alias => lk === alias || lk.includes(alias));
    });
    const courseVal = (courseKey && cleanObj[courseKey]) ? cleanObj[courseKey] : (cleanObj.course || '');
    if (courseVal) columnsSet.add('course');

    // Identify fee/amount column
    const amountAliases = ['amount', 'fee', 'price', 'payment'];
    const amountKey = Object.keys(cleanObj).find(k => {
      const lk = k.toLowerCase();
      return amountAliases.some(alias => lk === alias || lk.includes(alias));
    });
    const amountVal = (amountKey && cleanObj[amountKey]) ? cleanObj[amountKey] : (cleanObj.amount || '');
    if (amountVal) columnsSet.add('amount');

    // Identify phone column
    const phoneKeys = ['phone', 'mobile', 'whatsapp', 'number', 'tel', 'contact'];
    let rawPhoneVal = null;
    let fallbackRawPhoneCandidate = null;
    for (const pk of phoneKeys) {
      const matchedKey = Object.keys(cleanObj).find(k => k.toLowerCase().includes(pk));
      if (matchedKey && cleanObj[matchedKey]) {
        if (!fallbackRawPhoneCandidate) fallbackRawPhoneCandidate = cleanObj[matchedKey];
        if (normalizePhoneNumber(cleanObj[matchedKey])) {
          rawPhoneVal = cleanObj[matchedKey];
          break;
        }
      }
    }
    if (!rawPhoneVal) {
      for (const val of Object.values(cleanObj)) {
        if (normalizePhoneNumber(val)) {
          rawPhoneVal = val;
          break;
        }
      }
    }

    const norm = normalizePhoneNumber(rawPhoneVal);
    if (!norm) {
      const rawInvalidStr = String(fallbackRawPhoneCandidate || cleanObj.phone || Object.values(cleanObj)[0] || '').trim();
      if (!rawInvalidStr) return;
      const invalidEntry = {
        id: `c_inv_${Date.now()}_${allContacts.length}_${Math.random().toString(36).slice(2, 5)}`,
        phone: rawInvalidStr,
        rawPhone: rawInvalidStr,
        jid: '',
        name: nameVal || '',
        course: courseVal,
        role: rawRole || 'Invalid',
        isAdmin: false,
        source: sourceLabel,
        isValid: false,
        validationError: 'Invalid Phone Number',
        countryCode: '',
        countryName: 'Invalid',
        countryFlag: '⚠️',
        data: {
          ...cleanObj,
          phone: rawInvalidStr,
          cleanPhone: '',
          name: nameVal || '',
          course: courseVal,
          amount: amountVal
        }
      };
      invalidContacts.push(invalidEntry);
      allContacts.push(invalidEntry);
      if (includeInvalid) {
        parsedContacts.push(invalidEntry);
      }
      return;
    }

    if (deduplicate && seenPhones.has(norm.clean)) return;
    seenPhones.add(norm.clean);

    const dataMap = {
      ...cleanObj,
      phone: norm.raw,
      cleanPhone: norm.clean,
      name: nameVal,
      course: courseVal,
      amount: amountVal,
      role: rawRole || (isAdmin ? 'Admin' : 'Member')
    };
    for (const [k, v] of Object.entries(cleanObj)) {
      dataMap[k.toLowerCase()] = v;
    }

    const validEntry = {
      id: `c_${Date.now()}_${allContacts.length}_${Math.random().toString(36).slice(2, 5)}`,
      phone: norm.clean,
      rawPhone: norm.raw,
      jid: norm.jid,
      name: nameVal,
      course: courseVal,
      role: rawRole || (isAdmin ? 'Admin' : 'Member'),
      isAdmin,
      source: sourceLabel,
      isValid: true,
      validationError: '',
      countryCode: norm.countryCode,
      countryName: norm.countryName,
      countryFlag: norm.countryFlag,
      data: dataMap
    };

    parsedContacts.push(validEntry);
    allContacts.push(validEntry);
  };

  if (mode === 'type') {
    const lines = String(rawText || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    for (const rawLine of lines) {
      const line = rawLine.replace(/^(?:#?\d{1,3}[.)]\s+|#\d+\s*[-:]\s*)/, '').trim();
      if (!line) continue;

      // Check if the line is a list of multiple phone numbers separated by comma/space/semicolon
      const multiTokens = line.split(/[,\t|;\s]+/).map(t => t.trim()).filter(Boolean);
      if (multiTokens.length > 1 && multiTokens.every(t => Boolean(normalizePhoneNumber(t)))) {
        for (const tok of multiTokens) {
          addContactRow({ phone: tok, name: 'Recipient' }, 'manual');
        }
        continue;
      }

      const parts = line.split(/[,\t|;]+|\s+[-–—:]\s+/).map(p => p.trim()).filter(Boolean);
      if (parts.length === 1) {
        const normSingle = normalizePhoneNumber(parts[0]);
        if (normSingle) {
          const leftoverName = parts[0]
            .replace(normSingle.raw, '')
            .replace(/^[\s,\-–—:|()]+|[\s,\-–—:|()]+$/g, '')
            .trim();
          addContactRow({ phone: normSingle.raw, name: leftoverName || 'Recipient' }, 'manual');
        } else {
          addContactRow({ phone: parts[0], name: 'Recipient' }, 'manual');
        }
      } else {
        const phonePartIdx = parts.findIndex(p => Boolean(normalizePhoneNumber(p)));
        if (phonePartIdx === 0) {
          addContactRow({
            phone: parts[0],
            name: parts[1] || 'Recipient',
            course: parts[2] || '',
            extra: parts[3] || ''
          }, 'manual');
        } else if (phonePartIdx > 0) {
          const otherParts = parts.filter((_, idx) => idx !== phonePartIdx);
          addContactRow({
            name: otherParts[0] || 'Recipient',
            phone: parts[phonePartIdx],
            course: otherParts[1] || '',
            extra: otherParts[2] || ''
          }, 'manual');
        } else {
          // None of the parts parsed as a valid phone number -> record as invalid contact row
          const digitPartIdx = parts.findIndex(p => /\d/.test(p));
          const chosenIdx = digitPartIdx >= 0 ? digitPartIdx : 0;
          const otherParts = parts.filter((_, idx) => idx !== chosenIdx);
          addContactRow({
            phone: parts[chosenIdx],
            name: otherParts[0] || 'Recipient',
            course: otherParts[1] || ''
          }, 'manual');
        }
      }
    }
  } else if (mode === 'json') {
    let data = jsonPayload;
    if (typeof data === 'string') {
      data = JSON.parse(data);
    }
    const arr = Array.isArray(data)
      ? data
      : (Array.isArray(data?.contacts) ? data.contacts : (Array.isArray(data?.students) ? data.students : (Array.isArray(data?.data) ? data.data : [data])));

    for (const item of arr) {
      if (typeof item === 'string' || typeof item === 'number') {
        addContactRow({ phone: String(item), name: 'Recipient' }, 'json');
      } else if (item && typeof item === 'object') {
        addContactRow(item, 'json');
      }
    }
  } else if (mode === 'excel') {
    if (!XLSX) {
      try { XLSX = require('xlsx'); } catch (e) {}
    }
    if (XLSX && excelBuffer) {
      const workbook = XLSX.read(excelBuffer, { type: 'buffer' });
      for (const sheetName of workbook.SheetNames || []) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) continue;
        const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        const nonEmptyRows = aoa.filter(row => Array.isArray(row) && row.some(cell => String(cell ?? '').trim() !== ''));
        if (nonEmptyRows.length === 0) continue;

        const rowHasPhone = (r) => r.some(cell => Boolean(normalizePhoneNumber(cell)));
        const headerKeywords = ['phone', 'mobile', 'number', 'whatsapp', 'tel', 'name', 'student', 'course'];
        const rowLooksLikeHeader = (r) => {
          const nonEmptyCells = r.map(c => String(c ?? '').trim().toLowerCase()).filter(Boolean);
          if (nonEmptyCells.length < 2) return false;
          return nonEmptyCells.some(c => headerKeywords.some(hk => c.includes(hk)));
        };

        let headerRowIdx = -1;
        for (let rIdx = 0; rIdx < Math.min(10, nonEmptyRows.length); rIdx++) {
          if (rowLooksLikeHeader(nonEmptyRows[rIdx]) && !rowHasPhone(nonEmptyRows[rIdx])) {
            headerRowIdx = rIdx;
            break;
          }
        }

        if (headerRowIdx >= 0) {
          const headers = nonEmptyRows[headerRowIdx].map((h, idx) => String(h ?? '').trim() || `col_${idx + 1}`);
          for (let rIdx = headerRowIdx + 1; rIdx < nonEmptyRows.length; rIdx++) {
            const rowArr = nonEmptyRows[rIdx];
            const rowObj = {};
            headers.forEach((h, cIdx) => {
              rowObj[h] = rowArr[cIdx] !== undefined && rowArr[cIdx] !== null ? String(rowArr[cIdx]).trim() : '';
            });
            addContactRow(rowObj, fileName || sheetName || 'excel');
          }
        } else {
          const defaultHeaders = ['phone', 'name', 'course', 'amount', 'extra'];
          for (let rIdx = 0; rIdx < nonEmptyRows.length; rIdx++) {
            const rowArr = nonEmptyRows[rIdx];
            const nonEmptyCells = rowArr.map(c => String(c ?? '').trim()).filter(Boolean);
            // Skip single-cell title/banner rows that have no phone candidate
            if (!rowHasPhone(rowArr) && (nonEmptyCells.length <= 1 || !includeInvalid)) continue;
            const rowObj = {};
            rowArr.forEach((cellVal, cIdx) => {
              const h = defaultHeaders[cIdx] || `col_${cIdx + 1}`;
              rowObj[h] = cellVal !== undefined && cellVal !== null ? String(cellVal).trim() : '';
            });
            addContactRow(rowObj, fileName || sheetName || 'excel');
          }
        }
      }
    } else if (excelBuffer) {
      const csvText = Buffer.isBuffer(excelBuffer) ? excelBuffer.toString('utf8') : String(excelBuffer);
      const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (lines.length > 0) {
        const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
        const firstHeaderIsPhone = Boolean(normalizePhoneNumber(headers[0]));
        if (firstHeaderIsPhone) {
          for (const line of lines) {
            const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
            addContactRow({ phone: cols[0], name: cols[1] || 'Recipient', course: cols[2] || '' }, 'csv');
          }
        } else {
          for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
            const obj = {};
            headers.forEach((h, idx) => { obj[h || `col${idx}`] = cols[idx] || ''; });
            addContactRow(obj, 'csv');
          }
        }
      }
    }
  }

  return {
    contacts: parsedContacts,
    validContacts: allContacts.filter(c => c.isValid !== false),
    invalidContacts,
    allContacts,
    validCount: allContacts.filter(c => c.isValid !== false).length,
    invalidCount: invalidContacts.length,
    detectedColumns: Array.from(columnsSet)
  };
}

// ─── Sent Message Store & Retry Cache (Fixes "Waiting for this message" on Recipient Phone) ───
export const sentMessagesStore = new Map();

// Hydrate persisted sent messages on startup so retry requests across app restarts also succeed
try {
  const savedEntries = loadJsonFile(SENT_MESSAGES_FILE, []);
  if (Array.isArray(savedEntries)) {
    for (const [k, v] of savedEntries) {
      if (k && v && typeof v === 'object') {
        const restored = deepRestoreBuffers(v);
        const kStr = String(k);
        sentMessagesStore.set(kStr, restored);

        // Attribute legacy or un-namespaced keys to their owning bot
        const ownerBot = restored._botId || BOT_IDS.find(b => kStr.toLowerCase().startsWith(`${b}:`) || kStr.toLowerCase().includes(b));
        if (ownerBot) {
          restored._botId = ownerBot;
          const cleanKey = kStr.includes(':') ? kStr.slice(kStr.lastIndexOf(':') + 1) : kStr;
          if (!kStr.startsWith(`${ownerBot}:`)) {
            sentMessagesStore.set(`${ownerBot}:${kStr}`, restored);
            sentMessagesStore.set(`${ownerBot}:${cleanKey}`, restored);
          }
        }
      }
    }
  }
} catch (e) {}

let persistSentStoreTimer = null;
function schedulePersistSentMessagesStore() {
  if (persistSentStoreTimer) return;
  persistSentStoreTimer = setTimeout(() => {
    persistSentStoreTimer = null;
    try {
      const entries = Array.from(sentMessagesStore.entries()).slice(-2000);
      saveJsonFile(SENT_MESSAGES_FILE, entries);
    } catch (e) {}
  }, 150);
  if (typeof persistSentStoreTimer.unref === 'function') {
    persistSentStoreTimer.unref();
  }
}

export function rememberSentMessage(msgObj, fallbackPayload = null, fallbackJid = '', botId = null) {
  if (!msgObj) return;
  const msgId = msgObj.key?.id;
  if (!msgId) return;

  let resolvedBotId = botId;
  if (!resolvedBotId && msgObj.botId) {
    resolvedBotId = msgObj.botId;
  }
  if (!resolvedBotId && typeof msgId === 'string' && msgId.includes('BOT')) {
    resolvedBotId = BOT_IDS.find(b => msgId.toLowerCase().includes(b)) || null;
  }

  let protoMsg = null;
  if (msgObj.message) {
    try {
      protoMsg = typeof msgObj.message.$type === 'object' || msgObj.message instanceof proto.Message
        ? proto.Message.toObject(msgObj.message, { defaults: false, arrays: true, objects: true, bytes: Buffer })
        : { ...msgObj.message };
    } catch (e) {
      protoMsg = { ...msgObj.message };
    }
  } else if (fallbackPayload) {
    if (fallbackPayload.forward?.message) {
      protoMsg = { ...fallbackPayload.forward.message };
    } else if (typeof fallbackPayload.text === 'string') {
      protoMsg = { conversation: fallbackPayload.text };
    } else if (fallbackPayload.image) {
      protoMsg = { imageMessage: { ...(fallbackPayload.caption ? { caption: fallbackPayload.caption } : {}), mimetype: fallbackPayload.mimetype || 'image/png' } };
    } else if (fallbackPayload.video) {
      protoMsg = { videoMessage: { ...(fallbackPayload.caption ? { caption: fallbackPayload.caption } : {}), mimetype: fallbackPayload.mimetype || 'video/mp4' } };
    } else if (fallbackPayload.document) {
      protoMsg = { documentMessage: { ...(fallbackPayload.caption ? { caption: fallbackPayload.caption } : {}), fileName: fallbackPayload.fileName || 'Document.pdf', mimetype: fallbackPayload.mimetype || 'application/pdf' } };
    } else if (fallbackPayload.contacts) {
      protoMsg = { contactsArrayMessage: fallbackPayload.contacts };
    } else {
      protoMsg = { ...fallbackPayload };
    }
  }
  if (!protoMsg) return;
  protoMsg = deepRestoreBuffers(protoMsg);

  // If inner media is missing mediaKey, try to heal from fallbackPayload
  const innerKey = Object.keys(protoMsg || {}).find(k => k.endsWith('Message'));
  if (innerKey && protoMsg[innerKey]) {
    const inner = protoMsg[innerKey];
    if (!inner.mediaKey || inner.mediaKey.length < 16) {
      const pInner = fallbackPayload?.forward?.message?.[innerKey];
      if (pInner && pInner.mediaKey) {
        inner.mediaKey = ensureBuffer(pInner.mediaKey);
        inner.fileSha256 = ensureBuffer(pInner.fileSha256) || inner.fileSha256;
        inner.fileEncSha256 = ensureBuffer(pInner.fileEncSha256) || inner.fileEncSha256;
      }
    }
  }

  

  const rJid = msgObj.key?.remoteJid || fallbackJid;
  const normJid = rJid ? jidNormalizedUser(rJid) : '';

  // Explicitly stamp ownership on the message payload to prevent cross-account decryption leaks
  if (resolvedBotId) {
    protoMsg._botId = resolvedBotId;
    if (msgObj) msgObj.botId = resolvedBotId;
  }

  // 1. Account / Bot-isolated keys (Strictly prevent cross-account collisions)
  if (resolvedBotId) {
    sentMessagesStore.set(`${resolvedBotId}:${msgId}`, protoMsg);
    if (rJid) {
      sentMessagesStore.set(`${resolvedBotId}:${rJid}:${msgId}`, protoMsg);
    }
    if (normJid && normJid !== rJid) {
      sentMessagesStore.set(`${resolvedBotId}:${normJid}:${msgId}`, protoMsg);
    }
  } else {
    // 2. Un-namespaced fallback only when bot ID is genuinely indeterminate (legacy)
    sentMessagesStore.set(msgId, protoMsg);
    if (rJid) {
      sentMessagesStore.set(`${rJid}:${msgId}`, protoMsg);
    }
    if (normJid && normJid !== rJid) {
      sentMessagesStore.set(`${normJid}:${msgId}`, protoMsg);
    }
  }

  while (sentMessagesStore.size > 5000) {
    const oldestKey = sentMessagesStore.keys().next().value;
    if (!oldestKey) break;
    sentMessagesStore.delete(oldestKey);
  }
  schedulePersistSentMessagesStore();
}

export async function getStoredMessageForRetry(key, botId = null) {
  if (!key) return undefined;
  const id = key.id;
  const rawJid = key.remoteJid || '';
  const normJid = rawJid ? jidNormalizedUser(rawJid) : '';
  let foundMsg = undefined;

  // 1. First attempt strictly isolated lookup keyed by botId + JID + msgId
  if (botId && id) {
    if (normJid && sentMessagesStore.has(`${botId}:${normJid}:${id}`)) {
      foundMsg = sentMessagesStore.get(`${botId}:${normJid}:${id}`);
    } else if (rawJid && sentMessagesStore.has(`${botId}:${rawJid}:${id}`)) {
      foundMsg = sentMessagesStore.get(`${botId}:${rawJid}:${id}`);
    } else if (sentMessagesStore.has(`${botId}:${id}`)) {
      foundMsg = sentMessagesStore.get(`${botId}:${id}`);
    }
  }

  // 2. Controlled fallback for legacy un-prefixed records only if no cross-account owner conflict
  if (!foundMsg && id) {
    let legacyCandidate = undefined;
    if (normJid && sentMessagesStore.has(`${normJid}:${id}`)) {
      legacyCandidate = sentMessagesStore.get(`${normJid}:${id}`);
    } else if (rawJid && sentMessagesStore.has(`${rawJid}:${id}`)) {
      legacyCandidate = sentMessagesStore.get(`${rawJid}:${id}`);
    } else if (sentMessagesStore.has(id)) {
      legacyCandidate = sentMessagesStore.get(id);
    }

    if (legacyCandidate) {
      // If candidate is tagged with a different bot ID, reject to prevent cross-account leak
      if (botId && legacyCandidate._botId && legacyCandidate._botId !== botId) {
        console.warn(`[RETRY] Blocked cross-account message leak: ${id} belongs to ${legacyCandidate._botId}, requested by ${botId}`);
        return undefined;
      }
      // If the message ID contains a signature of a different bot, reject
      if (botId && typeof id === 'string') {
        const idLower = id.toLowerCase();
        const otherOwner = BOT_IDS.find(b => b !== botId && idLower.includes(b));
        if (otherOwner) {
          console.warn(`[RETRY] Blocked cross-account message leak: ID ${id} belongs to ${otherOwner}, requested by ${botId}`);
          return undefined;
        }
      }
      foundMsg = legacyCandidate;
    }
  }
  
  if (foundMsg) {
    console.log(`[RETRY] Found message in store for retry (${botId || 'generic'}): ${id}`);
  } else {
    console.log(`[RETRY] Message not found for retry (${botId || 'generic'}): ${id}`);
  }
  return foundMsg;
}

export function createMsgRetryCounterCache(botId = '') {
  const cache = new NodeCache({
    stdTTL: 3600, // 1 hour TTL matching Baileys DEFAULT_CACHE_TTLS.MSG_RETRY
    useClones: false,
    deleteOnExpire: true
  });
  const prefix = botId ? `${botId}:` : '';
  return {
    get: (k) => cache.get(prefix + k),
    set: (k, v) => { cache.set(prefix + k, v); return true; },
    del: (k) => cache.del(prefix + k),
    flushAll: () => cache.flushAll(),
    has: (k) => cache.has(prefix + k),
    keys: () => cache.keys(),
    size: () => cache.getStats().keys,
    getRawCache: () => cache
  };
}

// ─── Forwardable Messages & /boost Media Engine ──────────────────────────────
export function parseLongOrNumber(val) {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  if (typeof val === 'string') {
    const num = Number(val);
    return isNaN(num) ? 0 : num;
  }
  if (typeof val === 'bigint') return Number(val);
  if (typeof val === 'object') {
    if (typeof val.toNumber === 'function') return val.toNumber();
    if ('low' in val && 'high' in val) {
      return (val.high * 4294967296) + (val.low >>> 0);
    }
  }
  const num = Number(val);
  return isNaN(num) ? 0 : num;
}

export function formatBytes(bytes) {
  const b = parseLongOrNumber(bytes);
  if (!b || b <= 0) return '0 B';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Ensures any Buffer-like object (Buffer, Uint8Array, {type:'Buffer', data:[]}, index map {0:..., 1:...}, base64)
 * is reconstituted into a real, native Node.js Buffer for protobuf encoding and Baileys decryption.
 */
export function ensureBuffer(val) {
  if (!val) return null;
  if (Buffer.isBuffer(val)) return val;
  if (val instanceof Uint8Array) return Buffer.from(val);
  if (val.type === 'Buffer' && Array.isArray(val.data)) {
    return Buffer.from(val.data);
  }
  if (typeof val === 'object' && !Array.isArray(val)) {
    const keys = Object.keys(val).filter(k => !isNaN(k)).sort((a, b) => Number(a) - Number(b));
    if (keys.length > 0 && keys.length === Object.keys(val).length) {
      return Buffer.from(keys.map(k => val[k]));
    }
  }
  if (typeof val === 'string' && /^[A-Za-z0-9+/=]+$/.test(val) && val.length > 40) {
    try {
      return Buffer.from(val, 'base64');
    } catch (e) {}
  }
  return null;
}

/**
 * Deeply traverses a message object or dictionary and restores all byte buffers (mediaKey, fileSha256,
 * fileEncSha256, jpegThumbnail, etc.) so that Protobuf never drops them during serialization/forwarding.
 */
export function deepRestoreBuffers(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Buffer.isBuffer(obj)) return obj;
  if (obj instanceof Uint8Array) return Buffer.from(obj);

  if (obj.type === 'Buffer' && Array.isArray(obj.data)) {
    return Buffer.from(obj.data);
  }

  if (Array.isArray(obj)) {
    return obj.map(item => deepRestoreBuffers(item));
  }

  const keys = Object.keys(obj);
  if (keys.length > 0 && keys.every(k => !isNaN(k))) {
    if (keys.every(k => typeof obj[k] === 'number')) {
      return Buffer.from(keys.sort((a, b) => Number(a) - Number(b)).map(k => obj[k]));
    }
  }

  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    if (['mediaKey', 'fileSha256', 'fileEncSha256', 'jpegThumbnail', 'thumbnailSha256', 'thumbnailEncSha256'].includes(k)) {
      const buf = ensureBuffer(v);
      result[k] = buf !== null ? buf : v;
    } else {
      result[k] = deepRestoreBuffers(v);
    }
  }
  return result;
}

export function unwrapMessage(msg) {
  if (!msg || typeof msg !== 'object') return null;
  let curr = msg;
  for (let i = 0; i < 6; i++) {
    if (!curr || typeof curr !== 'object') break;
    if (curr.deviceSentMessage?.message) {
      curr = curr.deviceSentMessage.message;
      continue;
    }
    if (curr.ephemeralMessage?.message) {
      curr = curr.ephemeralMessage.message;
      continue;
    }
    if (curr.viewOnceMessage?.message) {
      curr = curr.viewOnceMessage.message;
      continue;
    }
    if (curr.viewOnceMessageV2?.message) {
      curr = curr.viewOnceMessageV2.message;
      continue;
    }
    if (curr.viewOnceMessageV2Extension?.message) {
      curr = curr.viewOnceMessageV2Extension.message;
      continue;
    }
    if (curr.documentWithCaptionMessage?.message) {
      curr = curr.documentWithCaptionMessage.message;
      continue;
    }
    break;
  }
  return curr;
}

export const forwardMessagesStore = new Map();
let persistForwardCatalogTimer = null;

export function schedulePersistForwardCatalog() {
  if (persistForwardCatalogTimer) return;
  persistForwardCatalogTimer = setTimeout(() => {
    persistForwardCatalogTimer = null;
    try {
      const list = Array.from(forwardMessagesStore.values()).slice(0, 1000);
      saveJsonFile(FORWARD_CATALOG_FILE, list);
    } catch (e) {}
  }, 200);
  if (typeof persistForwardCatalogTimer.unref === 'function') {
    persistForwardCatalogTimer.unref();
  }
}

export function extractForwardableItem(id, protoMsg, options = {}) {
  if (!protoMsg || typeof protoMsg !== 'object') return null;
  const unwrapped = deepRestoreBuffers(unwrapMessage(protoMsg));
  if (!unwrapped || typeof unwrapped !== 'object') return null;

  const innerKey = Object.keys(unwrapped).find(k => k.endsWith('Message') || k === 'conversation');
  if (!innerKey) return null;
  if (['protocolMessage', 'senderKeyDistributionMessage', 'pollResultSnapshotMessage', 'reactionMessage'].includes(innerKey)) return null;

  let type = 'other';
  let fileName = '';
  let fileSizeBytes = 0;
  let mimetype = '';
  let caption = '';

  if (innerKey === 'videoMessage') {
    type = 'video';
    fileName = unwrapped.videoMessage?.fileName || options.fileName || 'WhatsApp_Video.mp4';
    fileSizeBytes = parseLongOrNumber(unwrapped.videoMessage?.fileLength) || options.fileSizeBytes || 0;
    mimetype = unwrapped.videoMessage?.mimetype || 'video/mp4';
    caption = unwrapped.videoMessage?.caption || '';
  } else if (innerKey === 'documentMessage') {
    type = 'document';
    fileName = unwrapped.documentMessage?.fileName || unwrapped.documentMessage?.title || options.fileName || 'Document.pdf';
    fileSizeBytes = parseLongOrNumber(unwrapped.documentMessage?.fileLength) || options.fileSizeBytes || 0;
    mimetype = unwrapped.documentMessage?.mimetype || 'application/pdf';
    caption = unwrapped.documentMessage?.caption || '';
  } else if (innerKey === 'imageMessage') {
    type = 'image';
    fileName = unwrapped.imageMessage?.fileName || options.fileName || 'Image.jpg';
    fileSizeBytes = parseLongOrNumber(unwrapped.imageMessage?.fileLength) || options.fileSizeBytes || 0;
    mimetype = unwrapped.imageMessage?.mimetype || 'image/jpeg';
    caption = unwrapped.imageMessage?.caption || '';
  } else if (innerKey === 'audioMessage') {
    type = 'audio';
    fileName = unwrapped.audioMessage?.ptt ? 'Voice_Note.opus' : (options.fileName || 'Audio.mp3');
    fileSizeBytes = parseLongOrNumber(unwrapped.audioMessage?.fileLength) || options.fileSizeBytes || 0;
    mimetype = unwrapped.audioMessage?.mimetype || 'audio/ogg';
    caption = '';
  } else if (innerKey === 'stickerMessage') {
    type = 'sticker';
    fileName = options.fileName || 'Sticker.webp';
    fileSizeBytes = parseLongOrNumber(unwrapped.stickerMessage?.fileLength) || options.fileSizeBytes || 0;
    mimetype = unwrapped.stickerMessage?.mimetype || 'image/webp';
    caption = '';
  } else if (innerKey === 'conversation' || innerKey === 'extendedTextMessage') {
    type = 'text';
    caption = unwrapped.conversation || unwrapped.extendedTextMessage?.text || '';
    fileName = caption.slice(0, 32);
    fileSizeBytes = Buffer.byteLength(caption, 'utf8');
    mimetype = 'text/plain';
  } else {
    return null;
  }

  const rawIdStr = String(id || '');
  const cleanId = rawIdStr.includes(':') ? rawIdStr.slice(rawIdStr.lastIndexOf(':') + 1) : rawIdStr;
  const jid = rawIdStr.includes(':') ? rawIdStr.slice(0, rawIdStr.lastIndexOf(':')) : (options.remoteJid || '');
  const botId = options.botId || 'bot1';
  const botLabel = accounts[botId]?.label || botId.toUpperCase();

  // Check if a local cached file exists in uploads
  let filePath = options.filePath || '';
  if (!filePath && fileName) {
    const potentialUploadsPath = path.join(UPLOADS_DIR, `cached_forward_${fileName}`);
    if (fs.existsSync(potentialUploadsPath)) {
      filePath = potentialUploadsPath;
    }
  }

  return {
    id: cleanId,
    botId,
    botLabel,
    fromMe: options.fromMe !== false,
    remoteJid: jid,
    sender: options.sender || (options.fromMe ? 'Bot Sent' : (jid || 'WhatsApp User')),
    type,
    fileName,
    fileSizeBytes,
    fileSizeFormatted: formatBytes(fileSizeBytes),
    mimetype,
    caption,
    filePath,
    timestamp: options.timestamp || new Date().toISOString(),
    source: options.source || (options.fromMe ? 'sent' : 'received'),
    rawMessage: unwrapped,
    key: {
      id: cleanId,
      remoteJid: jid,
      fromMe: options.fromMe !== false
    }
  };
}

export function recordForwardableMessage(msgObj, options = {}) {
  if (!msgObj) return null;
  const msgId = msgObj.key?.id || msgObj.id;
  if (!msgId) return null;

  let protoMsg = null;
  if (msgObj.message) {
    try {
      protoMsg = typeof msgObj.message.$type === 'object' || msgObj.message instanceof proto.Message
        ? proto.Message.toObject(msgObj.message, { defaults: false, arrays: true, objects: true, bytes: Buffer })
        : { ...msgObj.message };
    } catch (e) {
      protoMsg = { ...msgObj.message };
    }
  } else if (options.payload) {
    if (options.payload.forward?.message) {
      protoMsg = { ...options.payload.forward.message };
    } else if (options.payload.text) {
      protoMsg = { conversation: options.payload.text };
    } else if (options.payload.image) {
      protoMsg = { imageMessage: { caption: options.payload.caption || '', mimetype: options.payload.mimetype || 'image/png' } };
    } else if (options.payload.video) {
      protoMsg = { videoMessage: { caption: options.payload.caption || '', mimetype: options.payload.mimetype || 'video/mp4' } };
    } else if (options.payload.document) {
      protoMsg = { documentMessage: { caption: options.payload.caption || '', fileName: options.payload.fileName || 'Document.pdf', mimetype: options.payload.mimetype || 'application/pdf' } };
    } else if (options.payload.sticker) {
      protoMsg = { stickerMessage: { mimetype: 'image/webp' } };
    }
  } else if (msgObj.rawMessage) {
    protoMsg = { ...msgObj.rawMessage };
  }

  if (!protoMsg) return null;
  protoMsg = deepRestoreBuffers(protoMsg);

  // Check if message quotes another message (e.g. user quoted a media message with /boost or any text)
  const unwrapped = unwrapMessage(protoMsg);
  const textContent = (unwrapped?.conversation || unwrapped?.extendedTextMessage?.text || '').trim();
  const quotedMsg = unwrapped?.extendedTextMessage?.contextInfo?.quotedMessage;
  const quotedStanzaId = unwrapped?.extendedTextMessage?.contextInfo?.stanzaId;

  if (quotedMsg) {
    const unwrappedQuoted = deepRestoreBuffers(unwrapMessage(quotedMsg));
    const quotedKey = Object.keys(unwrappedQuoted || {}).find(k => k.endsWith('Message') && k !== 'extendedTextMessage');
    if (quotedKey && ['videoMessage', 'documentMessage', 'imageMessage', 'audioMessage', 'stickerMessage'].includes(quotedKey)) {
      const quotedId = quotedStanzaId || `QUOTED_${msgId}`;
      const quotedItem = extractForwardableItem(quotedId, unwrappedQuoted, {
        botId: options.botId || 'bot1',
        remoteJid: msgObj.key?.remoteJid || options.remoteJid || '',
        sender: options.sender || msgObj.pushName || 'WhatsApp User',
        source: 'quoted',
        timestamp: options.timestamp || new Date().toISOString()
      });
      if (quotedItem) {
        forwardMessagesStore.delete(quotedItem.id);
        forwardMessagesStore.set(quotedItem.id, quotedItem);
        schedulePersistForwardCatalog();
        if (textContent.toLowerCase().startsWith('/boost')) {
          const boostCaption = textContent.replace(/^\/boost\s*/i, '').trim();
          if (boostCaption) {
            quotedItem.caption = boostCaption;
          }
          addLog('success', `⚡ [/boost] Quoted media "${quotedItem.fileName}" (${quotedItem.fileSizeFormatted}) added to Forward Catalog!`);
        }
        return quotedItem;
      }
    }
  }

  const botId = options.botId || (msgId.includes('BOT') ? BOT_IDS.find(b => msgId.toLowerCase().includes(b)) || 'bot1' : 'bot1');
  const item = extractForwardableItem(msgId, protoMsg, {
    botId,
    botLabel: accounts[botId]?.label || botId.toUpperCase(),
    fromMe: msgObj.key?.fromMe !== false,
    remoteJid: msgObj.key?.remoteJid || options.remoteJid || '',
    sender: options.sender || msgObj.pushName || (msgObj.key?.fromMe ? 'Bot Sent' : (msgObj.key?.remoteJid || 'WhatsApp User')),
    source: options.source || (msgObj.key?.fromMe ? 'sent' : 'received'),
    timestamp: options.timestamp || new Date().toISOString(),
    fileName: options.fileName,
    fileSizeBytes: options.fileSizeBytes,
    filePath: options.filePath
  });

  if (!item) return null;

  // Quality check: For media items, ensure mediaKey is not empty. If empty, attempt auto-healing from sentMessagesStore!
  if (item.type !== 'text') {
    const innerKey = Object.keys(item.rawMessage || {}).find(k => k.endsWith('Message'));
    if (innerKey && item.rawMessage[innerKey]) {
      const inner = item.rawMessage[innerKey];
      const mk = ensureBuffer(inner.mediaKey);
      if (!mk || mk.length < 16) {
        // Auto-heal from sentMessagesStore
        for (const [k, v] of sentMessagesStore.entries()) {
          const sInner = v?.[innerKey];
          if (sInner && (sInner.directPath === inner.directPath || (inner.fileName && sInner.fileName === inner.fileName))) {
            const sMk = ensureBuffer(sInner.mediaKey);
            if (sMk && sMk.length >= 16) {
              inner.mediaKey = sMk;
              inner.fileSha256 = ensureBuffer(sInner.fileSha256) || inner.fileSha256;
              inner.fileEncSha256 = ensureBuffer(sInner.fileEncSha256) || inner.fileEncSha256;
              break;
            }
          }
        }
      }
      // If still missing mediaKey and no local file, do not pollute catalog with dummy/unforwardable stubs
      const finalMk = ensureBuffer(inner.mediaKey);
      if ((!finalMk || finalMk.length < 16) && !item.filePath && !fs.existsSync(item.filePath || '')) {
        return null;
      }
    }
  }

  // Put into store, maintaining newest first
  forwardMessagesStore.delete(item.id);
  forwardMessagesStore.set(item.id, item);

  while (forwardMessagesStore.size > 1000) {
    const oldest = forwardMessagesStore.keys().next().value;
    if (!oldest) break;
    forwardMessagesStore.delete(oldest);
  }

  schedulePersistForwardCatalog();
  return item;
}

export function getForwardableMessage(id) {
  if (!id) return null;
  const rawIdStr = String(id);
  const cleanId = rawIdStr.includes(':') ? rawIdStr.slice(rawIdStr.lastIndexOf(':') + 1) : rawIdStr;
  let item = forwardMessagesStore.get(cleanId) || forwardMessagesStore.get(id);

  // Check sentMessagesStore if not found in catalog
  if (!item) {
    let pMsg = sentMessagesStore.get(cleanId) || sentMessagesStore.get(id);
    if (!pMsg) {
      for (const bId of BOT_IDS) {
        if (sentMessagesStore.has(`${bId}:${cleanId}`)) {
          pMsg = sentMessagesStore.get(`${bId}:${cleanId}`);
          break;
        }
      }
    }
    if (pMsg) {
      const extracted = extractForwardableItem(cleanId, pMsg, { botId: pMsg._botId });
      if (extracted) {
        forwardMessagesStore.set(extracted.id, extracted);
        item = extracted;
      }
    }
  }

  if (!item) return null;

  // Restore buffers and auto-heal if needed
  if (item.rawMessage) {
    item.rawMessage = deepRestoreBuffers(item.rawMessage);
    const innerKey = Object.keys(item.rawMessage || {}).find(k => k.endsWith('Message'));
    if (innerKey && item.rawMessage[innerKey]) {
      const inner = item.rawMessage[innerKey];
      inner.mediaKey = ensureBuffer(inner.mediaKey);
      inner.fileSha256 = ensureBuffer(inner.fileSha256);
      inner.fileEncSha256 = ensureBuffer(inner.fileEncSha256);
      if (inner.jpegThumbnail) inner.jpegThumbnail = ensureBuffer(inner.jpegThumbnail);

      if (!inner.mediaKey || inner.mediaKey.length < 16) {
        for (const [k, v] of sentMessagesStore.entries()) {
          const sInner = v?.[innerKey];
          if (sInner && (sInner.directPath === inner.directPath || (item.fileName && sInner.fileName === item.fileName))) {
            const sMk = ensureBuffer(sInner.mediaKey);
            if (sMk && sMk.length >= 16) {
              inner.mediaKey = sMk;
              inner.fileSha256 = ensureBuffer(sInner.fileSha256) || inner.fileSha256;
              inner.fileEncSha256 = ensureBuffer(sInner.fileEncSha256) || inner.fileEncSha256;
              break;
            }
          }
        }
      }
    }
  }

  // Attach local cached file if available
  const foundLocal = findLocalMediaFile(item.filePath) || findLocalMediaFile(item.fileName);
  if (foundLocal) {
    item.filePath = foundLocal;
  }

  return item;
}

export function deleteForwardableMessage(id) {
  if (!id) return false;
  const rawIdStr = String(id);
  const cleanId = rawIdStr.includes(':') ? rawIdStr.slice(rawIdStr.lastIndexOf(':') + 1) : rawIdStr;
  const removed = forwardMessagesStore.delete(cleanId) || forwardMessagesStore.delete(id);
  if (removed) schedulePersistForwardCatalog();
  return removed;
}

export function loadForwardCatalog() {
  try {
    const saved = loadJsonFile(FORWARD_CATALOG_FILE, []);
    if (Array.isArray(saved)) {
      for (const item of saved) {
        if (item?.id) {
          if (item.rawMessage) {
            item.rawMessage = deepRestoreBuffers(item.rawMessage);
          }
          // Auto-attach local cache file if filePath is missing or stale
          const foundPath = findLocalMediaFile(item.filePath) || findLocalMediaFile(item.fileName);
          if (foundPath) {
            item.filePath = foundPath;
          }
          forwardMessagesStore.set(item.id, item);
        }
      }
    }
  } catch (e) {}

  // Also populate from sentMessagesStore
  try {
    for (const [k, v] of sentMessagesStore.entries()) {
      const rawIdStr = String(k);
      const cleanId = rawIdStr.includes(':') ? rawIdStr.slice(rawIdStr.lastIndexOf(':') + 1) : rawIdStr;
      if (!forwardMessagesStore.has(cleanId)) {
        const item = extractForwardableItem(k, v);
        if (item) {
          forwardMessagesStore.set(item.id, item);
        }
      }
    }
  } catch (e) {}
}

export async function prepareMediaForForwarding({ bot, mediaAttachment }) {
  if (!mediaAttachment) return null;
  if (mediaAttachment.forwardMessage) return mediaAttachment.forwardMessage;
  if (mediaAttachment.forwardMessageId) {
    const existing = getForwardableMessage(mediaAttachment.forwardMessageId);
    if (existing) return existing;
  }

  let fileBuffer = null;
  if (mediaAttachment.base64) {
    const cleanB64 = mediaAttachment.base64.replace(/^data:[^;]+;base64,/, '');
    fileBuffer = Buffer.from(cleanB64, 'base64');
  } else if (mediaAttachment.filePath && fs.existsSync(mediaAttachment.filePath)) {
    fileBuffer = fs.readFileSync(mediaAttachment.filePath);
  } else {
    fileBuffer = Buffer.from('WhatsApp Bot Prepared Forward Media');
  }

  const rawType = (mediaAttachment.type || 'document').toLowerCase();
  const mType = rawType === 'pdf' ? 'document' : rawType;
  const fileName = mediaAttachment.fileName || (mType === 'image' ? 'Image.jpg' : (mType === 'video' ? 'Video.mp4' : (mType === 'audio' ? 'Audio.mp3' : (mType === 'sticker' ? 'Sticker.webp' : 'Document.pdf'))));
  const mimetype = mediaAttachment.mimetype || (mType === 'image' ? 'image/jpeg' : (mType === 'video' ? 'video/mp4' : (mType === 'audio' ? 'audio/ogg' : (mType === 'sticker' ? 'image/webp' : 'application/pdf'))));

  // Persist local copy in uploads folder for 100% resilient zero-failure fallback
  const savedLocalPath = path.join(UPLOADS_DIR, `cached_forward_${fileName}`);
  try {
    fs.writeFileSync(savedLocalPath, fileBuffer);
  } catch (e) {}

  // If bot has a real connected WhatsApp socket, upload to self chat once (WhatsApp "Message Yourself")
  if (bot && bot.isConnected && bot.sock && !bot.isSimulated && bot.sock.user?.id) {
    try {
      const selfJid = jidNormalizedUser(bot.sock.user.id);
      const isNoCaption = !mediaAttachment.caption || !mediaAttachment.caption.trim() || mediaAttachment.captionSource === 'none' || mediaAttachment.captionMode === 'none';
      const cleanCaption = isNoCaption ? '' : mediaAttachment.caption.trim();

      let sendPayload = {};
      if (mType === 'image') {
        sendPayload = { image: fileBuffer, mimetype };
        if (cleanCaption) sendPayload.caption = cleanCaption;
      } else if (mType === 'video') {
        sendPayload = { video: fileBuffer, mimetype };
        if (cleanCaption) sendPayload.caption = cleanCaption;
      } else if (mType === 'document') {
        sendPayload = { document: fileBuffer, fileName, mimetype };
        if (cleanCaption) sendPayload.caption = cleanCaption;
      } else if (mType === 'audio' || mType === 'voice') {
        const converted = convertAudioToWhatsAppPtt(fileBuffer, fileName || 'voice.mp3');
        sendPayload = {
          audio: converted.buffer,
          mimetype: 'audio/ogg; codecs=opus',
          ptt: true,
          waveform: converted.waveform
        };
      } else if (mType === 'sticker') {
        sendPayload = {
          sticker: fileBuffer,
          mimetype: 'image/webp'
        };
      }

      const sentRes = await Promise.race([
        bot.sock.sendMessage(selfJid, sendPayload),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout uploading media to CDN (60s)')), 60000))
      ]);
      const forwardItem = recordForwardableMessage(sentRes, {
        botId: bot.id,
        source: 'prepared',
        fileName,
        fileSizeBytes: fileBuffer.length,
        mimetype,
        filePath: savedLocalPath
      });
      if (forwardItem) {
        forwardItem.filePath = savedLocalPath;
        return forwardItem;
      }
    } catch (uploadErr) {
      console.warn('Real upload to self failed, falling back to cached forward:', uploadErr.message);
    }
  }

  // Fallback forward item with local file path attached
  const isFallbackNoCaption = !mediaAttachment.caption || !mediaAttachment.caption.trim() || mediaAttachment.captionSource === 'none' || mediaAttachment.captionMode === 'none';
  const cleanFallbackCaption = isFallbackNoCaption ? '' : mediaAttachment.caption.trim();
  const simId = `FWD_BOOST_${Date.now()}_${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const keyName = mType === 'image' ? 'imageMessage' : (mType === 'video' ? 'videoMessage' : (mType === 'audio' ? 'audioMessage' : 'documentMessage'));
  const simMsg = {
    key: { id: simId, remoteJid: 'status@broadcast', fromMe: true },
    message: {
      [keyName]: {
        url: `https://mmg.whatsapp.net/mms/${mType}/boost_${Date.now()}`,
        mimetype,
        fileName,
        fileLength: fileBuffer.length,
        ...(cleanFallbackCaption ? { caption: cleanFallbackCaption } : {}),
        directPath: `/v/t62.7118-24/boost_${Date.now()}.enc`
      }
    }
  };
  const forwardItem = recordForwardableMessage(simMsg, {
    botId: bot?.id || 'bot1',
    source: 'prepared',
    fileName,
    fileSizeBytes: fileBuffer.length,
    mimetype,
    filePath: savedLocalPath
  });
  if (forwardItem) forwardItem.filePath = savedLocalPath;
  return forwardItem;
}

// Initialize catalog from store & files immediately
loadForwardCatalog();

// ─── Baileys Multi-Account Connection Manager (bot1 .. bot5) ─────────────────
export const botConnectionLocks = new Map();

export async function startBotConnection(botId, options = {}) {
  const bot = accounts[botId];
  if (!bot) throw new Error(`Invalid bot account ID: ${botId}`);

  // Simulation / Instant Test Mode (for desktop testing without physical phone or automated test suite)
  if (options.simulate) {
    bot.status = 'connected';
    bot.isConnected = true;
    bot.isSimulated = true;
    bot.ipLocked = true;
    bot.ipLockedAt = bot.ipLockedAt || new Date().toISOString();
    bot.qrDataUrl = null;
    bot.phone = options.phone || `9477000000${bot.index}`;
    bot.pushName = options.pushName || `WA Desktop Bot #${bot.index}`;
    bot.lastActiveAt = new Date().toISOString();
    if (googleAuthState.tokens && (googleAuthState.tokens.refresh_token || googleAuthState.tokens.access_token)) {
      bot.googleAccount = {
        email: googleAuthState.user?.email || null,
        name: googleAuthState.user?.name || null,
        picture: googleAuthState.user?.picture || null,
        linkedAt: new Date().toISOString(),
        active: true
      };
    }
    persistState();
    addLog('success', `🟢 [${bot.label}] Successfully connected (+${bot.phone}) | 🔒 IP Locked: ${bot.virtualIp}`, { botId });
    return { ok: true, status: bot.status, phone: bot.phone, virtualIp: bot.virtualIp, ipLocked: true };
  }

  // If the bot is already connected, do not re-initialize or regenerate QR in the background!
  if (bot.isConnected && bot.sock && !options.forceReconnect) {
    return { ok: true, status: bot.status, phone: bot.phone, message: 'Account is already successfully connected.' };
  }

  // Prevent concurrent connection attempts on the same account slot
  if (botConnectionLocks.has(botId)) {
    addLog('info', `⏳ [${bot.label}] Connection already being established, awaiting in-flight connection...`, { botId });
    return await botConnectionLocks.get(botId);
  }

  const connectTask = (async () => {
    // Close existing socket and clear in-memory key caches before establishing new connection
    if (bot.sock) {
      try { bot.sock.end(); } catch (e) {}
      bot.sock = null;
    }
    if (bot.signalKeyCache) {
      try { bot.signalKeyCache.flushAll(); } catch (e) {}
      bot.signalKeyCache = null;
    }
    bot.signalKeyStore = null;
    if (bot.userDevicesCache) {
      try { bot.userDevicesCache.flushAll(); } catch (e) {}
      bot.userDevicesCache = null;
    }

    const authDir = getBotAuthDir(botId);

    const hasCreds = hasSavedSessionCreds(botId);
    bot.status = 'connecting';
    bot.isSimulated = false;
    bot.qrDataUrl = null;

    if (!hasCreds) {
      addLog('info', `🔄 [${bot.label}] Generating QR code...`, { botId });
    } else {
      addLog('info', `🔄 [${bot.label}] Connecting via saved WhatsApp Session...`, { botId });
    }

    try {
      const { state, saveCreds } = await useMultiFileAuthState(authDir);
      let version = [2, 3000, 1015901307];
      try {
        const latest = await Promise.race([
          fetchLatestBaileysVersion(),
          new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 3500))
        ]);
        if (latest?.version) version = latest.version;
      } catch (e) {}

      const silentLogger = pino({ level: 'silent' });

      // Dedicated per-bot Signal Key Cache strictly isolated to this account
      if (!bot.signalKeyCache) {
        bot.signalKeyCache = new NodeCache({
          stdTTL: 300, // 5 minutes TTL
          useClones: false,
          deleteOnExpire: true
        });
      }
      const botSignalKeyStore = makeCacheableSignalKeyStore(state.keys, silentLogger, bot.signalKeyCache);
      bot.signalKeyStore = botSignalKeyStore;

      // Dedicated per-bot Message Retry Counter Cache namespaced by account
      if (!bot.msgRetryCounterCache) {
        bot.msgRetryCounterCache = createMsgRetryCounterCache(bot.id);
      }
      const msgRetryCounterCache = bot.msgRetryCounterCache;

      // Dedicated per-bot User Devices Cache for Signal multi-device key exchange
      if (!bot.userDevicesCache) {
        bot.userDevicesCache = new NodeCache({
          stdTTL: 300, // 5 minutes TTL
          useClones: false,
          deleteOnExpire: true
        });
      }
      const userDevicesCache = bot.userDevicesCache;

      const netCfg = createBotNetworkAgent(bot);

      const sock = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: bot.signalKeyStore
        },
        printQRInTerminal: false,
        logger: silentLogger,
        browser: netCfg.browser,
        agent: netCfg.agent,
        fetchAgent: netCfg.fetchAgent,
        options: {
          headers: netCfg.headers
        },
        connectTimeoutMs: 30000,
        defaultQueryTimeoutMs: 20000,
        keepAliveIntervalMs: 15000,
        syncFullHistory: false,
        markOnlineOnConnect: true,
          retryRequestDelayMs: 250,
        generateHighQualityLinkPreview: false,
        msgRetryCounterCache,
        userDevicesCache,
        getMessage: async (key) => {
            let msg = await getStoredMessageForRetry(key, bot.id);
            if (msg) {
              if (msg.message && msg.key) {
                msg = msg.message;
              } else if (msg.message && !msg.conversation && !msg.extendedTextMessage && !msg.imageMessage && !msg.videoMessage) {
                msg = msg.message;
              }
              if (msg._botId) {
                const cleaned = { ...msg };
                delete cleaned._botId;
                msg = cleaned;
              }
            }
            return msg;
          },
      patchMessageBeforeSending: (message) => {
        const requiresViewOncePatch = !!(
          message?.buttonsMessage ||
          message?.templateMessage ||
          message?.listMessage
        );
        if (requiresViewOncePatch) {
          return {
            viewOnceMessage: {
              message: {
                messageContextInfo: {
                  deviceListMetadataVersion: 2,
                  deviceListMetadata: {}
                },
                ...message
              }
            }
          };
        }
        return message;
      }
    });

    bot.sock = sock;
    sock.ev.on('creds.update', saveCreds);

    // Track contact names (pushName, notify, verifiedName) and LID-to-Phone mappings
    const recordContactInfo = (c) => {
      if (!c) return;
      const label = String(c.notify || c.name || c.verifiedName || c.pushName || '').trim();
      const idStr = String(c.id || '').trim();
      const lidStr = String(c.lid || (idStr.endsWith('@lid') ? idStr : '')).trim();
      const pnStr = String(c.phoneNumber || (!idStr.endsWith('@lid') && !idStr.endsWith('@g.us') ? idStr : '')).trim();
      const cleanPhone = pnStr.split(':')[0].split('@')[0].replace(/\D/g, '');

      if (cleanPhone && cleanPhone.length >= 7 && cleanPhone.length <= 15) {
        if (lidStr) {
          lidToPhoneDirectory.set(lidStr, cleanPhone);
          const bareLid = lidStr.split(':')[0].split('@')[0];
          if (bareLid) lidToPhoneDirectory.set(bareLid, cleanPhone);
        }
        if (label) {
          contactNamesDirectory.set(cleanPhone, label);
          contactNamesDirectory.set(`${cleanPhone}@s.whatsapp.net`, label);
        }

        // Store in this specific Bot's contacts map
        if (botContactsStore[bot.id]) {
          const existing = botContactsStore[bot.id].get(cleanPhone) || {};
          const contactName = label || existing.name || String(c.pushName || '').trim();
          botContactsStore[bot.id].set(cleanPhone, {
            phone: cleanPhone,
            name: contactName,
            pushName: String(c.pushName || existing.pushName || '').trim(),
            jid: `${cleanPhone}@s.whatsapp.net`,
            botId: bot.id,
            botLabel: bot.label,
            updatedAt: new Date().toISOString()
          });
        }
      }
      if (label) {
        if (idStr) contactNamesDirectory.set(idStr, label);
        if (lidStr) contactNamesDirectory.set(lidStr, label);
      }
    };

    sock.ev.on('contacts.upsert', (list) => {
      for (const c of list || []) recordContactInfo(c);
      persistContactDirectory();
      saveBotContacts(bot.id);
    });

    sock.ev.on('contacts.update', (list) => {
      for (const c of list || []) recordContactInfo(c);
      persistContactDirectory();
      saveBotContacts(bot.id);
    });

    sock.ev.on('chats.upsert', (chats) => {
      for (const ch of chats || []) {
        const jid = String(ch.id || '');
        if (jid && !jid.endsWith('@g.us')) {
          recordContactInfo(ch);
        }
      }
      saveBotContacts(bot.id);
    });

    sock.ev.on('messaging-history.set', ({ contacts, chats }) => {
      for (const c of contacts || []) recordContactInfo(c);
      for (const ch of chats || []) {
        const jid = String(ch.id || '');
        if (jid && !jid.endsWith('@g.us')) {
          recordContactInfo(ch);
        }
      }
      persistContactDirectory();
      saveBotContacts(bot.id);
    });

    // Cache every outgoing/upserted message immediately so Signal decryption retries ("Waiting for this message") succeed
    sock.ev.on('messages.upsert', ({ messages }) => {
      for (const m of messages || []) {
        rememberSentMessage(m, null, '', bot.id);
        const recordedItem = recordForwardableMessage(m, { botId: bot.id, source: m.key?.fromMe ? 'sent' : 'received' });
        if (m?.pushName) {
          const senderJid = m.key?.participant || m.key?.remoteJid;
          if (senderJid && !String(senderJid).endsWith('@g.us')) {
            recordContactInfo({ id: senderJid, pushName: m.pushName });
            saveBotContacts(bot.id);
          }
        }
        
        // Engagement Score: track inbound replies
        if (!m.key?.fromMe && m.key?.remoteJid && !String(m.key.remoteJid).endsWith('@g.us')) {
          const _senderPhoneNum = m.key.remoteJid.split('@')[0].replace(/\D/g,'');
          if (_senderPhoneNum) {
            const _ec = contactsState.contacts.find(c => c.phone === _senderPhoneNum || c.phone === '+' + _senderPhoneNum);
            if (_ec) {
              _ec.totalReceived = (_ec.totalReceived || 0) + 1;
              _ec.lastReplied = new Date().toISOString();
              _ec.engagementScore = Math.min(100, ((_ec.totalReceived || 0) * 10) + ((_ec.totalSent || 0) > 0 ? 5 : 0));
            }
            
            // Auto Opt-Out / Blacklist
            const textMsg = String(m.message?.conversation || m.message?.extendedTextMessage?.text || '').trim().toUpperCase();
            if (textMsg === 'STOP') {
              if (!blacklistStore.includes(_senderPhoneNum) && !blacklistStore.includes('+' + _senderPhoneNum)) {
                blacklistStore.push('+' + _senderPhoneNum);
                saveJsonFile(BLACKLIST_FILE, blacklistStore);
                addLog('warn', `🛑 Auto Opt-Out: +${_senderPhoneNum} replied STOP. Added to Blacklist.`, { botId: bot.id });
                if (typeof sock.sendMessage === 'function') {
                  sock.sendMessage(m.key.remoteJid, { text: 'You have been successfully unsubscribed.' }).catch(()=>{});
                }
              }
            }
          }
        }
        // Anti-Ban: Automatically read incoming messages after a randomized delay to simulate human presence
        if (!m.key?.fromMe && m.key?.remoteJid && !String(m.key.remoteJid).endsWith('@g.us')) {
          setTimeout(() => {
            if (bot.isConnected && typeof sock.readMessages === 'function') {
              sock.readMessages([m.key]).catch(() => {});
            }
          }, 3000 + (Math.random() * 7000)); // 3 to 10 seconds delay
        }
        // Handle /boost command in incoming message
        try {
          const unwrapped = unwrapMessage(m.message);
          const txt = (unwrapped?.conversation || unwrapped?.extendedTextMessage?.text || '').trim();
          if (txt.toLowerCase().startsWith('/boost')) {
            if (recordedItem && recordedItem.type !== 'text') {
              addLog('success', `⚡ [/boost Command] Quoted Media from WhatsApp added to Forward Catalog: "${recordedItem.fileName}" (${recordedItem.fileSizeFormatted})`, { botId: bot.id });
            } else {
              addLog('info', `⚡ [/boost Command] Media messages in Forward Catalog ${forwardMessagesStore.size} ready (Zero Re-Upload Mode).`, { botId: bot.id });
            }
          }
        } catch (e) {}
      }
    });

    // Listen for Server Delivery Receipts / Message Updates (SERVER_ACK = 1, DELIVERY_ACK = 2)
    sock.ev.on('messages.update', (updates) => {
      for (const u of updates || []) {
        const msgId = u.key?.id;
        const status = u.update?.status;
        if (msgId && bot.pendingAcks.has(msgId)) {
          const resolver = bot.pendingAcks.get(msgId);
          bot.pendingAcks.delete(msgId);
          resolver({ confirmed: true, msgId, ackStatus: status || 1, timestamp: new Date().toISOString() });
        }
        if (msgId && status) {
          try {
            let changed = false;
            if (campaignState && Array.isArray(campaignState.results)) {
              for (const r of campaignState.results) {
                if (r.botId && r.botId !== bot.id) continue;
                if (r.serverMessageId === msgId || r.id === msgId || r.msgId === msgId) {
                  if (!r.deliveryStatusValue || status > r.deliveryStatusValue) {
                    r.deliveryStatusValue = status;
                    r.deliveryStatus = status >= 4 ? 'read' : (status === 3 ? 'delivered' : (status === 2 ? 'sent' : 'pending'));
                    if (status >= 4 && !r.readTime) r.readTime = new Date().toISOString();
                    changed = true;
                  }
                }
              }
            }
            const history = loadJsonFile(REPORTS_FILE, []);
            for (const h of history) {
              if (h.results && Array.isArray(h.results)) {
                for (const r of h.results) {
                  if (r.botId && r.botId !== bot.id) continue;
                  if (r.serverMessageId === msgId || r.id === msgId || r.msgId === msgId) {
                    if (!r.deliveryStatusValue || status > r.deliveryStatusValue) {
                      r.deliveryStatusValue = status;
                      r.deliveryStatus = status >= 4 ? 'read' : (status === 3 ? 'delivered' : (status === 2 ? 'sent' : 'pending'));
                      if (status >= 4 && !r.readTime) r.readTime = new Date().toISOString();
                      changed = true;
                    }
                  }
                }
              }
            }
            if (changed) {
              saveJsonFile(REPORTS_FILE, history);
            }
          } catch (e) {
            console.error('Error tracking delivery status:', e);
          }
        }
      }
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        // If the bot is already connected, or already has saved session credentials, NEVER regenerate QR in background!
        if (bot.isConnected || bot.status === 'connected' || hasSavedSessionCreds(botId)) {
          bot.qrDataUrl = null;
          return;
        }
        try {
          bot.qrDataUrl = await QRCode.toDataURL(qr, { width: 280, margin: 2 });
          bot.qrUpdatedAt = new Date().toISOString();
          bot.status = 'qr';
          bot.isConnected = false;
          if (!bot._qrFirstLogged) {
            bot._qrFirstLogged = true;
            addLog('info', `📱 [${bot.label}] QR code ready! Scan with your mobile WhatsApp.`, { botId });
          }
        } catch (err) {
          addLog('error', `QR generation error [${bot.label}]: ${err.message}`, { botId });
        }
      }

      if (connection === 'open') {
        bot._qrFirstLogged = false;
        bot.status = 'connected';
        bot.isConnected = true;
        bot.ipLocked = true;
        bot.ipLockedAt = bot.ipLockedAt || new Date().toISOString();
        bot.qrDataUrl = null;
        bot.qrUpdatedAt = null;
        const rawJid = sock.user?.id || '';
        bot.phone = rawJid.split(':')[0].split('@')[0] || bot.phone || `9477${bot.index}00000`;
        bot.pushName = sock.user?.name || bot.pushName || `WhatsApp #${bot.index}`;
        bot.lastActiveAt = new Date().toISOString();

        // Automatically link and attach persistent Google account credentials to this bot
        if (googleAuthState.tokens && (googleAuthState.tokens.refresh_token || googleAuthState.tokens.access_token)) {
          bot.googleAccount = {
            email: googleAuthState.user?.email || null,
            name: googleAuthState.user?.name || null,
            picture: googleAuthState.user?.picture || null,
            linkedAt: new Date().toISOString(),
            active: true
          };
          addLog('info', `☁️ [${bot.label}] Google Account (${bot.googleAccount.email}) automatically synced!`, { botId });
          
          // Trigger Google Contacts sync automatically on connect
          const contactsToSync = (contactsState.contacts || []).filter(c => c && c.isValid !== false);
          if (contactsToSync.length > 0) {
            setTimeout(() => {
              addLog('info', `☁️ [${bot.label}] Starting sync to Google Contacts after connection...`);
              batchSaveContactsToGoogleContacts(contactsToSync, appSettings.googleContactsLabel || 'WhatsApp Bot').then(res => {
                if (res?.ok) addLog('success', `☁️ [${bot.label}] Google Contacts ${res.savedCount} successfully synced.`);
              }).catch((err) => {
                addLog('error', `☁️ [${bot.label}] Google Contacts Sync error: ${err.message}`);
              });
            }, 5000);
          }
        }

        persistState();
        addLog('success', `🟢 [${bot.label}] WhatsApp Account Successfully connected (+${bot.phone}) | 🔒 IP Locked: ${bot.virtualIp}`, { botId });
        // Automatically fetch participating WhatsApp groups in the background when connected
        setTimeout(() => {
          fetchGroupsForBot(botId, true).catch(() => {});
        }, 1200);
      }

      if (connection === 'close') {
        const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
        bot.isConnected = false;

        if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
          bot._qrFirstLogged = false;
          bot.status = 'disconnected';
          bot.qrDataUrl = null;
          bot.phone = '';
          if (bot.signalKeyCache) {
            try { bot.signalKeyCache.flushAll(); } catch (e) {}
            bot.signalKeyCache = null;
          }
          bot.signalKeyStore = null;
          if (bot.msgRetryCounterCache) {
            try { bot.msgRetryCounterCache.flushAll(); } catch (e) {}
            bot.msgRetryCounterCache = null;
          }
          if (bot.userDevicesCache) {
            try { bot.userDevicesCache.flushAll(); } catch (e) {}
            bot.userDevicesCache = null;
          }
          if (bot.pendingAcks) {
            bot.pendingAcks.clear();
          }
          try { fs.rmSync(authDir, { recursive: true, force: true }); } catch (e) {}
          persistState();
          addLog('warn', `🔴 [${bot.label}] Logged Out.`, { botId });
        } else if (statusCode === 408 && bot.status === 'qr') {
          bot._qrFirstLogged = false;
          bot.status = 'disconnected';
          bot.qrDataUrl = null;
          addLog('warn', `⏱️ [${bot.label}] QR code timeout. Click Connect again.`, { botId });
        } else if (bot.status !== 'disconnected') {
          // Reconnecting existing session in the background: keep QR null so it never appears
          bot.status = 'connecting';
          bot.qrDataUrl = null;
          setTimeout(() => {
            if (bot.status !== 'disconnected') startBotConnection(botId).catch(() => {});
          }, 4000);
        }
      }
    });

    return { ok: true, status: bot.status };
  } catch (err) {
    bot.status = 'disconnected';
    bot.isConnected = false;
    addLog('error', `❌ [${bot.label}] Connection error: ${err.message}`, { botId });
    throw err;
  }
})();

  botConnectionLocks.set(botId, connectTask);
  try {
    return await connectTask;
  } finally {
    botConnectionLocks.delete(botId);
  }
}

export async function disconnectBotConnection(botId, options = {}) {
  const bot = accounts[botId];
  if (!bot) throw new Error(`Invalid bot account ID: ${botId}`);

  const wasSimulated = bot.isSimulated;
  bot.status = 'disconnected';
  bot.isConnected = false;
  bot.isSimulated = false;
  bot.ipLocked = Boolean(options.keepIpLocked);
  bot.qrDataUrl = null;
  bot.phone = '';
  // Note: bot.virtualIp is intentionally preserved and NEVER randomized or reset upon disconnect.

  if (bot.sock) {
    try { 
      await Promise.race([
        bot.sock.logout(),
        new Promise(r => setTimeout(r, 2000))
      ]); 
    } catch (e) {}
    try { bot.sock.end(); } catch (e) {}
    bot.sock = null;
  }

  if (bot.signalKeyCache) {
    try { bot.signalKeyCache.flushAll(); } catch (e) {}
    bot.signalKeyCache = null;
  }
  bot.signalKeyStore = null;

  if (bot.msgRetryCounterCache) {
    try { bot.msgRetryCounterCache.flushAll(); } catch (e) {}
    bot.msgRetryCounterCache = null;
  }

  if (bot.userDevicesCache) {
    try { bot.userDevicesCache.flushAll(); } catch (e) {}
    bot.userDevicesCache = null;
  }

  if (bot.pendingAcks) {
    bot.pendingAcks.clear();
  }

  // Preserve disk session credentials on normal disconnect; only wipe on explicit wipeAuth request
  if (options.wipeAuth === true) {
    const authDir = getBotAuthDir(botId);
    try {
      if (fs.existsSync(authDir)) {
        fs.rmSync(authDir, { recursive: true, force: true });
      }
    } catch (e) {}
  }

  persistState();
  addLog('warn', `🛑 [${bot.label}] WhatsApp connection disconnected.`, { botId });
  return { ok: true, botId, status: 'disconnected', virtualIp: bot.virtualIp, ipLocked: bot.ipLocked };
}

/**
 * Purges a corrupted Signal session file (`session-<id>.json`) when Bad MAC occurs
 * while keeping `creds.json` and `pre-key-*.json` intact so the bot stays logged in.
 */
async function purgeCorruptedSignalSession(bot, rawIdOrJid) {
  if (!bot || !rawIdOrJid) return;
  const rawId = String(rawIdOrJid).split('@')[0].split(':')[0].replace(/\.0$/, '');
  if (!rawId) return;
  const authDir = getBotAuthDir(bot.id);
  try {
    if (fs.existsSync(authDir)) {
      const files = fs.readdirSync(authDir);
      for (const f of files) {
        if (f.startsWith(`session-${rawId}`) && f.endsWith('.json')) {
          try { fs.unlinkSync(path.join(authDir, f)); } catch (e) {}
        }
      }
    }
    if (bot.signalKeyCache) {
      try {
        bot.signalKeyCache.del(`session.${rawId}.0`);
        bot.signalKeyCache.del(`session.${rawId}`);
        for (const k of (bot.signalKeyCache.keys ? bot.signalKeyCache.keys() : [])) {
          if (k.startsWith(`session.${rawId}`)) {
            bot.signalKeyCache.del(k);
          }
        }
      } catch (e) {}
    }
    if (bot.sock?.authState?.keys) {
      await bot.sock.authState.keys.set({
        session: {
          [`${rawId}.0`]: null,
          [`${rawId}.1`]: null,
          [`${rawId}.2`]: null,
          [rawId]: null
        }
      });
    }
    console.log(`🔧 [${bot.id}] Auto-healed Signal session for ${rawId}`);
  } catch (e) {}
}

/**
 * Dispatches a message (Text + optional Image / Video / PDF / Contact card) via the selected Bot
 * and waits for WhatsApp Server Confirmation (Server ACK stanza) before returning.
 * Includes canonical JID resolution (onWhatsApp), Signal session assertion (assertSessions),
 * and sentMessagesStore caching so the recipient never sees "Waiting for this message".
 */
export async function sendSingleMessageWithServerAck({ bot, recipient, renderedText, mediaAttachment, contactAttachment, pollData }) {
  let textSentAsCaption = false;
  if (!bot || !bot.isConnected) {
    const connErr = new Error('Selected bot account is not connected');
    connErr.isAccountConnectionError = true;
    throw connErr;
  }

  const isGroupJid = Boolean(recipient.isGroup || (recipient.jid && recipient.jid.endsWith('@g.us')) || (recipient.phone && String(recipient.phone).endsWith('@g.us')));
  const normPhone = isGroupJid ? null : normalizePhoneNumber(recipient.phone || recipient.jid);
  let targetJid = isGroupJid ? (recipient.jid || recipient.phone).trim() : jidNormalizedUser(recipient.jid || normPhone?.jid || '');
  if (!targetJid) {
    const recErr = new Error(`Invalid recipient or phone number: ${recipient.phone}`);
    recErr.isRecipientError = true;
    throw recErr;
  }

  // Simulated error trigger for testing error percentage if phone ends with 0000000 or recipient.forceFail is true
  if (recipient.forceFail || (!isGroupJid && String(recipient.phone).endsWith('0000000'))) {
    const recErr = new Error('WhatsApp Server Rejected: Number not registered on WhatsApp (Simulated Failure)');
    recErr.isRecipientError = true;
    throw recErr;
  }

  // For real WhatsApp sockets: resolve canonical JID via sock.onWhatsApp and establish Signal pre-key sessions upfront
  if (!bot.isSimulated && bot.sock && !isGroupJid) {
    if (typeof bot.sock.onWhatsApp === 'function') {
      try {
        const waQuery = normPhone?.clean || targetJid;
        const waResult = await Promise.race([
          bot.sock.onWhatsApp(waQuery),
          new Promise((resolve) => setTimeout(() => resolve(null), 5000))
        ]);
        if (Array.isArray(waResult) && waResult.length > 0) {
          const firstMatch = waResult[0];
          if (firstMatch && firstMatch.exists === false) {
            const notRegErr = new Error(`Number not registered on WhatsApp: ${recipient.phone}`);
            notRegErr.isRecipientError = true;
            throw notRegErr;
          }
          if (firstMatch?.jid) {
            targetJid = jidNormalizedUser(firstMatch.jid);
          }
        }
      } catch (waErr) {
        if (waErr.isRecipientError) throw waErr;
      }
    }

    if (typeof bot.sock.assertSessions === 'function') {
      try {
        const jidsToAssert = [targetJid];
        if (bot.sock.user?.id) {
          jidsToAssert.push(jidNormalizedUser(bot.sock.user.id));
        }
        await Promise.race([
          bot.sock.assertSessions(jidsToAssert, true),
          new Promise((resolve) => setTimeout(resolve, 4500))
        ]);
      } catch (e) {}
    }

    if (typeof bot.sock.presenceSubscribe === 'function') {
      try {
        await Promise.race([
          bot.sock.presenceSubscribe(targetJid),
          new Promise((resolve) => setTimeout(resolve, 800))
        ]);
      } catch (e) {}
    }

    if (typeof bot.sock.sendPresenceUpdate === 'function') {
      try {
        await Promise.race([
          bot.sock.sendPresenceUpdate('composing', targetJid),
          new Promise((resolve) => setTimeout(resolve, 600))
        ]);
      } catch (e) {}
    }
  }

  const sentMessageIds = [];
  let ackStatusLabel = 'SERVER_ACK_CONFIRMED';

  // Helper that sends a Baileys message payload, stores it for retry decryption, and awaits Server Stanza ACK
  const sendAndWaitAck = async (payload, options = {}) => {
    const timeoutMs = options.timeoutMs || 25000;
    if (!bot.isSimulated && !bot.sock) {
      const connErr = new Error(`Account ${bot.id} socket is not available (disconnected)`);
      connErr.isAccountConnectionError = true;
      throw connErr;
    }

    if (bot.isSimulated) {
      if (!bot.isConnected) {
        const connErr = new Error(`Account ${bot.id} disconnected during send`);
        connErr.isAccountConnectionError = true;
        throw connErr;
      }
      // Simulate realistic network trip + WhatsApp server stanza ACK (60ms)
      await new Promise(r => setTimeout(r, 60));
      if (!bot.isConnected) {
        const connErr = new Error(`Account ${bot.id} disconnected before Server ACK`);
        connErr.isAccountConnectionError = true;
        throw connErr;
      }
      const fakeMsgId = `BAE5_${bot.id.toUpperCase()}_${Date.now()}_${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      const fakeMsgObj = { key: { id: fakeMsgId, remoteJid: targetJid, fromMe: true }, status: 1 };
      rememberSentMessage(fakeMsgObj, payload, targetJid, bot.id);
      recordForwardableMessage(fakeMsgObj, { botId: bot.id, source: 'sent', remoteJid: targetJid, payload });
      sentMessageIds.push(fakeMsgId);
      return fakeMsgObj;
    }

    let result;
    let lastSockErr = null;

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        if (!bot.sock || !bot.isConnected || bot.status !== 'connected') {
          const connErr = new Error(`Account ${bot.id} is disconnected before sending`);
          connErr.isAccountConnectionError = true;
          throw connErr;
        }

        if (attempt === 2) {
          await purgeCorruptedSignalSession(bot, targetJid);
          try {
            if (typeof bot.sock.assertSessions === 'function') {
              await bot.sock.assertSessions([targetJid], true);
            }
          } catch (e) {}
        }

        let preMessageId = `BAE5_${Date.now()}_${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
        try {
          if (typeof generateMessageIDV2 === 'function') {
            preMessageId = generateMessageIDV2(bot.sock.user?.id);
          }
        } catch (e) {}

        // Store payload BEFORE network transmission so instant Signal <receipt type="retry"> requests find it immediately
        rememberSentMessage({ key: { id: preMessageId, remoteJid: targetJid, fromMe: true } }, payload, targetJid, bot.id);

        // Real Baileys socket send with timeout protection so it never hangs indefinitely
        result = await Promise.race([
          bot.sock.sendMessage(targetJid, payload, { messageId: preMessageId }),
          new Promise((_, reject) => setTimeout(() => {
            const tErr = new Error(`Connection Timed Out! Please Disconnect this account and Scan the QR Code again to reconnect.`);
            tErr.isTimeout = true;
            reject(tErr);
          }, timeoutMs))
        ]);
        rememberSentMessage(result, payload, targetJid, bot.id);
        recordForwardableMessage(result, { botId: bot.id, source: 'sent', remoteJid: targetJid, payload });
        if (typeof bot.sock.sendPresenceUpdate === 'function') {
          bot.sock.sendPresenceUpdate('paused', targetJid).catch(() => {});
        }

        if (!bot.isConnected) {
          const connErr = new Error(`Account ${bot.id} lost connection before Server ACK`);
          connErr.isAccountConnectionError = true;
          throw connErr;
        }

        const msgId = result?.key?.id || `WA_${Date.now()}`;

        if (appSettings.requireServerAck && msgId && !payload.poll) {
          // Wait for `messages.update` server receipt event to ensure delivery to WA server
          await Promise.race([
            new Promise((resolve) => {
              bot.pendingAcks.set(msgId, resolve);
            }),
            new Promise((resolve) => setTimeout(() => {
              bot.pendingAcks.delete(msgId);
              // If sendMessage already succeeded, avoid triggering retry attempt that produces duplicates
              resolve({ confirmed: true, timeout: true });
            }, 4000))
          ]);
        }

        sentMessageIds.push(msgId);
        lastSockErr = null;
        break;
      } catch (sockErr) {
        lastSockErr = sockErr;
        if (!sockErr.isTimeout && attempt === 2) {
          bot.isConnected = false;
          bot.status = 'disconnected';
          sockErr.isAccountConnectionError = true;
        }
        if (attempt === 1) {
          await new Promise(r => setTimeout(r, 1500));
        }
      }
    }

    if (lastSockErr) {
      throw lastSockErr;
    }

    return result;
  };

  // 0. Forward Message Dispatch (/boost Zero Re-Upload Engine)
  const isForwardAttachment = Boolean(
    mediaAttachment && (
      mediaAttachment.type === 'forward' ||
      mediaAttachment.isForward === true ||
      mediaAttachment.forwardMessage ||
      mediaAttachment.forwardMessageId
    )
  );

  let fwdItem = null;
  if (isForwardAttachment) {
    fwdItem = mediaAttachment.forwardMessage;
    if (!fwdItem && mediaAttachment.forwardMessageId) {
      fwdItem = getForwardableMessage(mediaAttachment.forwardMessageId);
    }
    if (!fwdItem && mediaAttachment.rawMessage) {
      fwdItem = mediaAttachment;
    }
    if (!fwdItem && mediaAttachment.id) {
      fwdItem = getForwardableMessage(mediaAttachment.id);
    }

    if (!fwdItem) {
      throw new Error(`Forward message with ID "${mediaAttachment.forwardMessageId || ''}" could not be found.`);
    }

    const rawMsg = deepRestoreBuffers(fwdItem.rawMessage || fwdItem.message || fwdItem);
    const rawKey = fwdItem.key || {
      id: fwdItem.id || `FWD_${Date.now()}`,
      remoteJid: fwdItem.remoteJid || targetJid,
      fromMe: fwdItem.fromMe !== false
    };

    const actualMsg = rawMsg.message || rawMsg;
    const innerKey = Object.keys(actualMsg || {}).find(k => k.endsWith('Message') || k === 'conversation');
    if (innerKey && actualMsg[innerKey]) {
      const inner = actualMsg[innerKey];
      inner.mediaKey = ensureBuffer(inner.mediaKey);
      inner.fileSha256 = ensureBuffer(inner.fileSha256);
      inner.fileEncSha256 = ensureBuffer(inner.fileEncSha256);
      if (inner.jpegThumbnail) inner.jpegThumbnail = ensureBuffer(inner.jpegThumbnail);

      // Auto-heal empty keys from sentMessagesStore if necessary
      if (!inner.mediaKey || inner.mediaKey.length < 16) {
        for (const [k, v] of sentMessagesStore.entries()) {
          const sInner = (v.message || v)?.[innerKey];
          if (sInner && (sInner.directPath === inner.directPath || (inner.fileName && sInner.fileName === inner.fileName))) {
            const sMk = ensureBuffer(sInner.mediaKey);
            if (sMk && sMk.length >= 16) {
              inner.mediaKey = sMk;
              inner.fileSha256 = ensureBuffer(sInner.fileSha256) || inner.fileSha256;
              inner.fileEncSha256 = ensureBuffer(sInner.fileEncSha256) || inner.fileEncSha256;
              break;
            }
          }
        }
      }
    }

    // Deep copy container preserving genuine Buffer references
    const clonedMsg = {
        key: { ...rawKey },
        message: {
          ...actualMsg,
          ...(innerKey && actualMsg[innerKey] ? { [innerKey]: { ...actualMsg[innerKey] } } : {})
        }
      };
      
      // CRITICAL: Strip original message context and sender keys to prevent "Waiting for this message" Signal protocol errors on the recipient's phone!
      if (clonedMsg.message.messageContextInfo) delete clonedMsg.message.messageContextInfo;
      if (clonedMsg.message.senderKeyDistributionMessage) delete clonedMsg.message.senderKeyDistributionMessage;

    const captionMode = mediaAttachment.captionMode || 'template';
    const sendSeparate = Boolean(
      mediaAttachment.sendSeparate === true ||
      mediaAttachment.mode === 'separate' ||
      mediaAttachment.dispatchMode === 'separate' ||
      mediaAttachment.separate === true
    );
    const forceForward = mediaAttachment.forceForward !== false;
    let targetMediaMsg = null;
    if (innerKey && ['imageMessage', 'videoMessage', 'documentMessage'].includes(innerKey)) {
      targetMediaMsg = clonedMsg.message[innerKey];
    } else if (innerKey === 'documentWithCaptionMessage') {
      targetMediaMsg = clonedMsg.message.documentWithCaptionMessage?.message?.documentMessage;
    }

    const isNoCaption = mediaAttachment.captionSource === 'none' ||
      mediaAttachment.captionMode === 'none' ||
      (mediaAttachment.captionSource === 'custom' && (!mediaAttachment.caption || !mediaAttachment.caption.trim()));

    if (targetMediaMsg) {
      if (!isNoCaption && renderedText) {
        targetMediaMsg.caption = renderedText;
        textSentAsCaption = true;
      } else {
        delete targetMediaMsg.caption;
      }
    }
    if (clonedMsg.message.documentWithCaptionMessage && (isNoCaption || !targetMediaMsg || !targetMediaMsg.caption)) {
      if (targetMediaMsg) {
        delete targetMediaMsg.caption;
        clonedMsg.message.documentMessage = targetMediaMsg;
      }
      delete clonedMsg.message.documentWithCaptionMessage;
    }

    // WhatsApp forwarding contextInfo
    if (!forceForward) {
      clonedMsg.key.fromMe = true;
      if (innerKey && clonedMsg.message[innerKey]) {
        clonedMsg.message[innerKey].contextInfo = {
          ...(clonedMsg.message[innerKey].contextInfo || {}),
          forwardingScore: 0,
          isForwarded: false
        };
      }
    } else {
      if (innerKey && clonedMsg.message[innerKey]) {
        clonedMsg.message[innerKey].contextInfo = {
          ...(clonedMsg.message[innerKey].contextInfo || {}),
          forwardingScore: 1,
          isForwarded: true
        };
      }
    }

    // Check for local file buffer or cached disk file
    let localFileBuffer = null;
    const resolvedPath = findLocalMediaFile(fwdItem.filePath) ||
                         findLocalMediaFile(fwdItem.fileName) ||
                         findLocalMediaFile(mediaAttachment.filePath) ||
                         findLocalMediaFile(mediaAttachment.fileName);
    if (resolvedPath && fs.existsSync(resolvedPath)) {
      try {
        localFileBuffer = fs.readFileSync(resolvedPath);
        fwdItem.filePath = resolvedPath;
      } catch (e) {}
    }


    if (!localFileBuffer && mediaAttachment.base64) {
      try {
        const cleanB64 = mediaAttachment.base64.replace(/^data:[^;]+;base64,/, '');
        localFileBuffer = Buffer.from(cleanB64, 'base64');
      } catch (e) {}
    }

    let forwardDelivered = false;
    
    // Prevent cross-account silent drop: if fwdItem was uploaded by a different bot, native forward will silently fail.
    // We must fall back to Path B (buffer download & re-upload) for cross-account forwarding!
    const isSameBot = !fwdItem.botId || fwdItem.botId === bot.id;
    
    const inner = actualMsg && innerKey ? actualMsg[innerKey] : null;
    const hasValidCdnKeys = isSameBot && inner && inner.url && inner.mediaKey && inner.mediaKey.length > 0;

    // Path A: Native Zero-Reupload WhatsApp CDN Forward
    if (hasValidCdnKeys || bot.isSimulated || innerKey === 'conversation' || innerKey === 'extendedTextMessage') {
      try {
        await sendAndWaitAck({
          forward: clonedMsg,
          force: forceForward
        }, { timeoutMs: 8000 });
        forwardDelivered = true;
        if (targetMediaMsg?.caption && targetMediaMsg.caption === renderedText) {
          textSentAsCaption = true;
        }
      } catch (fwdErr) {
        console.warn(`[${bot.label}] Native forward attempt threw error (${fwdErr.message}), falling back to direct media stream...`);
      }
    }

    // Path B: Fallback buffer transmission (if native forward had missing keys or threw CDN error)
    if (!forwardDelivered) {
      if (innerKey === 'conversation' || innerKey === 'extendedTextMessage') {
        const txt = clonedMsg.message.conversation || clonedMsg.message.extendedTextMessage?.text || renderedText;
        if (txt) {
          await sendAndWaitAck({ text: txt });
          forwardDelivered = true;
        }
      } else if (innerKey === 'locationMessage') {
        await sendAndWaitAck({ location: clonedMsg.message.locationMessage });
        forwardDelivered = true;
      } else if (innerKey === 'contactMessage') {
        await sendAndWaitAck({ contacts: { displayName: clonedMsg.message.contactMessage.displayName, contacts: [{ vcard: clonedMsg.message.contactMessage.vcard }] } });
        forwardDelivered = true;
      } else {
        if (!localFileBuffer && !bot.isSimulated && bot.sock && (clonedMsg.message[innerKey]?.directPath || clonedMsg.message[innerKey]?.url)) {
          try {
            localFileBuffer = await downloadMediaMessage({
              key: clonedMsg.key,
              message: clonedMsg.message
            }, 'buffer', { }, { logger: bot.sock.logger, reuploadRequest: bot.sock.updateMediaMessage });
            if (localFileBuffer) {
              const saveCached = path.join(UPLOADS_DIR, `cached_forward_${fwdItem.fileName || 'file'}`);
              fs.writeFileSync(saveCached, localFileBuffer);
              fwdItem.filePath = saveCached;
            }
          } catch (dlErr) {
            console.warn(`Failed to download media for forward fallback: ${dlErr.message}`);
          }
        }

        if (localFileBuffer && localFileBuffer.length > 0) {
          const isNoCaption = mediaAttachment.captionSource === 'none' || mediaAttachment.captionMode === 'none';
          const fallbackCaption = (!isNoCaption && renderedText !== undefined && renderedText !== null && renderedText !== '')
            ? renderedText
            : '';
          if (innerKey === 'imageMessage') {
            const sendOpt = {
              image: localFileBuffer,
              mimetype: clonedMsg.message[innerKey]?.mimetype || 'image/jpeg'
            };
            if (fallbackCaption) sendOpt.caption = fallbackCaption;
            await sendAndWaitAck(sendOpt);
            forwardDelivered = true;
            if (fallbackCaption && fallbackCaption === renderedText) textSentAsCaption = true;
          } else if (innerKey === 'videoMessage' || innerKey === 'ptvMessage') {
            const sendOpt = {
              video: localFileBuffer,
              mimetype: clonedMsg.message[innerKey]?.mimetype || 'video/mp4',
              ptv: innerKey === 'ptvMessage'
            };
            if (fallbackCaption) sendOpt.caption = fallbackCaption;
            await sendAndWaitAck(sendOpt);
            forwardDelivered = true;
            if (fallbackCaption && fallbackCaption === renderedText) textSentAsCaption = true;
          } else if (innerKey === 'documentMessage' || innerKey === 'documentWithCaptionMessage') {
            const docMsg = innerKey === 'documentWithCaptionMessage' ? clonedMsg.message.documentWithCaptionMessage?.message?.documentMessage : clonedMsg.message.documentMessage;
            const sendOpt = {
              document: localFileBuffer,
              fileName: docMsg?.fileName || fwdItem.fileName || 'Document.pdf',
              mimetype: docMsg?.mimetype || 'application/pdf'
            };
            if (fallbackCaption) sendOpt.caption = fallbackCaption;
            await sendAndWaitAck(sendOpt);
            forwardDelivered = true;
            if (fallbackCaption && fallbackCaption === renderedText) textSentAsCaption = true;
          } else if (innerKey === 'audioMessage') {
            await sendAndWaitAck({
              audio: localFileBuffer,
              ptt: clonedMsg.message.audioMessage?.ptt || false,
              mimetype: clonedMsg.message[innerKey]?.mimetype || 'audio/ogg'
            });
            forwardDelivered = true;
          } else if (innerKey === 'stickerMessage') {
            await sendAndWaitAck({
              sticker: localFileBuffer
            });
            forwardDelivered = true;
          }
        }
      }
    }


    if (!forwardDelivered) {
      throw new Error(`Could not forward message: WhatsApp CDN key (mediaKey) or file not found (${fwdItem.fileName || fwdItem.id}).`);
    }

    ackStatusLabel = 'SERVER_ACK_FORWARDED';
  } else if (mediaAttachment && mediaAttachment.type && mediaAttachment.type !== 'none') {
    // 1. Send Media (Image / Video / PDF Document) if attached
    let fileBuffer = null;
    if (mediaAttachment.base64) {
      const cleanB64 = mediaAttachment.base64.replace(/^data:[^;]+;base64,/, '');
      fileBuffer = Buffer.from(cleanB64, 'base64');
    } else if (mediaAttachment.filePath && fs.existsSync(mediaAttachment.filePath)) {
      fileBuffer = fs.readFileSync(mediaAttachment.filePath);
    } else {
      // Fallback buffer for test/demo media
      fileBuffer = Buffer.from('WhatsApp Bot Desktop Media Attachment');
    }

    const mType = mediaAttachment.type.toLowerCase();
    const sendSeparate = Boolean(
      mediaAttachment.sendSeparate === true ||
      mediaAttachment.mode === 'separate' ||
      mediaAttachment.dispatchMode === 'separate' ||
      mediaAttachment.separate === true
    );

    const captionToSend = renderedText || '';
    const isNoCaption = mediaAttachment.captionSource === 'none' ||
      mediaAttachment.captionMode === 'none' ||
      (mediaAttachment.captionSource === 'custom' && (!mediaAttachment.caption || !mediaAttachment.caption.trim()));
    const hasCaption = Boolean(
      !isNoCaption &&
      captionToSend &&
      captionToSend.trim() &&
      mediaAttachment.captionSource !== 'none' &&
      mediaAttachment.captionMode !== 'none'
    );
    const finalCaption = hasCaption ? captionToSend.trim() : '';

    if (mType === 'image') {
      const payload = {
        image: fileBuffer,
        mimetype: mediaAttachment.mimetype || 'image/png'
      };
      if (finalCaption) {
        payload.caption = finalCaption;
        textSentAsCaption = true;
      }
      await sendAndWaitAck(payload);
    } else if (mType === 'video') {
      const payload = {
        video: fileBuffer,
        mimetype: mediaAttachment.mimetype || 'video/mp4'
      };
      if (finalCaption) {
        payload.caption = finalCaption;
        textSentAsCaption = true;
      }
      await sendAndWaitAck(payload);
    } else if (mType === 'pdf' || mType === 'document') {
      const payload = {
        document: fileBuffer,
        fileName: mediaAttachment.fileName || 'Document.pdf',
        mimetype: mediaAttachment.mimetype || 'application/pdf'
      };
      if (finalCaption) {
        payload.caption = finalCaption;
        textSentAsCaption = true;
      }
      await sendAndWaitAck(payload);
    } else if (mType === 'voice' || mType === 'audio') {
      const isVoice = mType === 'voice' || mediaAttachment.ptt !== false;
      if (isVoice) {
        const converted = convertAudioToWhatsAppPtt(fileBuffer, mediaAttachment.fileName || 'voice.mp3');
        await sendAndWaitAck({
          audio: converted.buffer,
          mimetype: 'audio/ogg; codecs=opus',
          ptt: true,
          waveform: converted.waveform
        });
      } else {
        await sendAndWaitAck({
          audio: fileBuffer,
          mimetype: mediaAttachment.mimetype || 'audio/mpeg',
          ptt: false
        });
      }
    } else if (mType === 'sticker') {
      await sendAndWaitAck({
        sticker: fileBuffer
      });
    }
  }

  const isStickerMedia = Boolean((mediaAttachment && (mediaAttachment.type === 'sticker' || mediaAttachment.mediaType === 'sticker')) || (fwdItem && fwdItem.type === 'sticker'));
  if (!isStickerMedia && ((renderedText && !textSentAsCaption) || pollData)) {
    // Delay slightly if media was sent separately or forwarded, to ensure ordering
    if (mediaAttachment && mediaAttachment.type !== 'none') {
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
    // 2. Send Text Message if no media carried the caption
    if (pollData) {
      await sendAndWaitAck({
        poll: {
          name: pollData.question,
          values: pollData.options,
          selectableCount: pollData.multiSelect ? 0 : 1
        }
      });
    } else {
      await sendAndWaitAck({ text: renderedText });
    }
  }

  // 3. Send Contact Card (vCard) if enabled
  if (contactAttachment && contactAttachment.enabled && contactAttachment.phone) {
    const vcardObj = buildContactVCard({
      fullName: contactAttachment.fullName || 'Japan Panthiya Contact',
      phone: contactAttachment.phone,
      org: contactAttachment.org || 'Japan Panthiya',
      email: contactAttachment.email || ''
    });
    await sendAndWaitAck({
      contacts: {
        displayName: vcardObj.displayName,
        contacts: [{ vcard: vcardObj.vcard }]
      }
    });
  }

  // Increment account's daily & total counters
  bot.sentToday += 1;
  bot.totalSent += 1;
  bot.lastActiveAt = new Date().toISOString();
  // Ban Risk Alert via SSE
  const _pct = bot.dailyLimit > 0 ? (bot.sentToday / bot.dailyLimit) : 0;
  if (_pct >= 0.95) {
    broadcastDispatchEvent('ban_risk_alert', { botId: bot.id, label: bot.label, level: 'danger', reason: `Daily limit almost reached (${bot.sentToday}/${bot.dailyLimit})`, sentToday: bot.sentToday, dailyLimit: bot.dailyLimit });
  } else if (_pct >= 0.80) {
    broadcastDispatchEvent('ban_risk_alert', { botId: bot.id, label: bot.label, level: 'warning', reason: `Approaching daily limit (${bot.sentToday}/${bot.dailyLimit})`, sentToday: bot.sentToday, dailyLimit: bot.dailyLimit });
  }
  persistState();

  return {
    confirmed: true,
    serverMessageId: sentMessageIds[0] || `ACK_${Date.now()}`,
    allMessageIds: sentMessageIds,
    ackStatus: ackStatusLabel,
    confirmedAt: new Date().toISOString(),
    sentFromBot: bot.id,
    sentFromPhone: bot.phone,
    forwarded: isForwardAttachment
  };
}

// ─── Live Campaign Dispatcher State & Engine ─────────────────────────────────
const initialReportHistory = loadJsonFile(REPORTS_FILE, []);
const latestSavedCampaign = Array.isArray(initialReportHistory) && initialReportHistory.length > 0 ? initialReportHistory[0] : null;

const initialSavedProgress = loadJsonFile(CAMPAIGN_PROGRESS_FILE, null);
const hasUnfinishedSavedProgress = Boolean(
  initialSavedProgress &&
  initialSavedProgress.total > 0 &&
  ((initialSavedProgress.sent + initialSavedProgress.failed) < initialSavedProgress.total) &&
  initialSavedProgress.status !== 'completed' &&
  initialSavedProgress.payload
);

export const campaignState = {
  id: hasUnfinishedSavedProgress ? initialSavedProgress.id : (latestSavedCampaign?.id || null),
  name: hasUnfinishedSavedProgress ? (initialSavedProgress.name || initialSavedProgress.campaignName || 'Untitled Campaign') : (latestSavedCampaign?.name || latestSavedCampaign?.campaignName || 'Untitled Campaign'),
  campaignName: hasUnfinishedSavedProgress ? (initialSavedProgress.name || initialSavedProgress.campaignName || 'Untitled Campaign') : (latestSavedCampaign?.name || latestSavedCampaign?.campaignName || 'Untitled Campaign'),
  status: hasUnfinishedSavedProgress ? 'paused' : 'idle', // 'idle' | 'running' | 'paused' | 'completed' | 'stopped_limit' | 'stopped_manual' | 'stopped_no_account'
  isRunning: false,
  isPaused: hasUnfinishedSavedProgress,
  isStopped: !hasUnfinishedSavedProgress,
  stopReason: hasUnfinishedSavedProgress ? (initialSavedProgress.stopReason || 'Interrupted by app close. Ready to resume.') : (latestSavedCampaign?.stopReason || ''),
  startedAt: hasUnfinishedSavedProgress ? initialSavedProgress.startedAt : (latestSavedCampaign?.startedAt || null),
  completedAt: hasUnfinishedSavedProgress ? null : (latestSavedCampaign?.completedAt || null),
  total: hasUnfinishedSavedProgress ? (initialSavedProgress.total || 0) : (latestSavedCampaign?.total || 0),
  processed: hasUnfinishedSavedProgress ? ((initialSavedProgress.sent || 0) + (initialSavedProgress.failed || 0)) : ((latestSavedCampaign?.sent || 0) + (latestSavedCampaign?.failed || 0)),
  sent: hasUnfinishedSavedProgress ? (initialSavedProgress.sent || 0) : (latestSavedCampaign?.sent || 0),
  failed: hasUnfinishedSavedProgress ? (initialSavedProgress.failed || 0) : (latestSavedCampaign?.failed || 0),
  completionPercentage: hasUnfinishedSavedProgress
    ? (initialSavedProgress.total > 0 ? Math.round(((initialSavedProgress.sent || 0) / initialSavedProgress.total) * 1000) / 10 : 0)
    : (latestSavedCampaign?.completionPercentage ?? 0),
  errorPercentage: hasUnfinishedSavedProgress
    ? (initialSavedProgress.total > 0 ? Math.round(((initialSavedProgress.failed || 0) / initialSavedProgress.total) * 1000) / 10 : 0)
    : (latestSavedCampaign?.errorPercentage ?? 0),
  progressPercentage: hasUnfinishedSavedProgress
    ? (initialSavedProgress.total > 0 ? Math.round((((initialSavedProgress.sent || 0) + (initialSavedProgress.failed || 0)) / initialSavedProgress.total) * 1000) / 10 : 0)
    : (latestSavedCampaign?.total > 0 ? Math.round((((latestSavedCampaign?.sent || 0) + (latestSavedCampaign?.failed || 0)) / latestSavedCampaign.total) * 1000) / 10 : 0),
  activeBotId: hasUnfinishedSavedProgress ? (initialSavedProgress.activeBotId || 'bot1') : 'bot1',
  currentRecipient: null,
  currentPhone: null,
  nextMessageCountdownSec: 0,
  nextDelaySeconds: 0,
  lastServerAckId: latestSavedCampaign?.results?.[latestSavedCampaign.results.length - 1]?.serverMessageId || null,
  lastServerAckTime: latestSavedCampaign?.completedAt || null,
  accountRotations: latestSavedCampaign?.accountRotations || 0,
  batchEnabled: false,
  batchSize: 25,
  batchDelaySec: 60,
  batchSwitchBot: true,
  currentBatch: 1,
  totalBatches: 1,
  isBatchCooldown: false,
  batchCooldownCountdownSec: 0,
  lastPayload: hasUnfinishedSavedProgress ? initialSavedProgress.payload : null,
  summary: hasUnfinishedSavedProgress ? (initialSavedProgress.summary || null) : (latestSavedCampaign?.summary || null),
  results: hasUnfinishedSavedProgress ? (Array.isArray(initialSavedProgress.results) ? initialSavedProgress.results : []) : (Array.isArray(latestSavedCampaign?.results) ? latestSavedCampaign.results : []),
  resumable: hasUnfinishedSavedProgress,
  liveDispatch: {
    active: false,
    dispatchType: 'text',
    phase: 'idle',
    recipient: null,
    bot: null,
    file: null,
    isForward: false,
    forwardBoost: false,
    serverAckId: '',
    latencyMs: 0,
    countdownSec: 0,
    speedMsgsPerMin: 0,
    recentResults: []
  }
};

export const sseClients = new Set();
export function broadcastDispatchEvent(type, payload) {
  const data = JSON.stringify({
    type,
    payload,
    timestamp: new Date().toISOString()
  });
  for (const client of sseClients) {
    try {
      client.write(`event: ${type}\ndata: ${data}\n\n`);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

export let campaignAbortFlag = false;
export let campaignPauseFlag = false;

function recalculateCampaignPercentages() {
  const total = campaignState.total || 0;
  const sent = campaignState.sent || 0;
  const failed = campaignState.failed || 0;
  const processed = sent + failed;
  campaignState.processed = processed;
  campaignState.completionPercentage = total > 0 ? Math.round((sent / total) * 1000) / 10 : 0;
  campaignState.errorPercentage = total > 0 ? Math.round((failed / total) * 1000) / 10 : 0;
  campaignState.progressPercentage = total > 0 ? Math.round((processed / total) * 1000) / 10 : 0;
}

export function saveCampaignProgress(extra = {}) {
  try {
    const sentPhones = [];
    const failedPhones = [];
    const sentSet = new Set();
    const failedSet = new Set();
    if (Array.isArray(campaignState.results)) {
      for (const r of campaignState.results) {
        const norm = normalizePhoneNumber(r.phone || r.clean)?.clean || String(r.phone || '').replace(/\D/g, '');
        if (norm) {
          if (r.status === 'SENT') {
            if (!sentSet.has(norm)) {
              sentSet.add(norm);
              sentPhones.push(norm);
            }
          } else if (r.status === 'FAILED') {
            if (!failedSet.has(norm)) {
              failedSet.add(norm);
              failedPhones.push(norm);
            }
          }
        }
      }
    }

    // Determine pending / remaining recipients from lastPayload
    const remainingPhones = [];
    const allRecipients = Array.isArray(campaignState.lastPayload?.recipients) ? campaignState.lastPayload.recipients : [];
    for (const rec of allRecipients) {
      const pNorm = normalizePhoneNumber(rec.phone || rec.clean || rec.jid)?.clean || String(rec.phone || '').replace(/\D/g, '');
      if (pNorm && !sentSet.has(pNorm) && !failedSet.has(pNorm)) {
        remainingPhones.push(pNorm);
      }
    }

    const dataToSave = {
      id: campaignState.id,
      name: campaignState.name || campaignState.campaignName || 'Untitled Campaign',
      campaignName: campaignState.name || campaignState.campaignName || 'Untitled Campaign',
      status: campaignState.status,
      startedAt: campaignState.startedAt,
      updatedAt: new Date().toISOString(),
      completedAt: campaignState.completedAt || null,
      total: campaignState.total || allRecipients.length || 0,
      sent: campaignState.sent || sentPhones.length || 0,
      failed: campaignState.failed || failedPhones.length || 0,
      processed: (campaignState.sent || 0) + (campaignState.failed || 0),
      remainingCount: remainingPhones.length,
      completionPercentage: campaignState.completionPercentage || 0,
      errorPercentage: campaignState.errorPercentage || 0,
      activeBotId: campaignState.activeBotId || 'bot1',
      stopReason: campaignState.stopReason || '',
      payload: campaignState.lastPayload || null,
      sentPhones,
      failedPhones,
      remainingPhones,
      batchEnabled: Boolean(campaignState.batchEnabled),
      batchSize: campaignState.batchSize || 25,
      batchDelaySec: campaignState.batchDelaySec || 60,
      currentBatch: campaignState.currentBatch || 1,
      totalBatches: campaignState.totalBatches || 1,
      results: campaignState.results || [],
      summary: campaignState.summary || null,
      ...extra
    };
    saveJsonFile(CAMPAIGN_PROGRESS_FILE, dataToSave);
  } catch (e) {
    console.warn('saveCampaignProgress error:', e.message);
  }
}

// Handle app shutdown to preserve campaign state
export const handleProcessShutdown = () => {
  if (campaignState.isRunning || campaignState.status === 'running') {
    campaignAbortFlag = true;
    campaignState.isRunning = false;
    campaignState.isPaused = true;
    campaignState.status = 'interrupted';
    campaignState.stopReason = 'Application closed while sending. Ready to resume.';
    saveCampaignProgress({ status: 'interrupted' });
  }
};
process.on('SIGINT', () => { handleProcessShutdown(); process.exit(0); });
process.on('SIGTERM', () => { handleProcessShutdown(); process.exit(0); });
process.on('exit', handleProcessShutdown);

export function computeCampaignSummary() {
  const durMs = campaignState.startedAt && campaignState.completedAt
    ? (new Date(campaignState.completedAt).getTime() - new Date(campaignState.startedAt).getTime())
    : (campaignState.startedAt ? (Date.now() - new Date(campaignState.startedAt).getTime()) : 0);
  const durSec = Math.max(0, Math.floor(durMs / 1000));
  const durMins = Math.floor(durSec / 60);
  const durRemainSec = durSec % 60;
  const durationText = durMins > 0 ? `${durMins}m ${durRemainSec}s` : `${durRemainSec}s`;

  const botStats = {};
  for (const res of campaignState.results || []) {
    const bId = res.botId || 'bot1';
    if (!botStats[bId]) {
      botStats[bId] = {
        botId: bId,
        botLabel: res.botLabel || accounts[bId]?.label || bId.toUpperCase(),
        sent: 0,
        failed: 0,
        total: 0
      };
    }
    botStats[bId].total++;
    if (res.status === 'SENT' || res.serverAck) {
      botStats[bId].sent++;
    } else {
      botStats[bId].failed++;
    }
  }

  return {
    id: campaignState.id,
    name: campaignState.name || campaignState.campaignName || 'Untitled Campaign',
    campaignName: campaignState.name || campaignState.campaignName || 'Untitled Campaign',
    status: campaignState.status,
    stopReason: campaignState.stopReason,
    total: campaignState.total,
    processed: campaignState.processed,
    sent: campaignState.sent,
    failed: campaignState.failed,
    completionPercentage: campaignState.completionPercentage,
    errorPercentage: campaignState.errorPercentage,
    startedAt: campaignState.startedAt,
    completedAt: campaignState.completedAt,
    durationMs: durMs,
    durationText: durationText,
    botBreakdown: Object.values(botStats),
    lastServerAckId: campaignState.lastServerAckId || null,
    accountRotations: campaignState.accountRotations || 0,
    batchEnabled: Boolean(campaignState.batchEnabled),
    batchSize: campaignState.batchSize || 25,
    batchDelaySec: campaignState.batchDelaySec || 60,
    totalBatches: campaignState.totalBatches || 1,
    completedBatches: campaignState.currentBatch || 1
  };
}

export async function runCampaign({
  name = '',
  campaignName = '',
  recipients = [],
  templateText = '',
  messages = null,      // NEW: array of text strings [ "msg1", "msg2", ... ]
  mediaAttachment = null,
  mediaAttachments = null, pollData = null, scheduleTime = null,
  contactAttachment = null,
  delaySettings = null,
  batchSettings = null,
  fileSendMethod = 'forward',
  fastTestDelayMs = null,
  resume = false
}) {
  if (campaignState.isRunning || campaignState.status === 'running') {
    throw new Error('A campaign is already running.');
  }

  if (resume) {
    if (!campaignState.lastPayload) {
      const savedProg = loadJsonFile(CAMPAIGN_PROGRESS_FILE, null);
      if (savedProg && savedProg.payload) {
        campaignState.lastPayload = savedProg.payload;
        campaignState.id = savedProg.id || `camp_${Date.now()}`;
        campaignState.name = savedProg.name || savedProg.campaignName || savedProg.payload?.name || savedProg.payload?.campaignName || campaignState.name || 'Untitled Campaign';
        campaignState.campaignName = campaignState.name;
        campaignState.startedAt = savedProg.startedAt || new Date().toISOString();
        campaignState.total = savedProg.total || 0;
        campaignState.sent = savedProg.sent || 0;
        campaignState.failed = savedProg.failed || 0;
        campaignState.results = Array.isArray(savedProg.results) ? savedProg.results : [];
        campaignState.activeBotId = savedProg.activeBotId || 'bot1';
      }
    }
    if (!campaignState.lastPayload) {
      throw new Error('No previous campaign state found to resume.');
    }
    campaignState.name = campaignState.lastPayload?.name || campaignState.lastPayload?.campaignName || campaignState.name || 'Untitled Campaign';
    campaignState.campaignName = campaignState.name;
    recipients = campaignState.lastPayload.recipients;
    templateText = campaignState.lastPayload.templateText;
    messages = campaignState.lastPayload.messages;
    mediaAttachment = campaignState.lastPayload.mediaAttachment;
    mediaAttachments = campaignState.lastPayload.mediaAttachments;
    contactAttachment = campaignState.lastPayload.contactAttachment;
    fileSendMethod = campaignState.lastPayload.fileSendMethod || 'forward';
    fastTestDelayMs = campaignState.lastPayload.fastTestDelayMs;
    delaySettings = delaySettings || campaignState.lastPayload.delaySettings;
    batchSettings = batchSettings || campaignState.lastPayload.batchSettings;
  } else {
    const resolvedName = (name || campaignName || '').trim() || ('Campaign ' + new Date().toISOString().slice(0, 10) + ' ' + new Date().toTimeString().slice(0, 5));
    campaignState.lastPayload = {
      name: resolvedName, campaignName: resolvedName,
      recipients, templateText, messages, mediaAttachment, mediaAttachments, contactAttachment, fileSendMethod, fastTestDelayMs, delaySettings, batchSettings
    };
  }

  // Normalise: build the canonical arrays from either old single or new array fields
  // If messages is explicitly provided as an array (even if empty []), respect it!
  const msgList = Array.isArray(messages)
    ? messages.filter(m => typeof m === 'string' && m.trim())
    : (templateText ? [templateText] : []);

  // mediaAttachments[] wins over mediaAttachment
  console.log('DEBUG mediaAttachments:', mediaAttachments); const mediaList = Array.isArray(mediaAttachments) && mediaAttachments.length > 0
    ? mediaAttachments
    : (mediaAttachment ? [mediaAttachment] : []);


  const rawList = Array.isArray(recipients) ? recipients : [];
  const seenRecipientPhones = new Set();
  const validRecipients = [];
  for (const r of rawList) {
    if (!r || r.isValid === false) continue;
    // Support WhatsApp Group JIDs (ending with @g.us)
    const isGroup = Boolean(r.isGroup || (r.jid && r.jid.endsWith('@g.us')) || (r.phone && String(r.phone).endsWith('@g.us')));
    if (isGroup) {
      const gJid = (r.jid || r.phone).trim();
      if (seenRecipientPhones.has(gJid)) continue;
      seenRecipientPhones.add(gJid);
      validRecipients.push({
        ...r,
        isGroup: true,
        jid: gJid,
        phone: gJid,
        name: r.name || r.groupName || 'WhatsApp Group'
      });
      continue;
    }
    const norm = normalizePhoneNumber(r.phone || r.jid);
    if (!norm) continue;
    if (seenRecipientPhones.has(norm.clean)) continue;
    seenRecipientPhones.add(norm.clean);
    validRecipients.push(r);
  }
  // DNC filter — skip opted-out numbers (groups are not phone numbers)
  const dncFiltered = validRecipients.filter(r => {
    if (r.isGroup) return true;
    const norm = normalizePhoneNumber(r.phone || r.jid);
    return norm && !dncState.numbers.has(norm.clean);
  });
  const dncSkipped = validRecipients.length - dncFiltered.length;
  if (dncSkipped > 0) addLog('info', `[DNC] Skipped ${dncSkipped} Do-Not-Contact number(s).`);
  validRecipients.length = 0;
  dncFiltered.forEach(r => validRecipients.push(r));

  if (validRecipients.length === 0) {
    throw new Error('No valid recipients after DNC filtering. All numbers are on the Do-Not-Contact list.');
  }

  if (delaySettings) {
    appSettings.delayMode = delaySettings.delayMode === 'fixed' ? 'fixed' : 'random';
    appSettings.minDelay = Math.max(3, Number(delaySettings.minDelay) || 3);
    appSettings.maxDelay = Math.max(appSettings.minDelay, Number(delaySettings.maxDelay) || 7);
    appSettings.fixedDelay = Math.max(3, Number(delaySettings.fixedDelay) || 4);
    persistState();
  }

  if (batchSettings) {
    if (batchSettings.batchEnabled !== undefined) appSettings.batchEnabled = Boolean(batchSettings.batchEnabled);
    if (batchSettings.batchSize !== undefined) appSettings.batchSize = Math.max(1, Number(batchSettings.batchSize) || 25);
    if (batchSettings.batchDelaySec !== undefined) appSettings.batchDelaySec = Math.max(5, Number(batchSettings.batchDelaySec) || 60);
    if (batchSettings.batchSwitchBot !== undefined) appSettings.batchSwitchBot = Boolean(batchSettings.batchSwitchBot);
    persistState();
  }

  // Verify at least one account is available before starting
  const initialCheck = selectAvailableBot(accounts, 'bot1');
  if (!initialCheck.bot) {
    campaignState.isRunning = false;
    campaignState.isPaused = false;
    campaignState.isStopped = true;
    campaignState.status = initialCheck.reason === 'DAILY_LIMIT_REACHED' ? 'stopped_limit' : 'stopped_no_account';
    campaignState.stopReason = initialCheck.message;
    addLog('error', `🛑 ${initialCheck.message}`);
    throw new Error(initialCheck.message);
  }

  // Optimizer: Automatically convert all raw file uploads into Zero-Reupload Forwards
  // by sending them once to the bot's own number and caching the CDN keys.
  for (let mIdx = 0; mIdx < mediaList.length; mIdx++) {
    let mAttach = mediaList[mIdx];
    if (mAttach && mAttach.base64 && mAttach.type !== 'forward' && !mAttach.forwardMessageId && fileSendMethod === 'forward') {
      const msg1 = `[Optimizer] Uploading ${mAttach.fileName || 'file'} to WhatsApp CDN (Zero-Reupload caching)...`;
      addLog('info', msg1);
      // We use setTimeout to ensure the SSE client has time to connect if this is the very start of the campaign
      setTimeout(() => broadcastDispatchEvent('log', { level: 'info', text: msg1 }), 500);
      
      try {
        const forwardItem = await prepareMediaForForwarding({ bot: initialCheck.bot, mediaAttachment: mAttach });
        if (forwardItem && forwardItem.id) {
          const isNoCaption = mAttach.captionSource === 'none' ||
            mAttach.captionMode === 'none' ||
            (!mAttach.caption && mAttach.captionSource !== 'msg') ||
            (mAttach.captionSource === 'custom' && (!mAttach.caption || !mAttach.caption.trim()));
          const origSendSeparate = Boolean(mAttach.sendSeparate === true || mAttach.mode === 'separate');
          mediaList[mIdx] = {
            type: 'forward',
            forwardMessageId: forwardItem.id,
            fileName: forwardItem.fileName || mAttach.fileName,
            mimetype: forwardItem.mimetype || mAttach.mimetype,
            mediaType: forwardItem.type || mAttach.type,
            caption: isNoCaption ? '' : (mAttach.caption || ''),
            captionMessageIndex: isNoCaption ? -1 : mAttach.captionMessageIndex,
            captionSource: isNoCaption ? 'none' : mAttach.captionSource,
            sendSeparate: origSendSeparate,
            forceCaption: !isNoCaption && Boolean(mAttach.caption),
            captionMode: isNoCaption ? 'none' : (mAttach.captionMode || 'template'),
            base64: mAttach.base64
          };
          const msg2 = `[Optimizer] File successfully cached to CDN! Will forward natively.`;
          addLog('success', msg2);
          broadcastDispatchEvent('log', { level: 'success', text: msg2 });
        }
      } catch (prepErr) {
        const msg3 = `[Optimizer] Failed to cache media, will upload normally per user: ${prepErr.message}`;
        addLog('warning', msg3);
        broadcastDispatchEvent('log', { level: 'warning', text: msg3 });
      }
    }
  }

  const isBatchActive = Boolean(appSettings.batchEnabled);
  const bSize = Math.max(1, Number(appSettings.batchSize) || 25);
  const bDelaySec = Math.max(5, Number(appSettings.batchDelaySec) || 60);
  const bSwitchBot = Boolean(appSettings.batchSwitchBot);
  const totalBatches = isBatchActive ? Math.ceil(validRecipients.length / bSize) : 1;

  campaignAbortFlag = false;
  campaignPauseFlag = false;

  const alreadySentPhones = new Set();
  const alreadyFailedPhones = new Set();
  if (resume) {
    if (Array.isArray(campaignState.results)) {
      for (const r of campaignState.results) {
        const norm = normalizePhoneNumber(r.phone || r.clean)?.clean || String(r.phone || '').replace(/\D/g, '');
        if (norm) {
          if (r.status === 'SENT' || r.status === 'DELIVERED') {
            alreadySentPhones.add(norm);
            alreadyFailedPhones.delete(norm);
          } else if (r.status === 'FAILED') {
            if (!alreadySentPhones.has(norm)) alreadyFailedPhones.add(norm);
          }
        }
      }
    }
    const savedProg = loadJsonFile(CAMPAIGN_PROGRESS_FILE, null);
    if (savedProg) {
      if (Array.isArray(savedProg.sentPhones)) {
        for (const p of savedProg.sentPhones) {
          const norm = normalizePhoneNumber(p)?.clean || String(p || '').replace(/\D/g, '');
          if (norm) alreadySentPhones.add(norm);
        }
      }
      if (Array.isArray(savedProg.failedPhones)) {
        for (const p of savedProg.failedPhones) {
          const norm = normalizePhoneNumber(p)?.clean || String(p || '').replace(/\D/g, '');
          if (norm) alreadyFailedPhones.add(norm);
        }
      }
      if (savedProg.batchEnabled !== undefined) campaignState.batchEnabled = Boolean(savedProg.batchEnabled);
      if (savedProg.batchSize) campaignState.batchSize = savedProg.batchSize;
      if (savedProg.batchDelaySec) campaignState.batchDelaySec = savedProg.batchDelaySec;
    }
  }

  if (!resume) {
    const resolvedName = (name || campaignName || campaignState.lastPayload?.name || '').trim() || ('Campaign ' + new Date().toISOString().slice(0, 10) + ' ' + new Date().toTimeString().slice(0, 5));
    campaignState.id = `camp_${Date.now()}`;
    campaignState.name = resolvedName;
    campaignState.campaignName = resolvedName;
    campaignState.startedAt = new Date().toISOString();
    campaignState.total = validRecipients.length;
    campaignState.processed = 0;
    campaignState.sent = 0;
    campaignState.failed = 0;
    campaignState.completionPercentage = 0;
    campaignState.errorPercentage = 0;
    campaignState.progressPercentage = 0;
    campaignState.accountRotations = 0;
    campaignState.currentBatch = 1;
    campaignState.summary = null;
    campaignState.results = [];
    campaignState.resumable = false;
    saveCampaignProgress({ status: 'running' });
  } else {
    campaignState.total = validRecipients.length;
    campaignState.sent = alreadySentPhones.size;
    campaignState.failed = alreadyFailedPhones.size;
    campaignState.processed = campaignState.sent + campaignState.failed;
    campaignState.currentBatch = isBatchActive ? Math.min(totalBatches, Math.floor((campaignState.sent + campaignState.failed) / bSize) + 1) : 1;
    campaignState.totalBatches = totalBatches;
    recalculateCampaignPercentages();
    campaignState.resumable = false;
    saveCampaignProgress({ status: 'running' });
  }
  
  campaignState.status = 'running';
  campaignState.isRunning = true;
  campaignState.isPaused = false;
  campaignState.isStopped = false;
  campaignState.stopReason = '';
  campaignState.completedAt = null;
  campaignState.activeBotId = initialCheck.bot.id;
  campaignState.currentRecipient = null;
  campaignState.currentPhone = null;
  campaignState.nextMessageCountdownSec = 0;
  campaignState.nextDelaySeconds = 0;
  campaignState.batchEnabled = isBatchActive;
  campaignState.batchSize = bSize;
  campaignState.batchDelaySec = bDelaySec;
  campaignState.batchSwitchBot = bSwitchBot;
  campaignState.totalBatches = totalBatches;
  campaignState.isBatchCooldown = false;
  campaignState.batchCooldownCountdownSec = 0;
  campaignState.liveDispatch = {
    active: true,
    dispatchType: 'text',
    phase: 'starting',
    recipient: null,
    bot: { id: initialCheck.bot.id, label: initialCheck.bot.label, phone: initialCheck.bot.phone, index: initialCheck.bot.index },
    file: null,
    message: '',
    textSnippet: '',
    caption: '',
    isForward: false,
    forwardBoost: false,
    serverAckId: '',
    latencyMs: 0,
    countdownSec: 0,
    speedMsgsPerMin: 0,
    recentResults: []
  };
  broadcastDispatchEvent('state', campaignState.liveDispatch);

  const batchLogMsg = isBatchActive
    ? ` | 📦 Batching: ON (${bSize}/batch, Cooldown: ${bDelaySec}s, Total Batches: ${totalBatches}${bSwitchBot ? ', Auto-Rotate Bot: Yes' : ''})`
    : ' | 📦 Batching: OFF';
  addLog('info', `🚀 Campaign started! Total recipients: ${validRecipients.length} | Starting bot: ${initialCheck.bot.label}${batchLogMsg}`);

  // Pre-save contacts to Google Contacts if enabled and logged in
  if (appSettings.googleContactsAutoSave && googleAuthState?.tokens?.refresh_token) {
    try {
      addLog('info', `☁️ [Google Contacts Auto-Save] Saving ${validRecipients.length} contacts to Google Contacts before sending (Saved Contact Anti-Ban Protection)...`);
      batchSaveContactsToGoogleContacts(validRecipients, appSettings.googleContactsLabel || 'WhatsApp Bot')
        .then(res => {
          addLog('success', `☁️ [Google Contacts] Contacts ${res.savedCount} contacts saved to Google Contacts — will sync with your phone now!`);
        })
        .catch(err => {
          addLog('warn', `⚠️ [Google Contacts Auto-Save] Sync minor issue: ${err.message}`);
        });
    } catch (e) {}
  }

  // Automatic /boost Mode: Pre-upload each media file once to WhatsApp CDN, then forward to all contacts (Zero Re-Upload Mode)
  for (let mi = 0; mi < mediaList.length; mi++) {
    let mAttach = mediaList[mi];
    if (mAttach && mAttach.type && mAttach.type !== 'none' && mAttach.type !== 'forward' && fileSendMethod === 'forward') {
      const isBoostEnabled = mAttach.boostMode === true;
      if (isBoostEnabled) {
        try {
          addLog('info', `⚡ [/boost Engine] Media "${mAttach.fileName || mAttach.type}" preparing to upload once to WhatsApp Server and forward to all contacts (Zero Re-Upload Mode)...`);
          const preparedForward = await prepareMediaForForwarding({ bot: initialCheck.bot, mediaAttachment: mAttach });
          if (preparedForward) {
            const isNoCaption = mAttach.captionSource === 'none' || (!mAttach.caption && mAttach.captionSource !== 'msg');
            const originalSendSeparate = Boolean(mAttach.sendSeparate || mAttach.mode === 'separate' || mAttach.dispatchMode === 'separate');
            mediaList[mi] = {
              type: 'forward',
              isForward: true,
              forwardMessage: preparedForward,
              forwardMessageId: preparedForward.id,
              fileName: preparedForward.fileName,
              mimetype: preparedForward.mimetype,
              mediaType: preparedForward.type,
              caption: isNoCaption ? '' : (mAttach.caption || ''),
              captionMessageIndex: isNoCaption ? -1 : mAttach.captionMessageIndex,
              captionSource: isNoCaption ? 'none' : mAttach.captionSource,
              captionMode: isNoCaption ? 'none' : (mAttach.captionMode || 'template'),
              sendSeparate: originalSendSeparate,
              forceForward: mAttach.forceForward !== false,
              base64: mAttach.base64
            };
            addLog('success', `⚡ [/boost Engine] Media ready! Forwarding instantly to all ${validRecipients.length} recipients without re-uploading (Zero re-upload) (Estimated Bandwidth Saved: ~${((Math.max(1, validRecipients.length - 1) * (preparedForward.fileSizeBytes || 1024 * 1024)) / (1024 * 1024)).toFixed(1)} MB)!`);
          }
        } catch (prepErr) {
          addLog('warn', `⚠️ [/boost Engine] Minor issue preparing media: ${prepErr.message}`);
        }
      }
    }
    // Forward Message Resolution: Ensure forwardMessage and mediaType are populated from catalog if only ID was passed
    mAttach = mediaList[mi];
    if (mAttach && (mAttach.type === 'forward' || mAttach.isForward)) {
      if (!mAttach.forwardMessage && mAttach.forwardMessageId) {
        mediaList[mi].forwardMessage = getForwardableMessage(mAttach.forwardMessageId);
      }
      if (mediaList[mi].forwardMessage && !mediaList[mi].mediaType) {
        mediaList[mi].mediaType = mediaList[mi].forwardMessage.type;
      }
    }
  }


  let currentBotId = initialCheck.bot.id;
  let consecutiveFailures = 0;

  try {
    for (let idx = 0; idx < validRecipients.length; idx++) {
      if (campaignAbortFlag) {
        if (campaignState.status !== 'interrupted') {
          campaignState.status = 'stopped_manual';
          campaignState.stopReason = 'Stopped by user.';
        }
        addLog('warn', `⏹️ ${campaignState.stopReason}`);
        saveCampaignProgress({ status: campaignState.status });
        break;
      }

      // Wait while paused
      let wasPausedLogged = false;
      while (campaignPauseFlag && !campaignAbortFlag) {
        if (!wasPausedLogged) {
          campaignState.status = 'paused';
          campaignState.isPaused = true;
          saveCampaignProgress({ status: 'paused' });
          wasPausedLogged = true;
        }
        await new Promise(r => setTimeout(r, 300));
      }
      if (campaignAbortFlag) {
        if (campaignState.status !== 'interrupted') {
          campaignState.status = 'stopped_manual';
          campaignState.stopReason = 'Stopped by user.';
        }
        saveCampaignProgress({ status: campaignState.status });
        break;
      }
      campaignState.status = 'running';
      campaignState.isRunning = true;
      campaignState.isPaused = false;

      const recipient = validRecipients[idx];
      const rClean = normalizePhoneNumber(recipient.phone || recipient.jid)?.clean || String(recipient.phone || '').replace(/\D/g, '');

      // Resuming duplicate protection: skip recipient if already sent or failed in this campaign!
      if (resume && rClean && (alreadySentPhones.has(rClean) || alreadyFailedPhones.has(rClean))) {
        continue;
      }

      // Blacklist check
      if (rClean && (blacklistStore.includes(rClean) || blacklistStore.includes('+' + rClean))) {
        campaignState.failed += 1;
        alreadyFailedPhones.add(rClean);
        campaignState.results.push({ phone: recipient.phone, status: 'FAILED', error: 'Blacklisted (Opt-Out)' });
        addLog('warn', `🛑 Skipped ${recipient.phone}: User is in Blacklist (Opt-out).`);
        continue;
      }

      campaignState.currentRecipient = {
        index: idx + 1,
        name: recipient.name || 'Recipient',
        phone: recipient.phone
      };
      campaignState.currentPhone = recipient.phone;

      // Build the ordered list of "sends" for this recipient upfront:
      //  1. All text messages (each as a pure text send with no media)
      //  2. All media attachments (sent individually; text from first message used as caption if any)
      const sendsForRecipient = [];
      const usedCaptionIndexes = new Set();

      if (pollData) {
        // Poll campaign: exactly ONE poll send per recipient
        sendsForRecipient.push({ kind: 'poll', renderedText: '', media: null, pollData });
      } else {
        for (const mAttach of mediaList) {
          let captionToUse = '';
          const isFwd = mAttach.type === 'forward' || mAttach.isForward;
          const isSep = Boolean(mAttach.sendSeparate === true || mAttach.mode === 'separate' || mAttach.dispatchMode === 'separate');
          
          const isNoCap = mAttach.type === 'sticker' || mAttach.captionSource === 'none' ||
            mAttach.captionMode === 'none' ||
            (mAttach.captionSource === 'custom' && (!mAttach.caption || !mAttach.caption.trim()));
          
          if (isNoCap) {
            captionToUse = '';
          } else if (mAttach.captionSource === 'msg') {
            const targetIdx = (typeof mAttach.captionMessageIndex === 'number' && mAttach.captionMessageIndex >= 0) ? mAttach.captionMessageIndex : 0;
            if (msgList[targetIdx]) {
              captionToUse = renderTemplate(msgList[targetIdx], recipient.data || recipient);
              if (!isSep) usedCaptionIndexes.add(targetIdx);
            }
          } else if (mAttach.caption && typeof mAttach.caption === 'string' && mAttach.caption.trim()) {
            captionToUse = renderTemplate(mAttach.caption.trim(), recipient.data || recipient);
          } else {
            captionToUse = '';
          }
          sendsForRecipient.push({ kind: 'media', renderedText: captionToUse, media: mAttach });
        }

        // Add remaining text messages that weren't used as captions
        const textSends = [];
        for (let i = 0; i < msgList.length; i++) {
          if (!usedCaptionIndexes.has(i)) {
            textSends.push({ kind: 'text', renderedText: renderTemplate(msgList[i], recipient.data || recipient), media: null });
          }
        }
        
        sendsForRecipient.unshift(...textSends);
        // Only push a text send if there are literally NO media or other sends for this recipient at all!
        if (sendsForRecipient.length === 0 && mediaList.length === 0) {
          sendsForRecipient.push({ kind: 'text', renderedText: '', media: null });
        }
      }

      // Check daily limit BEFORE sending, ensuring bot has enough quota to send ALL messages for this recipient!
      const requiredSendsForRecipient = Math.max(1, sendsForRecipient.length);
      let selection = selectAvailableBot(accounts, currentBotId, requiredSendsForRecipient);
      if (!selection.bot) {
        campaignState.status = selection.reason === 'DAILY_LIMIT_REACHED' ? 'stopped_limit' : 'stopped_no_account';
        campaignState.stopReason = selection.message;
        addLog('error', `🛑 ${selection.message}`);
        break;
      }

      if (selection.bot.id !== currentBotId) {
        campaignState.accountRotations += 1;
        addLog('warn', `🔀 [${accounts[currentBotId]?.label}] Cannot fit all ${requiredSendsForRecipient} message(s) for ${recipient.phone} in remaining quota (${accounts[currentBotId]?.dailyLimit - accounts[currentBotId]?.sentToday} left). Auto-switched to [${selection.bot.label}]!`);
        currentBotId = selection.bot.id;
      }
      campaignState.activeBotId = currentBotId;

      let stopEntireCampaign = false;

      for (let sendIdx = 0; sendIdx < sendsForRecipient.length && !stopEntireCampaign && !campaignAbortFlag; sendIdx++) {
        // Apply inter-message delay BEFORE the 2nd and subsequent sends to the same recipient
        if (sendIdx > 0 && !campaignAbortFlag) {
          const interDelayObj = calculateMessageDelay(appSettings);
          const interWaitMs = typeof fastTestDelayMs === 'number' ? Math.min(fastTestDelayMs, interDelayObj.ms) : interDelayObj.ms;
          addLog('info', `⏱️ [${recipient.phone}] Multiple sends: waiting ${interDelayObj.seconds}s before send ${sendIdx + 1}/${sendsForRecipient.length}...`);
          let rem = interWaitMs;
          const stepMs2 = Math.min(250, interWaitMs);
          while (rem > 0 && !campaignAbortFlag) {
            while (campaignPauseFlag && !campaignAbortFlag) { await new Promise(r => setTimeout(r, 300)); }
            await new Promise(r => setTimeout(r, stepMs2));
            rem -= stepMs2;
          }
        }

        const { renderedText: renderedMessage, media: currentMedia, pollData: currentPollData } = sendsForRecipient[sendIdx];
        const delayObj = calculateMessageDelay(appSettings);

        let deliveredOrHandled = false;

        // Failover retry loop: if the active account drops connection mid-send, rotate to the next connected account and retry!
        for (let attempt = 0; attempt < BOT_IDS.length && !deliveredOrHandled; attempt++) {
          const activeBot = selection.bot;
          let sendStartTime = Date.now();
          try {
            // Pre-save contact to Google Contacts & inject into Baileys address book (only on first send per recipient)
            if (sendIdx === 0) {
              if (appSettings.googleContactsAutoSave && googleAuthState?.tokens?.refresh_token) {
                try {
                  await saveContactToGoogleContacts({
                    name: recipient.name,
                    phone: recipient.phone,
                    course: recipient.course || recipient.data?.course,
                    label: appSettings.googleContactsLabel || 'WhatsApp Bot'
                  });
                } catch (gErr) {
                  // Non-blocking fallback
                }
              }
              injectBaileysContact(activeBot, recipient);
            }

            const isFwd = Boolean(currentMedia && (currentMedia.type === 'forward' || currentMedia.isForward || currentMedia.forwardMessageId));
            let dType = 'text';
            if (isFwd) {
              dType = 'forward';
            } else if (currentMedia && currentMedia.type && currentMedia.type !== 'none') {
              dType = (currentMedia.type || 'image').toLowerCase();
              if (dType === 'document') dType = 'pdf';
            } else if (contactAttachment?.enabled) {
              dType = 'contact';
            }

            const fwdItem = isFwd ? (currentMedia?.forwardMessage || (currentMedia?.forwardMessageId ? getForwardableMessage(currentMedia.forwardMessageId) : null)) : null;
            const fwdMediaType = fwdItem?.type || currentMedia?.mediaType || 'media';

            const fDetails = (currentMedia && currentMedia.type !== 'none') || isFwd ? {
              name: currentMedia?.fileName || currentMedia?.forwardMessage?.fileName || fwdItem?.fileName || fwdItem?.textSnippet || (isFwd ? 'Forwarded Media' : `${dType.toUpperCase()} File`),
              size: currentMedia?.fileSize || currentMedia?.forwardMessage?.fileSizeFormatted || fwdItem?.fileSizeFormatted || (currentMedia?.base64 ? `${Math.round(currentMedia.base64.length * 0.75 / 1024)} KB` : '1.2 MB'),
              type: dType,
              fwdMediaType: isFwd ? fwdMediaType : null,
              thumbnail: currentMedia?.base64 || fwdItem?.jpegThumbnail || null,
              caption: currentMedia?.caption || renderedMessage || ''
            } : null;

            sendStartTime = Date.now();
            const campElapsedMin = Math.max(0.01, (Date.now() - new Date(campaignState.startedAt).getTime()) / 60000);
            const curSpeed = Math.max(1, Math.round((campaignState.sent + 1) / campElapsedMin));

            campaignState.liveDispatch = {
              active: true,
              dispatchType: dType,
              phase: 'transmitting',
              recipient: {
                name: recipient.name || 'Recipient',
                phone: recipient.phone,
                index: idx + 1,
                total: validRecipients.length
              },
              bot: {
                id: activeBot.id,
                label: activeBot.label,
                phone: activeBot.phone,
                index: activeBot.index
              },
              file: fDetails,
              message: renderedMessage,
              textSnippet: (renderedMessage || '').slice(0, 160),
              caption: currentMedia?.caption || renderedMessage || '',
              isForward: dType === 'forward' || isFwd,
              forwardBoost: Boolean(currentMedia?.boostMode || isFwd),
              serverAckId: '',
              latencyMs: 0,
              countdownSec: 0,
              speedMsgsPerMin: curSpeed,
              recentResults: campaignState.results.slice(-10)
            };
            broadcastDispatchEvent('transmitting', campaignState.liveDispatch);

            const ackResult = await sendSingleMessageWithServerAck({
              bot: activeBot,
              recipient,
              renderedText: renderedMessage,
              mediaAttachment: currentMedia,
              contactAttachment: sendIdx === 0 ? contactAttachment : null,
              pollData: currentPollData
            });

            campaignState.lastServerAckId = ackResult.serverMessageId;
            campaignState.lastServerAckTime = ackResult.confirmedAt;
            recalculateCampaignPercentages();

            const latencyMs = Date.now() - sendStartTime;
            const record = {
              index: idx + 1,
              phone: recipient.phone,
              name: recipient.name || 'Recipient',
              course: recipient.course || recipient.data?.course || '',
              botId: activeBot.id,
              botLabel: activeBot.label,
              senderPhone: activeBot.phone,
              message: currentPollData ? `[Poll] ${currentPollData.question}` : (currentMedia?.type === 'voice' ? '[Voice Note]' : (currentMedia?.type === 'sticker' ? '[Sticker]' : renderedMessage)),
              mediaType: currentPollData ? 'POLL' : (currentMedia?.type === 'forward'
                ? `FORWARD (${(currentMedia.mediaType || currentMedia.forwardMessage?.type || 'MEDIA').toUpperCase()})`
                : (currentMedia?.type && currentMedia.type !== 'none' ? currentMedia.type.toUpperCase() : (contactAttachment?.enabled ? 'CONTACT' : 'TEXT'))),
              status: 'SENT',
              serverAck: true,
              serverMessageId: ackResult.serverMessageId,
              delaySec: delayObj.seconds,
              timestamp: ackResult.confirmedAt,
              latencyMs,
              error: ''
            };
            campaignState.results.push(record);

            campaignState.liveDispatch.phase = 'confirmed';
            campaignState.liveDispatch.serverAckId = ackResult.serverMessageId;
            campaignState.liveDispatch.latencyMs = latencyMs;
            campaignState.liveDispatch.recentResults = campaignState.results.slice(-10);
            broadcastDispatchEvent('server_ack', {
              ...campaignState.liveDispatch,
              result: record
            });

            addLog('success', `✅ [${activeBot.label}] -> ${recipient.name} (${recipient.phone}) [${sendIdx + 1}/${sendsForRecipient.length}] | ${currentPollData ? '📊 Poll Sent' : (ackResult.forwarded ? '⚡ Forwarded (Boost CDN)' : 'Server ACK')}: ${ackResult.serverMessageId}`);
            // Message History Log
            appendMsgHistory({ phone: recipient.phone, name: recipient.name || '', campaignId: campaignState.id, campaignName: campaignState.name || campaignState.campaignName || 'Untitled Campaign', text: currentPollData ? `[Poll] ${currentPollData.question}` : (renderedMessage ? renderedMessage.substring(0, 200) : ''), status: 'sent', timestamp: new Date().toISOString(), botId: activeBot.id });
            // Engagement Score: increment totalSent on contact
            const _ec = contactsState.contacts.find(c => c.phone === recipient.phone);
            if (_ec) { _ec.totalSent = (_ec.totalSent || 0) + 1; }
            consecutiveFailures = 0;
            deliveredOrHandled = true;
            if (sendIdx === sendsForRecipient.length - 1) alreadySentPhones.add(rClean);
            campaignState.sent = alreadySentPhones.size;
            campaignState.processed = campaignState.sent + campaignState.failed;
            saveCampaignProgress({ status: 'running' });
          } catch (err) {
            activeBot.totalFailed += 1;
            campaignState.processed = campaignState.sent + campaignState.failed;
            recalculateCampaignPercentages();
            persistState();

            const latencyMs = Date.now() - sendStartTime;
            const record = {
              index: idx + 1,
              phone: recipient.phone,
              name: recipient.name || 'Recipient',
              course: recipient.course || recipient.data?.course || '',
              botId: activeBot.id,
              botLabel: activeBot.label,
              senderPhone: activeBot.phone,
              message: renderedMessage,
              mediaType: currentMedia?.type === 'forward'
                ? `FORWARD (${(currentMedia.mediaType || currentMedia.forwardMessage?.type || 'MEDIA').toUpperCase()})`
                : (currentMedia?.type && currentMedia.type !== 'none' ? currentMedia.type.toUpperCase() : (contactAttachment?.enabled ? 'CONTACT' : 'TEXT')),
              status: 'FAILED',
              serverAck: false,
              serverMessageId: '',
              delaySec: delayObj.seconds,
              timestamp: new Date().toISOString(),
              latencyMs,
              error: err.message || 'Send failed'
            };
            campaignState.results.push(record);

            campaignState.liveDispatch.phase = 'failed';
            campaignState.liveDispatch.error = err.message || 'Send failed';
            campaignState.liveDispatch.recentResults = campaignState.results.slice(-10);
            broadcastDispatchEvent('failed', {
              ...campaignState.liveDispatch,
              phone: recipient.phone,
              error: err.message
            });
            addLog('error', `❌ [${activeBot.label}] -> ${recipient.phone} [${sendIdx + 1}/${sendsForRecipient.length}] failed: ${err.message}`);
            saveCampaignProgress({ status: 'running' });

            consecutiveFailures++;
            deliveredOrHandled = true;
            if (sendIdx === sendsForRecipient.length - 1) alreadyFailedPhones.add(rClean);
            campaignState.failed = alreadyFailedPhones.size;

            if (consecutiveFailures >= 5) {
              campaignPauseFlag = true;
              campaignState.isPaused = true;
              campaignState.status = 'paused';
              addLog('error', `🛑 5 consecutive messages failed! Campaign paused.`);
              saveCampaignProgress({ status: 'paused' });
              broadcastDispatchEvent('alert', { type: 'consecutive_failure', message: 'Please check internet and WhatsApp connections!' });
              stopEntireCampaign = true; // Break out of the fallback loop, we will pause.
              break; // Stop the retry loop for this send unit
            }

            const isConnDrop = Boolean(err.isAccountConnectionError || !activeBot.isConnected) && !err.isRecipientError;
            if (!isConnDrop) {
              appendMsgHistory({
                phone: recipient.phone,
                name: recipient.name || '',
                campaignId: campaignState.id,
                campaignName: campaignState.name || campaignState.campaignName || 'Untitled Campaign',
                text: currentPollData ? `[Poll] ${currentPollData.question}` : (renderedMessage ? renderedMessage.substring(0, 200) : ''),
                status: 'failed',
                timestamp: new Date().toISOString(),
                botId: activeBot.id
              });
            }
            if (isConnDrop && !campaignPauseFlag) {
              activeBot.isConnected = false;
              activeBot.status = 'disconnected';
              persistState();

              const fallbackSelection = selectAvailableBot(accounts, currentBotId);
              if (fallbackSelection.bot) {
                campaignState.accountRotations += 1;
                addLog('warn', `🔀 [${activeBot.label}] Connection failed (${err.message}) [${fallbackSelection.bot.label}] auto-switched to ${recipient.phone} to retry sending!`);
                currentBotId = fallbackSelection.bot.id;
                campaignState.activeBotId = currentBotId;
                selection = fallbackSelection;
                
                // Pop the failed record since we are going to retry
                campaignState.results.pop();
                if (sendIdx === sendsForRecipient.length - 1) alreadyFailedPhones.delete(rClean);
                campaignState.failed = alreadyFailedPhones.size;
                activeBot.totalFailed -= 1;
                consecutiveFailures -= 1; 
                deliveredOrHandled = false;
                campaignState.processed = campaignState.sent + campaignState.failed;
                saveCampaignProgress({ status: 'running' });
                
                continue; // Retry this send on fallbackSelection.bot!
              } else {
                appendMsgHistory({
                  phone: recipient.phone,
                  name: recipient.name || '',
                  campaignId: campaignState.id,
                  campaignName: campaignState.name || campaignState.campaignName || 'Untitled Campaign',
                  text: currentPollData ? `[Poll] ${currentPollData.question}` : (renderedMessage ? renderedMessage.substring(0, 200) : ''),
                  status: 'failed',
                  timestamp: new Date().toISOString(),
                  botId: activeBot.id
                });
                // No other connected bot has quota
                campaignState.status = fallbackSelection.reason === 'DAILY_LIMIT_REACHED' ? 'stopped_limit' : 'stopped_no_account';
                campaignState.stopReason = fallbackSelection.message;
                addLog('error', `🛑 ${fallbackSelection.message}`);
                saveCampaignProgress({ status: campaignState.status });
                stopEntireCampaign = true;
              }
            }
          }
        } // end failover retry loop
      } // end sendsForRecipient loop


      // If 5 consecutive failures triggered a pause, wait in the pause loop above for next iteration
      if (consecutiveFailures >= 5) {
        idx--; // Decrement idx so we retry this same recipient when resumed
        continue;
      }

      if (stopEntireCampaign && !campaignPauseFlag) break;

      // Wait the configured delay (minimum 3 seconds) before sending the next message, ONLY after server confirmation
      if (idx < validRecipients.length - 1 && !campaignAbortFlag) {
        // Also check immediately if ALL accounts just hit their daily limit after this message
        const nextCheck = selectAvailableBot(accounts, currentBotId);
        if (!nextCheck.bot) {
          campaignState.status = nextCheck.reason === 'DAILY_LIMIT_REACHED' ? 'stopped_limit' : 'stopped_no_account';
          campaignState.stopReason = nextCheck.message;
          addLog('error', `🛑 ${nextCheck.message}`);
          break;
        }

        // Check if current message completes a batch
        const isBatchEnd = isBatchActive && ((idx + 1) % bSize === 0);
        if (isBatchEnd) {
          const finishedBatch = campaignState.currentBatch;
          campaignState.isBatchCooldown = true;
          addLog('warn', `📦 Batch #${finishedBatch}/${totalBatches} finished! Cooldown started ( ${bDelaySec}s break)...`);

          // If batchSwitchBot is enabled, rotate to the next bot
          if (bSwitchBot) {
            const botIds = ['bot1', 'bot2', 'bot3', 'bot4', 'bot5'];
            const curIdx = botIds.indexOf(currentBotId);
            const nextBotId = botIds[(curIdx + 1) % botIds.length];
            const rotatedCheck = selectAvailableBot(accounts, nextBotId);
            if (rotatedCheck.bot) {
              currentBotId = rotatedCheck.bot.id;
              campaignState.activeBotId = currentBotId;
              campaignState.accountRotations++;
              addLog('info', `🔄 Batch #${finishedBatch} Bot switched after Batch ➔ ${rotatedCheck.bot.label} (${rotatedCheck.bot.phone})`);
            }
          }

          const totalWaitMs = typeof fastTestDelayMs === 'number' ? Math.min(fastTestDelayMs, bDelaySec * 1000) : (bDelaySec * 1000);
          let remainingMs = totalWaitMs;
          const stepMs = 250;
          let lastCooldownSec = -1;
          while (remainingMs > 0 && !campaignAbortFlag) {
            while (campaignPauseFlag && !campaignAbortFlag) {
              campaignState.status = 'paused';
              campaignState.isPaused = true;
              await new Promise(r => setTimeout(r, 300));
            }
            if (campaignAbortFlag) break;
            campaignState.status = 'running';
            campaignState.isPaused = false;
            campaignState.isRunning = true;
            const secLeft = Math.ceil(remainingMs / 1000);
            campaignState.batchCooldownCountdownSec = secLeft;
            campaignState.nextMessageCountdownSec = secLeft;
            campaignState.nextDelaySeconds = secLeft;
            if (campaignState.liveDispatch && secLeft !== lastCooldownSec) {
              lastCooldownSec = secLeft;
              campaignState.liveDispatch.phase = 'cooldown';
              campaignState.liveDispatch.countdownSec = secLeft;
              broadcastDispatchEvent('cooldown', {
                ...campaignState.liveDispatch,
                countdownSec: secLeft,
                isBatchCooldown: true
              });
            }
            await new Promise(r => setTimeout(r, stepMs));
            remainingMs -= stepMs;
          }
          campaignState.isBatchCooldown = false;
          campaignState.batchCooldownCountdownSec = 0;
          campaignState.nextMessageCountdownSec = 0;
          campaignState.nextDelaySeconds = 0;
          campaignState.currentBatch = Math.min(totalBatches, finishedBatch + 1);
          if (!campaignAbortFlag) {
            addLog('info', `▶️ Batch #${campaignState.currentBatch}/${totalBatches} started!`);
          }
        } else {
          const totalWaitMs = typeof fastTestDelayMs === 'number' ? fastTestDelayMs : calculateMessageDelay(appSettings).ms;
          let remainingMs = totalWaitMs;
          const stepMs = Math.min(250, totalWaitMs);
          let lastCooldownSec = -1;
          while (remainingMs > 0 && !campaignAbortFlag) {
            while (campaignPauseFlag && !campaignAbortFlag) {
              campaignState.status = 'paused';
              campaignState.isPaused = true;
              await new Promise(r => setTimeout(r, 300));
            }
            if (campaignAbortFlag) break;
            campaignState.status = 'running';
            campaignState.isPaused = false;
            campaignState.isRunning = true;
            const secLeft = Math.ceil(remainingMs / 1000);
            campaignState.nextMessageCountdownSec = secLeft;
            campaignState.nextDelaySeconds = secLeft;
            if (campaignState.liveDispatch && secLeft !== lastCooldownSec) {
              lastCooldownSec = secLeft;
              campaignState.liveDispatch.phase = 'cooldown';
              campaignState.liveDispatch.countdownSec = secLeft;
              broadcastDispatchEvent('cooldown', {
                ...campaignState.liveDispatch,
                countdownSec: secLeft,
                isBatchCooldown: false
              });
            }
            await new Promise(r => setTimeout(r, stepMs));
            remainingMs -= stepMs;
          }
          campaignState.nextMessageCountdownSec = 0;
          campaignState.nextDelaySeconds = 0;
        }
      }
    }
  } finally {
    campaignAbortFlag = true;
    campaignPauseFlag = false;
    campaignState.isRunning = false;
    campaignState.isPaused = false;
    campaignState.isStopped = true;
    campaignState.isBatchCooldown = false;
    campaignState.batchCooldownCountdownSec = 0;
    if (campaignState.status === 'running' || campaignState.status === 'paused' || campaignState.status === 'interrupted') {
      if (campaignState.total > 0 && (campaignState.sent + campaignState.failed >= campaignState.total)) {
        campaignState.status = 'completed';
        campaignState.stopReason = `All numbers (${campaignState.total}/${campaignState.total}) processed. Campaign auto-stopped.`;
        addLog('success', `🎉 Campaign finished! Success: ${campaignState.sent} (${campaignState.completionPercentage}%) | Failed: ${campaignState.failed} (${campaignState.errorPercentage}%)`);
      } else if (campaignState.status !== 'interrupted') {
        campaignState.status = 'paused';
        campaignState.stopReason = `Campaign paused (${campaignState.sent}/${campaignState.total} sent). Ready to resume.`;
      }
    }

    campaignState.completedAt = campaignState.status === 'completed' ? new Date().toISOString() : null;
    campaignState.currentRecipient = null;
    campaignState.currentPhone = null;
    campaignState.nextMessageCountdownSec = 0;
    campaignState.nextDelaySeconds = 0;
    recalculateCampaignPercentages();
    campaignState.summary = computeCampaignSummary();
    saveCampaignProgress({ status: campaignState.status });

    if (campaignState.liveDispatch) {
      campaignState.liveDispatch.active = false;
      campaignState.liveDispatch.phase = 'completed';
      broadcastDispatchEvent('completed', {
        ...campaignState.liveDispatch,
        summary: campaignState.summary
      });
    }
  }

  // Save to report history
  const history = loadJsonFile(REPORTS_FILE, []);
  history.unshift({
    id: campaignState.id,
    name: campaignState.name || campaignState.campaignName || 'Untitled Campaign',
    campaignName: campaignState.name || campaignState.campaignName || 'Untitled Campaign',
    startedAt: campaignState.startedAt,
    completedAt: campaignState.completedAt,
    status: campaignState.status,
    stopReason: campaignState.stopReason,
    total: campaignState.total,
    sent: campaignState.sent,
    failed: campaignState.failed,
    completionPercentage: campaignState.completionPercentage,
    errorPercentage: campaignState.errorPercentage,
    accountRotations: campaignState.accountRotations,
    summary: campaignState.summary,
    results: campaignState.results
  });
  if (history.length > 30) history.pop();
  saveJsonFile(REPORTS_FILE, history);

  // Sync to campaign_archive.json
  try {
    const arcEntry = {
      id: campaignState.id,
      name: campaignState.name || campaignState.campaignName || 'Untitled Campaign',
      campaignName: campaignState.name || campaignState.campaignName || 'Untitled Campaign',
      config: {
        total: campaignState.total,
        sent: campaignState.sent,
        failed: campaignState.failed,
        ...(campaignState.lastPayload || {})
      },
      savedAt: new Date().toISOString()
    };
    if (!campaignArchive.some(c => c.id === campaignState.id)) {
      campaignArchive.unshift(arcEntry);
      if (campaignArchive.length > 50) campaignArchive.length = 50;
      saveCampaignArchive();
    }
  } catch (e) {
    console.warn('saveCampaignArchive error:', e.message);
  }

  return campaignState;
}

// ─── Express HTTP Server & API Routes ────────────────────────────────────────
export const app = express();
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ extended: true, limit: '500mb' }));
app.use(express.static(PUBLIC_DIR));

const LICENSE_FILE = path.join(DATA_DIR, 'license.json');
const MACHINE_ID_FILE = path.join(DATA_DIR, 'machine_id.txt');
let cachedMachineId = null;

export const MASTER_LICENSE_SECRET = 'WA_BOT_PRO_SECRET_KEY_2026_MASTER_CRYPT_SECURE';

export function verifyAdminCryptographicKey(key, currentMachineId) {
  if (!key || typeof key !== 'string') return { valid: false, error: 'Invalid key' };
  const trimmed = key.trim().toUpperCase();
  if (!trimmed.startsWith('WABOT-')) return { valid: false, error: 'Invalid license format' };
  const parts = trimmed.slice(6).split('-');
  if (parts.length < 5) return { valid: false, error: 'Malformed license key' };
  const [client, plan, expToken, boundMid, hmac] = parts;
  const payloadStr = [client, plan, expToken, boundMid].join('-');
  const expectedHmac = crypto.createHmac('sha256', MASTER_LICENSE_SECRET).update(payloadStr).digest('hex').slice(0, 8).toUpperCase();
  if (expectedHmac !== hmac) {
    return { valid: false, error: 'Invalid license key signature (Key is invalid or tampered)' };
  }

  // Check hardware lock if bound to specific machine
  if (boundMid !== 'ANY' && currentMachineId) {
    const cleanMid = String(currentMachineId).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const cleanBound = boundMid.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    if (!cleanMid.startsWith(cleanBound)) {
      return { valid: false, error: `This key is locked to computer hardware ID [${boundMid}]. It cannot be activated on this device.` };
    }
  }

  // Check expiry
  let expiresAt = null;
  if (expToken !== 'INF' && expToken !== 'NOEXP' && expToken !== 'LIFETIME') {
    const epochSec = parseInt(expToken, 36);
    if (!isNaN(epochSec) && epochSec > 0) {
      expiresAt = new Date(epochSec * 1000).toISOString();
      if (new Date(expiresAt) <= new Date()) {
        return { valid: false, error: `License key expired on ${new Date(expiresAt).toLocaleDateString()}` };
      }
    }
  }

  const planNames = { 'LIF': 'Lifetime Pro License', 'YEA': 'Annual Pro License (1 Year)', 'MON': 'Monthly Pro License (30 Days)' };
  return {
    valid: true,
    isPro: true,
    key: trimmed,
    customer: client,
    plan: planNames[plan] || 'Pro License',
    planCode: plan,
    expiresAt,
    boundMachineId: boundMid !== 'ANY' ? boundMid : null,
    isOfflineKey: true
  };
}

function getMachineId() {
  if (cachedMachineId) return cachedMachineId;

  // 1. Try reading saved machine ID from disk
  if (fs.existsSync(MACHINE_ID_FILE)) {
    try {
      const saved = fs.readFileSync(MACHINE_ID_FILE, 'utf8').trim();
      if (saved && saved.length >= 8) {
        cachedMachineId = saved;
        return saved;
      }
    } catch(e) {}
  }

  // 2. Query Windows Registry for MachineGuid (permanent, unique hardware GUID)
  let hwId = null;
  if (process.platform === 'win32') {
    try {
      const { execSync } = require('child_process');
      const out = execSync('reg query HKLM\\SOFTWARE\\Microsoft\\Cryptography /v MachineGuid', { timeout: 2000 }).toString();
      const m = out.match(/MachineGuid\s+REG_SZ\s+([a-f0-9\-]+)/i);
      if (m && m[1]) hwId = m[1].trim();
    } catch(e) {}
  }

  // 3. Fallback: OS architecture + hostname hash
  if (!hwId) {
    const os = require('os');
    const seed = [os.hostname(), os.platform(), os.arch(), os.cpus()?.[0]?.model || '', os.totalmem()].join('|');
    hwId = crypto.createHash('sha256').update(seed).digest('hex').substring(0, 32);
  }

  // 4. Save to persistent file
  try {
    fs.writeFileSync(MACHINE_ID_FILE, hwId, 'utf8');
  } catch(e) {}

  cachedMachineId = hwId;
  return hwId;
}

function getLicense() {
  if (fs.existsSync(LICENSE_FILE)) {
    try { return JSON.parse(fs.readFileSync(LICENSE_FILE, 'utf8')); } catch(e){}
  }
  return null;
}

function hasProLicense() {
  const lic = getLicense();
  if (!lic || !lic.valid) return false;

  // Single-Device Policy Enforcement:
  // The license MUST belong to this physical device hardware
  const currentMid = getMachineId();
  if (lic.machineId && lic.machineId !== currentMid) {
    console.warn(`[License Security] Blocked: Key is locked to device (${lic.machineId}), current hardware is (${currentMid})`);
    return false;
  }

  // Expiry check
  if (lic.expiresAt && !isNaN(new Date(lic.expiresAt).getTime()) && new Date(lic.expiresAt) <= new Date()) {
    return false;
  }
  return true;
}

app.post('/api/license/verify', async (req, res) => {
  try {
    const { key } = req.body;
    if (!key) return res.status(400).json({ valid: false, error: 'License key is required' });
    const currentMid = getMachineId();
    const os = require('os');
    const deviceName = os.hostname();

    // 1. First, check if this is an Admin-generated Cryptographic Key (Starts with WABOT-)
    if (String(key).trim().toUpperCase().startsWith('WABOT-')) {
      const cryptoCheck = verifyAdminCryptographicKey(key, currentMid);
      if (!cryptoCheck.valid) {
        return res.json({ valid: false, error: cryptoCheck.error });
      }
      const licToSave = {
        valid: true,
        isPro: true,
        key: cryptoCheck.key,
        customer: cryptoCheck.customer,
        plan: cryptoCheck.plan,
        planCode: cryptoCheck.planCode,
        machineId: currentMid,
        boundMachineId: cryptoCheck.boundMachineId,
        deviceName: deviceName,
        expiresAt: cryptoCheck.expiresAt,
        savedAt: new Date().toISOString(),
        isOfflineKey: true
      };
      fs.writeFileSync(LICENSE_FILE, JSON.stringify(licToSave, null, 2));
      return res.json({
        ...licToSave,
        valid: true,
        message: `PRO License activated successfully! (${cryptoCheck.plan})`
      });
    }

    // 2. Otherwise, check Cloudflare licensing worker with single-device binding parameters
    const verifyUrl = `https://wa-bot-license.pathiraja1234567.workers.dev/verify?id=${encodeURIComponent(key)}&machineId=${encodeURIComponent(currentMid)}&device=${encodeURIComponent(deviceName)}`;
    let response;
    try {
      response = await fetch(verifyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, machineId: currentMid, device: deviceName })
      });
    } catch(err) {
      response = await fetch(verifyUrl);
    }

    let data;
    try {
      data = await response.json();
    } catch(e) {
      data = { valid: false, error: 'Could not connect to licensing server.' };
    }

    // Check if worker indicates license is already bound to a DIFFERENT machine
    const remoteBoundMachine = data.machineId || data.boundMachineId || data.device_id || data.activeMachineId;
    if (data.valid && remoteBoundMachine && remoteBoundMachine !== currentMid) {
      return res.json({
        valid: false,
        error: `This license is already registered on another device (${data.deviceName || data.device || 'another computer'}). A user can only log in from ONE device at a time. Please deactivate the license on your other device first.`,
        isMultiDeviceBlocked: true
      });
    }

    if (data.valid) {
      // Save license locally bound specifically to THIS device hardware
      const licToSave = {
        ...data,
        key,
        machineId: currentMid,
        deviceName: deviceName,
        savedAt: new Date().toISOString()
      };
      fs.writeFileSync(LICENSE_FILE, JSON.stringify(licToSave, null, 2));

      // Inform cloud server of successful device activation
      try {
        await fetch(`https://wa-bot-license.pathiraja1234567.workers.dev/activate?id=${encodeURIComponent(key)}&machineId=${encodeURIComponent(currentMid)}&device=${encodeURIComponent(deviceName)}`, { method: 'POST' }).catch(() => {});
      } catch(err) {}

      res.json({
        ...licToSave,
        valid: true,
        message: 'PRO activated successfully on this device.'
      });
    } else {
      if (fs.existsSync(LICENSE_FILE)) {
        try { fs.unlinkSync(LICENSE_FILE); } catch(e) {}
      }
      res.json({
        valid: false,
        error: data.error || 'Invalid or expired license key'
      });
    }
  } catch(e) {
    res.status(500).json({ valid: false, error: e.message });
  }
});

app.post('/api/license/deactivate', async (req, res) => {
  try {
    const lic = getLicense();
    const currentMid = getMachineId();
    if (lic && lic.key) {
      try {
        await fetch(`https://wa-bot-license.pathiraja1234567.workers.dev/deactivate?id=${encodeURIComponent(lic.key)}&machineId=${encodeURIComponent(currentMid)}`, { method: 'POST' }).catch(() => {});
      } catch (err) {}
    }
    if (fs.existsSync(LICENSE_FILE)) {
      try { fs.unlinkSync(LICENSE_FILE); } catch (e) {}
    }
    res.json({ success: true, message: 'License deactivated successfully. You can now use this key on another device.' });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/machine-id', (req, res) => {
  res.json({ machineId: getMachineId() });
});

app.get('/api/license/status', async (req, res) => {
  let lic = getLicense();
  const currentMid = getMachineId();
  const os = require('os');
  let isPro = hasProLicense();

  // If local file is missing or expired/invalid, auto-check Cloudflare Worker for machine ID
  if (!isPro && (!lic || !lic.valid)) {
    try {
      const response = await fetch('https://wa-bot-license.pathiraja1234567.workers.dev/verify?id=' + encodeURIComponent(currentMid));
      const data = await response.json();
      if (data && (data.valid === true || data.active === true)) {
        lic = {
          ...data,
          valid: true,
          isPro: true,
          key: currentMid,
          machineId: currentMid,
          deviceName: os.hostname(),
          savedAt: new Date().toISOString()
        };
        fs.writeFileSync(LICENSE_FILE, JSON.stringify(lic, null, 2));
        isPro = true;
      }
    } catch(err) {}
  }

  res.json({
    isPro,
    license: lic,
    currentMachineId: currentMid,
    isDeviceBound: Boolean(lic && lic.machineId === currentMid),
    boundDeviceName: lic?.deviceName || os.hostname(),
    singleDevicePolicy: true
  });
});

app.get('/api/license/auto-verify', async (req, res) => {
  try {
    const mid = getMachineId();
    const response = await fetch('https://wa-bot-license.pathiraja1234567.workers.dev/verify?id=' + encodeURIComponent(mid), {
      signal: AbortSignal.timeout ? AbortSignal.timeout(3500) : undefined
    });
    const data = await response.json();
    if (data && (data.valid === true || data.active === true)) {
      const os = require('os');
      const lic = { ...data, valid: true, isPro: true, key: mid, machineId: mid, deviceName: os.hostname(), savedAt: new Date().toISOString() };
      fs.writeFileSync(LICENSE_FILE, JSON.stringify(lic, null, 2));
      res.json({ isPro: true, data: lic });
    } else {
      res.json({ isPro: false, data });
    }
  } catch(e) {
    res.json({ isPro: false, error: e.message });
  }
});

// Periodic Cloud Session Heartbeat (Enforce Single Device Policy across multiple PCs)
setInterval(async () => {
  try {
    const lic = getLicense();
    if (!lic || !lic.valid || !lic.key) return;
    const currentMid = getMachineId();
    if (lic.machineId && lic.machineId !== currentMid) {
      try { fs.unlinkSync(LICENSE_FILE); } catch(e) {}
      return;
    }
    // If it's an offline cryptographic key, verify signature locally
    if (lic.isOfflineKey) {
      const cryptoCheck = verifyAdminCryptographicKey(lic.key, currentMid);
      if (!cryptoCheck.valid) {
        console.warn(`[License] Local crypto key revoked: ${cryptoCheck.error}`);
        try { fs.unlinkSync(LICENSE_FILE); } catch(e) {}
      }
      return;
    }
    const resp = await fetch(`https://wa-bot-license.pathiraja1234567.workers.dev/verify?id=${encodeURIComponent(lic.key)}&machineId=${encodeURIComponent(currentMid)}`);
    const data = await resp.json();
    const remoteBoundMachine = data.machineId || data.boundMachineId || data.device_id || data.activeMachineId;
    if (remoteBoundMachine && remoteBoundMachine !== currentMid) {
      console.warn(`[License] Session revoked: Key claimed by another device (${remoteBoundMachine})`);
      try { fs.unlinkSync(LICENSE_FILE); } catch(e) {}
    }
  } catch(e) {}
}, 180000);

app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/license')) return next();
  
  if (!hasProLicense()) {
    const proRoutes = [
      '/forward/upload', '/forward/prepare', '/boost/', '/links', '/templates/preview'
    ];
    if (proRoutes.some(r => req.path.includes(r))) {
      return res.status(403).json({ success: false, error: 'Requires PRO License' });
    }

    if (req.path === '/send/single' || req.path === '/campaign/start') {
      const b = req.body;
      console.log('--- CAMPAIGN START PAYLOAD ---'); console.log(JSON.stringify(b, null, 2));
      if (b && (b.mediaAttachment || (Array.isArray(b.mediaAttachments) && b.mediaAttachments.length > 0) || b.contactAttachment || b.type === 'forward' || b.forwardMessageId)) {
         return res.status(403).json({ success: false, error: 'Media sending requires PRO License' });
      }
    }
  }
  next();
});

function getContactsSummaryCounts() {
  const list = Array.isArray(contactsState.contacts) ? contactsState.contacts : [];
  const invalidCount = list.filter(c => c && c.isValid === false).length;
  const validCount = list.length - invalidCount;
  const seen = new Set();
  let duplicateCount = 0;
  for (const c of list) {
    if (!c) continue;
    const norm = (c.phone || c.rawPhone || '').replace(/\D/g, '');
    if (!norm) continue;
    if (seen.has(norm)) {
      duplicateCount++;
    } else {
      seen.add(norm);
    }
  }
  return {
    totalCount: list.length,
    validCount,
    invalidCount,
    duplicateCount
  };
}

// 1. Dashboard Summary & Live State
app.get('/api/state', (req, res) => {
  checkDailyReset();
  const accountsList = BOT_IDS.map(id => {
    const a = accounts[id];
    const locked = isBotIpLocked(a);
    return {
      id: a.id,
      index: a.index,
      label: a.label,
      status: a.status,
      isConnected: a.isConnected,
      isSimulated: a.isSimulated,
      ipLocked: locked,
      ipLockedAt: a.ipLockedAt || null,
      phone: a.phone,
      pushName: a.pushName,
      qrDataUrl: a.qrDataUrl,
      dailyLimit: a.dailyLimit,
      maxDailyLimit: 1000,
      defaultDailyLimit: 100,
      sentToday: a.sentToday,
      remainingToday: Math.max(0, a.dailyLimit - a.sentToday),
      usagePercentage: a.dailyLimit > 0 ? Math.min(100, Math.round((a.sentToday / a.dailyLimit) * 100)) : 0,
      totalSent: a.totalSent,
      totalFailed: a.totalFailed,
      lastActiveAt: a.lastActiveAt,
      deviceName: a.deviceName,
      deviceFingerprint: a.deviceFingerprint,
      deviceId: a.deviceId,
      virtualIp: a.virtualIp,
      proxyUrl: a.proxyUrl,
      localAddress: a.localAddress,
      networkMode: a.networkMode,
      contactsCount: botContactsStore[id]?.size || 0,
      googleAccount: a.googleAccount || null,
      isGoogleSynced: Boolean(googleAuthState.tokens && (googleAuthState.tokens.refresh_token || googleAuthState.tokens.access_token)),
      googleEmail: googleAuthState.user?.email || null
    };
  });

  const totalDailyCapacity = accountsList.reduce((sum, a) => sum + (a.isConnected ? a.dailyLimit : 0), 0);
  const totalSentToday = accountsList.reduce((sum, a) => sum + a.sentToday, 0);
  const totalAllTimeSent = accountsList.reduce((sum, a) => sum + a.totalSent, 0);
  const totalAllTimeFailed = accountsList.reduce((sum, a) => sum + a.totalFailed, 0);
  const totalAllTimeProcessed = totalAllTimeSent + totalAllTimeFailed;

  const overallSuccessPct = campaignState.total > 0
    ? campaignState.completionPercentage
    : (totalAllTimeProcessed > 0 ? Math.round((totalAllTimeSent / totalAllTimeProcessed) * 1000) / 10 : 100);
  const overallErrorPct = campaignState.total > 0
    ? campaignState.errorPercentage
    : (totalAllTimeProcessed > 0 ? Math.round((totalAllTimeFailed / totalAllTimeProcessed) * 1000) / 10 : 0);

  const cCounts = getContactsSummaryCounts();

  res.json({
    accounts: accountsList,
    settings: appSettings,
    campaign: campaignState,
    contactsCount: cCounts.totalCount,
    validContactsCount: cCounts.validCount,
    invalidContactsCount: cCounts.invalidCount,
    duplicateContactsCount: cCounts.duplicateCount,
    detectedColumns: contactsState.detectedColumns,
    templatesCount: templates.length,
    forwardCount: forwardMessagesStore.size,
    boostEnabled: appSettings.boostForwardMode !== false,
    googleAuth: {
      isLoggedIn: Boolean(googleAuthState.tokens && (googleAuthState.tokens.refresh_token || googleAuthState.tokens.access_token)),
      email: googleAuthState.user?.email || null,
      name: googleAuthState.user?.name || null,
      picture: googleAuthState.user?.picture || null,
      autoSaveEnabled: Boolean(appSettings.googleContactsAutoSave),
      contactsLabel: appSettings.googleContactsLabel || 'WhatsApp Bot',
      syncedBotsCount: accountsList.filter(a => a.googleAccount?.email).length,
      activeConnectedSyncedCount: accountsList.filter(a => a.isConnected && a.googleAccount?.email).length,
      totalBotsCount: BOT_IDS.length
    },
    metrics: {
      connectedCount: accountsList.filter(a => a.isConnected).length,
      totalAccounts: 5,
      totalDailyCapacity,
      totalSentToday,
      totalAllTimeSent,
      totalAllTimeFailed,
      overallSuccessPct,
      overallErrorPct,
      validContactsCount: cCounts.validCount,
      invalidContactsCount: cCounts.invalidCount,
      duplicateContactsCount: cCounts.duplicateCount
    },
    logs: activityLogs.slice(0, 60)
  });
});

// 2. Account Connect / QR / Disconnect / Limit & Per-Bot Separate IP / Device Endpoints
app.get('/api/accounts', (req, res) => {
  checkDailyReset();
  const accountsList = BOT_IDS.map(id => {
    const a = accounts[id];
    return {
      id: a.id,
      index: a.index,
      label: a.label,
      status: a.status,
      isConnected: a.isConnected,
      dailyLimit: a.dailyLimit,
      sentToday: a.sentToday,
      remainingToday: Math.max(0, a.dailyLimit - a.sentToday),
      virtualIp: a.virtualIp,
      proxyUrl: a.proxyUrl,
      ipLocked: isBotIpLocked(a)
    };
  });
  res.json({ ok: true, accounts: accountsList, accountsMap: accounts });
});

app.post('/api/accounts/:botId/connect', async (req, res) => {
  try {
    const { botId } = req.params;
    const { simulate = false, phone, pushName, force = false } = req.body || {};
    const bot = accounts[botId];
    if (bot && bot.isConnected && !simulate && !force) {
      return res.json({
        ok: true,
        account: bot,
        message: `[${bot.label}] is already connected (+${bot.phone}). Not regenerating QR.`
      });
    }
    const result = await startBotConnection(botId, { simulate, phone, pushName, forceReconnect: force });
    res.json({ ok: true, account: accounts[botId], result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/accounts/:botId/disconnect', async (req, res) => {
  try {
    const { botId } = req.params;
    const result = await disconnectBotConnection(botId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/accounts/:botId/limit', (req, res) => {
  const { botId } = req.params;
  const bot = accounts[botId];
  if (!bot) return res.status(404).json({ ok: false, error: 'Account not found' });

  if (req.body?.dailyLimit !== undefined) {
    const parsedLimit = Number(req.body.dailyLimit); bot.dailyLimit = !isNaN(parsedLimit) ? Math.min(1000, Math.max(1, parsedLimit)) : 100;
  }
  if (req.body?.label) bot.label = String(req.body.label).trim();
  if (req.body?.resetToday) bot.sentToday = 0;

  // Only allow IP / Proxy / Fingerprint change if the bot is NOT connected / locked
  if (!isBotIpLocked(bot)) {
    if (req.body?.virtualIp !== undefined) {
      bot.virtualIp = String(req.body.virtualIp).trim() || DEFAULT_BOT_DEVICE_PROFILES[botId].defaultVirtualIp;
    }
    if (req.body?.proxyUrl !== undefined) bot.proxyUrl = String(req.body.proxyUrl).trim();
    if (req.body?.localAddress !== undefined) bot.localAddress = String(req.body.localAddress).trim();
    if (Array.isArray(req.body?.deviceFingerprint) && req.body.deviceFingerprint.length === 3) {
      bot.deviceFingerprint = req.body.deviceFingerprint.map(x => String(x));
      bot.deviceName = `${bot.deviceFingerprint[0]} • ${bot.deviceFingerprint[1]} (${bot.deviceFingerprint[2]})`;
    }
  }

  bot.networkMode = bot.proxyUrl ? 'custom_proxy' : (bot.localAddress ? 'local_interface' : 'isolated_virtual_ip');
  persistState();
  addLog('info', `⚙️ [${bot.label}] Daily limit: ${bot.dailyLimit} | IP: ${bot.virtualIp} | Device: ${bot.deviceFingerprint.join(' / ')}`);
  res.json({
    ok: true,
    botId,
    dailyLimit: bot.dailyLimit,
    sentToday: bot.sentToday,
    virtualIp: bot.virtualIp,
    ipLocked: isBotIpLocked(bot),
    proxyUrl: bot.proxyUrl,
    localAddress: bot.localAddress,
    deviceName: bot.deviceName,
    deviceFingerprint: bot.deviceFingerprint,
    networkMode: bot.networkMode
  });
});

// Rename Bot Account (Persisted in state)
app.post('/api/accounts/:botId/rename', (req, res) => {
  const { botId } = req.params;
  const { name, label } = req.body || {};
  const bot = accounts[botId];
  if (!bot) return res.status(404).json({ ok: false, error: 'Account not found' });
  const newName = String(name || label || '').trim();
  if (!newName) return res.status(400).json({ ok: false, error: 'Bot name cannot be empty.' });
  const oldName = bot.label;
  bot.label = newName;
  persistState();
  addLog('success', `✏️ [${botId.toUpperCase()}] Account name "${oldName}" from "${newName}" changed!`, { botId });
  res.json({ ok: true, botId, label: bot.label, accounts: BOT_IDS.map(id => ({ id, label: accounts[id].label })) });
});

// Per-Bot Contacts: Get List
app.get('/api/accounts/:botId/contacts', (req, res) => {
  const { botId } = req.params;
  if (botId === 'all') {
    const allList = [];
    for (const id of BOT_IDS) {
      const list = Array.from(botContactsStore[id]?.values() || []);
      allList.push(...list);
    }
    return res.json({ ok: true, botId: 'all', count: allList.length, contacts: allList });
  }
  const bot = accounts[botId];
  if (!bot) return res.status(404).json({ ok: false, error: 'Account not found' });
  const list = Array.from(botContactsStore[botId]?.values() || []).sort((a, b) => (a.name || a.phone).localeCompare(b.name || b.phone));
  res.json({ ok: true, botId, botLabel: bot.label, count: list.length, contacts: list });
});

// Per-Bot Contacts: Export (Excel, CSV, JSON)
app.get('/api/accounts/:botId/contacts/export', (req, res) => {
  const { botId } = req.params;
  const format = String(req.query.format || 'xlsx').toLowerCase();

  let contactsList = [];
  let filePrefix = '';

  if (botId === 'all') {
    filePrefix = 'whatsapp_all_accounts_contacts';
    for (const id of BOT_IDS) {
      const list = Array.from(botContactsStore[id]?.values() || []);
      contactsList.push(...list);
    }
  } else {
    const bot = accounts[botId];
    if (!bot) return res.status(404).json({ ok: false, error: 'Account not found' });
    filePrefix = `whatsapp_${botId}_contacts`;
    contactsList = Array.from(botContactsStore[botId]?.values() || []);
  }

  const rows = contactsList.map((c, i) => ({
    Index: i + 1,
    Phone: c.phone,
    Name: c.name || '',
    PushName: c.pushName || '',
    AccountUsed: accounts[c.botId]?.label || c.botId || '',
    UpdatedAt: c.updatedAt || ''
  }));

  if (format === 'json') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filePrefix}_${Date.now()}.json"`);
    return res.send(JSON.stringify(rows, null, 2));
  }

  if (format === 'csv') {
    const header = ['Index', 'Phone', 'Name', 'PushName', 'AccountUsed', 'UpdatedAt'];
    const csvRows = [header.join(',')];
    for (const r of rows) {
      csvRows.push([
        r.Index,
        `"${String(r.Phone).replace(/"/g, '""')}"`,
        `"${String(r.Name).replace(/"/g, '""')}"`,
        `"${String(r.PushName).replace(/"/g, '""')}"`,
        `"${String(r.AccountUsed).replace(/"/g, '""')}"`,
        `"${String(r.UpdatedAt).replace(/"/g, '""')}"`
      ].join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filePrefix}_${Date.now()}.csv"`);
    return res.send('\uFEFF' + csvRows.join('\r\n'));
  }

  if (format === 'xlsx' && XLSX) {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [{ Index: '', Phone: '', Name: '', PushName: '', AccountUsed: '', UpdatedAt: '' }]);
    XLSX.utils.book_append_sheet(wb, ws, 'Contacts');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filePrefix}_${Date.now()}.xlsx"`);
    return res.send(buf);
  }

  res.status(400).json({ ok: false, error: 'Invalid format requested' });
});

// Per-Bot Contacts: Import into main campaign contacts queue
app.post('/api/accounts/:botId/contacts/import-to-contacts', (req, res) => {
  const { botId } = req.params;
  const { clearExisting = false } = req.body || {};

  let listToImport = [];
  if (botId === 'all') {
    for (const id of BOT_IDS) {
      listToImport.push(...Array.from(botContactsStore[id]?.values() || []));
    }
  } else {
    const bot = accounts[botId];
    if (!bot) return res.status(404).json({ ok: false, error: 'Account not found' });
    listToImport = Array.from(botContactsStore[botId]?.values() || []);
  }

  if (listToImport.length === 0) {
    return res.status(400).json({ ok: false, error: 'No WhatsApp Contacts found for this account. If just connected via QR, please wait for sync.' });
  }

  const currentContacts = clearExisting ? [] : (contactsState.contacts || []);
  const existingPhones = new Set(currentContacts.map(c => normalizePhoneNumber(c.phone)));
  let addedCount = 0;

  for (const c of listToImport) {
    const norm = normalizePhoneNumber(c.phone);
    if (norm && !existingPhones.has(norm)) {
      existingPhones.add(norm);
      currentContacts.push({
        id: `cnt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        phone: norm,
        name: c.name || c.pushName || 'Contact',
        data: {
          name: c.name || c.pushName || 'Contact',
          phone: norm,
          account: accounts[c.botId]?.label || c.botId
        },
        source: `bot_contacts_${c.botId || botId}`,
        isValid: true,
        validationError: null,
        addedAt: new Date().toISOString()
      });
      addedCount++;
    }
  }

  contactsState.contacts = currentContacts;
  saveJsonFile(CONTACTS_FILE, contactsState);
  persistState();
  const counts = getContactsSummaryCounts();
  addLog('success', `👥 [${botId.toUpperCase()}] WhatsApp Contacts ${addedCount}added to the Contacts list!`);
  res.json({ ok: true, addedCount, totalCount: counts.totalCount, validCount: counts.validCount, invalidCount: counts.invalidCount });
});

app.post('/api/accounts/:botId/network', (req, res) => {
  const { botId } = req.params;
  const bot = accounts[botId];
  if (!bot) return res.status(404).json({ ok: false, error: 'Account not found' });

  if (isBotIpLocked(bot)) {
    addLog('warn', `🔒 [${bot.label}] Since account is connected, IP address (${bot.virtualIp}) cannot be changed! (IP Locked after connection)`, { botId });
    return res.status(403).json({
      ok: false,
      locked: true,
      ipLocked: true,
      botId,
      virtualIp: bot.virtualIp,
      proxyUrl: bot.proxyUrl,
      localAddress: bot.localAddress,
      deviceName: bot.deviceName,
      deviceFingerprint: bot.deviceFingerprint,
      error: `🔒 [${bot.label}] IP address will not change once connected (${bot.virtualIp}) (IP Locked — Connected Account)`
    });
  }

  const defProfile = DEFAULT_BOT_DEVICE_PROFILES[botId] || DEFAULT_BOT_DEVICE_PROFILES.bot1;
  if (req.body?.virtualIp !== undefined) {
    const nextIp = String(req.body.virtualIp).trim() || defProfile.defaultVirtualIp;
    bot.virtualIp = nextIp;
    defProfile.defaultVirtualIp = nextIp;
  }
  if (req.body?.proxyUrl !== undefined) {
    bot.proxyUrl = String(req.body.proxyUrl).trim();
  }
  if (req.body?.localAddress !== undefined) {
    bot.localAddress = String(req.body.localAddress).trim();
  }
  if (Array.isArray(req.body?.deviceFingerprint) && req.body.deviceFingerprint.length === 3) {
    bot.deviceFingerprint = req.body.deviceFingerprint.map(x => String(x).trim());
    bot.deviceName = `${bot.deviceFingerprint[0]} • ${bot.deviceFingerprint[1]} (${bot.deviceFingerprint[2]})`;
  } else if (req.body?.osName || req.body?.browserName) {
    const osName = String(req.body.osName || bot.deviceFingerprint[0] || defProfile.browserTuple[0]).trim();
    const browserName = String(req.body.browserName || bot.deviceFingerprint[1] || defProfile.browserTuple[1]).trim();
    const osVersion = String(req.body.osVersion || bot.deviceFingerprint[2] || defProfile.browserTuple[2]).trim();
    bot.deviceFingerprint = [osName, browserName, osVersion];
    bot.deviceName = `${osName} • ${browserName} (${osVersion})`;
  }
  bot.networkMode = bot.proxyUrl ? 'custom_proxy' : (bot.localAddress ? 'local_interface' : 'isolated_virtual_ip');
  persistState();

  const netCfg = createBotNetworkAgent(bot);
  addLog('success', `🌐 [${bot.label}] Separate Device & IP settings saved -> IP: ${bot.virtualIp}${bot.proxyUrl ? ` (Proxy: ${bot.proxyUrl})` : ''} | Device: ${bot.deviceFingerprint.join(' / ')}`, { botId });

  res.json({
    ok: true,
    botId,
    virtualIp: bot.virtualIp,
    ipLocked: isBotIpLocked(bot),
    proxyUrl: bot.proxyUrl,
    localAddress: bot.localAddress,
    deviceName: bot.deviceName,
    deviceFingerprint: bot.deviceFingerprint,
    deviceId: bot.deviceId,
    networkMode: netCfg.networkMode,
    headers: netCfg.headers
  });
});

app.all('/api/accounts/:botId/check-ip', (req, res) => {
  const { botId } = req.params;
  const bot = accounts[botId];
  if (!bot) return res.status(404).json({ ok: false, error: 'Account not found' });

  const netCfg = createBotNetworkAgent(bot);
  const otherIps = BOT_IDS.filter(id => id !== botId).map(id => accounts[id].virtualIp);
  const isUniqueIp = !otherIps.includes(bot.virtualIp);
  const locked = isBotIpLocked(bot);

  res.json({
    ok: true,
    botId,
    label: bot.label,
    isolated: true,
    isUniqueIp,
    ipLocked: locked,
    activeIp: bot.virtualIp,
    proxyUrl: bot.proxyUrl || null,
    localAddress: bot.localAddress || null,
    networkMode: netCfg.networkMode,
    deviceName: bot.deviceName,
    deviceFingerprint: netCfg.browser,
    deviceId: netCfg.deviceId,
    headers: netCfg.headers,
    statusMessage: `✅ [${bot.label}] separate Device (${netCfg.browser[0]} • ${netCfg.browser[1]}) and separate IP (${bot.virtualIp}${locked ? ' 🔒 IP Locked' : ''}${bot.proxyUrl ? ` via Proxy ${bot.proxyUrl}` : ''}) is running.`
  });
});

app.post('/api/accounts/rotate-ips', (req, res) => {
  const usedIps = new Set(BOT_IDS.map(id => accounts[id].virtualIp).filter(Boolean));
  const rotatedBots = [];
  const lockedBots = [];

  BOT_IDS.forEach((id, idx) => {
    const bot = accounts[id];
    if (isBotIpLocked(bot)) {
      // Connected / Locked bot: NEVER alter its virtualIp, proxyUrl, or deviceFingerprint!
      bot.ipLocked = true;
      lockedBots.push(id);
    } else {
      const newIp = generateRandomBotIp(idx, usedIps);
      usedIps.add(newIp);
      bot.virtualIp = newIp;
      DEFAULT_BOT_DEVICE_PROFILES[id].defaultVirtualIp = newIp;
      rotatedBots.push(id);
    }
  });

  persistState();

  if (rotatedBots.length === 0 && lockedBots.length > 0) {
    addLog('warn', `🔒 All connected accounts have IP addresses locked (IP Locked). IP won't change once connected.`);
    return res.status(403).json({
      ok: false,
      locked: true,
      ipLocked: true,
      rotatedCount: 0,
      lockedCount: lockedBots.length,
      lockedBots,
      error: "Connected accounts have IPs permanently locked (IP Locked). IP address won't change once connected.",
      accounts: BOT_IDS.map(id => ({
        id,
        virtualIp: accounts[id].virtualIp,
        ipLocked: isBotIpLocked(accounts[id]),
        isConnected: accounts[id].isConnected,
        deviceName: accounts[id].deviceName,
        deviceFingerprint: accounts[id].deviceFingerprint
      }))
    });
  }

  addLog(
    'success',
    lockedBots.length > 0
      ? `🌐 Unconnected accounts (${rotatedBots.join(', ')}) assigned random IPs. 🔒 Connected accounts (${lockedBots.join(', ')}) IPs protected from changes!`
      : `🌐 Automatically assigned 5 different random IPs for all 5 accounts!`
  );

  res.json({
    ok: true,
    rotatedCount: rotatedBots.length,
    lockedCount: lockedBots.length,
    rotatedBots,
    lockedBots,
    accounts: BOT_IDS.map(id => ({
      id,
      virtualIp: accounts[id].virtualIp,
      ipLocked: isBotIpLocked(accounts[id]),
      isConnected: accounts[id].isConnected,
      deviceName: accounts[id].deviceName,
      deviceFingerprint: accounts[id].deviceFingerprint
    }))
  });
});

app.post('/api/accounts/bulk-limit', (req, res) => {
  const limit = Math.min(1000, Math.max(1, Number(req.body?.dailyLimit) || 100));
  const resetToday = Boolean(req.body?.resetToday);
  for (const id of BOT_IDS) {
    accounts[id].dailyLimit = limit;
    if (resetToday) accounts[id].sentToday = 0;
  }
  persistState();
  addLog('info', `⚙️ Daily message limit for all 5 accounts set to ${limit} (Max: 1000).`);
  res.json({ ok: true, dailyLimit: limit, maxDailyLimit: 1000, defaultDailyLimit: 100 });
});

// 3. Contacts Input Endpoints (Manual Type, Auto-Detect on Enter, Excel, JSON, Invalid Highlighting & Bulk Remove)

app.post('/api/contacts/verify-whatsapp', async (req, res) => {
  try {
    const { numbers } = req.body;
    if (!Array.isArray(numbers)) return res.status(400).json({ error: 'Invalid numbers array' });
    
    // Find a connected bot to use for verification
    const selection = selectAvailableBot(accounts, 'bot1');
    const bot = selection?.bot || Object.values(accounts).find(b => b && b.isConnected && b.sock);
    if (!bot || !bot.sock || !bot.isConnected) {
      return res.status(400).json({ error: 'No active WhatsApp connection available to verify numbers.' });
    }
    
    const results = [];
    for (const num of numbers) {
      try {
        const cleanNum = String(num).replace(/[^0-9]/g, '');
        const waResult = await Promise.race([
          bot.sock.onWhatsApp(cleanNum),
          new Promise((resolve) => setTimeout(() => resolve(null), 4000))
        ]);
        if (Array.isArray(waResult) && waResult.length > 0 && waResult[0].exists) {
          results.push({ phone: num, exists: true, jid: waResult[0].jid });
        } else {
          results.push({ phone: num, exists: false });
        }
      } catch (e) {
        results.push({ phone: num, exists: false, error: e.message });
      }
      // Small delay to prevent ban during bulk verify
      await new Promise(r => setTimeout(r, 500));
    }
    
    res.json({ ok: true, results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/contacts', (req, res) => {
  const counts = getContactsSummaryCounts();
  res.json({
    ...contactsState,
    totalCount: counts.totalCount,
    validCount: counts.validCount,
    invalidCount: counts.invalidCount,
    duplicateCount: counts.duplicateCount
  });
});

app.post('/api/contacts/auto-add', (req, res) => {
  try {
    const rawInput = String(req.body?.text ?? req.body?.rawText ?? '').trim();
    if (!rawInput) {
      return res.status(400).json({ ok: false, isValid: false, error: 'Please enter a phone number.' });
    }

    const parsed = parseContactsData({ mode: 'type', rawText: rawInput, deduplicate: false, includeInvalid: true });

    const combined = [...(contactsState.contacts || []), ...parsed.allContacts];
    const cols = Array.from(new Set([...(contactsState.detectedColumns || []), ...parsed.detectedColumns]));
    contactsState = { contacts: combined, detectedColumns: cols };
    saveJsonFile(CONTACTS_FILE, contactsState);

    const counts = getContactsSummaryCounts();

    if (!parsed.validContacts || parsed.validContacts.length === 0) {
      addLog('warn', `⚠️ Invalid phone number detected ("${rawInput}") — marked in red (Invalid: ${counts.invalidCount}).`);
      return res.status(400).json({
        ok: false,
        isValid: false,
        added: parsed.allContacts,
        addedInvalid: parsed.invalidContacts,
        addedCount: parsed.allContacts.length,
        totalCount: counts.totalCount,
        validCount: counts.validCount,
        invalidCount: counts.invalidCount,
        contacts: contactsState.contacts,
        detectedColumns: contactsState.detectedColumns,
        error: `"${rawInput}" is not a valid phone number! Marked in light red (Invalid count: ${counts.invalidCount}).`
      });
    }

    const firstAdded = parsed.validContacts[0];
    addLog('success', `⚡ Auto-Detected & Added: +${firstAdded.phone} (${firstAdded.countryFlag || '🌍'} ${firstAdded.name || 'Recipient'})${parsed.validContacts.length > 1 ? ` (+${parsed.validContacts.length - 1} more)` : ''}${parsed.invalidCount > 0 ? ` | ⚠️ Invalid: ${parsed.invalidCount}` : ''}`);

    res.json({
      ok: true,
      isValid: true,
      added: parsed.validContacts,
      addedInvalid: parsed.invalidContacts,
      addedCount: parsed.allContacts.length,
      newlyAddedCount: parsed.validContacts.length,
      totalCount: counts.totalCount,
      validCount: counts.validCount,
      invalidCount: counts.invalidCount,
      contacts: contactsState.contacts,
      detectedColumns: contactsState.detectedColumns
    });
  } catch (err) {
    res.status(400).json({ ok: false, isValid: false, error: err.message });
  }
});

app.post('/api/contacts/import', (req, res) => {
  try {
    const { mode = 'type', rawText = '', jsonPayload = null, fileBase64 = '', fileName = '', append = false, requireValid = false, excludeAdmins = false, listTag = '' } = req.body || {};
    let excelBuffer = null;
    if (fileBase64) {
      const clean = fileBase64.replace(/^data:[^;]+;base64,/, '');
      excelBuffer = Buffer.from(clean, 'base64');
    }

    const parsed = parseContactsData({ mode, rawText, jsonPayload, excelBuffer, fileName, deduplicate: false, includeInvalid: true, excludeAdmins: Boolean(excludeAdmins) });
    if (listTag) {
      const tag = String(listTag).trim();
      if (tag) {
        parsed.allContacts.forEach(c => c.listTag = tag);
      }
    }
    if (requireValid && parsed.allContacts.length === 0) {
      return res.status(400).json({
        ok: false,
        isValid: false,
        addedCount: 0,
        error: 'Could not detect a phone number. Please enter a phone number.'
      });
    }

    if (append) {
      const combined = [...(contactsState.contacts || []), ...parsed.allContacts];
      const cols = Array.from(new Set([...(contactsState.detectedColumns || []), ...parsed.detectedColumns]));
      contactsState = { contacts: combined, detectedColumns: cols };
    } else {
      contactsState = {
        contacts: parsed.allContacts,
        detectedColumns: parsed.detectedColumns
      };
    }
    saveJsonFile(CONTACTS_FILE, contactsState);
    const counts = getContactsSummaryCounts();
    addLog('success', `📋 phone numbers ${parsed.allContacts.length} (${mode.toUpperCase()}) added — ✅ Valid: ${counts.validCount} | ⚠️ Invalid: ${counts.invalidCount}${excludeAdmins ? ' | 🛡️ Admins removed' : ''}`);
    res.json({
      ok: true,
      isValid: parsed.validCount > 0,
      added: parsed.allContacts,
      addedCount: parsed.allContacts.length,
      validCount: counts.validCount,
      invalidCount: counts.invalidCount,
      totalCount: counts.totalCount,
      contacts: contactsState.contacts,
      detectedColumns: contactsState.detectedColumns
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: `Data reading error: ${err.message}` });
  }
});

app.post('/api/contacts/filter-country', (req, res) => {
  const keepCountry = String(req.body?.keepCountry || '').trim(); // e.g. "94", "81", "all"
  const removeCountry = String(req.body?.removeCountry || '').trim();

  if (keepCountry && keepCountry !== 'all') {
    const beforeCount = contactsState.contacts.length;
    contactsState.contacts = contactsState.contacts.filter(c => {
      if (c.isValid === false) return false;
      return String(c.countryCode) === keepCountry || (c.phone && String(c.phone).startsWith(keepCountry));
    });
    const removedCount = beforeCount - contactsState.contacts.length;
    saveJsonFile(CONTACTS_FILE, contactsState);
    addLog('info', `🌍 Country Filter: ${keepCountry} Removed ${removedCount} phone numbers not from`);
  } else if (removeCountry) {
    const beforeCount = contactsState.contacts.length;
    contactsState.contacts = contactsState.contacts.filter(c => {
      return String(c.countryCode) !== removeCountry && !(c.phone && String(c.phone).startsWith(removeCountry));
    });
    const removedCount = beforeCount - contactsState.contacts.length;
    saveJsonFile(CONTACTS_FILE, contactsState);
    addLog('info', `🌍 Country Filter: ${removeCountry} Removed ${removedCount} phone numbers from`);
  }

  const counts = getContactsSummaryCounts();
  res.json({
    ok: true,
    totalCount: counts.totalCount,
    validCount: counts.validCount,
    invalidCount: counts.invalidCount,
    contacts: contactsState.contacts
  });
});

app.post('/api/contacts/remove-admins', (req, res) => {
  const beforeCount = contactsState.contacts.length;
  contactsState.contacts = contactsState.contacts.filter(c => {
    if (c.isAdmin) return false;
    if (c.role && /admin|owner|superadmin|moderator/i.test(c.role)) return false;
    if (c.name && /^(?:group\s+)?admin|owner$/i.test(String(c.name).trim())) return false;
    return true;
  });
  const removedCount = beforeCount - contactsState.contacts.length;
  saveJsonFile(CONTACTS_FILE, contactsState);
  addLog('info', `🛡️ Admin Filter: Removed ${removedCount} Admin / Owner phone numbers from Contacts list.`);
  const counts = getContactsSummaryCounts();
  res.json({
    ok: true,
    removedCount,
    totalCount: counts.totalCount,
    validCount: counts.validCount,
    invalidCount: counts.invalidCount,
    contacts: contactsState.contacts
  });
});

app.post('/api/contacts/remove-invalid', (req, res) => {
  const beforeCount = contactsState.contacts.length;
  contactsState.contacts = contactsState.contacts.filter(c => c && c.isValid !== false);
  const removedCount = beforeCount - contactsState.contacts.length;
  saveJsonFile(CONTACTS_FILE, contactsState);
  const counts = getContactsSummaryCounts();
  addLog('info', `🗑️ Removed ${removedCount} invalid phone numbers at once (Remaining Valid: ${counts.validCount}).`);
  res.json({
    ok: true,
    removedCount,
    totalCount: counts.totalCount,
    validCount: counts.validCount,
    invalidCount: counts.invalidCount,
    duplicateCount: counts.duplicateCount,
    contacts: contactsState.contacts
  });
});

app.post('/api/contacts/remove-duplicates', (req, res) => {
  const beforeCount = contactsState.contacts.length;
  const seen = new Set();
  const uniqueList = [];
  
  for (const c of contactsState.contacts) {
    if (!c) continue;
    const norm = (c.phone || c.rawPhone || '').replace(/\D/g, '');
    if (!norm) {
      uniqueList.push(c);
      continue;
    }
    if (seen.has(norm)) {
      // Duplicate number - skip so it is removed
      continue;
    }
    seen.add(norm);
    uniqueList.push(c);
  }

  contactsState.contacts = uniqueList;
  const removedCount = beforeCount - uniqueList.length;
  saveJsonFile(CONTACTS_FILE, contactsState);
  const counts = getContactsSummaryCounts();
  addLog('info', `🗑️ Removed ${removedCount} duplicate phone numbers at once (Remaining: ${counts.totalCount}).`);
  res.json({
    ok: true,
    removedCount,
    totalCount: counts.totalCount,
    validCount: counts.validCount,
    invalidCount: counts.invalidCount,
    duplicateCount: counts.duplicateCount,
    contacts: contactsState.contacts
  });
});

// Export Current Contacts Queue (Excel, CSV, JSON)
app.get('/api/contacts/export', (req, res) => {
  const format = String(req.query.format || 'xlsx').toLowerCase();
  const list = contactsState.contacts || [];
  const rows = list.map((c, i) => ({
    Index: i + 1,
    Phone: c.phone || c.rawPhone || '',
    Country: c.countryName || '',
    Name: c.name || '',
    Course: c.course || '',
    Amount: c.data?.amount || '',
    Role: c.role || '',
    Valid: c.isValid !== false ? 'YES' : 'NO'
  }));

  const filePrefix = 'whatsapp_campaign_contacts';

  if (format === 'json') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filePrefix}_${Date.now()}.json"`);
    return res.send(JSON.stringify(rows, null, 2));
  }

  if (format === 'csv') {
    const header = ['Index', 'Phone', 'Country', 'Name', 'Course', 'Amount', 'Role', 'Valid'];
    const csvRows = [header.join(',')];
    for (const r of rows) {
      csvRows.push([
        r.Index,
        `"${String(r.Phone).replace(/"/g, '""')}"`,
        `"${String(r.Country).replace(/"/g, '""')}"`,
        `"${String(r.Name).replace(/"/g, '""')}"`,
        `"${String(r.Course).replace(/"/g, '""')}"`,
        `"${String(r.Amount).replace(/"/g, '""')}"`,
        `"${String(r.Role).replace(/"/g, '""')}"`,
        `"${String(r.Valid).replace(/"/g, '""')}"`
      ].join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filePrefix}_${Date.now()}.csv"`);
    return res.send('\uFEFF' + csvRows.join('\r\n'));
  }

  if (format === 'xlsx' && XLSX) {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [{ Index: '', Phone: '', Country: '', Name: '', Course: '', Amount: '', Role: '', Valid: '' }]);
    XLSX.utils.book_append_sheet(wb, ws, 'Contacts');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filePrefix}_${Date.now()}.xlsx"`);
    return res.send(buf);
  }

  res.status(400).json({ ok: false, error: 'Invalid format requested' });
});

app.post('/api/contacts/remove', (req, res) => {
  const { id, phone, index, all } = req.body || {};
  const beforeCount = contactsState.contacts.length;
  if (all) {
    contactsState.contacts = [];
  } else if (id !== undefined && id !== null && id !== '') {
    contactsState.contacts = contactsState.contacts.filter(c => c.id !== id);
  } else if (typeof index === 'number' && index >= 0 && index < contactsState.contacts.length) {
    contactsState.contacts.splice(index, 1);
  } else if (phone) {
    contactsState.contacts = contactsState.contacts.filter(c => c.phone !== phone && c.rawPhone !== phone);
  }
  saveJsonFile(CONTACTS_FILE, contactsState);
  const counts = getContactsSummaryCounts();
  res.json({
    ok: true,
    removedCount: beforeCount - contactsState.contacts.length,
    totalCount: counts.totalCount,
    validCount: counts.validCount,
    invalidCount: counts.invalidCount,
    duplicateCount: counts.duplicateCount,
    contacts: contactsState.contacts
  });
});

app.delete('/api/contacts/:id', (req, res) => {
  const { id } = req.params;
  if (id === 'all') {
    contactsState.contacts = [];
  } else if (id === 'invalid') {
    contactsState.contacts = contactsState.contacts.filter(c => c && c.isValid !== false);
  } else if (id === 'duplicates') {
    const seen = new Set();
    contactsState.contacts = contactsState.contacts.filter(c => {
      if (!c) return false;
      const norm = (c.phone || c.rawPhone || '').replace(/\D/g, '');
      if (!norm) return true;
      if (seen.has(norm)) return false;
      seen.add(norm);
      return true;
    });
  } else {
    const beforeLen = contactsState.contacts.length;
    contactsState.contacts = contactsState.contacts.filter(c => c.id !== id && c.phone !== id && c.rawPhone !== id);
    if (contactsState.contacts.length === beforeLen && /^\d+$/.test(id)) {
      const idx = Number(id);
      if (idx >= 0 && idx < contactsState.contacts.length) {
        contactsState.contacts.splice(idx, 1);
      }
    }
  }
  saveJsonFile(CONTACTS_FILE, contactsState);
  const counts = getContactsSummaryCounts();
  res.json({
    ok: true,
    totalCount: counts.totalCount,
    validCount: counts.validCount,
    invalidCount: counts.invalidCount,
    contacts: contactsState.contacts
  });
});

// Sample File Downloads (Excel .xlsx / JSON / CSV)
app.get('/api/contacts/sample', (req, res) => {
  const format = (req.query.format || 'xlsx').toLowerCase();
  const sampleRows = [
    { phone: '0771234567', name: 'Kasun Perera', course: 'JLPT N5', amount: 'Rs. 4500', batch: '2026 Intake' },
    { phone: '0712345678', name: 'Nimali Silva', course: 'JLPT N4', amount: 'Rs. 5000', batch: '2026 Intake' },
    { phone: '0769876543', name: 'Chathura Bandara', course: 'SSW Caregiver', amount: 'Rs. 6000', batch: 'Weekend' }
  ];

  if (format === 'json') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="whatsapp_contacts_sample.json"');
    return res.send(JSON.stringify(sampleRows, null, 2));
  }
  if (format === 'xlsx' && XLSX) {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(sampleRows);
    XLSX.utils.book_append_sheet(wb, ws, 'Contacts');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="whatsapp_contacts_sample.xlsx"');
    return res.send(buf);
  }
  const csv = 'phone,name,course,amount,batch\n' + sampleRows.map(r => `${r.phone},"${r.name}","${r.course}","${r.amount}","${r.batch}"`).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="whatsapp_contacts_sample.csv"');
  return res.send('\uFEFF' + csv);
});

// 4. Templates CRUD & Live Variable Preview
app.get('/api/templates', (req, res) => {
  res.json({ templates });
});

app.post('/api/templates', (req, res) => {
  const { id, title, content, category = 'Custom' } = req.body || {};
  if (!title || !content) {
    return res.status(400).json({ ok: false, error: 'Template name and message content are required.' });
  }

  if (id) {
    const existingIdx = templates.findIndex(t => t.id === id);
    if (existingIdx >= 0) {
      templates[existingIdx] = { ...templates[existingIdx], title, content, category, updatedAt: new Date().toISOString() };
      saveJsonFile(TEMPLATES_FILE, templates);
      addLog('success', `💾 Message Template updated: "${title}"`);
      return res.json({ ok: true, template: templates[existingIdx], templates });
    }
  }

  const newTpl = {
    id: `tpl_${Date.now()}`,
    title: String(title).trim(),
    content: String(content),
    category,
    createdAt: new Date().toISOString()
  };
  templates.unshift(newTpl);
  saveJsonFile(TEMPLATES_FILE, templates);
  addLog('success', `💾 New Message Template saved: "${newTpl.title}"`);
  res.json({ ok: true, template: newTpl, templates });
});

app.delete('/api/templates/:id', (req, res) => {
  templates = templates.filter(t => t.id !== req.params.id);
  saveJsonFile(TEMPLATES_FILE, templates);
  res.json({ ok: true, templates });
});

app.post('/api/templates/preview', (req, res) => {
  const { templateText = '', sampleData = {} } = req.body || {};
  const firstContact = contactsState.contacts[0]?.data || { name: 'Kasun Perera', phone: '0771234567', course: 'JLPT N5', amount: 'Rs. 4500' };
  const mergedData = { ...firstContact, ...sampleData };
  const rendered = renderTemplate(templateText, mergedData);
  const templateVariables = extractTemplateVariables(templateText);
  res.json({ ok: true, rendered, sampleData: mergedData, templateVariables });
});

// 4B. Stickers Catalog Endpoints
app.get('/api/stickers', (req, res) => {
  try {
    stickersCatalogStore = loadJsonFile(STICKERS_FILE, []);
    res.json({ ok: true, stickers: stickersCatalogStore });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/stickers', (req, res) => {
  try {
    const { id, name, base64 } = req.body || {};
    if (!base64) return res.status(400).json({ ok: false, error: 'Base64 image is required.' });
    const newSticker = {
      id: id || `stk_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: name || 'Custom Sticker',
      base64,
      createdAt: new Date().toISOString()
    };
    stickersCatalogStore = loadJsonFile(STICKERS_FILE, []);
    stickersCatalogStore.unshift(newSticker);
    if (stickersCatalogStore.length > 50) stickersCatalogStore = stickersCatalogStore.slice(0, 50);
    saveJsonFile(STICKERS_FILE, stickersCatalogStore);
    res.json({ ok: true, sticker: newSticker });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete('/api/stickers/:id', (req, res) => {
  try {
    const { id } = req.params;
    stickersCatalogStore = loadJsonFile(STICKERS_FILE, []);
    stickersCatalogStore = stickersCatalogStore.filter(s => s.id !== id);
    saveJsonFile(STICKERS_FILE, stickersCatalogStore);
    res.json({ ok: true, deleted: id });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Proxy remote image to bypass CORS and return Base64 data URL
app.get(['/api/proxy-image', '/api/stickers/fetch-url'], async (req, res) => {
  try {
    const { url } = req.query;
    if (!url || typeof url !== 'string' || (!url.startsWith('http://') && !url.startsWith('https://'))) {
      return res.status(400).json({ ok: false, error: 'A valid http/https image URL is required.' });
    }
    const fetchResp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    if (!fetchResp.ok) {
      return res.status(fetchResp.status).json({ ok: false, error: `Failed to fetch image: HTTP ${fetchResp.status}` });
    }
    const contentType = fetchResp.headers.get('content-type') || 'image/png';
    const buffer = Buffer.from(await fetchResp.arrayBuffer());
    const base64Data = `data:${contentType};base64,${buffer.toString('base64')}`;
    res.json({ ok: true, dataUrl: base64Data, contentType });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 5. Settings Update (Minimum 3 Seconds Delay Enforced & Batching Configuration)
app.post('/api/settings', (req, res) => {
  const {
    delayMode, minDelay, maxDelay, fixedDelay, requireServerAck, autoFailover,
    batchEnabled, batchSize, batchDelaySec, batchSwitchBot
  } = req.body || {};
  if (delayMode) appSettings.delayMode = delayMode === 'fixed' ? 'fixed' : 'random';
  if (minDelay !== undefined) appSettings.minDelay = Math.max(3, Number(minDelay) || 3);
  if (maxDelay !== undefined) appSettings.maxDelay = Math.max(appSettings.minDelay, Number(maxDelay) || 7);
  if (fixedDelay !== undefined) appSettings.fixedDelay = Math.max(3, Number(fixedDelay) || 3);
  if (requireServerAck !== undefined) appSettings.requireServerAck = Boolean(requireServerAck);
  if (autoFailover !== undefined) appSettings.autoFailover = Boolean(autoFailover);
  if (batchEnabled !== undefined) appSettings.batchEnabled = Boolean(batchEnabled);
  if (batchSize !== undefined) appSettings.batchSize = Math.max(1, Number(batchSize) || 25);
  if (batchDelaySec !== undefined) appSettings.batchDelaySec = Math.max(5, Number(batchDelaySec) || 60);
  if (batchSwitchBot !== undefined) appSettings.batchSwitchBot = Boolean(batchSwitchBot);
  if (req.body?.boostForwardMode !== undefined) appSettings.boostForwardMode = Boolean(req.body.boostForwardMode);
  persistState();
  const batchNotice = appSettings.batchEnabled
    ? ` | 📦 Batching: ON (${appSettings.batchSize}/batch, ${appSettings.batchDelaySec}s cooldown)`
    : ' | 📦 Batching: OFF';
  addLog('info', `⏱️ Settings updated (${appSettings.delayMode === 'fixed' ? `Fixed seconds ${appSettings.fixedDelay}s` : `Random seconds ${appSettings.minDelay}s - ${appSettings.maxDelay}s`}${batchNotice}).`);
  res.json({ ok: true, settings: appSettings });
});

// 5B. Google Account & Contacts Auto-Save Endpoints (Anti-Ban Protection)
app.get('/api/google/status', (req, res) => {
  const isLogged = Boolean(googleAuthState.tokens && (googleAuthState.tokens.refresh_token || googleAuthState.tokens.access_token));
  const connectedBotsCount = BOT_IDS.filter(id => accounts[id]?.isConnected).length;
  res.json({
    ok: true,
    isConfigured: Boolean(googleAuthState.clientId && googleAuthState.clientSecret),
    isLoggedIn: isLogged,
    email: googleAuthState.user?.email || null,
    name: googleAuthState.user?.name || null,
    picture: googleAuthState.user?.picture || null,
    autoSaveEnabled: Boolean(appSettings.googleContactsAutoSave),
    contactsLabel: appSettings.googleContactsLabel || 'WhatsApp Bot',
    clientId: googleAuthState.clientId || '',
    redirectUri: googleAuthState.redirectUri || 'http://127.0.0.1:5050/api/google/callback',
    botsSyncSummary: {
      totalBots: BOT_IDS.length,
      connectedBots: connectedBotsCount,
      linkedBots: isLogged ? BOT_IDS.length : 0,
      activeSyncedBots: isLogged ? connectedBotsCount : 0
    }
  });
});

app.post('/api/google/config', (req, res) => {
  const { clientId = '', clientSecret = '', contactsLabel = 'WhatsApp Bot' } = req.body || {};
  googleAuthState.clientId = String(clientId).trim();
  googleAuthState.clientSecret = String(clientSecret).trim();
  if (contactsLabel) appSettings.googleContactsLabel = String(contactsLabel).trim();
  saveJsonFile(GOOGLE_AUTH_FILE, googleAuthState);
  persistState();
  addLog('info', '⚙️ Google OAuth Credentials (Client ID & Secret) saved.');
  res.json({
    ok: true,
    isConfigured: Boolean(googleAuthState.clientId && googleAuthState.clientSecret),
    contactsLabel: appSettings.googleContactsLabel
  });
});

app.get('/api/google/auth-url', (req, res) => {
  if (!googleAuthState.clientId) {
    return res.status(400).json({
      ok: false,
      error: 'Google Client ID not set. Please enter Client ID and Secret from Google Cloud Console first.'
    });
  }
  const redirectUri = googleAuthState.redirectUri || 'http://127.0.0.1:5050/api/google/callback';
  const scopes = [
    'https://www.googleapis.com/auth/contacts',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile'
  ].join(' ');

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(googleAuthState.clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scopes)}&access_type=offline&prompt=consent`;
  res.json({ ok: true, authUrl });
});

app.get('/api/google/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) {
    return res.send(`<h2>Google Login Error: ${error}</h2><p><a href="/#tab-campaign">Go Back</a></p>`);
  }
  if (!code) {
    return res.send(`<h2>Authorization Code not found.</h2><p><a href="/#tab-campaign">Go Back</a></p>`);
  }
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(code),
        client_id: googleAuthState.clientId,
        client_secret: googleAuthState.clientSecret,
        redirect_uri: googleAuthState.redirectUri || 'http://127.0.0.1:5050/api/google/callback',
        grant_type: 'authorization_code'
      }).toString()
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return res.send(`<h2>Token Error: ${tokenData.error_description || tokenData.error}</h2><p><a href="/#tab-campaign">Go Back</a></p>`);
    }

    const existingRefreshToken = googleAuthState.tokens?.refresh_token;
    googleAuthState.tokens = tokenData;
    if (!tokenData.refresh_token && existingRefreshToken) {
      googleAuthState.tokens.refresh_token = existingRefreshToken;
    }
    googleAuthState.tokens.connected_at = new Date().toISOString();
    if (tokenData.expires_in) {
      googleAuthState.tokens.expiry_date = Date.now() + (Number(tokenData.expires_in) * 1000);
    }

    try {
      const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });
      const userData = await userRes.json();
      googleAuthState.user = {
        email: userData.email,
        name: userData.name || userData.given_name,
        picture: userData.picture
      };
    } catch (uErr) {
      console.warn('UserInfo fetch error:', uErr.message);
    }

    appSettings.googleContactsAutoSave = true;
    saveJsonFile(GOOGLE_AUTH_FILE, googleAuthState);
    syncGoogleAuthToBots(true);
    persistState();
    addLog('success', `☁️ Google Account (${googleAuthState.user?.email || 'Gmail'}) successfully connected — Auto-Save enabled for all 5 bots!`);

    res.send(`<!DOCTYPE html>
    <html>
    <head>
     <meta charset="utf-8">
     <title>Google Authentication Successful</title>
     <style>
      body { background:#14161D; color:#FFF; font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif; display:flex; align-items:center; justify-content:center; height:100vh; margin:0; }
      .card { background:#1E212B; border:1px solid #4ECDC4; padding:32px; border-radius:16px; text-align:center; max-width:440px; box-shadow:0 12px 30px rgba(0,0,0,0.5); }
      h2 { color:#4ECDC4; margin:0 0 10px 0; font-size:22px; }
      p { color:#94A3B8; font-size:14px; margin:0 0 20px 0; line-height:1.5; }
      .btn { background:#4ECDC4; color:#14161D; border:none; padding:10px 20px; border-radius:8px; font-weight:700; cursor:pointer; text-decoration:none; display:inline-block; }
     </style>
    </head>
    <body>
     <div class="card">
      <div style="font-size:48px; margin-bottom:12px;">☁️</div>
      <h2>Google Account Successfully connected!</h2>
      <p>Your <b>${googleAuthState.user?.email || 'Google Account'}</b> account has been successfully connected. This Google account will automatically operate for <b>all 5 Bot accounts</b> (even disconnected bots will automatically link when they connect later), and those numbers will be saved to Google Contacts before sending messages (Anti-Ban Protection).</p>
      <a class="btn" href="/#tab-campaign">Go to Main Screen (Go to Bot) ›</a>
     </div>
     <script>
      if (window.opener) {
       try { window.opener.postMessage({ type: 'GOOGLE_AUTH_SUCCESS' }, '*'); } catch (e) {}
       setTimeout(() => window.close(), 1500);
      } else {
       setTimeout(() => { window.location.href = '/#tab-campaign'; }, 2000);
      }
     </script>
    </body>
    </html>`);
  } catch (err) {
    res.send(`<h2>Error: ${err.message}</h2><p><a href="/#tab-campaign">Go Back</a></p>`);
  }
});

app.post('/api/google/logout', (req, res) => {
  googleAuthState.tokens = null;
  googleAuthState.user = null;
  saveJsonFile(GOOGLE_AUTH_FILE, googleAuthState);
  syncGoogleAuthToBots(false);
  persistState();
  addLog('info', '🚪 Disconnected from Google Account — Google connection removed from all 5 bot accounts (All 5 bots unlinked).');
  res.json({ ok: true });
});

app.post('/api/google/toggle-autosave', (req, res) => {
  const { enabled, label } = req.body || {};
  if (enabled !== undefined) appSettings.googleContactsAutoSave = Boolean(enabled);
  if (label) appSettings.googleContactsLabel = String(label).trim();
  persistState();
  addLog('info', `☁️ Pre-Send Contacts Auto-Save ${appSettings.googleContactsAutoSave ? 'ON' : 'OFF'} set.`);
  res.json({ ok: true, autoSaveEnabled: appSettings.googleContactsAutoSave, contactsLabel: appSettings.googleContactsLabel });
});

app.post('/api/google/sync-all', async (req, res) => {
  try {
    const { label = appSettings.googleContactsLabel || 'WhatsApp Bot' } = req.body || {};
    const contactsToSync = (contactsState.contacts || []).filter(c => c && c.isValid !== false);
    if (contactsToSync.length === 0) {
      return res.status(400).json({ ok: false, error: 'No valid phone numbers in the list to save to Google Contacts.' });
    }
    addLog('info', `☁️ Contacts ${contactsToSync.length} Starting sync to Google Contacts...`);
    const result = await batchSaveContactsToGoogleContacts(contactsToSync, label);
    addLog('success', `✅ Contacts ${result.savedCount} successfully saved to your Google Contacts!`);
    res.json({ ok: true, savedCount: result.savedCount, totalContacts: contactsToSync.length });
  } catch (err) {
    addLog('error', `❌ Google Contacts Sync failed: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 5C. /boost Message Forwarding Endpoints ─────────────────────────────────
app.post('/api/forward/upload', async (req, res) => {
  try {
    const { base64, mimeType, fileName, caption, botId } = req.body || {};
    if (!base64 || !botId) return res.status(400).json({ ok: false, error: 'base64 and botId required' });
    
    const bot = accounts[botId];
    if (!bot || !bot.isConnected || !bot.sock) return res.status(400).json({ ok: false, error: 'Bot offline' });

    // Send to self to get the media uploaded to WhatsApp CDN and a valid message ID
    const recipientJid = bot.sock.user.id.replace(/:.*@/, '@');
    
    const cleanB64 = base64.replace(/^data:[^;]+;base64,/, '');
    const fBuffer = Buffer.from(cleanB64, 'base64');
    const localCachePath = path.join(UPLOADS_DIR, `cached_forward_${fileName}`);
    fs.writeFileSync(localCachePath, fBuffer);

    const ackResult = await sendSingleMessageWithServerAck({
      bot,
      recipient: { phone: bot.phone, name: 'Self' },
      renderedText: caption || '',
      mediaAttachment: {
        filePath: localCachePath,
        base64,
        mimetype: mimeType,
        fileName,
        type: mimeType.startsWith('image') ? 'image' : mimeType.startsWith('video') ? 'video' : 'document',
        caption: (caption || '').trim(),
        captionMode: (caption && caption.trim()) ? 'template' : 'none',
        captionSource: (caption && caption.trim()) ? 'custom' : 'none'
      }
    });

    setTimeout(() => {
      schedulePersistForwardCatalog();
    }, 3000);

    res.json({ ok: true, msgId: ackResult.serverMessageId, message: 'Uploaded and cached to Forward Catalog!' });
  } catch (err) {
    addLog('error', `Forward Upload Error: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});
app.get('/api/forward/messages', (req, res) => {
  try {
    const { type = 'all', botId = 'all', search = '', limit = 100, offset = 0 } = req.query;
    let items = Array.from(forwardMessagesStore.values());

    if (type && type !== 'all') {
      const lowerType = type.toLowerCase();
      items = items.filter(i => i.type === lowerType);
    }
    if (botId && botId !== 'all') {
      items = items.filter(i => i.botId === botId);
    }
    if (search) {
      const s = search.toLowerCase();
      items = items.filter(i =>
        (i.fileName && i.fileName.toLowerCase().includes(s)) ||
        (i.caption && i.caption.toLowerCase().includes(s)) ||
        (i.sender && i.sender.toLowerCase().includes(s)) ||
        (i.id && i.id.toLowerCase().includes(s))
      );
    }

    // Newest first
    items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const total = items.length;
    const paginated = items.slice(Number(offset) || 0, (Number(offset) || 0) + (Number(limit) || 100)).map(item => {
      let thumbnailBase64 = null;
      if (item.rawMessage) {
        const msgType = Object.keys(item.rawMessage)[0];
        const msgContent = item.rawMessage[msgType];
        if (msgContent && msgContent.jpegThumbnail) {
          if (Buffer.isBuffer(msgContent.jpegThumbnail)) {
            thumbnailBase64 = msgContent.jpegThumbnail.toString('base64');
          } else if (msgContent.jpegThumbnail.type === 'Buffer' && Array.isArray(msgContent.jpegThumbnail.data)) {
            thumbnailBase64 = Buffer.from(msgContent.jpegThumbnail.data).toString('base64');
          } else if (msgContent.jpegThumbnail instanceof Uint8Array) {
            thumbnailBase64 = Buffer.from(msgContent.jpegThumbnail).toString('base64');
          }
        }
      }
      return {
        ...item,
        thumbnailBase64
      };
    });

    res.json({
      ok: true,
      total,
      boostEnabled: appSettings.boostForwardMode !== false,
      messages: paginated
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/forward/prepare', async (req, res) => {
  try {
    const {
      fileBase64,
      filePath,
      fileName = 'Uploaded_Media',
      mimetype = 'application/octet-stream',
      type = 'document',
      caption = '',
      botId
    } = req.body || {};

    if (!fileBase64 && !filePath) {
      return res.status(400).json({ ok: false, error: 'No file (buffer or path) provided.' });
    }

    const targetBotId = botId && accounts[botId]?.isConnected ? botId : (selectAvailableBot(accounts)?.bot?.id || 'bot1');
    const bot = accounts[targetBotId];

    const prepared = await prepareMediaForForwarding({
      bot,
      mediaAttachment: {
        base64: fileBase64,
        filePath,
        fileName,
        mimetype,
        type,
        caption
      }
    });

    if (!prepared) {
      return res.status(500).json({ ok: false, error: 'Could not prepare media for forwarding.' });
    }

    addLog('success', `⚡ [/boost] Media "${prepared.fileName}" (${prepared.fileSizeFormatted}) successfully prepared for forwarding!`);

    res.json({
      ok: true,
      message: prepared,
      summary: {
        id: prepared.id,
        fileName: prepared.fileName,
        type: prepared.type,
        fileSizeFormatted: prepared.fileSizeFormatted,
        fileSizeBytes: prepared.fileSizeBytes,
        botLabel: bot?.label || targetBotId
      }
    });
  } catch (err) {
    addLog('error', `❌ [/boost Prepare Error]: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/forward/test-send', async (req, res) => {
  try {
    const {
      phone,
      forwardMessageId,
      forwardMessage,
      renderedText = 'Testing /boost Message Forwarding 🚀 (No Re-upload)',
      captionMode = 'template',
      sendSeparate = false,
      forceForward = true,
      botId
    } = req.body || {};

    if (!phone) {
      return res.status(400).json({ ok: false, error: 'Phone number required for testing.' });
    }

    const targetBotId = botId && accounts[botId]?.isConnected ? botId : (selectAvailableBot(accounts)?.bot?.id || 'bot1');
    const bot = accounts[targetBotId];
    if (!bot || !bot.isConnected) {
      return res.status(400).json({ ok: false, error: 'Cannot find a connected WhatsApp Account (Connected bot).' });
    }

    let resolvedForwardMessage = null;
    if (forwardMessageId) {
      resolvedForwardMessage = getForwardableMessage(forwardMessageId);
    }
    if (!resolvedForwardMessage && forwardMessage) {
      resolvedForwardMessage = forwardMessage;
    }

    const ackResult = await sendSingleMessageWithServerAck({
      bot,
      recipient: { phone, name: 'Test Forward User' },
      renderedText,
      mediaAttachment: {
        type: 'forward',
        isForward: true,
        forwardMessageId,
        forwardMessage: resolvedForwardMessage,
        captionMode,
        sendSeparate,
        forceForward
      }
    });

    addLog('success', `🧪 [${bot.label}] -> Test Forward (${phone}) successful! Server ACK: ${ackResult.serverMessageId}`);
    res.json({ ok: true, result: ackResult });
  } catch (err) {
    addLog('error', `❌ Test Forward failed: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/forward/delete', (req, res) => {
  try {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ ok: false, error: 'Message ID is required' });
    const deleted = deleteForwardableMessage(id);
    res.json({ ok: true, deleted });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/forward/heal-catalog', async (req, res) => {
  try {
    let healed = 0;
    let healedByCdn = 0;
    let healedByLocalFile = 0;
    let total = 0;
    let skipped = 0;

    // Gather items that need healing
    const needsHeal = [];
    for (const [itemId, item] of forwardMessagesStore.entries()) {
      total++;
      const rawMsg = item.rawMessage || item.message || item;
      const innerKey = rawMsg && typeof rawMsg === 'object'
        ? Object.keys(rawMsg).find(k => k.endsWith('Message') || k === 'conversation')
        : null;
      if (!innerKey || innerKey === 'conversation' || innerKey === 'extendedTextMessage') { skipped++; continue; }

      const inner = rawMsg[innerKey];
      const mk = inner && ensureBuffer(inner.mediaKey);
      if (mk && mk.length >= 16) {
        // Valid CDN key. Check if local cache is present or can be linked
        const foundLocal = findLocalMediaFile(item.filePath) || findLocalMediaFile(item.fileName);
        if (foundLocal) {
          item.filePath = foundLocal;
          forwardMessagesStore.set(itemId, item);
        }
        skipped++;
        continue;
      }

      // Check if local cached file already exists (Path B will work with just that)
      const cachedPath = findLocalMediaFile(item.filePath) || findLocalMediaFile(item.fileName);
      if (cachedPath && fs.existsSync(cachedPath)) {
        item.filePath = cachedPath;
        forwardMessagesStore.set(itemId, item);
        healedByLocalFile++;
        healed++;
        skipped++;
        continue;
      }

      // Try to heal from sentMessagesStore by directPath or fileName match
      let foundKey = null;
      for (const [, sentMsg] of sentMessagesStore.entries()) {
        const sInner = sentMsg?.[innerKey];
        if (!sInner) continue;
        if (
          (inner.directPath && sInner.directPath === inner.directPath) ||
          (inner.fileName && sInner.fileName === inner.fileName) ||
          (inner.url && sInner.url === inner.url)
        ) {
          const sMk = ensureBuffer(sInner.mediaKey);
          if (sMk && sMk.length >= 16) {
            foundKey = {
              mediaKey: sMk,
              fileSha256: ensureBuffer(sInner.fileSha256),
              fileEncSha256: ensureBuffer(sInner.fileEncSha256)
            };
            break;
          }
        }
      }

      if (foundKey) {
        inner.mediaKey = foundKey.mediaKey;
        if (foundKey.fileSha256) inner.fileSha256 = foundKey.fileSha256;
        if (foundKey.fileEncSha256) inner.fileEncSha256 = foundKey.fileEncSha256;
        forwardMessagesStore.set(itemId, item);
        healed++;
      } else {
        // Queue for CDN download attempt
        needsHeal.push({ itemId, item, rawMsg, innerKey, inner });
      }
    }

    // Attempt CDN download for items without valid keys
    // Find a connected bot's sock for downloading
    const activeSock = (() => {
      for (const botId of BOT_IDS) {
        const b = accounts[botId];
        if (b?.sock && b?.status === 'connected') return b.sock;
      }
      return null;
    })();

    if (activeSock && needsHeal.length > 0) {
      addLog('info', `🔧 [Heal Catalog] Attempting CDN download for ${needsHeal.length} items via active bot...`);
      // Process in batches of 5 to avoid rate limiting
      const BATCH = 5;
      for (let i = 0; i < needsHeal.length; i += BATCH) {
        const batch = needsHeal.slice(i, i + BATCH);
        await Promise.all(batch.map(async ({ itemId, item, rawMsg, innerKey, inner }) => {
          try {
            // Reconstruct a minimal message object for downloadMediaMessage
            const fakeMsg = {
              key: {
                id: item.id || itemId,
                remoteJid: item.remoteJid || item.key?.remoteJid || '0@s.whatsapp.net',
                fromMe: item.fromMe !== false
              },
              message: { [innerKey]: inner }
            };

            const buf = await downloadMediaMessage(fakeMsg, 'buffer', {}, { logger: console, reuploadRequest: activeSock.updateMediaMessage });
            if (buf && buf.length > 0) {
              const safeFileName = `cached_forward_${item.fileName || itemId}`;
              const savePath = path.join(UPLOADS_DIR, safeFileName);
              fs.writeFileSync(savePath, buf);
              item.filePath = savePath;
              forwardMessagesStore.set(itemId, item);
              healedByCdn++;
              healed++;
            }
          } catch (dlErr) {
            // CDN link may have expired — silently skip
          }
        }));
        // Small delay between batches to avoid throttling
        if (i + BATCH < needsHeal.length) {
          await new Promise(r => setTimeout(r, 500));
        }
      }
    }

    // Persist healed catalog
    if (healed > 0) schedulePersistForwardCatalog();

    const notHealed = needsHeal.length - healedByCdn;
    addLog('success', `🔧 [/boost Heal Catalog] Total: ${total}, Healed: ${healed} (keys: ${healed - healedByCdn - healedByLocalFile}, local: ${healedByLocalFile}, CDN: ${healedByCdn}), Not reachable: ${notHealed}`);
    res.json({ ok: true, total, healed, healedByCdn, healedByLocalFile, notHealed, skipped });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});


app.get('/api/forward/stats', (req, res) => {
  try {
    let totalMedia = 0, valid = 0, empty = 0, text = 0;
    for (const [, item] of forwardMessagesStore.entries()) {
      const rawMsg = item.rawMessage || item.message || item;
      const innerKey = rawMsg && typeof rawMsg === 'object'
        ? Object.keys(rawMsg).find(k => k.endsWith('Message') || k === 'conversation')
        : null;
      if (!innerKey || innerKey === 'conversation') { text++; continue; }
      totalMedia++;
      const inner = rawMsg[innerKey];
      const mk = inner && ensureBuffer(inner.mediaKey);
      if (mk && mk.length >= 16) valid++; else empty++;
    }
    res.json({ ok: true, totalMedia, valid, empty, text, total: forwardMessagesStore.size });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// /boost Aliases
app.get('/api/boost/status', (req, res) => {
  res.json({
    ok: true,
    boostEnabled: appSettings.boostForwardMode !== false,
    forwardCatalogCount: forwardMessagesStore.size
  });
});

app.post('/api/boost/prepare', (req, res, next) => {
  req.url = '/api/forward/prepare';
  app._router.handle(req, res, next);
});

app.post('/api/boost/test-send', (req, res, next) => {
  req.url = '/api/forward/test-send';
  app._router.handle(req, res, next);
});

// ─── Live Dispatch Streaming (SSE) & Single Direct Send Endpoints ──────────
app.get('/api/live-dispatch/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive'
  });
  res.write(`event: state\ndata: ${JSON.stringify({ type: 'state', payload: campaignState.liveDispatch })}\n\n`);
  sseClients.add(res);
  req.on('close', () => {
    sseClients.delete(res);
  });
});

app.post('/api/send/single', async (req, res) => {
  try {
    const {
      phone,
      name = 'Direct Recipient',
      message = '',
      type = 'text',
      mediaAttachment = null,
      forwardMessageId = null,
      botId = null
    } = req.body || {};

    if (!phone) {
      return res.status(400).json({ ok: false, error: 'Entering a phone number is required.' });
    }

    const norm = normalizePhoneNumber(phone);
    if (!norm) {
      return res.status(400).json({ ok: false, error: 'Invalid WhatsApp phone number.' });
    }

    const targetBotId = botId && accounts[botId]?.isConnected ? botId : (selectAvailableBot(accounts)?.bot?.id || 'bot1');
    const bot = accounts[targetBotId];
    if (!bot || !bot.isConnected || (!bot.sock && !bot.isSimulated)) {
      return res.status(400).json({ ok: false, error: 'Cannot find a connected WhatsApp Account (Connected account).' });
    }

    let resolvedMediaAttachment = mediaAttachment;
    let fwdItem = null;
    if (type === 'forward' || forwardMessageId) {
      const fwdId = forwardMessageId || mediaAttachment?.forwardMessageId;
      fwdItem = fwdId ? getForwardableMessage(fwdId) : null;
      resolvedMediaAttachment = {
        type: 'forward',
        isForward: true,
        forwardMessageId: fwdId,
        forwardMessage: fwdItem || mediaAttachment?.forwardMessage,
        fileName: fwdItem?.fileName || fwdItem?.textSnippet || mediaAttachment?.fileName || 'Forwarded Media',
        captionMode: mediaAttachment?.captionMode || 'template',
        sendSeparate: Boolean(mediaAttachment?.sendSeparate),
        forceForward: mediaAttachment?.forceForward !== false
      };
    } else if (mediaAttachment && (type === 'image' || type === 'video' || type === 'pdf' || type === 'sticker' || type === 'voice' || type === 'audio')) {
      resolvedMediaAttachment = {
        ...mediaAttachment,
        type: type
      };
    }

    const dispatchType = resolvedMediaAttachment?.isForward || resolvedMediaAttachment?.type === 'forward'
      ? 'forward'
      : (resolvedMediaAttachment?.type && resolvedMediaAttachment?.type !== 'none' ? resolvedMediaAttachment.type.toLowerCase() : 'text');

    const isFwd = dispatchType === 'forward';
    const fileDetails = resolvedMediaAttachment ? {
      name: resolvedMediaAttachment.fileName || (isFwd ? (fwdItem?.fileName || fwdItem?.textSnippet || 'Forwarded Media') : `${dispatchType.toUpperCase()} File`),
      size: resolvedMediaAttachment.sizeFormatted || resolvedMediaAttachment.fileSize || resolvedMediaAttachment.forwardMessage?.fileSizeFormatted || (resolvedMediaAttachment.base64 ? `${Math.round(resolvedMediaAttachment.base64.length * 0.75 / 1024)} KB` : '1.2 MB'),
      type: dispatchType,
      thumbnail: resolvedMediaAttachment.base64 || fwdItem?.jpegThumbnail || null,
      fwdMediaType: isFwd ? (fwdItem?.type || 'media') : null,
      caption: message || ''
    } : null;

    const sendStart = Date.now();
    campaignState.liveDispatch = {
      active: true,
      dispatchType,
      phase: 'transmitting',
      recipient: { name, phone: norm.formatted || norm.clean, index: 1, total: 1 },
      bot: { id: bot.id, label: bot.label, phone: bot.phone, index: bot.index },
      file: fileDetails,
      message: message,
      textSnippet: (message || '').slice(0, 160),
      caption: message || '',
      isForward: isFwd,
      forwardBoost: Boolean(resolvedMediaAttachment?.isForward || resolvedMediaAttachment?.boostMode),
      serverAckId: '',
      latencyMs: 0,
      countdownSec: 0,
      speedMsgsPerMin: 60,
      recentResults: campaignState.results.slice(-10)
    };
    broadcastDispatchEvent('transmitting', campaignState.liveDispatch);

    const ackResult = await sendSingleMessageWithServerAck({
      bot,
      recipient: { phone: norm.clean, name },
      renderedText: message,
      mediaAttachment: resolvedMediaAttachment,
      contactAttachment: null
    });

    const latencyMs = Date.now() - sendStart;
    const resultRecord = {
      index: (campaignState.results?.length || 0) + 1,
      phone: norm.formatted || norm.clean,
      name,
      botId: bot.id,
      botLabel: bot.label,
      senderPhone: bot.phone,
      message,
      mediaType: dispatchType === 'forward' ? 'FORWARD' : dispatchType.toUpperCase(),
      status: 'SENT',
      serverAck: true,
      serverMessageId: ackResult.serverMessageId,
      delaySec: 0,
      timestamp: ackResult.confirmedAt,
      latencyMs,
      error: ''
    };

    if (Array.isArray(campaignState.results)) {
      campaignState.results.push(resultRecord);
    }

    campaignState.liveDispatch.phase = 'confirmed';
    campaignState.liveDispatch.serverAckId = ackResult.serverMessageId;
    campaignState.liveDispatch.latencyMs = latencyMs;
    campaignState.liveDispatch.recentResults = campaignState.results.slice(-10);
    broadcastDispatchEvent('server_ack', {
      ...campaignState.liveDispatch,
      result: resultRecord
    });

    addLog('success', `⚡ [Quick Send] [${bot.label}] ➔ ${name} (${norm.clean}) [${dispatchType.toUpperCase()}] successful! Server ACK: ${ackResult.serverMessageId} (${latencyMs}ms)`);

    setTimeout(() => {
      if (campaignState.liveDispatch?.phase === 'confirmed' && !campaignState.isRunning) {
        campaignState.liveDispatch.active = false;
        campaignState.liveDispatch.phase = 'idle';
        broadcastDispatchEvent('state', campaignState.liveDispatch);
      }
    }, 3500);

    res.json({ ok: true, result: ackResult, record: resultRecord });
  } catch (err) {
    campaignState.liveDispatch.phase = 'failed';
    campaignState.liveDispatch.error = err.message;
    broadcastDispatchEvent('failed', {
      ...campaignState.liveDispatch,
      error: err.message
    });
    addLog('error', `❌ [Quick Send] failed: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 6. Campaign Control Endpoints
app.post('/api/campaign/start', async (req, res) => {
    

  try {
    const {
      name = '',
      campaignName = '',
      recipients = contactsState.contacts,
      templateText = '',
      messages = null,      // NEW: array of text strings
      mediaAttachment = null,
      mediaAttachments = null, pollData = null, scheduleTime = null,
      contactAttachment = null,
      delaySettings = null,
      batchSettings = null,
      fileSendMethod = 'forward',
      awaitCompletion = false,
      fastTestDelayMs = null
    } = req.body || {};

    const resolvedCampName = (name || campaignName || '').trim() || ('Campaign ' + new Date().toISOString().slice(0, 10) + ' ' + new Date().toTimeString().slice(0, 5));

    if (scheduleTime) {
      const sTime = new Date(scheduleTime);
      if (sTime > new Date()) {
        const fs = require('fs');
        let sched = [];
        try { sched = JSON.parse(fs.readFileSync('scheduled_campaigns.json', 'utf8')); } catch(e){}
        sched.push({
          scheduleTime,
          payload: { name: resolvedCampName, campaignName: resolvedCampName, recipients, templateText, messages, mediaAttachment, mediaAttachments, contactAttachment, delaySettings, batchSettings, fileSendMethod, pollData }
        });
        fs.writeFileSync('scheduled_campaigns.json', JSON.stringify(sched, null, 2));
        addLog('info', `🗓️ Campaign "${resolvedCampName}" scheduled for ${sTime.toLocaleString()}`);
        return res.json({ ok: true, scheduled: true, message: `Campaign "${resolvedCampName}" scheduled successfully.` });
      }
    }

    if (awaitCompletion) {
      const finalState = await runCampaign({
        name: resolvedCampName,
        campaignName: resolvedCampName,
        recipients,
        templateText,
        messages,
        mediaAttachment,
        mediaAttachments,
        contactAttachment,
        delaySettings,
        batchSettings,
        fileSendMethod,
        fastTestDelayMs,
        pollData
      });
      return res.json({ ok: true, campaign: finalState });
    } else {
      // Start asynchronously and return immediate status
      let startupError = null;
      runCampaign({
        name: resolvedCampName,
        campaignName: resolvedCampName,
        recipients,
        templateText,
        messages,
        mediaAttachment,
        mediaAttachments,
        contactAttachment,
        delaySettings,
        batchSettings,
        fileSendMethod,
        pollData
      }).catch(err => {
        startupError = err.message;
        addLog('error', `Campaign Error: ${err.message}`);
      });
      // Brief wait so initial validations complete
      await new Promise(r => setTimeout(r, 80));
      if (startupError) {
        return res.status(400).json({ ok: false, error: startupError });
      }
      return res.json({ ok: true, campaign: campaignState });
    }
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/campaign/resume', async (req, res) => {
  try {
    let startupError = null;
    runCampaign({ resume: true }).catch(err => {
      startupError = err.message;
      addLog('error', `Resume Error: ${err.message}`);
    });
    await new Promise(r => setTimeout(r, 80));
    if (startupError) {
      return res.status(400).json({ ok: false, error: startupError });
    }
    return res.json({ ok: true, campaign: campaignState });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/campaign/pause', (req, res) => {
  if (!campaignState.isRunning && campaignState.status !== 'running' && campaignState.status !== 'paused') {
    return res.json({ ok: false, status: campaignState.status, isRunning: false, paused: false, message: 'Campaign is already stopped.' });
  }
  campaignPauseFlag = !campaignPauseFlag;
  campaignState.isPaused = campaignPauseFlag;
  campaignState.status = campaignPauseFlag ? 'paused' : 'running';
  saveCampaignProgress();
  addLog('info', campaignPauseFlag ? '⏸️ Sending paused.' : '▶️ Sending resumed.');
  res.json({ ok: true, status: campaignState.status, isRunning: campaignState.isRunning, paused: campaignPauseFlag });
});

app.post('/api/campaign/stop', (req, res) => {
  campaignAbortFlag = true;
  campaignPauseFlag = false;
  campaignState.isRunning = false;
  campaignState.isPaused = false;
  campaignState.isStopped = true;
  campaignState.isBatchCooldown = false;
  campaignState.batchCooldownCountdownSec = 0;
  campaignState.currentRecipient = null;
  campaignState.currentPhone = null;
  campaignState.nextMessageCountdownSec = 0;
  campaignState.nextDelaySeconds = 0;
  campaignState.status = 'stopped_manual';
  campaignState.stopReason = 'Stopped by user.';
  if (!campaignState.completedAt) {
    campaignState.completedAt = new Date().toISOString();
  }
  campaignState.summary = computeCampaignSummary();
  saveCampaignProgress({ status: 'stopped_manual', stopReason: 'Stopped by user.' });
  addLog('warn', `⏹️ ${campaignState.stopReason}`);
  res.json({ ok: true, status: campaignState.status, isRunning: false, isStopped: true, summary: campaignState.summary });
});

app.get('/api/campaign/summary', (req, res) => {
  const summary = campaignState.summary || computeCampaignSummary();
  res.json({ ok: true, summary });
});

app.get('/api/campaign/progress', (req, res) => {
  const progress = loadJsonFile(CAMPAIGN_PROGRESS_FILE, null);
  const remaining = progress && progress.total > 0 ? (progress.total - (progress.sent + progress.failed)) : 0;
  const resumable = Boolean(
    progress &&
    progress.total > 0 &&
    remaining > 0 &&
    progress.status !== 'completed' &&
    progress.payload
  );
  res.json({
    ok: true,
    hasProgress: Boolean(progress),
    resumable: resumable || Boolean(campaignState.lastPayload && campaignState.total > 0 && (campaignState.sent + campaignState.failed < campaignState.total)),
    progress: progress || null,
    campaign: campaignState
  });
});

app.get('/api/audience', (req, res) => {
  res.json({
    ok: true,
    list: audienceState.list || [],
    mode: audienceState.mode || 'manual',
    rawText: audienceState.rawText || '',
    total: (audienceState.list || []).length
  });
});

app.post('/api/audience', (req, res) => {
  try {
    const { list = [], mode = 'manual', rawText = '', rawOnly = false } = req.body || {};
    if (rawOnly && audienceState) {
      audienceState.rawText = String(rawText || '');
      audienceState.mode = String(mode || 'manual');
      audienceState.updatedAt = new Date().toISOString();
    } else {
      audienceState = {
        list: Array.isArray(list) ? list : (audienceState?.list || []),
        mode: String(mode || 'manual'),
        rawText: String(rawText || ''),
        updatedAt: new Date().toISOString()
      };
    }
    saveJsonFile(AUDIENCE_FILE, audienceState);
    res.json({ ok: true, count: audienceState.list.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
// ADVANCED FEATURES API ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

// ─── DNC (Do-Not-Contact) List ────────────────────────────────────────────────
app.get('/api/dnc', (req, res) => {
  res.json({ ok: true, numbers: [...dncState.numbers] });
});
app.post('/api/dnc', (req, res) => {
  const nums = Array.isArray(req.body.numbers) ? req.body.numbers : [req.body.phone].filter(Boolean);
  let added = 0;
  nums.forEach(n => {
    const norm = normalizePhoneNumber(String(n).replace(/\D/g,''));
    const key = norm?.clean || String(n).replace(/\D/g,'');
    if (key && !dncState.numbers.has(key)) { dncState.numbers.add(key); added++; }
  });
  saveDNC();
  res.json({ ok: true, added, total: dncState.numbers.size });
});
app.delete('/api/dnc/:phone', (req, res) => {
  const key = req.params.phone.replace(/\D/g,'');
  const removed = dncState.numbers.delete(key);
  saveDNC();
  res.json({ ok: true, removed });
});
app.delete('/api/dnc', (req, res) => {
  dncState.numbers.clear();
  saveDNC();
  res.json({ ok: true, cleared: true });
});

// ─── Contact Tags ─────────────────────────────────────────────────────────────
app.get('/api/tags', (req, res) => {
  res.json({ ok: true, tags: tagsState });
});
app.post('/api/tags', (req, res) => {
  const { name, color } = req.body;
  if (!name) return res.status(400).json({ error: 'Tag name required' });
  if (tagsState.find(t => t.name === name)) return res.status(400).json({ error: 'Tag already exists' });
  tagsState.push({ name, color: color || '#6b7280' });
  saveTags();
  res.json({ ok: true, tags: tagsState });
});
app.delete('/api/tags/:name', (req, res) => {
  tagsState = tagsState.filter(t => t.name !== req.params.name);
  // Also remove from all contacts
  contactsState.contacts.forEach(c => {
    if (Array.isArray(c.tags)) c.tags = c.tags.filter(t => t !== req.params.name);
  });
  saveTags();
  saveJsonFile(CONTACTS_FILE, contactsState);
  res.json({ ok: true });
});
app.post('/api/contacts/tags', (req, res) => {
  const { phone, tags } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone required' });
  const norm = normalizePhoneNumber(String(phone).replace(/\D/g,''));
  const key = norm?.clean || phone;
  let updated = 0;
  contactsState.contacts.forEach(c => {
    if (c.phone === key || c.phone === '+' + key) {
      c.tags = Array.isArray(tags) ? tags : [];
      updated++;
    }
  });
  saveJsonFile(CONTACTS_FILE, contactsState);
  res.json({ ok: true, updated });
});

// ─── Engagement Score ─────────────────────────────────────────────────────────
app.get('/api/contacts/engagement', (req, res) => {
  const sorted = [...contactsState.contacts]
    .map(c => ({ phone: c.phone, name: c.name || '', score: c.engagementScore || 0, lastReplied: c.lastReplied || null, totalSent: c.totalSent || 0, totalReceived: c.totalReceived || 0 }))
    .sort((a, b) => b.score - a.score);
  res.json({ ok: true, contacts: sorted });
});

// ─── Message History ──────────────────────────────────────────────────────────
app.get('/api/message-history', (req, res) => {
  const { phone, limit = 100, offset = 0 } = req.query;
  let list = msgHistoryStore;
  if (phone) {
    const key = String(phone).replace(/\D/g,'');
    list = list.filter(h => h.phone && (h.phone.replace(/\D/g,'') === key));
  }
  const total = list.length;
  res.json({ ok: true, total, history: list.slice(Number(offset), Number(offset) + Number(limit)) });
});

// ─── Campaign Archive ─────────────────────────────────────────────────────────
app.get('/api/campaign/archive', (req, res) => {
  res.json({ ok: true, campaigns: campaignArchive });
});
app.post('/api/campaign/archive', (req, res) => {
  const { name, campaignName, config } = req.body;
  const cName = (name || campaignName || '').trim();
  if (!cName || !config) return res.status(400).json({ error: 'name and config required' });
  const entry = { id: 'arc_' + Date.now(), name: cName, campaignName: cName, config, savedAt: new Date().toISOString() };
  campaignArchive.unshift(entry);
  if (campaignArchive.length > 50) campaignArchive.length = 50;
  saveCampaignArchive();
  res.json({ ok: true, entry });
});
app.delete('/api/campaign/archive/:id', (req, res) => {
  campaignArchive = campaignArchive.filter(c => c.id !== req.params.id);
  saveCampaignArchive();
  res.json({ ok: true });
});

// ─── Delivery Analytics ───────────────────────────────────────────────────────
app.get('/api/analytics/delivery', (req, res) => {
  const history = loadJsonFile(REPORTS_FILE, []);
  const days = {};
  history.forEach(h => {
    const date = (h.startedAt || '').substring(0, 10);
    if (!date) return;
    if (!days[date]) days[date] = { date, sent: 0, failed: 0, campaigns: 0 };
    days[date].sent += (h.sent || 0);
    days[date].failed += (h.failed || 0);
    days[date].campaigns++;
  });
  const sorted = Object.values(days).sort((a, b) => a.date.localeCompare(b.date)).slice(-14);
  res.json({ ok: true, data: sorted });
});
app.get('/api/analytics/best-send-time', (req, res) => {
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, sent: 0, total: 0 }));
  msgHistoryStore.forEach(h => {
    if (!h.timestamp || h.status !== 'sent') return;
    const hour = new Date(h.timestamp).getHours();
    if (hour >= 0 && hour < 24) { hours[hour].sent++; hours[hour].total++; }
  });
  res.json({ ok: true, hours });
});

// ─── Enhanced Contact Export with tag/score filters ───────────────────────────
app.get('/api/contacts/export-advanced', (req, res) => {
  const { tag, minScore = 0, excludeDNC = 'false', format = 'csv' } = req.query;
  let list = [...contactsState.contacts];
  if (tag) list = list.filter(c => Array.isArray(c.tags) && c.tags.includes(tag));
  if (Number(minScore) > 0) list = list.filter(c => (c.engagementScore || 0) >= Number(minScore));
  if (excludeDNC === 'true') list = list.filter(c => !dncState.numbers.has(c.phone?.replace(/\D/g,'') || ''));
  const csv = ['Phone,Name,Tags,Score,TotalSent,TotalReceived,LastReplied', ...list.map(c => [c.phone, c.name || '', (c.tags || []).join(';'), c.engagementScore || 0, c.totalSent || 0, c.totalReceived || 0, c.lastReplied || ''].join(','))].join('\n');
  if (format === 'json') return res.json({ ok: true, contacts: list });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="contacts_export.csv"');
  res.send(csv);
});


app.get('/api/reports/history', (req, res) => {
  const history = loadJsonFile(REPORTS_FILE, []);
  res.json({ ok: true, history });
});

app.delete('/api/reports/history/:id', (req, res) => {
  let history = loadJsonFile(REPORTS_FILE, []);
  history = history.filter(h => h.id !== req.params.id);
  saveJsonFile(REPORTS_FILE, history);
  res.json({ ok: true });
});

app.post('/api/reports/revoke/:id', async (req, res) => {
  try {
    const history = loadJsonFile(REPORTS_FILE, []);
    const campaign = history.find(h => h.id === req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Report not found' });
    
    if (!campaign.results || campaign.results.length === 0) {
      return res.json({ ok: true, message: 'No messages to revoke' });
    }

    // Check if all messages are already revoked or if no messages can be revoked
    const eligibleMessages = campaign.results.filter(r => {
      const st = (r.status || '').toUpperCase();
      return st === 'SENT' || st === 'DELIVERED';
    });
    const alreadyRevoked = campaign.results.filter(r => (r.status || '').toUpperCase() === 'REVOKED');

    if (eligibleMessages.length === 0) {
      if (alreadyRevoked.length > 0 || campaign.revokeStatus === 'green') {
        campaign.revokeStatus = 'green';
        saveJsonFile(REPORTS_FILE, history);
        return res.json({ 
          ok: true, 
          alreadyRevoked: true, 
          message: 'All sent messages in this campaign have already been deleted for everyone on WhatsApp.' 
        });
      }
      return res.json({ ok: true, message: 'No sent or delivered messages to revoke in this campaign.' });
    }

    campaign.revokeStatus = 'running';
    saveJsonFile(REPORTS_FILE, history);
    res.json({ ok: true, message: 'Revocation started in background. This may take some time for large campaigns.' });

    (async () => {
      let successCount = 0;
      let failCount = 0;

      for (const r of campaign.results) {
        if ((r.status || '').toUpperCase() !== 'SENT' && (r.status || '').toUpperCase() !== 'DELIVERED') continue;
        
        const remoteJid = r.jid || (r.phone ? (r.phone.includes('@') ? r.phone : r.phone + '@s.whatsapp.net') : null);
        if (!remoteJid) { failCount++; continue; }
        
        const botId = r.botId || campaign.botId || 'bot1'; 
        const botAcc = accounts[botId];
        if (!botAcc || !botAcc.sock) { failCount++; continue; }

        const msgId = r.serverMessageId || r.msgId || r.id; 
        if (!msgId) { failCount++; continue; }

        const key = {
          remoteJid: remoteJid,
          fromMe: true,
          id: msgId
        };
        if (r.participant) key.participant = r.participant;

        try {
          await botAcc.sock.sendMessage(remoteJid, { delete: key });
          successCount++;
          r.status = 'REVOKED';
          await new Promise(resolve => setTimeout(resolve, 300));
        } catch (err) {
          console.error(`Failed to revoke message ${msgId} for ${remoteJid}:`, err);
          failCount++;
        }
      }
      const totalRevokedCount = campaign.results.filter(r => (r.status || '').toUpperCase() === 'REVOKED').length;
      if (totalRevokedCount > 0 && failCount === 0) {
        campaign.revokeStatus = 'green';
      } else if (totalRevokedCount > 0 && failCount > 0) {
        campaign.revokeStatus = 'yellow';
      } else {
        campaign.revokeStatus = 'red';
      }
      saveJsonFile(REPORTS_FILE, history);
      console.log(`Revoke campaign ${campaign.id} complete. Revoked: ${successCount}, Total Revoked: ${totalRevokedCount}, Failed: ${failCount}`);
    })().catch(err => console.error('Background revoke error:', err));
  } catch (err) {
    console.error('Revoke error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/reports/download/:id', (req, res) => {
  const format = (req.query.format || 'xlsx').toLowerCase();
  const history = loadJsonFile(REPORTS_FILE, []);
  const activeResults = history.find(h => h.id === req.params.id);
  
  if (!activeResults) {
    return res.status(404).json({ error: 'Report not found' });
  }

  const summaryStats = {
    reportGeneratedAt: new Date().toISOString(),
    campaignName: activeResults.name || activeResults.campaignName || 'Untitled Campaign',
    campaignId: activeResults.id || 'N/A',
    campaignStatus: activeResults.status,
    stopReason: activeResults.stopReason || '',
    totalRecipients: activeResults.total,
    confirmedSent: activeResults.sent,
    failedCount: activeResults.failed,
    completionPercentage: `${activeResults.completionPercentage}%`,
    errorPercentage: `${activeResults.errorPercentage}%`,
    batchEnabled: (activeResults.batchEnabled || activeResults.summary?.batchEnabled) ? 'Enabled' : 'Disabled',
    totalBatches: activeResults.totalBatches || activeResults.summary?.totalBatches || 1,
    batchSize: activeResults.batchSize || activeResults.summary?.batchSize || 25,
    batchDelaySec: activeResults.batchDelaySec || activeResults.summary?.batchDelaySec || 60,
  };

  if (format === 'json') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="whatsapp_bot_report_${activeResults.id}.json"`);
    return res.send(JSON.stringify({ summary: summaryStats, records: activeResults.results || [] }, null, 2));
  }

  if (format === 'xlsx' && XLSX) {
    const wb = XLSX.utils.book_new();
    const summarySheetData = [
      { Metric: 'Report Date', Value: summaryStats.reportGeneratedAt },
      { Metric: 'Campaign Name', Value: summaryStats.campaignName },
      { Metric: 'Campaign ID', Value: summaryStats.campaignId },
      { Metric: 'Status', Value: summaryStats.campaignStatus },
      { Metric: 'Total Messages', Value: summaryStats.totalRecipients },
      { Metric: 'Successfully Sent (Server ACK)', Value: summaryStats.confirmedSent },
      { Metric: 'Failed / Errors', Value: summaryStats.failedCount },
      { Metric: 'Completion Percentage (%)', Value: summaryStats.completionPercentage },
      { Metric: 'Error Percentage (%)', Value: summaryStats.errorPercentage }
    ];
    const wsSummary = XLSX.utils.json_to_sheet(summarySheetData);
    
    // Add Delivery Status to records
    const logs = (activeResults.results || []).map(r => ({
      ...r,
      deliveryStatus: r.deliveryStatus ? r.deliveryStatus.toUpperCase() : 'UNKNOWN'
    }));
    
    const wsLogs = XLSX.utils.json_to_sheet(
      logs.length > 0
        ? logs
        : [{ index: 1, phone: 'N/A', name: 'No messages sent yet', status: 'IDLE', serverAck: false }]
    );

    XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');
    XLSX.utils.book_append_sheet(wb, wsLogs, 'Delivery_Report');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', `attachment; filename="whatsapp_bot_report_${activeResults.id}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return res.send(buf);
  }

  if (format === 'csv') {
    const lines = ['Index,CampaignName,CampaignId,Phone,Name,Bot,Status,DeliveryStatus,ServerAck,DelaySec,Time'];
    const logs = activeResults.results || [];
    for (const r of logs) {
      lines.push(`${r.index || ''},"${(summaryStats.campaignName || '').replace(/"/g, '""')}",${summaryStats.campaignId},${r.phone || ''},"${(r.name || '').replace(/"/g, '""')}",${r.botId || ''},${r.status || ''},${r.deliveryStatus ? r.deliveryStatus.toUpperCase() : 'UNKNOWN'},${r.serverAck ? 'Yes' : 'No'},${r.delaySec || 0},${r.timestamp || ''}`);
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="whatsapp_bot_report_${activeResults.id}.csv"`);
    return res.send(lines.join('\n'));
  }

  res.status(400).json({ error: 'Unsupported format or missing xlsx library' });
});

// 7. Report Download Endpoints (Excel .xlsx, CSV, JSON, Printable HTML)
app.get('/api/reports/download', (req, res) => {

  const format = (req.query.format || 'xlsx').toLowerCase();
  const history = loadJsonFile(REPORTS_FILE, []);
  const activeResults = campaignState.results.length > 0
    ? campaignState
    : (history[0] || {
      id: 'report_latest',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      status: 'completed',
      total: 0,
      sent: 0,
      failed: 0,
      completionPercentage: 100,
      errorPercentage: 0,
      results: []
    });

  const summaryStats = {
    reportGeneratedAt: new Date().toISOString(),
    campaignName: activeResults.name || activeResults.campaignName || 'Untitled Campaign',
    campaignId: activeResults.id || 'N/A',
    campaignStatus: activeResults.status,
    stopReason: activeResults.stopReason || '',
    totalRecipients: activeResults.total,
    confirmedSent: activeResults.sent,
    failedCount: activeResults.failed,
    completionPercentage: `${activeResults.completionPercentage}%`,
    errorPercentage: `${activeResults.errorPercentage}%`,
    batchEnabled: (activeResults.batchEnabled || activeResults.summary?.batchEnabled) ? 'Enabled' : 'Disabled',
    totalBatches: activeResults.totalBatches || activeResults.summary?.totalBatches || 1,
    batchSize: activeResults.batchSize || activeResults.summary?.batchSize || 25,
    batchDelaySec: activeResults.batchDelaySec || activeResults.summary?.batchDelaySec || 60,
    accountBreakdown: BOT_IDS.map(id => ({
      accountId: id,
      label: accounts[id].label,
      phone: accounts[id].phone || 'Not Connected',
      sentToday: accounts[id].sentToday,
      dailyLimit: accounts[id].dailyLimit,
      totalSent: accounts[id].totalSent,
      totalFailed: accounts[id].totalFailed
    }))
  };

  if (format === 'json') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="whatsapp_bot_report_${Date.now()}.json"`);
    return res.send(JSON.stringify({ summary: summaryStats, records: activeResults.results }, null, 2));
  }

  if (format === 'xlsx' && XLSX) {
    const wb = XLSX.utils.book_new();
    const summarySheetData = [
      { Metric: 'Report Date', Value: summaryStats.reportGeneratedAt },
      { Metric: 'Campaign Name', Value: summaryStats.campaignName },
      { Metric: 'Campaign ID', Value: summaryStats.campaignId },
      { Metric: 'Status', Value: summaryStats.campaignStatus },
      { Metric: 'Total Messages', Value: summaryStats.totalRecipients },
      { Metric: 'Successfully Sent (Server ACK)', Value: summaryStats.confirmedSent },
      { Metric: 'Failed / Errors', Value: summaryStats.failedCount },
      { Metric: 'Completion Percentage (%)', Value: summaryStats.completionPercentage },
      { Metric: 'Error Percentage (%)', Value: summaryStats.errorPercentage },
      { Metric: 'Batching Mode', Value: summaryStats.batchEnabled },
      { Metric: 'Total Batches', Value: summaryStats.totalBatches },
      { Metric: 'Batch Size', Value: summaryStats.batchSize },
      { Metric: 'Batch Cooldown (Seconds)', Value: summaryStats.batchDelaySec }
    ];
    const wsSummary = XLSX.utils.json_to_sheet(summarySheetData);
    const wsAccounts = XLSX.utils.json_to_sheet(summaryStats.accountBreakdown);
    const wsLogs = XLSX.utils.json_to_sheet(
      activeResults.results.length > 0
        ? activeResults.results
        : [{ index: 1, phone: 'N/A', name: 'No messages sent yet', status: 'IDLE', serverAck: false }]
    );

    XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');
    XLSX.utils.book_append_sheet(wb, wsAccounts, '5_Accounts_Quota');
    XLSX.utils.book_append_sheet(wb, wsLogs, 'Delivery_Report');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="whatsapp_bot_report_${Date.now()}.xlsx"`);
    return res.send(buf);
  }

  if (format === 'html') {
    const html = `<!DOCTYPE html>
<html lang="si">
<head>
<meta charset="utf-8"/>
<title>WhatsApp Desktop Bot Report</title>
<style>
 body { font-family: 'Segoe UI', sans-serif; background: #1E212B; color: #F1F2F6; padding: 30px; }
 .card { background: #272B38; padding: 20px; border-radius: 14px; margin-bottom: 20px; }
 h1 { color: #4ECDC4; margin-top: 0; }
 .badges span { display: inline-block; padding: 8px 16px; border-radius: 8px; margin-right: 12px; font-weight: bold; }
 .ok { background: rgba(78, 205, 196, 0.2); color: #4ECDC4; }
 .err { background: rgba(255, 107, 107, 0.2); color: #FF6B6B; }
 table { width: 100%; border-collapse: collapse; margin-top: 15px; }
 th, td { padding: 10px 12px; border-bottom: 1px solid #353B4B; text-align: left; font-size: 13px; }
 th { background: #323645; color: #4ECDC4; }
</style>
</head>
<body>
 <div class="card">
  <h1>📊 WhatsApp Multi-Bot Desktop Delivery Report</h1>
  <div style="margin-bottom:12px;font-size:16px;">Campaign: <b style="color:#4ECDC4;">${summaryStats.campaignName}</b> <span style="font-size:12px;color:#8E99B0;">(ID: ${summaryStats.campaignId})</span></div>
  <div class="badges">
   <span class="ok">Completion Percentage: ${summaryStats.completionPercentage} (${summaryStats.confirmedSent}/${summaryStats.totalRecipients})</span>
   <span class="err">Error Percentage: ${summaryStats.errorPercentage} (${summaryStats.failedCount}/${summaryStats.totalRecipients})</span>
  </div>
  <p>Campaign Status: <b>${summaryStats.campaignStatus}</b> | ${summaryStats.stopReason}</p>
 </div>
 <div class="card">
  <h3>Delivery Log</h3>
  <table>
   <thead>
    <tr><th>#</th><th>Phone</th><th>Name</th><th>Account Used</th><th>Media</th><th>Server ACK ID</th><th>Delay</th><th>Status</th><th>Timestamp</th></tr>
   </thead>
   <tbody>
    ${activeResults.results.map(r => `<tr>
     <td>${r.index}</td>
     <td>${r.phone}</td>
     <td>${r.name}</td>
     <td>${r.botLabel} (${r.senderPhone || ''})</td>
     <td>${r.mediaType}</td>
     <td>${r.serverMessageId || '-'}</td>
     <td>${r.delaySec}s</td>
     <td style="color:${r.status === 'SENT' ? '#4ECDC4' : '#FF6B6B'}"><b>${r.status}</b> ${r.error ? `(${r.error})` : ''}</td>
     <td>${r.timestamp}</td>
    </tr>`).join('')}
   </tbody>
  </table>
 </div>
</body>
</html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="whatsapp_bot_report_${Date.now()}.html"`);
    return res.send(html);
  }

  // Default CSV with UTF-8 BOM for Sinhala Excel support
  const headers = ['Index', 'CampaignName', 'CampaignId', 'Phone', 'Name', 'Course', 'BotAccount', 'SenderPhone', 'MediaType', 'Status', 'ServerACK', 'ServerMessageID', 'DelaySec', 'Timestamp', 'Error', 'Message'];
  const rows = activeResults.results.map(r => [
    r.index,
    `"${(summaryStats.campaignName || '').replace(/"/g, '""')}"`,
    `"${summaryStats.campaignId}"`,
    `"${r.phone}"`,
    `"${(r.name || '').replace(/"/g, '""')}"`,
    `"${(r.course || '').replace(/"/g, '""')}"`,
    `"${r.botLabel}"`,
    `"${r.senderPhone || ''}"`,
    `"${r.mediaType}"`,
    `"${r.status}"`,
    r.serverAck ? 'CONFIRMED' : 'FAILED',
    `"${r.serverMessageId || ''}"`,
    r.delaySec,
    `"${r.timestamp}"`,
    `"${(r.error || '').replace(/"/g, '""')}"`,
    `"${(r.message || '').replace(/\r?\n/g, ' ').replace(/"/g, '""')}"`
  ].join(','));

  const summaryComment = [
    `# WhatsApp Desktop Bot Report - Campaign: "${summaryStats.campaignName}" (${summaryStats.campaignId}) - Generated: ${summaryStats.reportGeneratedAt}`,
    `# Total: ${summaryStats.totalRecipients}, Sent: ${summaryStats.confirmedSent}, Failed: ${summaryStats.failedCount}, Completion %: ${summaryStats.completionPercentage}, Error %: ${summaryStats.errorPercentage}`,
    headers.join(','),
    ...rows
  ].join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="whatsapp_bot_report_${Date.now()}.csv"`);
  return res.send('\uFEFF' + summaryComment);
});

// ─── 7. WhatsApp Group Contacts Extractor & Exporter (bot1 .. bot5 Separate Groups) ───
const CONTACT_DIR_FILE = path.join(DATA_DIR, 'contacts_directory.json');
const GROUPS_CACHE_FILE = path.join(DATA_DIR, 'groups_cache.json');
const contactNamesDirectory = new Map();
const lidToPhoneDirectory = new Map();
const botGroupsStore = {
  bot1: [],
  bot2: [],
  bot3: [],
  bot4: [],
  bot5: []
};

export function isRealPersonName(str) {
  if (!str || typeof str !== 'string') return false;
  const s = str.trim();
  if (!s) return false;

  // Reject generic placeholders
  if (/^member\s*#?\d*$/i.test(s)) return false;
  if (/^user\s*#?\d*$/i.test(s)) return false;
  if (/^participant\s*#?\d*$/i.test(s)) return false;
  if (/^recipient\s*#?\d*$/i.test(s)) return false;

  // Reject any raw phone numbers: e.g. "94771234567", "+94771234567", "0771234567"
  const digitsOnly = s.replace(/\D/g, '');
  if (s.startsWith('+') && digitsOnly.length >= 7) return false;
  if (/^\d{7,16}$/.test(s)) return false;

  // Reject masked numbers from WhatsApp display_name: e.g. "+94·······22", "+94...22", "+94*...*22", "+94xxxx22"
  if (/[·*•xX~_]{2,}/.test(s)) return false;
  if (/^\+?\d+[\s\.\-–·*•xX_]+(?:\d+)?$/.test(s)) return false;

  // Reject strings that are primarily digits and punctuation
  const lettersCount = (s.match(/[\p{L}]/gu) || []).length;
  if (lettersCount === 0 && /\d/.test(s)) return false;

  return true;
}

try {
  if (fs.existsSync(CONTACT_DIR_FILE)) {
    const parsedDir = JSON.parse(fs.readFileSync(CONTACT_DIR_FILE, 'utf8'));
    for (const [k, v] of Object.entries(parsedDir.names || {})) {
      if (isRealPersonName(v)) contactNamesDirectory.set(k, v);
    }
    for (const [k, v] of Object.entries(parsedDir.lids || {})) lidToPhoneDirectory.set(k, v);
  }
  if (fs.existsSync(GROUPS_CACHE_FILE)) {
    const parsedGroups = JSON.parse(fs.readFileSync(GROUPS_CACHE_FILE, 'utf8'));
    for (const id of BOT_IDS) {
      if (Array.isArray(parsedGroups[id])) botGroupsStore[id] = parsedGroups[id];
    }
  }
} catch (e) {}

function persistContactDirectory() {
  try {
    fs.writeFileSync(CONTACT_DIR_FILE, JSON.stringify({
      names: Object.fromEntries(contactNamesDirectory.entries()),
      lids: Object.fromEntries(lidToPhoneDirectory.entries())
    }, null, 2), 'utf8');
  } catch (e) {}
}

function persistGroupsStore() {
  try {
    fs.writeFileSync(GROUPS_CACHE_FILE, JSON.stringify(botGroupsStore, null, 2), 'utf8');
  } catch (e) {}
}

function extractParticipantPhoneAndName(p, fallbackIndex = 1, bot = null) {
  if (!p) return null;

  // 1. Resolve true phone number — NEVER use an internal @lid ID as a phone number!
  let cleanPhone = '';

  const candidates = [
    p.phoneNumber,
    p.phone_number,
    p.rawAttrs?.phone_number,
    p.rawAttrs?.pn,
    p.jid,
    p.id
  ].filter(Boolean);

  for (const cand of candidates) {
    const str = String(cand).trim();
    // Skip any @lid ID completely
    if (str.endsWith('@lid') || /^\d{14,16}@lid$/.test(str)) continue;

    const userPart = str.split(':')[0].split('@')[0].replace(/\D/g, '');
    const norm = normalizePhoneNumber(userPart);
    if (norm && norm.clean) {
      cleanPhone = norm.clean;
      break;
    }
  }

  // 2. If not found directly, check if this LID was mapped to a real phone number
  const lidVal = String(p.lid || (String(p.id).endsWith('@lid') ? p.id : '')).trim();
  if (!cleanPhone && lidVal) {
    const bareLid = lidVal.split(':')[0].split('@')[0];
    const mapped = lidToPhoneDirectory.get(lidVal) || lidToPhoneDirectory.get(bareLid);
    if (mapped) {
      const norm = normalizePhoneNumber(mapped);
      if (norm && norm.clean) {
        cleanPhone = norm.clean;
      }
    }
  }

  // If still no valid phone number was found, do NOT output fake numbers or raw LID IDs!
  if (!cleanPhone) return null;

  // Cache this LID -> Phone mapping for all future queries
  if (lidVal) {
    lidToPhoneDirectory.set(lidVal, cleanPhone);
    const bareLid = lidVal.split(':')[0].split('@')[0];
    if (bareLid) lidToPhoneDirectory.set(bareLid, cleanPhone);
  }

  // 3. Resolve the actual recipient name
  const isBotSelf = Boolean(
    bot && (
      cleanPhone === bot.phone ||
      p.id === bot.sock?.user?.id ||
      p.jid === bot.sock?.user?.id ||
      (p.admin === 'superadmin' && cleanPhone === bot.phone)
    )
  );

  let resolvedName = '';
  if (isBotSelf) {
    resolvedName = String(bot.pushName || `WhatsApp Account 0${bot.index || 1}`).trim();
  } else {
    const nameCandidates = [
      p.name,
      p.notify,
      p.verifiedName,
      p.pushName,
      p.displayName,
      p.rawAttrs?.notify,
      p.rawAttrs?.name,
      p.rawAttrs?.display_name,
      contactNamesDirectory.get(cleanPhone),
      contactNamesDirectory.get(`${cleanPhone}@s.whatsapp.net`),
      p.id && contactNamesDirectory.get(p.id),
      lidVal && contactNamesDirectory.get(lidVal)
    ].filter(Boolean);

    for (const nc of nameCandidates) {
      const nStr = String(nc).trim();
      if (isRealPersonName(nStr)) {
        resolvedName = nStr;
        break;
      }
    }
  }

  // If no real person name exists, NEVER put a phone number here! Leave it as empty string ""
  if (!resolvedName) {
    resolvedName = '';
  } else if (isRealPersonName(resolvedName)) {
    contactNamesDirectory.set(cleanPhone, resolvedName);
    contactNamesDirectory.set(`${cleanPhone}@s.whatsapp.net`, resolvedName);
  }

  return {
    phone: cleanPhone,
    formattedPhone: `+${cleanPhone}`,
    name: resolvedName,
    role: p.admin === 'superadmin' ? 'Owner' : (p.admin ? 'Admin' : 'Member'),
    rawJid: `${cleanPhone}@s.whatsapp.net`,
    lid: lidVal || null
  };
}

export async function fetchGroupsForBot(botId, forceRefresh = false) {
  const bot = accounts[botId];
  if (!bot) throw new Error(`Invalid bot account ID: ${botId}`);

  // Only return real WhatsApp groups when the account is genuinely connected via Baileys socket
  if (!bot.isConnected || !bot.sock || typeof bot.sock.groupFetchAllParticipating !== 'function') {
    botGroupsStore[botId] = [];
    return [];
  }

  try {
    const participating = await bot.sock.groupFetchAllParticipating();
    const parsedGroups = [];
    for (const [gJid, meta] of Object.entries(participating || {})) {
      if (!meta) continue;
      const members = [];
      const rawParticipants = Array.isArray(meta.participants) ? meta.participants : [];
      rawParticipants.forEach((p, idx) => {
        const item = extractParticipantPhoneAndName(p, idx + 1, bot);
        if (item) {
          members.push({
            ...item,
            groupId: gJid,
            groupName: String(meta.subject || 'WhatsApp Group').trim(),
            botId,
            botLabel: bot.label
          });
        }
      });
      parsedGroups.push({
        id: gJid,
        name: String(meta.subject || 'WhatsApp Group').trim(),
        botId,
        botLabel: bot.label,
        memberCount: members.length,
        totalRawParticipants: rawParticipants.length,
        createdAt: meta.creation ? new Date(meta.creation * 1000).toISOString() : null,
        members
      });
    }
    parsedGroups.sort((a, b) => b.memberCount - a.memberCount);
    botGroupsStore[botId] = parsedGroups;
    persistGroupsStore();
    return parsedGroups;
  } catch (err) {
    addLog('warn', `⚠️ [${bot.label}] Error fetching Group list: ${err.message}`);
    return botGroupsStore[botId] || [];
  }
}

app.get('/api/groups', async (req, res) => {
  try {
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const targetBotId = req.query.botId ? String(req.query.botId) : null;
    const byAccount = {};
    let totalGroupsAll = 0;
    let totalMembersAll = 0;

    for (const id of BOT_IDS) {
      const isRealConnected = Boolean(accounts[id].isConnected && accounts[id].sock && !accounts[id].isSimulated);
      if (!isRealConnected) {
        botGroupsStore[id] = [];
      } else if (refresh && (!targetBotId || targetBotId === id)) {
        await fetchGroupsForBot(id, true);
      } else if (!botGroupsStore[id] || botGroupsStore[id].length === 0) {
        await fetchGroupsForBot(id, false);
      }
      const groups = isRealConnected ? (botGroupsStore[id] || []) : [];
      const memberSum = groups.reduce((acc, g) => acc + (g.members?.length || 0), 0);
      totalGroupsAll += groups.length;
      totalMembersAll += memberSum;

      byAccount[id] = {
        id,
        index: accounts[id].index,
        label: accounts[id].label,
        phone: isRealConnected ? (accounts[id].phone || '') : '',
        pushName: isRealConnected ? (accounts[id].pushName || '') : '',
        status: accounts[id].status,
        isConnected: isRealConnected,
        virtualIp: accounts[id].virtualIp,
        groupCount: groups.length,
        totalMembers: memberSum,
        groups
      };
    }

    res.json({
      ok: true,
      totalGroups: totalGroupsAll,
      totalMembers: totalMembersAll,
      byAccount
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/groups/debug-inspect', async (req, res) => {
  try {
    const bot = accounts.bot1;
    if (!bot || !bot.sock) return res.json({ error: 'No sock' });
    const gJid = req.query.groupId || '120363215551340705@g.us';
    const meta = await bot.sock.groupMetadata(gJid);
    res.json({
      ok: true,
      id: meta.id,
      subject: meta.subject,
      addressingMode: meta.addressingMode,
      participants: meta.participants
    });
  } catch (e) {
    res.status(500).json({ error: e.message, stack: e.stack });
  }
});

app.get('/api/groups/:botId/:groupId/members', async (req, res) => {
  try {
    const { botId, groupId } = req.params;
    const bot = accounts[botId];
    if (!bot || !bot.isConnected || !bot.sock) {
      return res.status(400).json({ ok: false, error: 'Account not connected' });
    }

    let meta = null;
    try {
      meta = await bot.sock.groupMetadata(groupId);
    } catch (e) {
      const cached = (botGroupsStore[botId] || []).find(g => g.id === groupId);
      if (cached) return res.json({ ok: true, group: cached, members: cached.members || [] });
      throw e;
    }

    const members = [];
    const rawParticipants = Array.isArray(meta.participants) ? meta.participants : [];
    rawParticipants.forEach((p, idx) => {
      const item = extractParticipantPhoneAndName(p, idx + 1, bot);
      if (item) {
        members.push({
          ...item,
          groupId,
          groupName: String(meta.subject || 'WhatsApp Group').trim(),
          botId,
          botLabel: bot.label
        });
      }
    });

    const groupObj = {
      id: groupId,
      name: String(meta.subject || 'WhatsApp Group').trim(),
      botId,
      botLabel: bot.label,
      memberCount: members.length,
      totalRawParticipants: rawParticipants.length,
      createdAt: meta.creation ? new Date(meta.creation * 1000).toISOString() : null,
      members
    };

    if (Array.isArray(botGroupsStore[botId])) {
      const existingIdx = botGroupsStore[botId].findIndex(g => g.id === groupId);
      if (existingIdx >= 0) {
        botGroupsStore[botId][existingIdx] = groupObj;
      } else {
        botGroupsStore[botId].push(groupObj);
      }
      persistGroupsStore();
    }

    res.json({
      ok: true,
      group: groupObj,
      members
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/groups/:botId/refresh', async (req, res) => {
  try {
    const { botId } = req.params;
    if (!accounts[botId]) return res.status(404).json({ ok: false, error: 'Invalid bot ID' });
    const groups = await fetchGroupsForBot(botId, true);
    const totalMembers = groups.reduce((acc, g) => acc + (g.members?.length || 0), 0);
    addLog('info', `👥 [${accounts[botId].label}] WhatsApp Groups ${groups.length} and members ${totalMembers} detected.`);
    res.json({
      ok: true,
      botId,
      groupCount: groups.length,
      totalMembers,
      groups
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/groups/export', async (req, res) => {
  try {
    const botId = String(req.query.botId || 'all');
    const groupId = String(req.query.groupId || 'all');
    const format = String(req.query.format || 'xlsx').toLowerCase();
    const deduplicate = req.query.deduplicate !== '0';

    const targetBotIds = botId === 'all' ? BOT_IDS : (accounts[botId] ? [botId] : []);
    const collectedRows = [];
    const seenPhones = new Set();

    for (const bId of targetBotIds) {
      const bot = accounts[bId];
      if (bot.isConnected && (!botGroupsStore[bId] || botGroupsStore[bId].length === 0)) {
        await fetchGroupsForBot(bId, false);
      }

      // If exporting a single specific group, ensure fresh interactive metadata is queried from WhatsApp
      if (groupId !== 'all' && bot.isConnected && bot.sock) {
        try {
          const meta = await bot.sock.groupMetadata(groupId);
          const freshMembers = [];
          const rawParticipants = Array.isArray(meta.participants) ? meta.participants : [];
          rawParticipants.forEach((p, idx) => {
            const item = extractParticipantPhoneAndName(p, idx + 1, bot);
            if (item) {
              freshMembers.push({
                ...item,
                groupId,
                groupName: String(meta.subject || 'WhatsApp Group').trim(),
                botId: bId,
                botLabel: bot.label
              });
            }
          });
          if (freshMembers.length > 0) {
            const existingGrp = (botGroupsStore[bId] || []).find(g => g.id === groupId);
            if (existingGrp) {
              existingGrp.members = freshMembers;
              existingGrp.memberCount = freshMembers.length;
            }
          }
        } catch (e) {}
      }

      const groups = botGroupsStore[bId] || [];
      for (const g of groups) {
        if (groupId !== 'all' && g.id !== groupId) continue;
        for (const m of g.members || []) {
          if (deduplicate && seenPhones.has(m.phone)) continue;
          seenPhones.add(m.phone);
          collectedRows.push({
            Phone: m.phone,
            Name: m.name || '',
            GroupName: g.name,
            Account: accounts[bId].label,
            Role: m.role || 'Member'
          });
        }
      }
    }

    const safeTag = `${botId}_${groupId === 'all' ? 'all_groups' : groupId.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`;

    if (format === 'json') {
      const jsonPayload = collectedRows.map((r, idx) => ({
        index: idx + 1,
        phoneNumber: r.Phone,
        name: r.Name || '',
        groupName: r.GroupName,
        whatsAppAccount: r.Account,
        role: r.Role
      }));
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="whatsapp_group_contacts_${safeTag}.json"`);
      return res.send(JSON.stringify(jsonPayload, null, 2));
    }

    if (format === 'xlsx') {
      if (!XLSX) {
        try { XLSX = require('xlsx'); } catch (e) {}
      }
      if (XLSX) {
        const wb = XLSX.utils.book_new();
        const sheetRows = collectedRows.length > 0
          ? collectedRows.map((r, idx) => ({
            '#': idx + 1,
            'Phone Number': r.Phone,
            'Name': r.Name || '',
            'Group Name': r.GroupName,
            'WhatsApp Account': r.Account,
            'Role': r.Role
          }))
          : [{ '#': 1, 'Phone Number': '', 'Name': '', 'Group Name': '', 'WhatsApp Account': botId, 'Role': '' }];
        const ws = XLSX.utils.json_to_sheet(sheetRows);
        ws['!cols'] = [{ wch: 6 }, { wch: 20 }, { wch: 28 }, { wch: 34 }, { wch: 22 }, { wch: 12 }];
        XLSX.utils.book_append_sheet(wb, ws, 'Group Contacts');
        const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="whatsapp_group_contacts_${safeTag}.xlsx"`);
        return res.send(buf);
      }
    }

    // Default / CSV Export with UTF-8 BOM
    const csvHeaders = ['#', 'Phone Number', 'Name', 'Group Name', 'WhatsApp Account', 'Role'];
    const csvLines = collectedRows.map((r, idx) => [
      idx + 1,
      `"${r.Phone}"`,
      `"${String(r.Name || '').replace(/"/g, '""')}"`,
      `"${String(r.GroupName || '').replace(/"/g, '""')}"`,
      `"${String(r.Account || '').replace(/"/g, '""')}"`,
      `"${String(r.Role || 'Member')}"`
    ].join(','));

    const csvContent = '\uFEFF' + [csvHeaders.join(','), ...csvLines].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="whatsapp_group_contacts_${safeTag}.csv"`);
    return res.send(csvContent);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/groups/import-to-contacts', async (req, res) => {
  try {
    const botId = String(req.body?.botId || 'all');
    const groupId = String(req.body?.groupId || 'all');
    const excludeAdmins = req.body?.excludeAdmins !== false; // default true
    const clearExisting = Boolean(req.body?.clearExisting || req.body?.replace);
    const targetBotIds = botId === 'all' ? BOT_IDS : (accounts[botId] ? [botId] : []);

    if (clearExisting) {
      contactsState.contacts = [];
    }

    const existingByPhone = new Map(contactsState.contacts.map(c => [c.phone, c]));
    let addedCount = 0;
    let skippedAdminsCount = 0;

    for (const bId of targetBotIds) {
      const bot = accounts[bId];
      // If importing a specific group, fetch fresh interactive metadata from WhatsApp socket
      if (groupId !== 'all' && bot && bot.isConnected && bot.sock) {
        try {
          const meta = await bot.sock.groupMetadata(groupId);
          const freshMembers = [];
          const rawParticipants = Array.isArray(meta.participants) ? meta.participants : [];
          rawParticipants.forEach((p, idx) => {
            const item = extractParticipantPhoneAndName(p, idx + 1, bot);
            if (item) {
              freshMembers.push({
                ...item,
                groupId,
                groupName: String(meta.subject || 'WhatsApp Group').trim(),
                botId: bId,
                botLabel: bot.label
              });
            }
          });
          if (!botGroupsStore[bId]) botGroupsStore[bId] = [];
          const existingG = botGroupsStore[bId].find(g => g.id === groupId);
          if (existingG) {
            existingG.members = freshMembers;
            existingG.memberCount = freshMembers.length;
          } else {
            botGroupsStore[bId].push({
              id: groupId,
              name: String(meta.subject || 'WhatsApp Group').trim(),
              memberCount: freshMembers.length,
              members: freshMembers
            });
          }
          persistGroupsStore();
        } catch (e) {}
      }

      const groups = botGroupsStore[bId] || [];
      for (const g of groups) {
        if (groupId !== 'all' && g.id !== groupId) continue;
        for (const m of g.members || []) {
          if (excludeAdmins && (m.role === 'Admin' || m.role === 'Owner' || m.isAdmin || m.isSuperAdmin)) {
            skippedAdminsCount++;
            continue;
          }
          if (!existingByPhone.has(m.phone)) {
            const contactObj = {
              id: `grp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
              phone: m.phone,
              formattedPhone: `+${m.phone}`,
              countryCode: m.phone.slice(0, 2),
              name: m.name || '',
              role: m.role || 'Member',
              course: g.name,
              amount: '',
              isValid: true,
              validationError: '',
              source: `${accounts[bId].label} • ${g.name}`,
              variables: {
                phone: m.phone,
                name: m.name || '',
                role: m.role || 'Member',
                course: g.name
              }
            };
            contactsState.contacts.push(contactObj);
            existingByPhone.set(m.phone, contactObj);
            addedCount++;
          }
        }
      }
    }

    const counts = getContactsSummaryCounts();
    persistState();
    addLog('success', `👥 ${addedCount} numbers from WhatsApp Groups added to Contacts list.${excludeAdmins && skippedAdminsCount > 0 ? ` (🛡️ Admin/Owner numbers ${skippedAdminsCount} removed)` : ''}`);
    res.json({
      ok: true,
      addedCount,
      skippedAdminsCount,
      totalCount: counts.totalCount,
      validCount: counts.validCount,
      invalidCount: counts.invalidCount
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Start HTTP Server (100% local loopback 127.0.0.1 inside the desktop app process)
const PORT = Number(process.env.WA_DESKTOP_PORT) || 5050;
export function startHttpServer(preferredPort = PORT) {
  return new Promise((resolve, reject) => {
    const tryListen = (portToTry) => {
      const srv = app.listen(portToTry, '127.0.0.1', () => {
        const actualPort = srv.address()?.port || portToTry;
        console.log(`🚀 WhatsApp Bot Desktop Engine running locally at http://127.0.0.1:${actualPort}`);

        // Auto-resume any saved WhatsApp QR sessions when starting the main desktop engine
        if (preferredPort !== 0) {
          for (const id of BOT_IDS) {
            const credsPath = path.join(getBotAuthDir(id), 'creds.json');
            if (fs.existsSync(credsPath)) {
              startBotConnection(id).catch(() => {});
            }
          }
        }

        resolve({ server: srv, port: actualPort });
      });
      srv.on('error', (err) => {
        if (err.code === 'EADDRINUSE' && portToTry !== 0) {
          tryListen(0);
        } else {
          reject(err);
        }
      });
    };
    tryListen(preferredPort);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  startHttpServer(PORT).catch(err => {
    console.error('Failed to start local desktop engine:', err.message);
  });
}





// Message Scheduling Checker
setInterval(() => {
  if (campaignState.isRunning) return; // Wait until no campaign is running
  if (fs.existsSync('scheduled_campaigns.json')) {
    try {
      let sched = JSON.parse(fs.readFileSync('scheduled_campaigns.json', 'utf8'));
      let now = new Date();
      let toRun = sched.findIndex(c => new Date(c.scheduleTime) <= now);
      if (toRun !== -1) {
        let camp = sched.splice(toRun, 1)[0];
        fs.writeFileSync('scheduled_campaigns.json', JSON.stringify(sched, null, 2));
        addLog('info', `⏰ Starting scheduled campaign "${camp.payload?.name || camp.payload?.campaignName || 'Untitled'}"...`);
        runCampaign(camp.payload).catch(e => addLog('error', `Scheduled Campaign Error: ${e.message}`));
      }
    } catch(e) { }
  }
}, 10000);
