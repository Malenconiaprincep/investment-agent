import { app, BrowserWindow, dialog, globalShortcut, Menu, shell } from 'electron';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

let mainWindow = null;
let agentChild = null;
let webChild = null;
let agentPort = 4010;
let webPort = 3010;

function resolvePackDir(name) {
  if (isDev) {
    return path.join(__dirname, '..', '.pack', name);
  }
  return path.join(process.resourcesPath, name);
}

function resolveResourcesPath() {
  if (isDev) {
    return path.join(__dirname, '..', 'templates', '..');
  }
  return process.resourcesPath;
}

function ensureActiveEnvFile(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const activeEnvPath = path.join(dataDir, 'active.env');
  if (!existsSync(activeEnvPath)) {
    writeFileSync(activeEnvPath, '# 登录后按账号同步 Token\n', 'utf-8');
  }
  return activeEnvPath;
}

function ensureSessionSecret(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const secretPath = path.join(dataDir, 'auth-session.secret');
  if (existsSync(secretPath)) {
    return readFileSync(secretPath, 'utf-8').trim();
  }
  const secret = randomBytes(32).toString('base64');
  writeFileSync(secretPath, secret, { mode: 0o600 });
  return secret;
}

function readPersistedPorts(dataDir) {
  const portsPath = path.join(dataDir, 'service-ports.json');
  if (!existsSync(portsPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(portsPath, 'utf-8'));
    const agentPort = Number(parsed?.agentPort);
    const webPort = Number(parsed?.webPort);
    if (!Number.isInteger(agentPort) || !Number.isInteger(webPort)) return null;
    return { agentPort, webPort };
  } catch {
    return null;
  }
}

function persistPorts(dataDir, nextAgentPort, nextWebPort) {
  writeFileSync(
    path.join(dataDir, 'service-ports.json'),
    JSON.stringify({ agentPort: nextAgentPort, webPort: nextWebPort }),
    'utf-8',
  );
}

function shouldOpenDevTools() {
  return (
    isDev ||
    process.env.INVESTMENT_AGENT_DEVTOOLS === '1' ||
    process.env.ELECTRON_OPEN_DEVTOOLS === '1'
  );
}

function toggleDevTools() {
  const window = BrowserWindow.getFocusedWindow() ?? mainWindow;
  if (!window) return;
  if (window.webContents.isDevToolsOpened()) {
    window.webContents.closeDevTools();
  } else {
    window.webContents.openDevTools({ mode: 'detach' });
  }
}

function setupApplicationMenu() {
  const devToolsItem = {
    label: '开发者工具',
    accelerator: process.platform === 'darwin' ? 'Cmd+Shift+I' : 'Ctrl+Shift+I',
    click: () => toggleDevTools(),
  };

  const editMenu = {
    label: '编辑',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'pasteAndMatchStyle' },
      { role: 'delete' },
      { role: 'selectAll' },
    ],
  };

  const template = [
    ...(process.platform === 'darwin'
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    editMenu,
    {
      label: '视图',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        devToolsItem,
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerDevToolsShortcuts() {
  const accelerators =
    process.platform === 'darwin'
      ? ['Command+Shift+I', 'Command+Alt+I', 'F12']
      : ['Control+Shift+I', 'F12'];

  for (const accelerator of accelerators) {
    if (globalShortcut.isRegistered(accelerator)) continue;
    globalShortcut.register(accelerator, toggleDevTools);
  }
}

function unregisterDevToolsShortcuts() {
  globalShortcut.unregisterAll();
}

function getFreePort(preferred) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', (err) => {
      if (err && 'code' in err && err.code === 'EADDRINUSE') {
        resolve(getFreePort(preferred + 1));
        return;
      }
      reject(err);
    });
    server.listen(preferred, '127.0.0.1', () => {
      const address = server.address();
      const port =
        typeof address === 'object' && address ? address.port : preferred;
      server.close(() => resolve(port));
    });
  });
}

