import chalk from 'chalk';
import { fork } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getApiToken, getSession } from './api';
import { IS_CRESC, pricingPageUrl } from './utils/constants';
import { t } from './utils/i18n';

export interface AccountInfo {
  name?: string;
  email?: string;
  tier?: string;
  tierExpiresAt?: string | null;
  serverTime?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function printAccountInfo(
  account: AccountInfo,
  isCresc = IS_CRESC,
  now = Date.now(),
) {
  const expiresAt = account.tierExpiresAt
    ? Date.parse(account.tierExpiresAt)
    : NaN;
  const serverTime = account.serverTime ? Date.parse(account.serverTime) : NaN;
  const remaining =
    expiresAt - (Number.isFinite(serverTime) ? serverTime : now);
  console.log(
    t('accountSummary', {
      account: account.email || account.name || t('accountUnknown'),
      tier: account.tier || t('accountUnknown'),
      expiry: Number.isFinite(expiresAt)
        ? new Date(expiresAt).toISOString()
        : t('accountNoExpiry'),
    }),
  );
  if (
    !isCresc &&
    account.tier &&
    account.tier !== 'free' &&
    remaining >= 0 &&
    remaining < 30 * DAY_MS
  ) {
    console.warn(
      chalk.yellow.bold(
        t('accountRenewalWarning', {
          days: Math.ceil(remaining / DAY_MS),
          url: pricingPageUrl,
        }),
      ),
    );
  }
}

interface AccountCache {
  account: AccountInfo;
  fetchedAt: number;
}

export function accountCacheFile(token: string, apiToken = '') {
  const key = createHash('sha256')
    .update(JSON.stringify([IS_CRESC, process.cwd(), token, apiToken]))
    .digest('hex');
  return path.join(
    os.homedir(),
    '.cache',
    'react-native-update-cli',
    'accounts',
    `${key}.json`,
  );
}

function printCachedAccount(entry: AccountCache) {
  const serverTime = Date.parse(entry.account.serverTime || '');
  // Advance cached server time by elapsed local time, instead of freezing the
  // remaining subscription duration at the moment the cache was written.
  printAccountInfo({
    ...entry.account,
    serverTime: Number.isFinite(serverTime)
      ? new Date(
          serverTime + Math.max(0, Date.now() - entry.fetchedAt),
        ).toISOString()
      : undefined,
  });
}

/** Cache first; the detached refresh never keeps the command process alive. */
export function showCurrentAccount() {
  const token = getSession()?.token;
  if (!token) return;
  const apiToken = getApiToken();
  const cacheFile = accountCacheFile(token, apiToken);
  let cached = false;
  try {
    const entry: AccountCache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (
      entry.account &&
      typeof entry.account === 'object' &&
      Number.isFinite(entry.fetchedAt)
    ) {
      printCachedAccount(entry);
      cached = true;
    }
  } catch {
    // Missing or corrupt cache is a cache miss.
  }
  try {
    const worker = fork(
      path.join(__dirname, `account-worker${path.extname(__filename)}`),
      [],
      {
        detached: true,
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        execArgv: [],
      },
    );
    worker.on('error', () => {});
    worker.on('message', (entry: AccountCache) => {
      if (!cached) {
        printCachedAccount(entry);
        cached = true;
      }
    });
    worker.send({ token, apiToken, cacheFile }, () => {});
    worker.unref();
    worker.channel?.unref();
  } catch {
    // Starting a background worker is also best effort.
  }
}
