const { app, BrowserWindow, shell, session, ipcMain } = require('electron');
const path = require('path');

if (require('electron-squirrel-startup')) {
    app.quit();
}

const isSafeExternalUrl = (url) => {
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'https:';
    } catch {
        return false;
    }
};

const createWindow = () => {
    const mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        show: false,
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
            allowRunningInsecureContent: false,
            devTools: !app.isPackaged,
        },
    });

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    if (app.isPackaged) {
        const indexPath = path.join(__dirname, '..', 'dist', 'index.html');
        mainWindow.loadFile(indexPath);
    } else {
        const devServer = process.env.VITE_DEV_SERVER_URL || 'http://localhost:3000';
        mainWindow.loadURL(devServer);
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    }

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (isSafeExternalUrl(url)) shell.openExternal(url);
        return { action: 'deny' };
    });

    mainWindow.webContents.on('will-navigate', (event, url) => {
        const currentUrl = mainWindow.webContents.getURL();
        if (url !== currentUrl) {
            event.preventDefault();
        }
    });
};


ipcMain.handle('codedumper:local-llm-request', async (_event, payload) => {
    const url = String(payload?.url || '');
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        return { ok: false, status: 400, statusText: 'Bad Request', headers: {}, text: 'Invalid URL.' };
    }

    const host = parsed.hostname.toLowerCase();
    const isAllowedHost =
        host === '127.0.0.1' ||
        host === 'localhost' ||
        host === '::1' ||
        /^192\.168\./.test(host) ||
        /^10\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);

    if (!['http:', 'https:'].includes(parsed.protocol) || !isAllowedHost) {
        return {
            ok: false,
            status: 403,
            statusText: 'Forbidden',
            headers: {},
            text: 'CodeDumper only proxies local/private-network LLM endpoints.',
        };
    }

    try {
        const response = await fetch(url, {
            method: payload?.method || 'GET',
            headers: payload?.headers || {},
            body: payload?.body,
        });
        const headers = {};
        response.headers.forEach((value, key) => {
            headers[key] = value;
        });
        return {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            headers,
            text: await response.text(),
        };
    } catch (error) {
        return {
            ok: false,
            status: 599,
            statusText: 'Network Error',
            headers: {},
            text: error instanceof Error ? error.message : String(error),
        };
    }
});


app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
        callback(false);
    });

    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': [
                    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' http://localhost:3000 ws://localhost:3000 http://127.0.0.1:1234 http://localhost:1234 http://192.168.178.62:1234; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none';"
                ],
                'X-Content-Type-Options': ['nosniff'],
                'Referrer-Policy': ['no-referrer'],
            },
        });
    });

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
