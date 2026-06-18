/**
 * Normalize a cookie's `domain` to a bare host.
 *
 * Cookies exported by hand from a browser's DevTools (the user's refresh flow) sometimes carry the
 * full URL — or the host with its path mashed on — in the `domain` field (e.g.
 * `host.example.net/proxy/8080/BAA/loginAction.do`). Playwright's `addCookies` requires a bare host
 * and rejects the whole batch if any cookie's domain is malformed, so a single bad cookie can keep
 * the entire session (including the SSO cookie) from applying. Stripping any scheme and everything
 * from the first slash on leaves a host Playwright accepts; a leading dot (a domain-wide cookie) is
 * preserved.
 */
export function normalizeCookieDomain(domain: string): string {
  const noScheme = domain.trim().replace(/^[a-z]+:\/\//i, '');
  return noScheme.split('/')[0] ?? noScheme;
}

/** Normalize the `domain` of every cookie in an exported array; url-only cookies pass through. */
export function normalizeCookies<T extends { domain?: string }>(cookies: readonly T[]): T[] {
  return cookies.map((c) => (c.domain ? { ...c, domain: normalizeCookieDomain(c.domain) } : c));
}
