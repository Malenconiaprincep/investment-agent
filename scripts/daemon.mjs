#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const stateDir = path.join(rootDir, '.daemon');

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
    command: 'pnpm',
    args: ['web:dev'],
    url: 'http://127.0.0.1:3000',
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

function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
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

function startService(name) {
  const service = services[name];
  const existing = readPid(name);
  if (existing && isAlive(existing.pid)) {
    console.log(`${service.label} already running (pid ${existing.pid}) -> ${service.displayUrl}`);
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
    env: process.env,
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

  const signalPid = process.platform === 'win32' ? info.pid : -info.pid;
  try {
    process.kill(signalPid, 'SIGTERM');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }

  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (!isAlive(info.pid)) {
      removePid(name);
      console.log(`${service.label} stopped`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  try {
    process.kill(signalPid, 'SIGKILL');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
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
      names.forEach(startService);
      break;
    case 'stop':
      for (const name of names) await stopService(name);
      break;
    case 'restart':
      for (const name of names) await stopService(name);
      names.forEach(startService);
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
