const fs = require('fs');
const path = require('path');
const https = require('https');

const OWNER = 'slwhatsappsender-ai';
const REPO = 'WhatsApp-Bulk-Sender-';
const TAG = 'v3.0.0';
const RELEASE_NAME = 'WhatsApp Bot Desktop PRO v3.0.0';
const EXE_PATH = path.join(__dirname, 'dist', 'whatsapp-bot-desktop-pro Setup 3.0.0.exe');
const ASSET_NAME = 'whatsapp-bot-desktop-pro.Setup.3.0.0.exe';

const TOKEN = process.env.GITHUB_TOKEN || process.argv[2];

if (!TOKEN) {
  console.error('\n[ERROR] GitHub Personal Access Token is required!');
  console.error('Usage: node upload_release.cjs <YOUR_GITHUB_TOKEN>');
  console.error('Or set $env:GITHUB_TOKEN = "<TOKEN>"\n');
  process.exit(1);
}

if (!fs.existsSync(EXE_PATH)) {
  console.error(`[ERROR] File not found: ${EXE_PATH}`);
  process.exit(1);
}

const stats = fs.statSync(EXE_PATH);
const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
console.log(`\n📦 Found Installer: ${ASSET_NAME} (${fileSizeMB} MB)`);
console.log(`🚀 Target: https://github.com/${OWNER}/${REPO}/releases/tag/${TAG}\n`);

function request(options, data) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve({ status: res.statusCode, data: json, headers: res.headers });
        } catch(e) {
          resolve({ status: res.statusCode, raw: body, headers: res.headers });
        }
      });
    });
    req.on('error', reject);
    if (data) {
      if (typeof data.pipe === 'function') {
        data.pipe(req);
        return;
      } else {
        req.write(data);
      }
    }
    req.end();
  });
}

async function main() {
  try {
    console.log('1. Checking or creating GitHub Release...');
    const releasePayload = JSON.stringify({
      tag_name: TAG,
      target_commitish: 'main',
      name: RELEASE_NAME,
      body: 'Official production release of WhatsApp Bot Desktop PRO v3.0.0 for Windows 10/11 (64-bit).\n\n- Multi-Bot Round-Robin rotation\n- Anti-ban cooldown & batching\n- Multimedia, Voice Notes & Stickers\n- Delivery analytics & Live Phone Preview',
      draft: false,
      prerelease: false
    });

    const createRes = await request({
      hostname: 'api.github.com',
      path: `/repos/${OWNER}/${REPO}/releases`,
      method: 'POST',
      headers: {
        'User-Agent': 'WhatsApp-Bot-Desktop-Uploader',
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github+json'
      }
    }, releasePayload);

    let releaseId = null;
    let uploadUrl = null;

    if (createRes.status === 201) {
      console.log(`✅ Release created successfully! (ID: ${createRes.data.id})`);
      releaseId = createRes.data.id;
      uploadUrl = createRes.data.upload_url;
    } else if (createRes.status === 422) {
      console.log('ℹ️ Release tag already exists. Fetching existing release...');
      const getRes = await request({
        hostname: 'api.github.com',
        path: `/repos/${OWNER}/${REPO}/releases/tags/${TAG}`,
        method: 'GET',
        headers: {
          'User-Agent': 'WhatsApp-Bot-Desktop-Uploader',
          'Authorization': `Bearer ${TOKEN}`,
          'Accept': 'application/vnd.github+json'
        }
      });
      if (getRes.status === 200) {
        releaseId = getRes.data.id;
        uploadUrl = getRes.data.upload_url;
        console.log(`✅ Found existing release (ID: ${releaseId})`);
      } else {
        throw new Error(`Failed to fetch release: ${JSON.stringify(getRes.data)}`);
      }
    } else {
      throw new Error(`Failed to create release (HTTP ${createRes.status}): ${JSON.stringify(createRes.data)}`);
    }

    // Clean clean upload URL
    const cleanUploadUrl = uploadUrl.split('{')[0];
    const urlObj = new URL(cleanUploadUrl);
    urlObj.searchParams.set('name', ASSET_NAME);

    console.log(`2. Uploading ${ASSET_NAME} (${fileSizeMB} MB) to GitHub CDN...`);
    console.log('   Please wait, uploading...');

    const fileStream = fs.createReadStream(EXE_PATH);
    const uploadRes = await request({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'User-Agent': 'WhatsApp-Bot-Desktop-Uploader',
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/octet-stream',
        'Content-Length': stats.size,
        'Accept': 'application/vnd.github+json'
      }
    }, fileStream);

    if (uploadRes.status === 201) {
      console.log(`\n🎉 SUCCESS! Upload Complete!`);
      console.log(`Direct Download Link:`);
      console.log(`https://github.com/${OWNER}/${REPO}/releases/download/${TAG}/${ASSET_NAME}`);
      console.log(`\nRelease Page:`);
      console.log(`https://github.com/${OWNER}/${REPO}/releases/tag/${TAG}`);
    } else {
      throw new Error(`Upload failed (HTTP ${uploadRes.status}): ${JSON.stringify(uploadRes.data)}`);
    }

  } catch(err) {
    console.error('\n❌ ERROR:', err.message);
    process.exit(1);
  }
}

main();
