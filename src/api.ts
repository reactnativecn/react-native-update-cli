import filesizeParser from 'filesize-parser';
import fs from 'fs';
import path from 'path';
import type ProgressBar from 'progress';
import packageJson from '../package.json';
import type { Package, Session } from './types';
import {
  credentialFile,
  defaultEndpoints,
  IS_CRESC,
  pricingPageUrl,
} from './utils/constants';
import type { HermesBaseServerRecord } from './utils/hermes-base';
import { getBaseUrl, isBaseUrlUnreachableFallback } from './utils/http-helper';
import { t } from './utils/i18n';
import {
  type AddressFamily,
  measureTcpLatency,
  measureTlsLatencyByFamily,
  proxyAgentFor,
  type RuntimeRequestInit,
  type RuntimeResponse,
  resolveProxy,
  runtimeFetch,
} from './utils/runtime';
import {
  multipartRequest,
  sendUploadRequest,
  type UploadRequest,
  type UploadResponse,
} from './utils/upload-request';

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

/** Remove credentials, query signatures and fragments before logging a URL. */
export function redactRequestUrl(requestUrl: string): string {
  try {
    const parsed = new URL(requestUrl);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}${
      parsed.search ? '?<redacted>' : ''
    }`;
  } catch {
    const secretStart = requestUrl.search(/[?#]/);
    return secretStart < 0
      ? requestUrl
      : `${requestUrl.slice(0, secretStart)}?<redacted>`;
  }
}

function createRequestError(
  error: unknown,
  requestUrl: string,
  status?: number,
  detail?: string,
) {
  const baseMessage =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : String(error);
  const message = detail ? `${baseMessage} (${detail})` : baseMessage;
  const cause =
    error instanceof Error || (typeof error === 'object' && error !== null)
      ? error
      : undefined;
  const requestError = new Error(
    `${message}\nURL: ${redactRequestUrl(requestUrl)}`,
    cause === undefined ? undefined : { cause },
  ) as Error & {
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
  // DNS: offline, or a proxy/VPN that hijacks name resolution
  'ENOTFOUND',
  'EAI_AGAIN',
  // undici's own connect/socket failures (Node's fetch)
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  // a TLS-inspecting corporate proxy re-signing with an untrusted root
  'UNABLE_TO_GET_ISSUER_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
];

/** The error chain from `error` down through its causes, without cycles. */
function errorChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  let current = error;
  while (
    current !== undefined &&
    current !== null &&
    !chain.includes(current)
  ) {
    chain.push(current);
    current =
      typeof current === 'object'
        ? (current as { cause?: unknown }).cause
        : undefined;
  }
  return chain;
}

/**
 * The underlying reason of a network failure, e.g.
 * `ENOTFOUND: getaddrinfo ENOTFOUND 1.rnupdate.online`. Node's fetch only says
 * "fetch failed" and keeps the reason in `cause`, which is otherwise printed
 * only under RNU_DEBUG=1.
 */
export function describeNetworkCause(error: unknown): string | undefined {
  const top = error instanceof Error ? error.message : String(error);
  for (const item of errorChain(error).slice(1).reverse()) {
    if (!(item instanceof Error)) {
      continue;
    }
    // happy-eyeballs connects fail with an AggregateError of per-address errors
    const inner =
      !(item as NodeJS.ErrnoException).code &&
      item instanceof AggregateError &&
      item.errors[0] instanceof Error
        ? item.errors[0]
        : item;
    const code = (inner as NodeJS.ErrnoException).code;
    const message = inner.message || item.message;
    if (!code && (!message || message === top)) {
      continue;
    }
    if (!code) {
      return message;
    }
    return message && !message.includes(code)
      ? `${code}: ${message}`
      : message || code;
  }
  return undefined;
}

function isProxyRelatedError(error: unknown): boolean {
  const parts: string[] = [];
  for (const current of errorChain(error)) {
    if (current instanceof Error) {
      const code = (current as NodeJS.ErrnoException).code;
      parts.push(`${current.name} ${code ?? ''} ${current.message}`);
      if (current instanceof AggregateError) {
        for (const inner of current.errors) {
          if (inner instanceof Error) {
            const innerCode = (inner as NodeJS.ErrnoException).code;
            parts.push(`${inner.name} ${innerCode ?? ''} ${inner.message}`);
          }
        }
      }
    } else {
      parts.push(String(current));
    }
  }
  const lower = parts.join('\n').toLowerCase();
  return PROXY_ERROR_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
}

/** A request error for `url`, with the proxy hints when a proxy is the likely cause. */
function networkError(
  error: unknown,
  url: string,
  { apiRequest = false }: { apiRequest?: boolean } = {},
): Error {
  const baseError = createRequestError(
    error,
    url,
    undefined,
    describeNetworkCause(error),
  );
  const hints: string[] = [];
  if (apiRequest && isBaseUrlUnreachableFallback()) {
    hints.push(
      t('allEndpointsUnreachable', {
        example: defaultEndpoints[defaultEndpoints.length - 1],
      }),
    );
  }
  if (isProxyRelatedError(error)) {
    hints.push(`${t('proxyNetworkError')}\n${t('proxyNetworkErrorTips')}`);
  }
  if (!hints.length) {
    return baseError;
  }
  return new Error(`${baseError.message}\n\n${hints.join('\n\n')}`, {
    cause: baseError,
  });
}

async function query(url: string, options: RuntimeRequestInit) {
  const baseUrl = await getBaseUrl();
  const fullUrl = `${baseUrl}${url}`;
  let resp: RuntimeResponse;
  try {
    resp = await runtimeFetch(fullUrl, options);
  } catch (error) {
    throw networkError(error, fullUrl, { apiRequest: true });
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

function queryWith(method: string, withBody: boolean) {
  return (api: string, body?: Record<string, any>) => {
    const headers: Record<string, string> = { 'User-Agent': userAgent };
    if (withBody) {
      headers['Content-Type'] = 'application/json';
    }
    if (apiToken) {
      headers['x-api-token'] = apiToken;
    } else if (session?.token) {
      headers['X-AccessToken'] = session.token;
    }
    return query(api, {
      method,
      headers,
      ...(withBody ? { body: JSON.stringify(body) } : {}),
    });
  };
}

export const get: (api: string) => Promise<any> = queryWith('GET', false);
export const post = queryWith('POST', true);
export const put = queryWith('PUT', true);
export const doDelete = queryWith('DELETE', true);

// Upload deadline: generous for a slow link (5 s/MB, i.e. ~200 KB/s, on top
// of a 30 s base, never below 60 s) but bounded, so a stalled connection cannot
// hang a CI job forever. The bar keeps ticking while bytes flow; the deadline
// is absolute.
const UPLOAD_TIMEOUT_BASE_MS = 30_000;
const UPLOAD_TIMEOUT_PER_MB_MS = 5_000;
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
  readonly code = 'ETIMEDOUT';

  constructor(timeoutMs: number) {
    super(`Upload timed out after ${Math.round(timeoutMs / 1000)}s`);
    this.name = 'UploadTimeoutError';
  }
}

/** A byte range of the file (end exclusive) and its retry budget. */
interface UploadSlice {
  start: number;
  end: number;
  retries: number;
}

/**
 * Send the file (or one slice of it) with a size-scaled deadline and retries
 * on a transient network error. `buildRequest` is invoked per attempt with a
 * fresh file stream (a consumed stream/form cannot be replayed).
 */
async function sendUpload(
  fn: string,
  realUrl: string,
  fileSize: number,
  bar: ProgressBar,
  buildRequest: (fileStream: fs.ReadStream) => UploadRequest,
  slice: UploadSlice = { start: 0, end: fileSize, retries: UPLOAD_MAX_RETRIES },
  family?: AddressFamily,
): Promise<UploadResponse> {
  const timeoutMs = uploadTimeoutMs(slice.end - slice.start);
  // HTTP(S)_PROXY / NO_PROXY, like every other request of the CLI
  const agent = proxyAgentFor(realUrl);
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const fileStream = fs.createReadStream(fn, {
      start: slice.start,
      // an empty file has no last byte; end = start reads nothing
      end: Math.max(slice.start, slice.end - 1),
    });
    let sent = 0;
    fileStream.on('data', (data) => {
      sent += data.length;
      bar.tick(data.length);
    });
    try {
      return await sendUploadRequest(realUrl, buildRequest(fileStream), {
        agent,
        signal: controller.signal,
        userAgent,
        family,
      });
    } catch (rawError) {
      fileStream.destroy();
      const error = timedOut ? new UploadTimeoutError(timeoutMs) : rawError;
      if (attempt < slice.retries && isTransientUploadError(error)) {
        const reason = error instanceof Error ? error.message : String(error);
        console.warn(`\nUpload interrupted (${reason}), retrying...`);
        // take this attempt's bytes back off the bar before the next pass
        bar.curr = Math.max(0, bar.curr - sent);
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Parts in flight at once; each is its own TCP connection. */
const CHUNK_CONCURRENCY = 4;
/** A part is small, so it can afford more retries than the whole file. */
const CHUNK_MAX_RETRIES = 2;

interface ChunkedInstruction {
  key: string;
  partSize: number;
  parts: Record<string, string>[];
}

/** A part the store answered with an HTTP error: retrying will not help. */
class ChunkRejectedError extends Error {}

/**
 * Post the parts of a chunked upload, CHUNK_CONCURRENCY at a time. The first
 * failure stops scheduling new parts; the ones in flight finish, then it is
 * thrown.
 */
async function sendChunks(
  fn: string,
  realUrl: string,
  fileSize: number,
  bar: ProgressBar,
  chunked: ChunkedInstruction,
  postForm: (
    fields: Record<string, string>,
    byteCount: number,
  ) => (fileStream: fs.ReadStream) => UploadRequest,
): Promise<void> {
  let next = 0;
  let failure: unknown;
  const worker = async () => {
    while (failure === undefined && next < chunked.parts.length) {
      const index = next++;
      const start = index * chunked.partSize;
      const end = Math.min(fileSize, start + chunked.partSize);
      try {
        const res = await sendUpload(
          fn,
          realUrl,
          fileSize,
          bar,
          postForm(chunked.parts[index], end - start),
          { start, end, retries: CHUNK_MAX_RETRIES },
        );
        if (res.status > 299) {
          throw new ChunkRejectedError(
            `${res.status}: ${res.statusText || 'Upload failed'} (part ${index + 1}/${chunked.parts.length})`,
          );
        }
      } catch (error) {
        failure ??= error;
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(CHUNK_CONCURRENCY, chunked.parts.length) },
      worker,
    ),
  );
  if (failure !== undefined) {
    throw failure;
  }
}

/** Above this TCP connect time the primary address counts as far away. */
const UPLOAD_PRIMARY_MAX_LATENCY_MS = 150;

/** An address to post the upload form to, and the family that probed best. */
export interface UploadTarget {
  url: string;
  family?: AddressFamily;
}

/**
 * The addresses to post the upload form to, best first; every one of them
 * accepts the same form. `backupUrls` (newer servers) lists all alternatives
 * to `url`, `backupUrl` (older ones) names a single one.
 *
 * The primary stays first while its TCP connect takes at most 150 ms, unprobed
 * further. When it is far or unreachable, every address, the primary
 * included, is timed by TLS handshake over IPv4 and IPv6 apart and tried
 * fastest first with the family that won; ties keep the server's order. The
 * family matters: an edge network may answer AAAA queries with an address on
 * another continent while its A records are near, and the TCP probe above
 * takes whichever family the system prefers.
 */
export async function chooseUploadUrls(instruction: {
  url: string;
  backupUrl?: string;
  backupUrls?: string[];
}): Promise<UploadTarget[]> {
  const urls = (items: string[]) => items.map((item) => ({ url: item }));
  const { url, backupUrl } = instruction;
  const listed = Array.isArray(instruction.backupUrls)
    ? instruction.backupUrls.filter((item) => typeof item === 'string' && item)
    : [];
  const backups = [
    ...new Set([...(backupUrl ? [backupUrl] : []), ...listed]),
    // GCS hands out the same url twice: nothing to switch to, no probe needed
  ].filter((item) => item !== url);
  if (backups.length === 0) {
    return urls([url]);
  }
  if (global.USE_ACC_OSS) {
    return urls([...backups, url]);
  }
  if (resolveProxy(url)) {
    // a direct probe says nothing about the path through a proxy (and
    // usually cannot connect at all): the primary url stays in that case
    return urls([url, ...backups]);
  }
  const latency = await measureTcpLatency(url, {
    attempts: 4,
    timeout: 1000,
  });
  if (Number.isFinite(latency) && latency <= UPLOAD_PRIMARY_MAX_LATENCY_MS) {
    return urls([url, ...backups]);
  }
  if (!Array.isArray(instruction.backupUrls)) {
    // an older server: one backup, chosen on the primary's probe alone
    return urls([...backups, url]);
  }
  const timed = await Promise.all(
    [url, ...backups].map(async (item) => ({
      url: item,
      ...(await measureTlsLatencyByFamily(item)),
    })),
  );
  // Array.prototype.sort is stable: ties keep the server's order
  timed.sort((a, b) =>
    a.latency === b.latency ? 0 : a.latency < b.latency ? -1 : 1,
  );
  return timed.map(({ url: item, family }) => ({
    url: item,
    ...(family ? { family } : {}),
  }));
}

/**
 * An answer worth trying the next address for: whatever fronts the store is
 * failing (5xx), turned the request away (403/410) or caps uploads below the
 * store's own limit (413). A store that refuses the form itself answers the
 * same everywhere, which costs one more short request.
 */
function uploadAnswerIsRetriableElsewhere(status: number): boolean {
  return status >= 500 || status === 403 || status === 410 || status === 413;
}

function uploadHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export async function uploadFile(fn: string, appId?: string | number) {
  const fileSize = fs.statSync(fn).size;
  // appId 用于服务端路由:绑定了自托管节点(rnu-node)的应用,
  // 上传指令会指向节点或其对象存储。chunked + size 让支持的服务端(GCS)
  // 改发分片并行上传的指令;不认识这两个字段的服务端照旧整文件上传
  const resp = await post('/upload', {
    ext: path.extname(fn),
    ...(appId ? { appId: Number(appId) } : {}),
    chunked: true,
    size: fileSize,
  });
  const { formData, maxSize } = resp;
  const uploadTargets = await chooseUploadUrls(resp);
  let realUrl = uploadTargets[0].url;

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

  // progress is only needed here; keep it off the startup path
  const progressModule = require('progress');
  const ProgressBarImpl = (progressModule.default ??
    progressModule) as typeof import('progress');
  const bar = new ProgressBarImpl('  Uploading [:bar] :percent :etas', {
    complete: '=',
    incomplete: ' ',
    total: fileSize,
  });

  const rethrowUploadError = (error: unknown): never => {
    throw networkError(error, realUrl);
  };

  // 自托管节点的 s3 直传:服务端下发预签名 PUT,字节直达用户的对象存储
  if (resp.method === 'PUT') {
    let putRes: UploadResponse;
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

  const postForm =
    (fields: Record<string, string>, byteCount: number) =>
    (fileStream: fs.ReadStream): UploadRequest =>
      multipartRequest(fields, {
        name: fn,
        size: byteCount,
        stream: fileStream,
      });

  if (resp.chunked) {
    try {
      await sendChunks(fn, realUrl, fileSize, bar, resp.chunked, postForm);
    } catch (error) {
      if (error instanceof ChunkRejectedError) {
        throw createRequestError(error.message, realUrl);
      }
      return rethrowUploadError(error);
    }
    await post('/upload/complete', {
      key: resp.chunked.key,
      parts: resp.chunked.parts.length,
    });
    return { hash: resp.chunked.key as string };
  }

  // Only the plain form upload has alternatives: a presigned PUT and the parts
  // of a chunked upload are bound to the address they were issued for.
  let res: UploadResponse | undefined;
  for (const [index, target] of uploadTargets.entries()) {
    realUrl = target.url;
    const next = uploadTargets[index + 1]?.url;
    let reason: string;
    try {
      res = await sendUpload(
        fn,
        target.url,
        fileSize,
        bar,
        postForm(formData, fileSize),
        undefined,
        target.family,
      );
      if (!next || !uploadAnswerIsRetriableElsewhere(res.status)) {
        break;
      }
      reason = `${res.status}`;
    } catch (error) {
      if (!next) {
        return rethrowUploadError(error);
      }
      reason = error instanceof Error ? error.message : String(error);
    }
    console.warn(
      `\nUpload via ${uploadHost(target.url)} failed (${reason}), trying ${uploadHost(next)}...`,
    );
    bar.curr = 0;
  }
  if (!res) {
    // unreachable: the last address either answers or throws above
    throw createRequestError('Upload failed', realUrl);
  }

  if (res.status > 299) {
    throw createRequestError(
      `${res.status}: ${res.statusText || 'Upload failed'}`,
      realUrl,
    );
  }

  return { hash: formData.key };
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
