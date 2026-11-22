export async function activePage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined || !tab.url || !/^https?:\/\//.test(tab.url)) throw new Error('Open a web page first.');
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => ({ url: location.href, title: document.title.slice(0, 400) }),
  });
  if (!result?.result || result.result.url !== tab.url) throw new Error('The page changed. Reopen StoryCursor.');
  return result.result;
}
