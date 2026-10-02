import { Request } from 'express';

export function detectThreats(req: Request): string[] {
  const threats: string[] = [];
  const url = decodeURIComponent(req.originalUrl || req.url).toLowerCase();
  console.log('DETECT THREATS CHECKING URL:', url, 'ORIGINAL:', req.originalUrl, 'REQURL:', req.url);
  
  // Phase 6: Basic deterministic threat detection
  if (url.includes('../') || url.includes('..%2f')) {
    threats.push('PATH_TRAVERSAL');
  }
  if (url.includes('select ') || url.includes('union ') || url.includes('<script>')) {
    threats.push('INJECTION_PATTERN');
  }
  
  return threats;
}
