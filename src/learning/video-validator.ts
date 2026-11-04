import {
  LEARNING_CATEGORIES,
  LEARNING_DIFFICULTIES,
  LEARNING_LIFECYCLE_STAGES,
  VIDEO_PROVIDERS,
  type LearningCategory,
  type LearningDifficulty,
  type LearningLifecycleStage,
  type ResolvedVideoPlayback,
  type VideoProvider,
} from './types.js';

const SELF_HOSTED_VIDEO_RE = /^\/learning\/videos\/[a-z0-9][a-z0-9._-]{1,120}\.(webm|mp4)$/i;
const SELF_HOSTED_CAPTION_RE = /^\/learning\/captions\/[a-z0-9][a-z0-9._-]{1,120}\.vtt$/i;
const SELF_HOSTED_THUMB_RE = /^\/learning\/thumbnails\/[a-z0-9][a-z0-9._-]{1,120}\.(png|jpg|jpeg|webp|svg)$/i;
const YOUTUBE_VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+){1,12}$/;

const DANGEROUS_MARKUP_OR_SCHEME_RE =
  /(<\s*\/?\s*(iframe|script|object|embed|svg|img|video|source|link|meta|style)\b|javascript\s*:|data\s*:|vbscript\s*:|file\s*:|blob\s*:)/i;

function isPrivateOrDisallowedHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '0:0:0:0:0:0:0:1' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return true;
  }

  // IPv4 private / loopback / link-local / metadata ranges
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const octets = ipv4Match.slice(1).map((n) => Number.parseInt(n, 10));
    if (octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) return true;
    const [a, b] = octets;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a >= 224) return true;
  }

  // IPv6 loopback / unique-local / link-local
  if (host.includes(':')) {
    if (
      host.startsWith('fc') ||
      host.startsWith('fd') ||
      host.startsWith('fe80') ||
      host.startsWith('::ffff:127.') ||
      host.startsWith('::ffff:10.') ||
      host.startsWith('::ffff:192.168.') ||
      host.startsWith('::ffff:169.254.')
    ) {
      return true;
    }
  }

  return false;
}

export function getAllowedExternalVideoOrigins(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const allowed = new Set<string>();
  const raw = env.LEARNING_ALLOWED_VIDEO_ORIGINS || '';
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === 'https:' && !parsed.username && !parsed.password && !isPrivateOrDisallowedHost(parsed.hostname)) {
        allowed.add(parsed.origin.toLowerCase());
      }
    } catch {
      // Ignore invalid origin entries
    }
  }
  return allowed;
}

export interface VideoValidationResult {
  valid: boolean;
  error?: string;
  provider?: VideoProvider;
  reference?: string | null;
}

export function validateTutorialSlug(slug: unknown): { valid: boolean; slug?: string; error?: string } {
  if (typeof slug !== 'string') {
    return { valid: false, error: 'Tutorial slug is required.' };
  }
  const normalized = slug.trim().toLowerCase();
  if (normalized.length < 3 || normalized.length > 96 || !SLUG_RE.test(normalized)) {
    return {
      valid: false,
      error: 'Slug must be 3–96 lowercase alphanumeric characters separated by hyphens.',
    };
  }
  return { valid: true, slug: normalized };
}

export function validateVideoSource(
  providerInput: unknown,
  referenceInput: unknown,
  env: NodeJS.ProcessEnv = process.env
): VideoValidationResult {
  if (typeof providerInput !== 'string' || !(VIDEO_PROVIDERS as readonly string[]).includes(providerInput)) {
    return {
      valid: false,
      error: `Invalid videoProvider. Must be one of: ${VIDEO_PROVIDERS.join(', ')}.`,
    };
  }

  const provider = providerInput as VideoProvider;

  if (provider === 'none') {
    if (referenceInput !== undefined && referenceInput !== null && String(referenceInput).trim() !== '') {
      return {
        valid: false,
        error: 'videoReference must be empty or null when videoProvider is "none".',
      };
    }
    return { valid: true, provider: 'none', reference: null };
  }

  if (typeof referenceInput !== 'string' || !referenceInput.trim()) {
    return {
      valid: false,
      error: `videoReference is required when videoProvider is "${provider}".`,
    };
  }

  const ref = referenceInput.trim();
  if (ref.length > 512 || DANGEROUS_MARKUP_OR_SCHEME_RE.test(ref)) {
    return {
      valid: false,
      error: 'Unsafe video reference rejected: raw HTML, iframe markup, and executable URI schemes are prohibited.',
    };
  }

  if (provider === 'self_hosted') {
    if (ref.includes('..') || ref.includes('\\') || ref.includes('%') || !SELF_HOSTED_VIDEO_RE.test(ref)) {
      return {
        valid: false,
        error: 'Self-hosted videoReference must match /learning/videos/<filename>.(webm|mp4) without traversal.',
      };
    }
    return { valid: true, provider, reference: ref };
  }

  if (provider === 'youtube_nocookie') {
    if (!YOUTUBE_VIDEO_ID_RE.test(ref)) {
      return {
        valid: false,
        error: 'youtube_nocookie videoReference must be an exact 11-character video ID (never a raw URL or iframe).',
      };
    }
    return { valid: true, provider, reference: ref };
  }

  if (provider === 'https_allowlist') {
    let parsed: URL;
    try {
      parsed = new URL(ref);
    } catch {
      return { valid: false, error: 'https_allowlist videoReference must be a valid HTTPS URL.' };
    }

    if (parsed.protocol !== 'https:') {
      return { valid: false, error: 'External video URLs must use HTTPS.' };
    }
    if (parsed.username || parsed.password) {
      return { valid: false, error: 'External video URLs must not contain embedded credentials.' };
    }
    if (isPrivateOrDisallowedHost(parsed.hostname)) {
      return { valid: false, error: 'External video URLs targeting private, loopback, or internal hosts are prohibited.' };
    }
    if (!/\.(webm|mp4)$/i.test(parsed.pathname)) {
      return { valid: false, error: 'Allowlisted HTTPS video URL must point to a .mp4 or .webm media asset.' };
    }

    const allowedOrigins = getAllowedExternalVideoOrigins(env);
    if (!allowedOrigins.has(parsed.origin.toLowerCase())) {
      return {
        valid: false,
        error: 'Video URL origin is not in LEARNING_ALLOWED_VIDEO_ORIGINS.',
      };
    }

    return { valid: true, provider, reference: parsed.toString() };
  }

  return { valid: false, error: 'Unsupported video provider.' };
}

