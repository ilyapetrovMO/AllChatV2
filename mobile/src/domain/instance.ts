export function normalizeInstanceURL(input: string, allowDevelopmentHTTP = false): string {
  const candidate = input.trim();
  if (!candidate) {
    throw new Error('Enter an Instance address.');
  }

  let url: URL;
  try {
    url = new URL(candidate.includes('://') ? candidate : `https://${candidate}`);
  } catch {
    throw new Error('Enter a valid Instance address.');
  }

  const developmentHost = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '10.0.2.2';
  if (url.protocol !== 'https:' && !(allowDevelopmentHTTP && developmentHost && url.protocol === 'http:')) {
    throw new Error('Instances must use HTTPS.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Enter the Instance address without credentials, query parameters, or fragments.');
  }

  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}
