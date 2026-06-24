import { app, BrowserWindow, dialog, shell } from 'electron';
import { spawn } from 'node:child_process';
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

async function startServices() {
  const userData = app.getPath('userData');
  const dataDir = path.join(userData, 'data');
  const activeEnvPath = ensureActiveEnvFile(dataDir);
  const resourcesPath = resolveResourcesPath();

  agentPort = await getFreePort(4010);
  webPort = await getFreePort(3010);

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

  const sharedEnv = {
    ...process.env,
    INVESTMENT_AGENT_DATA_DIR: dataDir,
    INVESTMENT_AGENT_ENV_PATH: activeEnvPath,
    INVESTMENT_AGENT_RESOURCES_PATH: resourcesPath,
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
  };

  webChild = spawnService(
    'web',
    nodeRunner,
    [webServer],
    { cwd: webRoot, env: webEnv },
  );

  await waitForHealth(`http://127.0.0.1:${webPort}/login`);
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
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.loadURL(`http://127.0.0.1:${webPort}/login`);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function boot() {
  try {
    await startServices();
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
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    void boot();
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
