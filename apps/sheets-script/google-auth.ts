import { signInErrors } from '../../packages/core/sign-in';
type Failure = keyof typeof signInErrors;
class ProviderError extends Error {
  constructor(readonly reason: Failure) { super(signInErrors[reason]); }
}
type Properties = { getProperty(key: string): string | null };
type Cache = { get(key: string): string | null; put(key: string, value: string, seconds: number): void };
type GoogleConfig = { client: string; secret: string; endpoint: string; email: string; subject?: string; signingKey: string };
type Attempt = { proofHash: string; until: number; phase: 'waiting' | 'processing' | 'denied' | 'ready'; browserCodeHash?: string; grantUntil?: number };
declare const Utilities: {
  getUuid(): string;
  computeHmacSha256Signature(value: string, key: string): number[];
  computeDigest(algorithm: unknown, value: string, charset: unknown): number[];
  DigestAlgorithm: { SHA_256: unknown }; Charset: { UTF_8: unknown };
};
declare const CacheService: { getScriptCache(): Cache };
declare const LockService: { getScriptLock(): { tryLock(ms: number): boolean; releaseLock(): void } };
declare const UrlFetchApp: { fetch(url: string, options: object): { getResponseCode(): number; getContentText(): string } };

const hex = (bytes: number[]) => bytes.map(byte => (byte & 255).toString(16).padStart(2, '0')).join('');
const sha256 = (value: string) => hex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8));
const isSecret = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
const isState = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
const seconds = () => Math.floor(Date.now() / 1000);
const attemptSeconds = 480;
const sessionSeconds = 30 * 24 * 60 * 60;
const cacheKey = (config: GoogleConfig, state: string) => 'google-sign-in:' + state + ':' + mac(config, state);

export function googleConfig(properties: Properties): GoogleConfig | undefined {
  const client = properties.getProperty('GOOGLE_OAUTH_CLIENT_ID');
  const secret = properties.getProperty('GOOGLE_OAUTH_CLIENT_SECRET');
  const endpoint = properties.getProperty('GOOGLE_OAUTH_REDIRECT_URI');
  const email = properties.getProperty('GOOGLE_OAUTH_ALLOWED_EMAIL')?.trim().toLowerCase();
  const subject = properties.getProperty('GOOGLE_OAUTH_ALLOWED_SUB')?.trim() || undefined;
  const signingKey = properties.getProperty('CLIENT_TOKEN');
  if (!client || !/^[A-Za-z0-9.-]+\.apps\.googleusercontent\.com$/.test(client) || !secret ||
      !endpoint || !/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(endpoint) ||
      !email || !/^[^@\s]+@[^@\s]+$/.test(email) || !isSecret(signingKey)) return;
  return { client, secret, endpoint, email, subject, signingKey };
}

function equal(left: string, right: string) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index++) diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return diff === 0;
}

function mac(config: GoogleConfig, payload: string) {
  const context = JSON.stringify(['storycursor-google-session-v1', config.client, config.endpoint, config.email, config.subject ?? '', payload]);
  return hex(Utilities.computeHmacSha256Signature(context, config.signingKey)).slice(0, 32);
}

export function isGoogleSession(config: GoogleConfig | undefined, token: unknown) {
  if (!config || !isSecret(token)) return false;
  const payload = token.slice(0, 32);
  const until = Number.parseInt(payload.slice(0, 12), 16);
  const now = seconds();
  return until > now && until <= now + sessionSeconds && equal(token.slice(32), mac(config, payload));
}

function form(fields: Record<string, string>) {
  return Object.entries(fields).map(([key, value]) => encodeURIComponent(key) + '=' + encodeURIComponent(value)).join('&');
}

function read(config: GoogleConfig, cache: Cache, state: string): Attempt | undefined {
  const entry = cache.get(cacheKey(config, state));
  if (!entry) return;
  const attempt = JSON.parse(entry) as Attempt;
  if (attempt.until > seconds()) return attempt;
}

function save(config: GoogleConfig, cache: Cache, state: string, attempt: Attempt) {
  const remaining = attempt.until - seconds();
  if (remaining > 0) cache.put(cacheKey(config, state), JSON.stringify(attempt), remaining);
}

export function beginGoogle(config: GoogleConfig | undefined, proofHash: unknown) {
  if (!config) return { status: 'failed', message: 'Google sign-in is not configured.' };
  if (!isSecret(proofHash)) return { status: 'failed', message: 'Invalid sign-in request.' };
  const state = Utilities.getUuid().replace(/-/g, '').toLowerCase();
  const attempt: Attempt = { proofHash, until: seconds() + attemptSeconds, phase: 'waiting' };
  save(config, CacheService.getScriptCache(), state, attempt);
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + form({
    client_id: config.client, redirect_uri: config.endpoint, response_type: 'code', scope: 'openid email',
    state, prompt: 'select_account',
  });
  return { status: 'ready', state, url };
}

