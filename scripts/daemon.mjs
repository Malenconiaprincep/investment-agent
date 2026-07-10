#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const stateDir = path.join(rootDir, '.daemon');
const webDataDir = path.join(rootDir, 'apps/web/.data');

const services = {
  agent: {
    label: 'agent-core',
    command: 'pnpm',
    args: ['agent:serve'],
    url: 'http://127.0.0.1:4000/health',
    displayUrl: 'http://127.0.0.1:4000',
  },
  web: {
    label: 'web',
    command: 'node',
    args: ['apps/web/.next/standalone/apps/web/server.js'],
    env: {
      HOSTNAME: '127.0.0.1',
      PORT: '3000',
      AGENT_CORE_URL: 'http://127.0.0.1:4000',
      AGENT_CORE_PAPER_LOCAL_EXEC: '0',
      AGENT_CORE_WATCHLIST_LOCAL_EXEC: '0',
      INVESTMENT_AGENT_DESKTOP: '1',
      INVESTMENT_AGENT_WEB_DATA_DIR: webDataDir,
    },
    url: 'http://127.0.0.1:3000/login',
    displayUrl: 'http://localhost:3000',
  },
};

const action = process.argv[2] ?? 'status';
const requested = process.argv.slice(3).filter((arg) => !arg.startsWith('-'));
const followLogs = process.argv.includes('--follow') || process.argv.includes('-f');

function ensureStateDir() {
  fs.mkdirSync(stateDir, { recursive: true });
}

function pidFile(name) {
  return path.join(stateDir, `${name}.pid.json`);
}

function logFile(name) {
  return path.join(stateDir, `${name}.log`);
}

function readPid(name) {
  try {
    return JSON.parse(fs.readFileSync(pidFile(name), 'utf8'));
  } catch {
    return null;
  }
}

function writePid(name, data) {
  ensureStateDir();
  fs.writeFileSync(pidFile(name), `${JSON.stringify(data, null, 2)}\n`);
}

function removePid(name) {
  fs.rmSync(pidFile(name), { force: true });
}

function servicePort(service) {
  try {
    return new URL(service.url).port;
  } catch {
    return '';
  }
}

function findListeningPid(service) {
  if (process.platform === 'win32') return null;

  const port = servicePort(service);
  if (!port) return null;

  try {
    const output = execFileSync(
      'lsof',
      ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    ).trim();
    const pid = Number(output.split(/\s+/)[0]);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function attachRunningService(name, service) {
  const pid = findListeningPid(service);
  if (!pid) return null;

  writePid(name, {
    pid,
    service: name,
    label: service.label,
    command: [service.command, ...service.args].join(' '),
    attachedAt: new Date().toISOString(),
    log: logFile(name),
  });

  return pid;
}

function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function signalTargets(pid) {
  if (process.platform === 'win32') return [pid];
  return [-pid, pid];
}

function signalServicePid(pid, signal) {
  for (const target of signalTargets(pid)) {
    try {
      process.kill(target, signal);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
}

function selectServices() {
  if (requested.length === 0 || requested.includes('all')) {
    return Object.keys(services);
  }

  const names = requested.filter((name) => services[name]);
  const unknown = requested.filter((name) => !services[name] && name !== 'all');
  if (unknown.length > 0) {
    console.error(`Unknown service: ${unknown.join(', ')}`);
    console.error(`Available services: ${Object.keys(services).join(', ')}, all`);
    process.exit(1);
  }
  return names;
}

async function startService(name) {
  const service = services[name];
  const existing = readPid(name);
  if (existing && isAlive(existing.pid)) {
    console.log(`${service.label} already running (pid ${existing.pid}) -> ${service.displayUrl}`);
    return;
  }

  const currentHealth = await health(service);
  if (currentHealth.startsWith('healthy')) {
    const pid = attachRunningService(name, service);
    const pidLabel = pid ? `pid ${pid}` : 'pid not tracked';
    console.log(`${service.label} already running (${currentHealth}, ${pidLabel}) -> ${service.displayUrl}`);
    return;
  }

  removePid(name);
  ensureStateDir();
  const logPath = logFile(name);
  fs.writeFileSync(logPath, `[daemon] starting ${service.label} at ${new Date().toISOString()}\n`);

  const logFd = fs.openSync(logPath, 'a');
  const child = spawn(service.command, service.args, {
    cwd: rootDir,
    detached: true,
    env: { ...process.env, ...(service.env ?? {}) },
    stdio: ['ignore', logFd, logFd],
    windowsHide: true,
  });

  child.unref();
  fs.closeSync(logFd);

  writePid(name, {
    pid: child.pid,
    service: name,
    label: service.label,
    command: [service.command, ...service.args].join(' '),
    startedAt: new Date().toISOString(),
    log: logPath,
  });

  console.log(`${service.label} started (pid ${child.pid}) -> ${service.displayUrl}`);
  console.log(`log: ${logPath}`);
}

async function stopService(name) {
  const service = services[name];
  const info = readPid(name);
  if (!info || !isAlive(info.pid)) {
    removePid(name);
    console.log(`${service.label} is not running`);
    return;
  }

  signalServicePid(info.pid, 'SIGTERM');

  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (!isAlive(info.pid)) {
      removePid(name);
      console.log(`${service.label} stopped`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  signalServicePid(info.pid, 'SIGKILL');
  removePid(name);
  console.log(`${service.label} killed after timeout`);
}

async function health(service) {
  try {
    const response = await fetch(service.url, { signal: AbortSignal.timeout(5000) });
    return response.ok ? `healthy (${response.status})` : `responding (${response.status})`;
  } catch {
    return 'not responding yet';
  }
}

async function statusService(name) {
  const service = services[name];
  const info = readPid(name);
  if (!info || !isAlive(info.pid)) {
    removePid(name);
    const currentHealth = await health(service);
    if (currentHealth.startsWith('healthy')) {
      const pid = attachRunningService(name, service);
      const pidLabel = pid ? `pid ${pid}` : 'pid not tracked';
      console.log(`${service.label}: running (${currentHealth}, ${pidLabel}) -> ${service.displayUrl}`);
      return;
    }
    console.log(`${service.label}: stopped`);
    return;
  }

  console.log(`${service.label}: running (pid ${info.pid}), ${await health(service)} -> ${service.displayUrl}`);
  console.log(`  log: ${logFile(name)}`);
}

function tailLog(name) {
  const service = services[name];
  const logPath = logFile(name);
  if (!fs.existsSync(logPath)) {
    console.log(`${service.label}: no log yet (${logPath})`);
    return;
  }

  console.log(`\n==> ${service.label} (${logPath}) <==`);
  if (followLogs) {
    const tail = spawn('tail', ['-n', '80', '-f', logPath], {
      cwd: rootDir,
      stdio: 'inherit',
    });
    tail.on('exit', (code) => process.exit(code ?? 0));
    return;
  }

  const content = fs.readFileSync(logPath, 'utf8');
  const lines = content.trimEnd().split('\n').slice(-80);
  console.log(lines.join('\n'));
}

async function main() {
  const names = selectServices();

  switch (action) {
    case 'start':
      for (const name of names) await startService(name);
      break;
    case 'stop':
      for (const name of names) await stopService(name);
      break;
    case 'restart':
      for (const name of names) await stopService(name);
      for (const name of names) await startService(name);
      break;
    case 'status':
      for (const name of names) await statusService(name);
      break;
    case 'logs':
      names.forEach(tailLog);
      break;
    default:
      console.error(`Usage: pnpm daemon <start|stop|restart|status|logs> [agent|web|all] [--follow]`);
      process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
