#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const webDir = path.join(rootDir, 'apps/web');
const standaloneWebDir = path.join(webDir, '.next/standalone/apps/web');

function copyIfExists(source, target) {
  if (!existsSync(source)) return false;
  mkdirSync(path.dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true });
  return true;
}

if (!existsSync(standaloneWebDir)) {
  throw new Error(
    `Next standalone output not found: ${standaloneWebDir}. Run pnpm web:build first.`,
  );
}

const copiedStatic = copyIfExists(
  path.join(webDir, '.next/static'),
  path.join(standaloneWebDir, '.next/static'),
);
const copiedPublic = copyIfExists(
  path.join(webDir, 'public'),
  path.join(standaloneWebDir, 'public'),
);

console.log(
  [
    'Prepared web standalone assets:',
    copiedStatic ? 'static copied' : 'static missing',
    copiedPublic ? 'public copied' : 'public missing',
  ].join(' '),
);
