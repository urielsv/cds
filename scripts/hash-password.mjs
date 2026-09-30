#!/usr/bin/env node
/**
 * Prints the value for UPLOAD_PASSWORD_HASH.
 *
 *   node scripts/hash-password.mjs 'your long passphrase'
 *
 * Or run it with no argument to be prompted, which keeps the passphrase out of
 * your shell history. The format must match `api/_lib/auth.ts`:
 * `scrypt:N:r:p:salt:hash` with base64 fields.
 */

import { randomBytes, scryptSync } from 'node:crypto';
import { createInterface } from 'node:readline/promises';

const N = 2 ** 15;
const r = 8;
const p = 1;

async function readPassphrase() {
  const fromArgs = process.argv[2];
  if (fromArgs) return fromArgs;
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await rl.question('Passphrase: ');
  rl.close();
  return answer;
}

const passphrase = await readPassphrase();
if (passphrase.length < 12) {
  console.error('Use at least 12 characters; a few random words work well.');
  process.exit(1);
}

const salt = randomBytes(16);
const key = scryptSync(passphrase.normalize('NFKC'), salt, 64, { N, r, p, maxmem: 256 * N * r });

process.stdout.write(
  `${['scrypt', N, r, p, salt.toString('base64'), key.toString('base64')].join(':')}\n`,
);
