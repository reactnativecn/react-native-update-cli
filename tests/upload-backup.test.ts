import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import fs from 'fs';
import { createServer } from 'net';
import os from 'os';
import path from 'path';

const uploadRequest = await import('../src/utils/upload-request');
const { chooseUploadUrls, uploadFile } = await import('../src/api');
const runtime = await import('../src/utils/runtime');
const httpHelper = await import('../src/utils/http-helper');

const tmp = path.join(os.tmpdir(), `rnu-backup-${process.pid}.ppk`);
const oss = 'https://bucket.oss-cn-beijing.aliyuncs.com';
const acc = 'https://bucket.oss-accelerate.aliyuncs.com';
const node = 'https://up.example';
const entry = 'https://up2.example';

const order = async (instruction: Parameters<typeof chooseUploadUrls>[0]) =>
  (await chooseUploadUrls(instruction)).map((target) => target.url);

describe('upload address selection', () => {
  let spies: { mockRestore: () => void }[] = [];
  const env = { ...process.env };
  let posted: string[] = [];
  let families: (4 | 6 | undefined)[] = [];
  let answers: Record<string, number | Error> = {};

  afterEach(() => {
    for (const spy of spies) spy.mockRestore();
    spies = [];
    posted = [];
    families = [];
    answers = {};
    process.env = { ...env };
    global.USE_ACC_OSS = undefined;
    fs.rmSync(tmp, { force: true });
  });

  function setup(
    instruction: Record<string, unknown>,
    tcpLatency: number,
    tlsLatency: Record<string, number | { v4?: number; v6?: number }> = {},
  ) {
    fs.writeFileSync(tmp, 'bundle');
    for (const name of [
      'HTTPS_PROXY',
      'https_proxy',
      'HTTP_PROXY',
      'http_proxy',
    ]) {
      delete process.env[name];
    }
    spies.push(
      spyOn(runtime, 'runtimeFetch').mockImplementation(async () => ({
        status: 200,
        statusText: 'OK',
        text: async () =>
          JSON.stringify({ formData: { key: 'k' }, ...instruction }),
      })),
      spyOn(uploadRequest, 'sendUploadRequest').mockImplementation(
        async (url, request, options) => {
          for await (const _ of request.body) {
            // drain, as the socket would
          }
          posted.push(url);
          families.push(options.family);
          const answer = answers[url] ?? 204;
          if (answer instanceof Error) {
            throw answer;
          }
          return { status: answer, statusText: '' };
        },
      ),
      spyOn(runtime, 'measureTcpLatency').mockResolvedValue(tcpLatency),
      spyOn(runtime, 'measureTlsLatency').mockImplementation(
        async (url: string, options?: { family?: 4 | 6 }) => {
          const entry = tlsLatency[url];
          if (typeof entry === 'number') {
            // a name with A records only
            return options?.family === 6 ? Number.POSITIVE_INFINITY : entry;
          }
          const value = options?.family === 6 ? entry?.v6 : entry?.v4;
          return value ?? Number.POSITIVE_INFINITY;
        },
      ),
      spyOn(httpHelper, 'getBaseUrl').mockResolvedValue('https://api.test'),
      spyOn(console, 'warn').mockImplementation(() => {}),
    );
  }

  test('a near primary stays first and nothing else is probed', async () => {
    setup({}, 30);
    expect(
      await order({
        url: oss,
        backupUrl: acc,
        backupUrls: [acc, node],
      }),
    ).toEqual([oss, acc, node]);
    expect(runtime.measureTlsLatency).not.toHaveBeenCalled();
  });

  test('a far primary gives way to the fastest alternative', async () => {
    setup({}, 320, { [acc]: 180, [node]: 60, [entry]: 95 });
    expect(
      await order({
        url: oss,
        backupUrl: acc,
        backupUrls: [acc, node, entry],
      }),
    ).toEqual([node, entry, acc, oss]);
  });

  test('each alternative keeps the address family that probed faster', async () => {
    setup({}, 320, {
      [acc]: 180,
      // an edge that answers AAAA with a far address
      [node]: { v4: 15, v6: 360 },
      [entry]: { v6: 40 },
    });
    expect(
      await chooseUploadUrls({
        url: oss,
        backupUrl: acc,
        backupUrls: [acc, node, entry],
      }),
    ).toEqual([
      { url: node, family: 4 },
      { url: entry, family: 6 },
      { url: acc, family: 4 },
      { url: oss },
    ]);
  });

  test('a tie between the families goes to IPv4', async () => {
    setup({}, 320, { [acc]: 180, [node]: { v4: 20, v6: 20 } });
    expect(
      await chooseUploadUrls({ url: oss, backupUrls: [acc, node] }),
    ).toEqual([
      { url: node, family: 4 },
      { url: acc, family: 4 },
      { url: oss },
    ]);
  });

  test('alternatives that do not answer go behind those that do', async () => {
    setup({}, Number.POSITIVE_INFINITY, { [acc]: 200 });
    expect(await order({ url: oss, backupUrls: [node, acc, entry] })).toEqual([
      acc,
      node,
      entry,
      oss,
    ]);
  });

  test('a server that names one backup needs no second probe', async () => {
    setup({}, 320);
    expect(await order({ url: oss, backupUrl: acc })).toEqual([acc, oss]);
    expect(runtime.measureTlsLatency).not.toHaveBeenCalled();
  });

  test('the same address twice is one address, unprobed', async () => {
    setup({}, 320);
    expect(
      await order({ url: oss, backupUrl: oss, backupUrls: [oss] }),
    ).toEqual([oss]);
    expect(runtime.measureTcpLatency).not.toHaveBeenCalled();
  });

  test('behind a proxy nothing is probed and the primary stays', async () => {
    setup({}, 320);
    process.env.HTTPS_PROXY = 'http://proxy.test:3128';
    expect(await order({ url: oss, backupUrls: [acc, node] })).toEqual([
      oss,
      acc,
      node,
    ]);
    expect(runtime.measureTcpLatency).not.toHaveBeenCalled();
  });

  test('--acc puts the backups first without probing', async () => {
    setup({}, 10);
    global.USE_ACC_OSS = true;
    expect(
      await order({
        url: oss,
        backupUrl: acc,
        backupUrls: [acc, node],
      }),
    ).toEqual([acc, node, oss]);
    expect(runtime.measureTcpLatency).not.toHaveBeenCalled();
  });

  test('uploads to the chosen address', async () => {
    setup({ url: oss, backupUrl: acc, backupUrls: [acc, node] }, 320, {
      [acc]: 180,
      [node]: 60,
    });
    expect(await uploadFile(tmp)).toEqual({ hash: 'k' });
    expect(posted).toEqual([node]);
    expect(families).toEqual([4]);
  });

  test('uploads over the family that probed faster', async () => {
    setup({ url: oss, backupUrl: acc, backupUrls: [acc, node] }, 320, {
      [acc]: 180,
      [node]: { v4: 15, v6: 360 },
    });
    expect(await uploadFile(tmp)).toEqual({ hash: 'k' });
    expect(posted).toEqual([node]);
    expect(families).toEqual([4]);
  });

  test('the primary is left to the system to pick a family', async () => {
    setup({ url: oss, backupUrl: acc, backupUrls: [acc, node] }, 30);
    expect(await uploadFile(tmp)).toEqual({ hash: 'k' });
    expect(posted).toEqual([oss]);
    expect(families).toEqual([undefined]);
  });

  test('moves on when an address turns the upload away or is failing', async () => {
    setup({ url: oss, backupUrl: acc, backupUrls: [acc, node, entry] }, 320, {
      [acc]: 180,
      [node]: 60,
      [entry]: 95,
    });
    answers = { [node]: 413, [entry]: 502 };
    expect(await uploadFile(tmp)).toEqual({ hash: 'k' });
    expect(posted).toEqual([node, entry, acc]);
  });

  test('moves on when an address cannot be reached', async () => {
    setup({ url: oss, backupUrl: acc, backupUrls: [acc, node] }, 320, {
      [acc]: 180,
      [node]: 60,
    });
    answers = { [node]: new Error('getaddrinfo ENOTFOUND up.example') };
    expect(await uploadFile(tmp)).toEqual({ hash: 'k' });
    expect(posted).toEqual([node, acc]);
  });

  test('a refusal of the form itself is not retried elsewhere', async () => {
    setup({ url: oss, backupUrl: acc, backupUrls: [acc, node] }, 30);
    answers = { [oss]: 400 };
    await expect(uploadFile(tmp)).rejects.toThrow('400');
    expect(posted).toEqual([oss]);
  });

  test('the last address reports its own failure', async () => {
    setup({ url: oss, backupUrl: acc }, 30);
    answers = { [oss]: 503, [acc]: 503 };
    await expect(uploadFile(tmp)).rejects.toThrow('503');
    expect(posted).toEqual([oss, acc]);
  });
});

