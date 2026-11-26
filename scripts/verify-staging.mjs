import { createHash, randomUUID } from 'node:crypto';

const endpoint = process.env.STORYCURSOR_STAGING_ENDPOINT;
const token = process.env.STORYCURSOR_STAGING_TOKEN;
const spreadsheet = process.env.STORYCURSOR_STAGING_SPREADSHEET_ID;
if (!endpoint || !/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(endpoint) ||
    !token || !/^[a-f0-9]{64}$/i.test(token) || !spreadsheet || !/^[A-Za-z0-9_-]{10,200}$/.test(spreadsheet)) {
  throw new Error('Set STORYCURSOR_STAGING_ENDPOINT, STORYCURSOR_STAGING_TOKEN, and STORYCURSOR_STAGING_SPREADSHEET_ID.');
}

const folder = process.env.STORYCURSOR_STAGING_FOLDER_ID;
if (folder && !/^[A-Za-z0-9_-]{10,200}$/.test(folder)) throw new Error('Invalid staging folder ID.');
const binding = createHash('sha256').update(folder ? 'storycursor-folder-v1:' + folder + ':' + spreadsheet : 'storycursor-v1:' + spreadsheet).digest('hex');
async function request(payload) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(endpoint, {
      method:'POST', body:JSON.stringify({ ...payload, token, binding }), signal:AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error('The staging endpoint responded with HTTP ' + response.status);
    const result = await response.json();
    if (result.status !== 'retry') return result;
  }
  throw new Error('The staging endpoint did not respond after three attempts.');
}

const check = await request({ action:'check' });
if (check.status !== 'ready' || check.binding !== binding) throw new Error('The deployed endpoint is not bound to the specified staging workbook.');

const result = await request({ action:'submit', command:{
  type:'CreateManga', operationId:randomUUID(), target:randomUUID(),
  // Creation accepts only "absent". This valid-shaped revision rejects before any write.
  expected:'0'.repeat(64), value:'StoryCursor no-write deployment probe', confirmed:false, initial:{},
} });
if (result.status !== 'conflict' || result.message !== 'Entry already exists.') {
  if (result.message === 'Invalid command.') throw new Error('The deployed code does not recognize CreateManga.');
  if (result.message === 'Workbook writes are disabled.') throw new Error('Staging writes are disabled. The service did not reach command validation.');
  throw new Error('The deployed endpoint did not reject the probe at the expected validation step.');
}
console.log('Staging binding and CreateManga support verified. No workbook row was written.');
