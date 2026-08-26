import filesizeParser from 'filesize-parser';
import fs from 'fs';
import fetch from 'node-fetch';
import path from 'path';
import type ProgressBar from 'progress';
import packageJson from '../package.json';
import type { Package, Session } from './types';
import { credentialFile, IS_CRESC, pricingPageUrl } from './utils/constants';
import type { HermesBaseServerRecord } from './utils/hermes-base';
import { getBaseUrl } from './utils/http-helper';
import { t } from './utils/i18n';
import {
  measureTcpLatency,
  type RuntimeRequestInit,
  type RuntimeResponse,
  runtimeFetch,
} from './utils/runtime';

let session: Session | undefined;
let savedSession: Session | undefined;
let apiToken: string | undefined;

const userAgent = `react-native-update-cli/${packageJson.version}`;

export const getSession = () => session;

export const getApiToken = () => apiToken;

export const setApiToken = (token: string) => {
  apiToken = token;
};

const loadApiTokenFromEnv = () => {
  // Use CRESC_API_TOKEN for cresc, PUSHY_API_TOKEN for pushy
  const envToken = IS_CRESC
    ? process.env.CRESC_API_TOKEN
    : process.env.PUSHY_API_TOKEN;
  if (envToken) {
    apiToken = envToken;
  }
};

export const replaceSession = (newSession: { token: string }) => {
  session = newSession;
};

export const loadSession = async () => {
  loadApiTokenFromEnv();
  if (fs.existsSync(credentialFile)) {
    try {
      replaceSession(JSON.parse(fs.readFileSync(credentialFile, 'utf8')));
      savedSession = session;
    } catch (e) {
      console.error(
        `Failed to parse file ${credentialFile}. Try to remove it manually.`,
      );
      throw e;
    }
  }
};

export const saveSession = () => {
  // Only save on change.
  if (session !== savedSession) {
    const current = session;
    const data = JSON.stringify(current, null, 4);
    fs.writeFileSync(credentialFile, data, { encoding: 'utf8', mode: 0o600 });
    try {
      // mode above only applies on creation; tighten pre-existing files too
      fs.chmodSync(credentialFile, 0o600);
    } catch {
      // best-effort (e.g. exotic filesystems); the token is still saved
    }
    savedSession = current;
  }
};

export const closeSession = () => {
  if (fs.existsSync(credentialFile)) {
    fs.unlinkSync(credentialFile);
    savedSession = undefined;
  }
  session = undefined;
};

function createRequestError(
  error: unknown,
  requestUrl: string,
  status?: number,
) {
  const message =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : String(error);
  const requestError = new Error(`${message}\nURL: ${requestUrl}`) as Error & {
    status?: number;
  };
  requestError.status = status;
  return requestError;
}

const PROXY_ERROR_PATTERNS = [
  'socket disconnected before secure TLS connection',
  'ECONNRESET',
  'ECONNREFUSED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'CERT_HAS_EXPIRED',
  'self signed certificate',
  'proxy',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
];

function isProxyRelatedError(error: unknown): boolean {
  const msg =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';
  const lower = msg.toLowerCase();
  return PROXY_ERROR_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
}

async function query(url: string, options: RuntimeRequestInit) {
  const baseUrl = await getBaseUrl();
  const fullUrl = `${baseUrl}${url}`;
  let resp: RuntimeResponse;
  try {
    resp = await runtimeFetch(fullUrl, options);
  } catch (error) {
    const baseError = createRequestError(error, fullUrl);
    if (isProxyRelatedError(error)) {
      throw new Error(
        `${baseError.message}\n\n${t('proxyNetworkError')}\n${t('proxyNetworkErrorTips')}`,
      );
    }
    throw baseError;
  }
  const text = await resp.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch (_e) {
    if (resp.status === 200) {
      // a proxy/gateway likely replaced the response; surface it instead of
      // returning undefined and crashing callers on destructuring
      throw createRequestError(
        `API returned 200 with non-JSON body (${text.length} bytes)`,
        fullUrl,
        resp.status,
      );
    }
  }

  if (resp.status !== 200) {
    const message = json?.message || resp.statusText || `HTTP ${resp.status}`;
    if (resp.status === 401) {
      throw createRequestError(t('loginExpired'), fullUrl, resp.status);
    }
    throw createRequestError(message, fullUrl, resp.status);
  }
  return json;
}

