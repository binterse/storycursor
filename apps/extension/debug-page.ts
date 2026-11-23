// This function runs in the isolated world of the active tab. Keep every dependency inside it.
export function readDebugPage() {
  const clean = (value: string, limit: number) => value
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[url]')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[email]')
    .replace(/\b(?:token|session|password|api[_-]?key|authorization)\s*[:=]\s*[^\s"'<>]+/gi, '[credential]')
    .replace(/\bBearer\s+[^\s"'<>]+/gi, '[credential]')
    .replace(/\b[A-Za-z0-9_-]{28,}\b/g, '[identifier]')
    .replace(/\s+/g, ' ').trim().slice(0, limit);
  const address = (raw: string) => {
    try {
      const url = new URL(raw, location.href);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return undefined;
      const segments = url.pathname.split('/').filter(Boolean).slice(0, 10);
      const route = segments.map((segment, index) => {
        if (/^(?:auth|authorize|account|email|token|session|login|invite|password|api[-_]?key)$/i.test(segments[index - 1] ?? '')) return ':segment';
        if (/^\d+$/.test(segment)) return ':number';
        if (/^[a-f0-9-]{28,}$/i.test(segment) || /^[a-zA-Z0-9_-]{48,}$/.test(segment)) return ':id';
        return /^[a-z][a-z0-9_.-]{0,55}$/i.test(segment) ? segment : ':segment';
      }).join('/');
      return { host: url.hostname, route: '/' + route };
    } catch { return undefined; }
  };
  const metadata = ['og:title', 'twitter:title', 'og:type', 'og:site_name'].flatMap(name => {
    const node = document.querySelector<HTMLMetaElement>('meta[property="' + name + '"],meta[name="' + name + '"]');
    return node?.content ? [{ name, value: clean(node.content, 200) }] : [];
  });
  const headings = Array.from(document.querySelectorAll('main h1, main h2, article h1, article h2, body > h1'))
    .slice(0, 6).map(node => ({ tag: node.tagName.toLowerCase(), text: clean(node.textContent ?? '', 140) }));
  const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>('script[src]')).slice(0, 12)
    .flatMap(node => address(node.src) ?? []);
  const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href;
  return {
    // URL of the inspected tab is used for the navigation guard and stripped before persistence.
    observedUrl: location.href,
    snapshot: {
      page: address(location.href), canonical: canonical ? address(canonical) : undefined,
      title: clean(document.title, 240), language: clean(document.documentElement.lang, 24),
      metadata, headings, scripts, jsonLdCount: Math.min(document.querySelectorAll('script[type="application/ld+json"]').length, 25),
    },
  };
}
