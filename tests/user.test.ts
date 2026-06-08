import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import crypto from 'crypto';

import * as api from '../src/api';
import { userCommands } from '../src/user';
import * as utils from '../src/utils';

function md5(str: string) {
  return crypto.createHash('md5').update(str).digest('hex');
}

describe('userCommands.login', () => {
  let consoleSpy: ReturnType<typeof spyOn>;
  let postSpy: ReturnType<typeof spyOn>;
  let replaceSessionSpy: ReturnType<typeof spyOn>;
  let saveSessionSpy: ReturnType<typeof spyOn>;
  let questionSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    postSpy = spyOn(api, 'post').mockResolvedValue({
      token: 'session-token-abc',
      info: { name: 'TestUser', email: 'test@example.com' },
    });
    replaceSessionSpy = spyOn(api, 'replaceSession').mockImplementation(
      () => {},
    );
    saveSessionSpy = spyOn(api, 'saveSession').mockResolvedValue(undefined);
    questionSpy = spyOn(utils, 'question').mockResolvedValue('fallback');
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    postSpy.mockRestore();
    replaceSessionSpy.mockRestore();
    saveSessionSpy.mockRestore();
    questionSpy.mockRestore();
  });

  test('calls post with /user/login and md5-hashes the password', async () => {
    await userCommands.login({
      args: ['user@example.com', 'mypassword'],
    });

    expect(postSpy).toHaveBeenCalledWith('/user/login', {
      email: 'user@example.com',
      pwd: md5('mypassword'),
    });
  });

  test('md5 hash is a valid 32-char hex string', async () => {
    await userCommands.login({
      args: ['user@example.com', 'secret123'],
    });

    const callArgs = postSpy.mock.calls[0];
    const pwdHash = callArgs[1].pwd as string;
    expect(pwdHash).toHaveLength(32);
    expect(pwdHash).toMatch(/^[0-9a-f]{32}$/);
    expect(pwdHash).toBe(md5('secret123'));
  });

  test('calls replaceSession with the returned token', async () => {
    await userCommands.login({
      args: ['user@example.com', 'mypassword'],
    });

    expect(replaceSessionSpy).toHaveBeenCalledWith({
      token: 'session-token-abc',
    });
  });

  test('calls saveSession after replaceSession', async () => {
    await userCommands.login({
      args: ['user@example.com', 'mypassword'],
    });

    expect(saveSessionSpy).toHaveBeenCalled();
    expect(replaceSessionSpy).toHaveBeenCalled();

    // Verify call order: replaceSession should be called before saveSession
    const replaceOrder = replaceSessionSpy.mock.invocationCallOrder[0];
    const saveOrder = saveSessionSpy.mock.invocationCallOrder[0];
    expect(replaceOrder).toBeLessThan(saveOrder);
  });

  test('prompts for email and password when args are missing', async () => {
    let _callCount = 0;
    questionSpy.mockImplementation(async (prompt: string) => {
      _callCount++;
      if (prompt === 'email:') return 'asked@email.com';
      return 'asked-password';
    });

    await userCommands.login({ args: [] });

    expect(questionSpy).toHaveBeenCalledTimes(2);
    expect(postSpy).toHaveBeenCalledWith('/user/login', {
      email: 'asked@email.com',
      pwd: md5('asked-password'),
    });
  });

  test('logs welcome message with user name', async () => {
    await userCommands.login({
      args: ['user@example.com', 'mypassword'],
    });

    expect(consoleSpy).toHaveBeenCalled();
    // The welcome message includes the user's name
    const logOutput = consoleSpy.mock.calls[0][0] as string;
    expect(logOutput).toContain('TestUser');
  });
});

describe('userCommands.logout', () => {
  let consoleSpy: ReturnType<typeof spyOn>;
  let closeSessionSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    closeSessionSpy = spyOn(api, 'closeSession').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    closeSessionSpy.mockRestore();
  });

  test('calls closeSession', async () => {
    await userCommands.logout({} as any);

    expect(closeSessionSpy).toHaveBeenCalled();
  });

  test('logs a message after logout', async () => {
    await userCommands.logout({} as any);

    expect(consoleSpy).toHaveBeenCalled();
  });
});

describe('userCommands.me', () => {
  let consoleSpy: ReturnType<typeof spyOn>;
  let getSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    getSpy = spyOn(api, 'get').mockResolvedValue({
      ok: true,
      name: 'TestUser',
      email: 'test@example.com',
      id: '12345',
    });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    getSpy.mockRestore();
  });

  test('calls get with /user/me', async () => {
    await userCommands.me();

    expect(getSpy).toHaveBeenCalledWith('/user/me');
  });

  test('logs each field except "ok"', async () => {
    await userCommands.me();

    // Should log name, email, id but NOT ok
    const logCalls = consoleSpy.mock.calls.map((c) => c[0] as string);
    expect(logCalls).toContain('name: TestUser');
    expect(logCalls).toContain('email: test@example.com');
    expect(logCalls).toContain('id: 12345');

    // Should not log the "ok" field
    const hasOk = logCalls.some((msg) => msg.startsWith('ok:'));
    expect(hasOk).toBe(false);
  });

  test('skips the "ok" field when logging', async () => {
    await userCommands.me();

    const logCalls = consoleSpy.mock.calls.map((c) => c[0] as string);
    for (const msg of logCalls) {
      expect(msg).not.toMatch(/^ok:/);
    }
  });
});