export function validateCaptionsUrl(captionsInput: unknown): { valid: boolean; url: string | null; error?: string } {
  if (captionsInput === undefined || captionsInput === null || String(captionsInput).trim() === '') {
    return { valid: true, url: null };
  }
  if (typeof captionsInput !== 'string') {
    return { valid: false, url: null, error: 'captionsUrl must be a string or null.' };
  }
  const trimmed = captionsInput.trim();
  if (
    trimmed.length > 256 ||
    trimmed.includes('..') ||
    trimmed.includes('\\') ||
    trimmed.includes('%') ||
    DANGEROUS_MARKUP_OR_SCHEME_RE.test(trimmed) ||
    !SELF_HOSTED_CAPTION_RE.test(trimmed)
  ) {
    return {
      valid: false,
      url: null,
      error: 'captionsUrl must match /learning/captions/<filename>.vtt.',
    };
  }
  return { valid: true, url: trimmed };
}

export function validateThumbnailUrl(
  thumbInput: unknown,
  env: NodeJS.ProcessEnv = process.env
): { valid: boolean; url: string | null; error?: string } {
  if (thumbInput === undefined || thumbInput === null || String(thumbInput).trim() === '') {
    return { valid: true, url: null };
  }
  if (typeof thumbInput !== 'string') {
    return { valid: false, url: null, error: 'thumbnailUrl must be a string or null.' };
  }
  const trimmed = thumbInput.trim();
  if (trimmed.length > 512 || DANGEROUS_MARKUP_OR_SCHEME_RE.test(trimmed)) {
    return { valid: false, url: null, error: 'Unsafe thumbnailUrl rejected.' };
  }
  if (trimmed.startsWith('/')) {
    if (trimmed.includes('..') || trimmed.includes('\\') || trimmed.includes('%') || !SELF_HOSTED_THUMB_RE.test(trimmed)) {
      return {
        valid: false,
        url: null,
        error: 'Local thumbnailUrl must match /learning/thumbnails/<filename>.(png|jpg|jpeg|webp|svg).',
      };
    }
    return { valid: true, url: trimmed };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, url: null, error: 'Invalid thumbnailUrl.' };
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || isPrivateOrDisallowedHost(parsed.hostname)) {
    return { valid: false, url: null, error: 'External thumbnailUrl must be a public HTTPS URL without credentials.' };
  }
  const allowedOrigins = getAllowedExternalVideoOrigins(env);
  if (!allowedOrigins.has(parsed.origin.toLowerCase())) {
    return { valid: false, url: null, error: 'External thumbnailUrl origin is not allowlisted.' };
  }
  return { valid: true, url: parsed.toString() };
}

export function resolveSafeVideoPlayback(row: {
  videoProvider: string;
  videoReference: string | null;
  videoSourceNote?: string | null;
  captionsUrl?: string | null;
  thumbnailUrl?: string | null;
}): ResolvedVideoPlayback {
  const checked = validateVideoSource(row.videoProvider, row.videoReference);
  const safeCaptions = validateCaptionsUrl(row.captionsUrl);
  const safeThumb = validateThumbnailUrl(row.thumbnailUrl);

  if (!checked.valid || !checked.provider || checked.provider === 'none' || !checked.reference) {
    return {
      playable: false,
      renderMode: 'unavailable',
      playbackUrl: null,
      captionsUrl: null,
      thumbnailUrl: safeThumb.valid ? safeThumb.url : null,
      provider: 'none',
      sourceNote: row.videoSourceNote || null,
    };
  }

  if (checked.provider === 'youtube_nocookie') {
    return {
      playable: true,
      renderMode: 'trusted_embed',
      playbackUrl: `https://www.youtube-nocookie.com/embed/${checked.reference}?rel=0&modestbranding=1`,
      captionsUrl: null,
      thumbnailUrl: safeThumb.valid ? safeThumb.url : null,
      provider: 'youtube_nocookie',
      sourceNote: row.videoSourceNote || null,
    };
  }

  return {
    playable: true,
    renderMode: 'html5_video',
    playbackUrl: checked.reference,
    captionsUrl: safeCaptions.valid ? safeCaptions.url : null,
    thumbnailUrl: safeThumb.valid ? safeThumb.url : null,
    provider: checked.provider,
    sourceNote: row.videoSourceNote || null,
  };
}

export function isValidCategory(value: unknown): value is LearningCategory {
  return typeof value === 'string' && (LEARNING_CATEGORIES as readonly string[]).includes(value);
}

export function isValidDifficulty(value: unknown): value is LearningDifficulty {
  return typeof value === 'string' && (LEARNING_DIFFICULTIES as readonly string[]).includes(value);
}

export function isValidLifecycleStage(value: unknown): value is LearningLifecycleStage {
  return typeof value === 'string' && (LEARNING_LIFECYCLE_STAGES as readonly string[]).includes(value);
}
