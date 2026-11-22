import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function popupCommand<T>(profile: string, targetId: string, method: string, params: object) {
  const [port] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n');
  const socket = new WebSocket('ws://127.0.0.1:' + port?.trim() + '/devtools/page/' + targetId);
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('Popup inspection timed out')); }, 3000);
    socket.addEventListener('open', () => socket.send(JSON.stringify({ id: 1, method, params })), { once:true });
    socket.addEventListener('message', event => {
      clearTimeout(timer);
      socket.close();
      const message = JSON.parse(String(event.data));
      if (message.result && !message.result.exceptionDetails) resolve(message.result);
      else reject(new Error('Popup inspection failed'));
    }, { once:true });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('Cannot connect to the toolbar popup'));
    }, { once:true });
  });
}

export async function inspectPopup<T>(profile: string, targetId: string, expression: string): Promise<T> {
  const response = await popupCommand<{ result: { value: T } }>(profile, targetId, 'Runtime.evaluate', {
    expression, returnByValue: true,
  });
  return response.result.value;
}

export function popupSnapshot(profile: string, targetId: string) {
  return inspectPopup<{ title: string; progress: string }>(profile, targetId,
    '({ title: document.querySelector(".page-title")?.textContent, progress: document.querySelector("#progress-value")?.value })',
  );
}
