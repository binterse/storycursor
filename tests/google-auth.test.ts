import { createHash, createHmac, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { handle, handleGet } from '../apps/sheets-script/main';

const endpoint = 'https://script.google.com/macros/s/test-deployment/exec';
const proof = '91'.repeat(32);
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const token = '4e'.repeat(32);
const account = 'owner@gmail.com';
const now = new Date('2025-04-17T11:30:00Z');
const cache = new Map<string, string>();
let properties: Record<string, string>;
let googleAccount: { sub: string; email: string; email_verified: boolean };

function post(input: object) {
  return handle({ postData: { contents: JSON.stringify(input) } }) as Record<string, unknown>;
}
function callback(state: string) {
  return handleGet({ parameter: { state, code: 'synthetic-google-code' } }) as Record<string, unknown>;
}
function begin() {
  const answer = post({ action: 'googleBegin', proofHash: sha(proof) });
  expect(answer.status).toBe('ready');
  return { state: String(answer.state), url: new URL(String(answer.url)) };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  cache.clear();
  properties = { CLIENT_TOKEN: token, GOOGLE_OAUTH_CLIENT_ID: 'test.apps.googleusercontent.com',
    GOOGLE_OAUTH_CLIENT_SECRET: 'synthetic-client-secret', GOOGLE_OAUTH_REDIRECT_URI: endpoint, GOOGLE_OAUTH_ALLOWED_EMAIL: account };
  googleAccount = { sub: 'synthetic-account', email: account, email_verified: true };
  vi.stubGlobal('PropertiesService', { getScriptProperties: () => ({ getProperty: (key: string) => properties[key] ?? null }) });
  vi.stubGlobal('CacheService', { getScriptCache: () => ({ get: (key: string) => cache.get(key), put: (key: string, value: string) => cache.set(key, value) }) });
  vi.stubGlobal('Utilities', {
    getUuid: randomUUID, DigestAlgorithm: {}, Charset: {},
    computeDigest: (_: unknown, text: string) => [...createHash('sha256').update(text).digest()],
    computeHmacSha256Signature: (text: string, key: string) => [...createHmac('sha256', key).update(text).digest()],
  });
  vi.stubGlobal('LockService', { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) });
  vi.stubGlobal('ContentService', { createTextOutput: (body: string) => ({ setMimeType: () => JSON.parse(body) }), MimeType: { JSON: 'json' } });
  vi.stubGlobal('UrlFetchApp', { fetch: (url: string, options: { payload?: string; headers?: Record<string, string> }) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      expect(new URLSearchParams(options.payload).get('redirect_uri')).toBe(endpoint);
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ access_token: 'google-access' }) };
    }
    expect(url).toBe('https://openidconnect.googleapis.com/v1/userinfo');
    expect(options.headers?.Authorization).toBe('Bearer google-access');
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify(googleAccount) };
  } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('requires the original extension proof and the code delivered through the browser callback', () => {
  const { state, url } = begin();
  expect(url.origin).toBe('https://accounts.google.com');
  expect(url.searchParams.get('redirect_uri')).toBe(endpoint);
  expect(url.searchParams.get('scope')).toBe('openid email');
  expect(url.href).not.toContain(proof);
  expect(post({ action: 'googleFinish', state, proof })).toHaveProperty('status', 'failed');
  const { browserCode } = callback(state);
  expect(browserCode).toMatch(/^[a-f0-9]{32}$/);
  expect(callback(state)).not.toHaveProperty('browserCode');
  expect(post({ action: 'googleFinish', state, proof, browserCode: state })).toHaveProperty('status', 'failed');
  expect(post({ action: 'googleFinish', state, proof: token, browserCode })).toHaveProperty('status', 'failed');
  const session = post({ action: 'googleFinish', state, proof, browserCode });
  expect(session.status).toBe('ready');
  expect(session.token).not.toBe(token);
  expect(post({ action: 'folders', token: session.token })).toMatchObject({ status: 'ready', folders: null });
  vi.setSystemTime(now.getTime() + 31 * 24 * 60 * 60 * 1000);
  expect(post({ action: 'folders', token: session.token })).toHaveProperty('message', 'Unauthorized.');
});

it.each([
  { email: 'another@example.test', email_verified: true },
  { email: account, email_verified: false },
])('rejects a Google account that is different or unverified', profile => {
  const { state } = begin();
  googleAccount = { sub: 'synthetic-account', ...profile };
  expect(callback(state)).toHaveProperty('status', 'failed');
  expect(post({ action: 'googleFinish', state, proof, browserCode: state })).toHaveProperty('status', 'failed');
});

it('expires the login attempt and rejects credentials after changing the allowed account', () => {
  const active = begin();
  const { browserCode } = callback(active.state);
  properties.GOOGLE_OAUTH_ALLOWED_EMAIL = 'another@example.test';
  expect(post({ action: 'googleFinish', state: active.state, proof, browserCode })).toHaveProperty('status', 'failed');
  const expiring = begin();
  vi.setSystemTime(now.getTime() + 9 * 60 * 1000);
  expect(callback(expiring.state)).not.toHaveProperty('browserCode');
});

it('requires a pinned Google subject for an account with an external email', () => {
  googleAccount = { sub: 'synthetic-account', email: 'owner@example.test', email_verified: true };
  properties.GOOGLE_OAUTH_ALLOWED_EMAIL = googleAccount.email;
  expect(callback(begin().state)).toHaveProperty('status', 'failed');
  properties.GOOGLE_OAUTH_ALLOWED_SUB = 'different-account';
  expect(callback(begin().state)).toHaveProperty('status', 'failed');
  properties.GOOGLE_OAUTH_ALLOWED_SUB = googleAccount.sub;
  expect(callback(begin().state)).toHaveProperty('status', 'ready');
});
