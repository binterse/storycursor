import { activePage } from './browser';
const app = document.querySelector('main')!;
const report = document.createElement('pre');
app.append(report);
const count = (await chrome.storage.local.get('spikeCount')).spikeCount ?? 0;
await chrome.storage.local.set({ spikeCount: count + 1 });
report.textContent = JSON.stringify({ count, page: await activePage().catch(() => null) });
