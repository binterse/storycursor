import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function popupSnapshot(profile: string, targetId: string) {
  const [port] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n');
  const socket = new WebSocket('ws://127.0.0.1:' + port?.trim() + '/devtools/page/' + targetId);
  return await new Promise<{ title: string; progress: string }>((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('Popup inspection timed out')); }, 3000);
    socket.addEventListener('open', () => socket.send(JSON.stringify({
      id: 1, method: 'Runtime.evaluate',
      params: {
        expression: '({ title: document.querySelector("main section p")?.textContent, progress: document.querySelector("main section input")?.value })',
        returnByValue: true,
      },
    })), { once:true });
    socket.addEventListener('message', event => {
      clearTimeout(timer);
      socket.close();
      const message = JSON.parse(String(event.data));
      if (message.result?.result?.value) resolve(message.result.result.value);
      else reject(new Error('Popup inspection failed'));
    }, { once:true });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('Cannot connect to the toolbar popup'));
    }, { once:true });
  });
}