function queryWithoutBody(method: string) {
  return (api: string) => {
    const headers: Record<string, string> = {
      'User-Agent': userAgent,
    };
    if (apiToken) {
      headers['x-api-token'] = apiToken;
    } else if (session?.token) {
      headers['X-AccessToken'] = session.token;
    }
    return query(api, {
      method,
      headers,
    });
  };
}

function queryWithBody(method: string) {
  return (api: string, body?: Record<string, any>) => {
    const headers: Record<string, string> = {
      'User-Agent': userAgent,
      'Content-Type': 'application/json',
    };
    if (apiToken) {
      headers['x-api-token'] = apiToken;
    } else if (session?.token) {
      headers['X-AccessToken'] = session.token;
    }
    return query(api, {
      method,
      headers,
      body: JSON.stringify(body),
    });
  };
}

export const get = queryWithoutBody('GET');
export const post = queryWithBody('POST');
export const put = queryWithBody('PUT');
export const doDelete = queryWithBody('DELETE');

// Upload deadline: generous for a slow link (1 s/MB on top of a 30 s base,
// never below 60 s) but bounded, so a stalled connection cannot hang a CI job
// forever. The bar keeps ticking while bytes flow; the deadline is absolute.
const UPLOAD_TIMEOUT_BASE_MS = 30_000;
const UPLOAD_TIMEOUT_PER_MB_MS = 1_000;
const UPLOAD_TIMEOUT_MIN_MS = 60_000;
const UPLOAD_MAX_RETRIES = 1;

export function uploadTimeoutMs(fileSize: number): number {
  const megabytes = Math.ceil(Math.max(0, fileSize) / 1048576);
  return Math.max(
    UPLOAD_TIMEOUT_MIN_MS,
    UPLOAD_TIMEOUT_BASE_MS + megabytes * UPLOAD_TIMEOUT_PER_MB_MS,
  );
}

const TRANSIENT_UPLOAD_ERROR_CODES = ['ECONNRESET', 'ETIMEDOUT', 'EPIPE'];

/**
 * A network-level failure worth one more attempt: a reset/timed-out/broken
 * pipe connection, or our own deadline abort. HTTP responses (4xx/5xx) never
 * get here — they are surfaced as-is.
 */
export function isTransientUploadError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const { name, code, type, message } = error as {
    name?: string;
    code?: string;
    type?: string;
    message?: string;
  };
  if (name === 'AbortError' || type === 'aborted' || code === 'ABORT_ERR') {
    return true;
  }
  const text = `${code ?? ''} ${message ?? ''}`;
  return TRANSIENT_UPLOAD_ERROR_CODES.some((c) => text.includes(c));
}

class UploadTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Upload timed out after ${Math.round(timeoutMs / 1000)}s`);
    this.name = 'UploadTimeoutError';
  }
}

/**
 * Send the file with a size-scaled deadline and one retry on a transient
 * network error. `buildRequest` is invoked per attempt with a fresh file
 * stream (a consumed stream/form cannot be replayed).
 */
async function sendUpload(
  fn: string,
  realUrl: string,
  fileSize: number,
  bar: ProgressBar,
  buildRequest: (fileStream: fs.ReadStream) => fetch.RequestInit,
): Promise<fetch.Response> {
  const timeoutMs = uploadTimeoutMs(fileSize);
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const fileStream = fs.createReadStream(fn);
    fileStream.on('data', (data) => {
      bar.tick(data.length);
    });
    try {
      return await fetch(realUrl, {
        ...buildRequest(fileStream),
        signal: controller.signal,
      });
    } catch (rawError) {
      fileStream.destroy();
      const error = timedOut ? new UploadTimeoutError(timeoutMs) : rawError;
      if (attempt < UPLOAD_MAX_RETRIES && isTransientUploadError(error)) {
        const reason = error instanceof Error ? error.message : String(error);
        console.warn(`\nUpload interrupted (${reason}), retrying...`);
        // restart the bar from zero for the second pass
        bar.curr = 0;
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

export async function uploadFile(
  fn: string,
  key?: string,
  appId?: string | number,
) {
  // appId 用于服务端路由:绑定了自托管节点(rnu-node)的应用,
  // 上传指令会指向节点或其对象存储
  const resp = await post('/upload', {
    ext: path.extname(fn),
    ...(appId ? { appId: Number(appId) } : {}),
  });
  const { url, backupUrl, formData, maxSize } = resp;
  let realUrl = url;
  if (backupUrl) {
    if (global.USE_ACC_OSS) {
      realUrl = backupUrl;
    } else {
      const latency = await measureTcpLatency(url, {
        attempts: 4,
        timeout: 1000,
      });
      if (!Number.isFinite(latency) || latency > 150) {
        realUrl = backupUrl;
      }
    }
    // console.log({realUrl});
  }

  const fileSize = fs.statSync(fn).size;
  if (maxSize && fileSize > filesizeParser(maxSize)) {
    const readableFileSize = `${(fileSize / 1048576).toFixed(1)}m`;
    throw new Error(
      t('fileSizeExceeded', {
        fileSize: readableFileSize,
        maxSize,
        pricingPageUrl,
      }),
    );
  }

  // progress/form-data are only needed here; keep them off the startup path
  const ProgressBarImpl = require('progress') as typeof import('progress');
  const bar = new ProgressBarImpl('  Uploading [:bar] :percent :etas', {
    complete: '=',
    incomplete: ' ',
    total: fileSize,
  });

  const rethrowUploadError = (error: unknown): never => {
    if (isProxyRelatedError(error)) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      throw new Error(
        `${rawMessage}\n\n${t('proxyNetworkError')}\n${t('proxyNetworkErrorTips')}`,
      );
    }
    throw createRequestError(error, realUrl);
  };

  // 自托管节点的 s3 直传:服务端下发预签名 PUT,字节直达用户的对象存储
  if (resp.method === 'PUT') {
    let putRes: fetch.Response;
    try {
      putRes = await sendUpload(fn, realUrl, fileSize, bar, (fileStream) => ({
        method: 'PUT',
        body: fileStream,
        // 预签名 PUT 不接受 chunked 传输,必须显式声明长度
        headers: {
          'content-length': String(fileSize),
          ...(resp.headers || {}),
        },
      }));
    } catch (error) {
      return rethrowUploadError(error);
    }
    if (putRes.status > 299) {
      throw createRequestError(
        `${putRes.status}: ${putRes.statusText || 'Upload failed'}`,
        realUrl,
      );
    }
    return { hash: resp.key };
  }

  const FormData = require('form-data') as typeof import('form-data');
  let res: fetch.Response;
  try {
    res = await sendUpload(fn, realUrl, fileSize, bar, (fileStream) => {
      const form = new FormData();
      for (const [k, v] of Object.entries(formData)) {
        form.append(k, v);
      }
      if (key) {
        form.append('key', key);
      }
      form.append('file', fileStream);
      // form.append('file', fileStream, {
      //   contentType: 'application/octet-stream',
      // });
      return { method: 'POST', body: form };
    });
  } catch (error) {
    return rethrowUploadError(error);
  }

  if (res.status > 299) {
    throw createRequestError(
      `${res.status}: ${res.statusText || 'Upload failed'}`,
      realUrl,
    );
  }

  // const body = await response.json();
  return { hash: key || formData.key };
}

/**
 * Ask the server for the Hermes base of (app, HBC version): the earliest
 * existing version of that epoch, or the newest version when the epoch is not
 * known yet. Old servers answer 404 → treated as "no base".
 */
export async function getHermesBase(
  appId: string,
  bytecodeVersion: number,
): Promise<HermesBaseServerRecord | null> {
  try {
    const data = await get(
      `/app/${appId}/hermesBase?bytecodeVersion=${bytecodeVersion}`,
    );
    const record =
      data && typeof data === 'object' && 'data' in data ? data.data : data;
    if (!record || typeof record !== 'object' || !record.url || !record.hash) {
      return null;
    }
    return record as HermesBaseServerRecord;
  } catch (error) {
    if ((error as { status?: number })?.status === 404) {
      return null;
    }
    throw error;
  }
}

export const getAllPackages = async (appId: string) => {
  // the server caps limit at 100, so page through with offset
  const limit = 100;
  let offset = 0;
  let allPackages: Package[] | undefined | null;
  while (true) {
    const { data, count } = await get(
      `/app/${appId}/package/list?offset=${offset}&limit=${limit}`,
    );
    const packages = data as Package[] | undefined | null;
    if (allPackages === undefined || allPackages === null) {
      allPackages = packages;
    } else if (packages) {
      allPackages.push(...packages);
    }
    if (!packages || packages.length === 0) {
      break;
    }
    offset += packages.length;
    if (offset >= Number(count || 0)) {
      break;
    }
  }
  return allPackages;
};
