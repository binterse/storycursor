import { validConfig, type Config } from './sync';
import { signInError } from '../../packages/core/sign-in';

const hex = (value: Uint8Array) => Array.from(value, byte => byte.toString(16).padStart(2, '0')).join('');
const isCode = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
const callbackOrigin = 'https://script.googleusercontent.com';

async function request(endpoint: string, body: object) {
  const response = await fetch(endpoint, {
    method: 'POST', body: JSON.stringify(body), credentials: 'omit', cache: 'no-store',
    referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) throw new Error('Could not reach StoryCursor sign-in.');
  const result = await response.json();
  if (result?.status !== 'ready') throw new Error(result?.message ?? 'Google sign-in could not finish.');
  return result;
}

function authorizationUrl(url: unknown, state: string, endpoint: string) {
  const address = typeof url === 'string' ? new URL(url) : undefined;
  if (!address || address.origin !== 'https://accounts.google.com' || address.pathname !== '/o/oauth2/v2/auth' ||
      address.username || address.password || address.searchParams.get('state') !== state ||
      address.searchParams.get('redirect_uri') !== endpoint || address.searchParams.get('response_type') !== 'code') {
    throw new Error('Unexpected Google sign-in URL.');
  }
  return address.href;
}

async function readCallback(tabId: number, state: string) {
  const until = Date.now() + 8 * 60 * 1000;
  while (Date.now() < until) {
    await new Promise(resolve => setTimeout(resolve, 750));
    const tab = await chrome.tabs.get(tabId).catch(() => undefined);
    if (!tab) throw new Error('Google sign-in was closed.');
    if (!tab.url || tab.status !== 'complete') continue;
    const address = new URL(tab.url);
    if (address.origin !== callbackOrigin || address.pathname !== '/macros/echo') continue;
    const [frame] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (location.origin !== 'https://script.googleusercontent.com' || location.pathname !== '/macros/echo') return;
        const data = document.body?.textContent;
        return data && data.length <= 2048 ? data : undefined;
      },
    }).catch(() => []);
    let response;
    try { response = JSON.parse(frame?.result ?? 'null'); } catch { continue; }
    if (response?.state !== state) continue;
    await chrome.tabs.remove(tabId).catch(() => {});
    if (response.status === 'ready' && isCode(response.browserCode)) return response.browserCode;
    throw new Error(signInError(response?.reason));
  }
  throw new Error('Google sign-in expired. Try again.');
}

export async function googleSignIn(endpoint: string): Promise<Config> {
  const proof = hex(crypto.getRandomValues(new Uint8Array(32)));
  if (!validConfig({ endpoint, token: proof })) throw new Error('Invalid StoryCursor deployment URL.');
  const proofHash = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(proof))));
  const { state, url } = await request(endpoint, { action: 'googleBegin', proofHash });
  if (!isCode(state)) throw new Error('Invalid StoryCursor sign-in challenge.');
  const target = authorizationUrl(url, state, endpoint);
  const tab = await chrome.tabs.create({ url: 'about:blank' });
  if (tab.id === undefined) throw new Error('Could not open the sign-in tab.');
  await chrome.tabs.update(tab.id, { url: target });
  const browserCode = await readCallback(tab.id, state);
  const { token } = await request(endpoint, { action: 'googleFinish', state, proof, browserCode });
  if (typeof token !== 'string' || !validConfig({ endpoint, token })) throw new Error('Invalid StoryCursor session.');
  const expiresAt = Number.parseInt(token.slice(0, 12), 16) * 1000;
  if (expiresAt <= Date.now() || expiresAt > Date.now() + 30 * 24 * 60 * 60 * 1000) throw new Error('Invalid StoryCursor session.');
  return { endpoint, token, expiresAt };
}
