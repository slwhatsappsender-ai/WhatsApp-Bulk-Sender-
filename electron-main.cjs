const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

let mainWindow = null;
let localServerInstance = null;

// Enforce single instance: prevent multiple simultaneous logins/instances on one device
const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
    console.log('[Single Device / Instance] Another instance is already running. Quitting.');
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });
}

// Set an isolated, clean local userData path inside D:\whatsapp bot\data\electron_profile
const profileDir = path.join(app.getPath('userData'), 'electron_profile');
try {
    if (!fs.existsSync(profileDir)) {
        fs.mkdirSync(profileDir, { recursive: true });
    }
    app.setPath('userData', profileDir);
} catch (e) {}

// Bypass Windows/System Proxy settings for local loopback 127.0.0.1 so Chromium never throws ERR_FAILED (-2)
app.commandLine.appendSwitch('no-proxy-server');
app.commandLine.appendSwitch('proxy-bypass-list', '<local>;localhost;127.0.0.1;::1');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

function checkLoopbackHealth(port, timeoutMs = 1500) {
    return new Promise((resolve) => {
        const req = http.get(
            {
                host: '127.0.0.1',
                port,
                path: '/api/state',
                agent: false,
                timeout: timeoutMs
            },
            (res) => {
                let raw = '';
                res.on('data', (chunk) => { raw += chunk; });
                res.on('end', () => {
                    if (res.statusCode === 200 && raw.includes('"accounts"')) {
                        resolve(true);
                    } else {
                        resolve(false);
                    }
                });
            }
        );
        req.on('error', () => resolve(false));
        req.on('timeout', () => {
            req.destroy();
            resolve(false);
        });
    });
}

async function waitForServerReady(port, maxAttempts = 120) {
    for (let i = 0; i < maxAttempts; i++) {
        const ok = await checkLoopbackHealth(port, 1200);
        if (ok) return true;
        await new Promise((r) => setTimeout(r, 1000));
    }
    return false;
}

async function createDesktopWindow() {
    
    process.env.WA_BOT_STORAGE_ROOT = app.getPath('userData');
    console.log('--- STARTING DESKTOP WINDOW ---');

    let activePort = 5050;
    const existingHealthyOn5050 = await checkLoopbackHealth(5050, 1000);
    
    if (!existingHealthyOn5050) {
        try {
            const serverModuleUrl = require('url').pathToFileURL(path.join(__dirname, 'server.js')).href;
            const { startHttpServer } = await import(serverModuleUrl);
            const { server, port } = await startHttpServer(5050);
            localServerInstance = server;
            activePort = port;
        } catch (e) {
            console.error('SERVER START ERROR:', e.message);
            console.error(e.stack);
        }
    }

    const ready = await waitForServerReady(activePort, 120);

    mainWindow = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1120,
        minHeight: 740,
        title: 'WA Bot Pro - Standalone Multi-Account WhatsApp Desktop Software',
        icon: path.join(__dirname, 'icon.ico'),
        backgroundColor: '#14161D',
        autoHideMenuBar: true,
        show: true,
        center: true,
        frame: false,
        transparent: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.cjs'),
            backgroundThrottling: false
        }
    });

        mainWindow.setMenuBarVisibility(false);

    // Open external links (like Stripe Checkout) safely in user's default browser
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http://') || url.startsWith('https://')) {
            shell.openExternal(url);
            return { action: 'deny' };
        }
        return { action: 'allow' };
    });

    // Force direct connection (no system proxy) inside Electron webContents session
    try {
        await mainWindow.webContents.session.setProxy({
            mode: 'direct',
            proxyBypassRules: '<local>,127.0.0.1,localhost,[::1]'
        });
    } catch (e) {}

    const reportsDir = path.join(app.getPath('userData'), 'reports');
    if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

    mainWindow.webContents.session.on('will-download', (event, item) => {
        const defaultSavePath = path.join(reportsDir, item.getFilename());
        item.setSaveDialogOptions({
            title: 'Save WhatsApp Bot Report',
            defaultPath: defaultSavePath
        });
    });

    const targetUrl = `http://127.0.0.1:${activePort}`;
    let loadedOk = false;

    for (let attempt = 1; attempt <= 3 && !loadedOk; attempt++) {
        try {
            await mainWindow.loadURL(targetUrl);
            loadedOk = true;
        } catch (err) {
            await new Promise((r) => setTimeout(r, 300));
        }
    }

    if (!loadedOk && mainWindow && !mainWindow.isDestroyed()) {
        try {
            await mainWindow.loadFile(path.join(__dirname, 'public', 'index.html'), {
                query: { apiBase: targetUrl }
            });
            loadedOk = true;
        } catch (fileErr) {
            console.error('Fallback loadFile error:', fileErr);
        }
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}


ipcMain.on('open-external', (event, url) => {
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
        shell.openExternal(url);
    }
});

ipcMain.on('window-minimize', () => { if(mainWindow) mainWindow.minimize(); });
ipcMain.on('window-maximize', () => { 
    if(mainWindow) {
        if(mainWindow.isMaximized()) mainWindow.unmaximize();
        else mainWindow.maximize();
    }
});
ipcMain.on('window-close', () => { if(mainWindow) mainWindow.close(); });

app.whenReady().then(() => {
    createDesktopWindow().catch((err) => {
        console.error('WA Bot Pro Startup Warning:', err);
    });
});


app.on('browser-window-created', (event, window) => {
    window.setIcon(path.join(__dirname, 'icon.ico'));
    // Optionally remove menu bar for child windows
    window.setMenuBarVisibility(false);
});

app.on('window-all-closed', () => {
    if (localServerInstance) {
        try { localServerInstance.close(); } catch (e) {}
    }
    app.quit();
});



