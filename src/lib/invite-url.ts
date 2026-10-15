export function inviteOrigin(request: Request, configured?: string) {
  let url: URL;
  try { url = new URL(configured?.trim() || request.headers.get('origin') || request.url); }
  catch { throw new Error('APP_URL_UNREACHABLE'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || ['0.0.0.0', '[::]'].includes(url.hostname)) throw new Error('APP_URL_UNREACHABLE');
  return url.origin;
}