export function finishGoogle(config: GoogleConfig | undefined, state: unknown, proof: unknown, browserCode: unknown) {
  const invalid = { status: 'failed', message: 'Sign-in expired or invalid. Try again.' };
  if (!config || !isState(state) || !isSecret(proof) || !isState(browserCode)) return invalid;
  const attempt = read(config, CacheService.getScriptCache(), state);
  if (!attempt || attempt.phase !== 'ready' || !attempt.grantUntil || !attempt.browserCodeHash ||
      !equal(attempt.proofHash, sha256(proof)) || !equal(attempt.browserCodeHash, sha256(browserCode))) return invalid;
  const payload = attempt.grantUntil.toString(16).padStart(12, '0') + state.slice(0, 20);
  return { status: 'ready', token: payload + mac(config, payload) };
}

function googleJson(url: string, options: object) {
  const response = UrlFetchApp.fetch(url, { ...options, followRedirects: false, muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) {
    const { error } = JSON.parse(response.getContentText());
    if (error === 'invalid_client' || error === 'redirect_uri_mismatch') throw new ProviderError('service-client');
    throw new ProviderError(error === 'invalid_grant' ? 'exchange' : 'service');
  }
  return JSON.parse(response.getContentText());
}

function verifiedAccount(config: GoogleConfig, code: string) {
  const { access_token: token } = googleJson('https://oauth2.googleapis.com/token', {
    method: 'post', contentType: 'application/x-www-form-urlencoded',
    payload: form({ code, client_id: config.client, client_secret: config.secret,
      redirect_uri: config.endpoint, grant_type: 'authorization_code' }),
  });
  if (typeof token !== 'string' || !token || /[\r\n]/.test(token)) return false;
  const account = googleJson('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: 'Bearer ' + token } });
  if (typeof account.sub !== 'string' || !account.sub || account.email_verified !== true ||
      typeof account.email !== 'string' || account.email.toLowerCase() !== config.email) return false;
  if (config.subject) return account.sub === config.subject;
  const domain = config.email.split('@')[1];
  return domain === 'gmail.com' || (typeof account.hd === 'string' && account.hd.toLowerCase() === domain);
}

// Run from the script editor to authorize outbound requests and check the
// deployment. A deliberately invalid code cannot produce a Google credential.
export function checkGoogleDeployment(properties: Properties) {
  const config = googleConfig(properties);
  if (!config) throw new Error('Configure Google sign-in in Script Properties.');
  try {
    verifiedAccount(config, 'storycursor-deployment-check');
  } catch (error) {
    if (error instanceof ProviderError && error.reason === 'exchange') return 'Google token endpoint reached.';
    throw error;
  }
  throw new Error('Unexpected Google deployment check result.');
}

export function googleCallback(config: GoogleConfig | undefined, { state, code, error }: { state?: string; code?: string; error?: string }) {
  const denied = (reason: Failure) => ({ status: 'failed', state, reason, message: signInErrors[reason] });
  if (!config || !isState(state)) return { status: 'failed', message: 'StoryCursor sign-in unavailable.' };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return denied('busy');
  const cache = CacheService.getScriptCache();
  let attempt: Attempt | undefined;
  try {
    attempt = read(config, cache, state);
    if (!attempt || attempt.phase !== 'waiting') return denied('expired');
    save(config, cache, state, { ...attempt, phase: 'processing' });
  } finally {
    lock.releaseLock();
  }
  let reason: Failure = error === 'access_denied' ? 'cancelled' : code ? 'account' : 'exchange';
  try {
    if (code && code.length <= 2048 && verifiedAccount(config, code) && attempt.until > seconds()) {
      const browserCode = Utilities.getUuid().replace(/-/g, '').toLowerCase();
      save(config, cache, state, { ...attempt, phase: 'ready', browserCodeHash: sha256(browserCode), grantUntil: seconds() + sessionSeconds });
      // Only the browser that follows Google's redirect receives this second proof.
      return { status: 'ready', state, browserCode, message: 'Return to StoryCursor settings.' };
    }
  } catch (cause) {
    reason = cause instanceof ProviderError ? cause.reason :
      /permission to call UrlFetchApp|auth\/script\.external_request/i.test(String(cause)) ? 'service-permission' : 'service';
  }
  save(config, cache, state, { ...attempt, phase: 'denied' });
  return denied(reason);
}