function spawnService(label, command, args, options) {
  const child = spawn(command, args, {
    ...options,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  child.stdout?.on('data', (chunk) => {
    process.stdout.write(`[${label}] ${chunk}`);
  });
  child.stderr?.on('data', (chunk) => {
    process.stderr.write(`[${label}] ${chunk}`);
  });

  child.on('exit', (code, signal) => {
    if (code !== 0 && code !== null) {
      console.error(`[${label}] 退出 code=${code} signal=${signal}`);
    }
  });

  return child;
}

async function waitForHealth(url, timeoutMs = 120_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`服务启动超时: ${url}`);
}

async function servicesHealthy() {
  if (!webChild || webChild.killed || !agentChild || agentChild.killed) {
    return false;
  }

  try {
    const [agentOk, webOk] = await Promise.all([
      fetch(`http://127.0.0.1:${agentPort}/health`)
        .then((response) => response.ok)
        .catch(() => false),
      fetch(`http://127.0.0.1:${webPort}/`)
        .then((response) => response.ok || response.status === 307 || response.status === 308)
        .catch(() => false),
    ]);
    return agentOk && webOk;
  } catch {
    return false;
  }
}

async function startServices() {
  const userData = app.getPath('userData');
  const dataDir = path.join(userData, 'data');
  const activeEnvPath = ensureActiveEnvFile(dataDir);
  const sessionSecret = ensureSessionSecret(dataDir);
  const resourcesPath = resolveResourcesPath();
  const persistedPorts = readPersistedPorts(dataDir);

  agentPort = await getFreePort(persistedPorts?.agentPort ?? 4010);
  webPort = await getFreePort(persistedPorts?.webPort ?? 3010);

  const agentCoreRoot = resolvePackDir('agent-core');
  const webRoot = resolvePackDir('web');
  const tsxCli = path.join(agentCoreRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const serverEntry = path.join(agentCoreRoot, 'src', 'server', 'index.ts');

  let webServer = path.join(webRoot, 'apps', 'web', 'server.js');
  const manifestPath = path.join(webRoot, 'manifest.json');
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    if (manifest.serverEntry) {
      webServer = path.join(webRoot, manifest.serverEntry);
    }
  }

  if (!existsSync(serverEntry)) {
    throw new Error(`未找到 agent-core：${serverEntry}，请先运行 pnpm desktop:prepare`);
  }
  if (!existsSync(webServer)) {
    throw new Error(`未找到 Web 服务：${webServer}，请先运行 pnpm desktop:prepare`);
  }

  const nodeRunner = process.execPath;
  const runAsNode = { ELECTRON_RUN_AS_NODE: '1' };

  const iwencaiServerPath = path.join(
    agentCoreRoot,
    'vendor',
    'iwencai-mcp',
    'server.py',
  );

  const sharedEnv = {
    ...process.env,
    INVESTMENT_AGENT_DATA_DIR: dataDir,
    INVESTMENT_AGENT_ENV_PATH: activeEnvPath,
    INVESTMENT_AGENT_RESOURCES_PATH: resourcesPath,
    ...(existsSync(iwencaiServerPath)
      ? { IWENCAI_MCP_SERVER_PATH: iwencaiServerPath }
      : {}),
  };

  const agentEnv = {
    ...sharedEnv,
    ...runAsNode,
    DOTENV_CONFIG_PATH: activeEnvPath,
    PORT: String(agentPort),
    AGENT_CORE_PORT: String(agentPort),
  };

  agentChild = spawnService(
    'agent-core',
    nodeRunner,
    [tsxCli, serverEntry],
    { cwd: agentCoreRoot, env: agentEnv },
  );

  await waitForHealth(`http://127.0.0.1:${agentPort}/health`);

  const webEnv = {
    ...sharedEnv,
    ...runAsNode,
    NODE_ENV: 'production',
    HOSTNAME: '127.0.0.1',
    PORT: String(webPort),
    AGENT_CORE_URL: `http://127.0.0.1:${agentPort}`,
    INVESTMENT_AGENT_DESKTOP: '1',
    AUTH_SESSION_SECRET: sessionSecret,
  };

  webChild = spawnService(
    'web',
    nodeRunner,
    [webServer],
    { cwd: webRoot, env: webEnv },
  );

  await waitForHealth(`http://127.0.0.1:${webPort}/login`);
  persistPorts(dataDir, agentPort, webPort);
}

function stopServices() {
  for (const child of [webChild, agentChild]) {
    if (!child || child.killed) continue;
    try {
      child.kill('SIGTERM');
    } catch {
      // ignore
    }
  }
  webChild = null;
  agentChild = null;
}

function isLocalAppUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname;
    return (
      parsed.protocol === 'http:' &&
      (host === '127.0.0.1' || host === 'localhost') &&
      parsed.port === String(webPort)
    );
  } catch {
    return false;
  }
}

function openExternalIfSafe(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (
      parsed.protocol === 'http:' ||
      parsed.protocol === 'https:' ||
      parsed.protocol === 'mailto:'
    ) {
      void shell.openExternal(rawUrl);
    }
  } catch {
    // ignore invalid URLs
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    title: '投研助手',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    if (shouldOpenDevTools()) {
      mainWindow?.webContents.openDevTools({ mode: 'detach' });
    }
  });

  mainWindow.loadURL(`http://127.0.0.1:${webPort}/`);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isLocalAppUrl(url)) {
      mainWindow?.loadURL(url);
    } else {
      openExternalIfSafe(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isLocalAppUrl(url)) return;
    event.preventDefault();
    openExternalIfSafe(url);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function boot() {
  try {
    if (!(await servicesHealthy())) {
      stopServices();
      await startServices();
    }
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      return;
    }
    createWindow();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const dataDir = path.join(app.getPath('userData'), 'data');
    dialog.showErrorBox(
      '投研助手启动失败',
      `${message}\n\n数据目录：\n${dataDir}`,
    );
    app.quit();
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    void boot();
  });

  app.whenReady().then(() => {
    setupApplicationMenu();
    registerDevToolsShortcuts();
    void boot();
  });

  app.on('will-quit', () => {
    unregisterDevToolsShortcuts();
  });

  app.on('before-quit', () => {
    stopServices();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void boot();
    }
  });
}