describe('address family pinning', () => {
  test('an upload request connects over the family it is given', async () => {
    const { createServer: createHttpServer } = await import('http');
    const { Readable } = await import('stream');
    const server = createHttpServer((req, res) => {
      req.resume();
      req.on('end', () => {
        res.statusCode = 204;
        res.end();
      });
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Unable to bind local server');
    }
    const request = () => ({
      method: 'POST',
      headers: { 'content-length': '2' },
      body: Readable.from([Buffer.from('ok')]),
    });
    const url = `http://localhost:${address.port}/`;
    try {
      const over4 = await uploadRequest.sendUploadRequest(url, request(), {
        family: 4,
      });
      expect(over4.status).toBe(204);
      // the server listens on IPv4 only: pinned to IPv6, localhost has no way in
      await expect(
        uploadRequest.sendUploadRequest(url, request(), { family: 6 }),
      ).rejects.toThrow();
    } finally {
      server.close();
    }
  });

  test('measuring by family reports the family that completed', async () => {
    const server = createServer((socket) => {
      socket.end();
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Unable to bind local TCP server');
    }
    try {
      const result = await runtime.measureTlsLatencyByFamily(
        `http://localhost:${address.port}/x`,
        { attempts: 1, timeout: 1000 },
      );
      expect(result.family).toBe(4);
      expect(Number.isFinite(result.latency)).toBe(true);
    } finally {
      server.close();
    }
  });
});

describe('TLS latency measurement', () => {
  test('is infinite when the peer does not speak TLS', async () => {
    const server = createServer((socket) => {
      socket.end();
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Unable to bind local TCP server');
    }
    try {
      expect(
        await runtime.measureTlsLatency(`https://127.0.0.1:${address.port}/x`, {
          attempts: 1,
          timeout: 1000,
        }),
      ).toBe(Number.POSITIVE_INFINITY);
      expect(
        Number.isFinite(
          await runtime.measureTlsLatency(
            `http://127.0.0.1:${address.port}/x`,
            { attempts: 1, timeout: 1000 },
          ),
        ),
      ).toBe(true);
    } finally {
      server.close();
    }
  });
});
