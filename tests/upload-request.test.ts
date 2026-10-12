import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { randomBytes } from 'crypto';
import fs from 'fs';
import http from 'http';
import type { AddressInfo } from 'net';
import os from 'os';
import path from 'path';
import {
  fileContentType,
  multipartRequest,
  sendUploadRequest,
} from '../src/utils/upload-request';

type Received = {
  method?: string;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
};

let dir: string;
let server: http.Server;
let base: string;
const received: Received[] = [];

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rnu-upload-request-'));
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      received.push({
        method: req.method,
        headers: req.headers,
        body: Buffer.concat(chunks),
      });
      if (req.url === '/hang') return;
      res.writeHead(req.url === '/denied' ? 403 : 204);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeFile(name: string, data: Buffer) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, data);
  return file;
}

describe('upload-request', () => {
  test('file content types match what form-data used to send', () => {
    expect(fileContentType('a.apk')).toBe(
      'application/vnd.android.package-archive',
    );
    expect(fileContentType('a.aab')).toBe('application/x-authorware-bin');
    expect(fileContentType('a.map')).toBe('application/json');
    expect(fileContentType('/x/a.ppk')).toBe('application/octet-stream');
    expect(fileContentType('a.ipa')).toBe('application/octet-stream');
    expect(fileContentType('a.app')).toBe('application/octet-stream');
  });

  test('posts a multipart form with an exact Content-Length', async () => {
    const data = randomBytes(3 << 20);
    const file = writeFile('bundle.ppk', data);
    const stream = fs.createReadStream(file);
    let progress = 0;
    stream.on('data', (chunk) => {
      progress += chunk.length;
    });
    received.length = 0;
    const res = await sendUploadRequest(
      `${base}/ok`,
      multipartRequest(
        { key: 'k/1', policy: 'p' },
        { name: file, size: data.length, stream },
      ),
      { userAgent: 'rnu-test' },
    );
    expect(res).toEqual({ status: 204, statusText: 'No Content' });
    expect(progress).toBe(data.length);

    const [{ method, headers, body }] = received;
    expect(method).toBe('POST');
    expect(headers['user-agent']).toBe('rnu-test');
    expect(Number(headers['content-length'])).toBe(body.length);
    expect(headers['transfer-encoding']).toBeUndefined();
    const boundary = /^multipart\/form-data;boundary=(-+[0-9a-f]{24})$/.exec(
      headers['content-type'] ?? '',
    )?.[1];
    expect(boundary).toBeDefined();
    const head =
      `--${boundary}\r\nContent-Disposition: form-data; name="key"\r\n\r\nk/1\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="policy"\r\n\r\np\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="bundle.ppk"\r\n` +
      'Content-Type: application/octet-stream\r\n\r\n';
    expect(body).toEqual(
      Buffer.concat([
        Buffer.from(head),
        data,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
    );
  });

  test('sends a raw PUT body with the given headers', async () => {
    const data = randomBytes(1000);
    const file = writeFile('package.apk', data);
    received.length = 0;
    const res = await sendUploadRequest(
      `${base}/ok`,
      {
        method: 'PUT',
        headers: { 'content-length': '1000', 'x-amz-acl': 'private' },
        body: fs.createReadStream(file),
      },
      {},
    );
    expect(res.status).toBe(204);
    expect(received[0].method).toBe('PUT');
    expect(received[0].headers['x-amz-acl']).toBe('private');
    expect(received[0].body).toEqual(data);
  });

  test('resolves with an HTTP error status instead of rejecting', async () => {
    const file = writeFile('denied.ppk', Buffer.from('x'));
    const res = await sendUploadRequest(
      `${base}/denied`,
      multipartRequest(
        {},
        { name: file, size: 1, stream: fs.createReadStream(file) },
      ),
      {},
    );
    expect(res).toEqual({ status: 403, statusText: 'Forbidden' });
  });

  test('a file shorter than its declared size fails instead of hanging', async () => {
    const file = writeFile('shrunk.ppk', Buffer.from('abc'));
    await expect(
      sendUploadRequest(
        `${base}/ok`,
        multipartRequest(
          {},
          { name: file, size: 10, stream: fs.createReadStream(file) },
        ),
        {},
      ),
    ).rejects.toThrow('changed during the upload: sent 3 of 10 bytes');
  });

  test('aborting rejects with an AbortError', async () => {
    const file = writeFile('hang.ppk', Buffer.from('x'));
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    await expect(
      sendUploadRequest(
        `${base}/hang`,
        multipartRequest(
          {},
          { name: file, size: 1, stream: fs.createReadStream(file) },
        ),
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: 'AbortError', code: 'ABORT_ERR' });
  });

  test('a refused connection rejects with its error code', async () => {
    const file = writeFile('refused.ppk', Buffer.from('x'));
    await expect(
      sendUploadRequest(
        'http://127.0.0.1:1/',
        multipartRequest(
          {},
          { name: file, size: 1, stream: fs.createReadStream(file) },
        ),
        {},
      ),
    ).rejects.toMatchObject({ code: 'ECONNREFUSED' });
  });
});
