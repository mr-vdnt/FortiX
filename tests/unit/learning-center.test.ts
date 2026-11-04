import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { setupApiRoutes } from '../../src/api/index.js';
import { db } from '../../src/db/index.js';
import { learningProgress, learningTutorials, users } from '../../src/db/schema.js';
import {
  resolveSafeVideoPlayback,
  validateCaptionsUrl,
  validateTutorialSlug,
  validateVideoSource,
} from '../../src/learning/video-validator.js';
import { ensureLearningCatalogSeeded } from '../../src/learning/catalog-seed.js';
import { formatDurationLabel } from '../../src/components/learning/TutorialVideoPlayer.js';

describe('FTX-LEARN-001: FortiX In-App Video Learning Center (Backend, Security & Progress)', () => {
  const app = express();
  app.use(express.json());
  setupApiRoutes(app);

  const createdUserIds: string[] = [];
  const createdTutorialSlugs: string[] = [];

  async function registerAndPromoteIfNeeded(role: 'DEVELOPER' | 'ADMIN' = 'DEVELOPER') {
    const email = `learn-${role.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@fortix.test`;
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email, password: 'StrongPassword!123' });
    expect(reg.status).toBe(201);
    const userId = reg.body.user.id as string;
    createdUserIds.push(userId);

    if (role === 'ADMIN') {
      await db.update(users).set({ role: 'ADMIN' }).where(eq(users.id, userId));
    }

    const login = await request(app)
      .post('/api/auth/login')
      .send({ identifier: email, password: 'StrongPassword!123' });
    expect(login.status).toBe(200);

    return {
      userId,
      email,
      token: login.body.token as string,
      authHeader: { Authorization: `Bearer ${login.body.token}` },
    };
  }

  beforeEach(async () => {
    await ensureLearningCatalogSeeded();
  });

  afterEach(async () => {
    while (createdTutorialSlugs.length > 0) {
      const slug = createdTutorialSlugs.pop();
      if (slug) {
        await db.delete(learningTutorials).where(eq(learningTutorials.slug, slug)).catch(() => {});
      }
    }
    while (createdUserIds.length > 0) {
      const uid = createdUserIds.pop();
      if (uid) {
        await db.delete(learningProgress).where(eq(learningProgress.userId, uid)).catch(() => {});
        await db.delete(users).where(eq(users.id, uid)).catch(() => {});
      }
    }
  });

  it('001B-1: rejects unauthenticated requests to /api/learning/* with 401', async () => {
    const res1 = await request(app).get('/api/learning/tutorials');
    const res2 = await request(app).get('/api/learning/progress');
    expect(res1.status).toBe(401);
    expect(res2.status).toBe(401);
  });

  it('001B-2: retrieves seeded catalog, filters by search/category/difficulty/lifecycle, and lists all 12 categories', async () => {
    const dev = await registerAndPromoteIfNeeded('DEVELOPER');

    const catalogRes = await request(app)
      .get('/api/learning/tutorials')
      .set(dev.authHeader);
    expect(catalogRes.status).toBe(200);
    expect(catalogRes.body.tutorials.length).toBeGreaterThanOrEqual(20);

    // Verify all 5 core featured workflows are present with playable self-hosted video + captions
    const featured = catalogRes.body.tutorials.filter((t: any) => t.featured);
    expect(featured.length).toBeGreaterThanOrEqual(5);
    for (const item of featured) {
      expect(item.video.playable).toBe(true);
      expect(item.video.renderMode).toBe('html5_video');
      expect(item.video.playbackUrl).toMatch(/^\/learning\/videos\/.+\.webm$/);
      expect(item.video.captionsUrl).toMatch(/^\/learning\/captions\/.+\.vtt$/);
    }

    // Verify non-recorded curriculum entries honestly report unavailable video
    const pendingItems = catalogRes.body.tutorials.filter((t: any) => !t.video.playable);
    expect(pendingItems.length).toBeGreaterThan(0);
    expect(pendingItems[0].video.renderMode).toBe('unavailable');
    expect(pendingItems[0].video.playbackUrl).toBeNull();

    // Filter by query + difficulty + category
    const studioSearch = await request(app)
      .get('/api/learning/tutorials?q=Products%20API&category=API%20Studio&difficulty=Beginner')
      .set(dev.authHeader);
    expect(studioSearch.status).toBe(200);
    expect(studioSearch.body.tutorials.length).toBeGreaterThanOrEqual(1);
    expect(studioSearch.body.tutorials[0].slug).toBe('creating-an-api-using-api-studio');

    // Categories endpoint returns all 12 canonical categories
    const catRes = await request(app)
      .get('/api/learning/categories')
      .set(dev.authHeader);
    expect(catRes.status).toBe(200);
    expect(catRes.body.categories).toHaveLength(12);
    expect(catRes.body.categories.every((c: any) => typeof c.publishedCount === 'number')).toBe(true);
  });

  it('001B-3: returns full tutorial detail with steps, objectives, warnings, related tutorials, and sequence links without mutating progress', async () => {
    const dev = await registerAndPromoteIfNeeded('DEVELOPER');

    const detailRes = await request(app)
      .get('/api/learning/tutorials/what-is-fortix')
      .set(dev.authHeader);
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.slug).toBe('what-is-fortix');
    expect(detailRes.body.learningObjectives.length).toBeGreaterThan(0);
    expect(detailRes.body.steps.length).toBeGreaterThanOrEqual(3);
    expect(detailRes.body.nextTutorial).toBeTruthy();
    expect(detailRes.body.progress).toBeNull();

    // Opening detail page must NEVER mark tutorial completed or create spurious progress rows
    const progRes = await request(app)
      .get(`/api/learning/progress/${detailRes.body.id}`)
      .set(dev.authHeader);
    expect(progRes.status).toBe(200);
    expect(progRes.body.progress.completed).toBe(false);
    expect(progRes.body.progress.lastPositionSeconds).toBe(0);
  });

  it('001E-1: enforces 90% completion threshold, decouples seek position from watchedSeconds, and handles concurrent updates safely', async () => {
    const dev = await registerAndPromoteIfNeeded('DEVELOPER');

    const detailRes = await request(app)
      .get('/api/learning/tutorials/what-is-fortix')
      .set(dev.authHeader);
    const tutorialId = detailRes.body.id as string;
    const duration = detailRes.body.durationSeconds as number; // 25s

    // 1. Partial watch (~40%) -> saved position, NOT completed
    const partialPos = Math.floor(duration * 0.4); // 10s
    const put1 = await request(app)
      .put(`/api/learning/progress/${tutorialId}`)
      .set(dev.authHeader)
      .send({ lastPositionSeconds: partialPos, watchedSeconds: partialPos });
    expect(put1.status).toBe(200);
    expect(put1.body.progress.lastPositionSeconds).toBe(partialPos);
    expect(put1.body.progress.completed).toBe(false);

    // 2. Scrubbing ahead to 96% WITHOUT actually watching (watchedSeconds remains 10s) must NOT auto-complete!
    const scrubbedPos = Math.floor(duration * 0.96); // 24s
    const putScrub = await request(app)
      .put(`/api/learning/progress/${tutorialId}`)
      .set(dev.authHeader)
      .send({ lastPositionSeconds: scrubbedPos, watchedSeconds: partialPos });
    expect(putScrub.status).toBe(200);
    expect(putScrub.body.progress.lastPositionSeconds).toBe(scrubbedPos);
    expect(putScrub.body.progress.completed).toBe(false);

    // 3. Concurrent progress updates do not create duplicate rows or fail
    const thresholdSec = Math.ceil(duration * 0.9); // 23s
    const [conc1, conc2, conc3] = await Promise.all([
      request(app)
        .put(`/api/learning/progress/${tutorialId}`)
        .set(dev.authHeader)
        .send({ lastPositionSeconds: 15, watchedSeconds: 15 }),
      request(app)
        .put(`/api/learning/progress/${tutorialId}`)
        .set(dev.authHeader)
        .send({ lastPositionSeconds: thresholdSec, watchedSeconds: thresholdSec }),
      request(app)
        .put(`/api/learning/progress/${tutorialId}`)
        .set(dev.authHeader)
        .send({ lastPositionSeconds: 18, watchedSeconds: 18 }),
    ]);
    expect(conc1.status).toBe(200);
    expect(conc2.status).toBe(200);
    expect(conc3.status).toBe(200);

    // Completion latches monotonically once >= 90% was watched
    const finalProg = await request(app)
      .get(`/api/learning/progress/${tutorialId}`)
      .set(dev.authHeader);
    expect(finalProg.status).toBe(200);
    expect(finalProg.body.progress.completed).toBe(true);
    expect(finalProg.body.progress.percentWatched).toBe(100);
    expect(finalProg.body.progress.completedAt).toBeTruthy();

    // Verify only 1 DB row exists for (userId, tutorialId)
    const dbRows = await db
      .select()
      .from(learningProgress)
      .where(eq(learningProgress.userId, dev.userId));
    expect(dbRows).toHaveLength(1);
  });

  it('001E-2: rejects negative, NaN, and impossible (> duration) playback positions with 400', async () => {
    const dev = await registerAndPromoteIfNeeded('DEVELOPER');
    const detailRes = await request(app)
      .get('/api/learning/tutorials/what-is-fortix')
      .set(dev.authHeader);
    const tutorialId = detailRes.body.id as string;

    const negRes = await request(app)
      .put(`/api/learning/progress/${tutorialId}`)
      .set(dev.authHeader)
      .send({ lastPositionSeconds: -5 });
    expect(negRes.status).toBe(400);
    expect(negRes.body.code).toBe('NEGATIVE_PLAYBACK_POSITION');

    const hugeRes = await request(app)
      .put(`/api/learning/progress/${tutorialId}`)
      .set(dev.authHeader)
      .send({ lastPositionSeconds: 99999 });
    expect(hugeRes.status).toBe(400);
    expect(hugeRes.body.code).toBe('IMPOSSIBLE_PLAYBACK_POSITION');

    const nanRes = await request(app)
      .put(`/api/learning/progress/${tutorialId}`)
      .set(dev.authHeader)
      .send({ lastPositionSeconds: 'not-a-number' });
    expect(nanRes.status).toBe(400);
    expect(nanRes.body.code).toBe('INVALID_PLAYBACK_POSITION');
  });

  it('001S-1: strictly isolates learning progress across users and blocks userId spoofing with 403', async () => {
    const userA = await registerAndPromoteIfNeeded('DEVELOPER');
    const userB = await registerAndPromoteIfNeeded('DEVELOPER');

    const detailRes = await request(app)
      .get('/api/learning/tutorials/creating-your-first-api')
      .set(userA.authHeader);
    const tutorialId = detailRes.body.id as string;

    // User A watches to 12s
    const saveA = await request(app)
      .put(`/api/learning/progress/${tutorialId}`)
      .set(userA.authHeader)
      .send({ lastPositionSeconds: 12, watchedSeconds: 12 });
    expect(saveA.status).toBe(200);

    // User B sees 0s for their own progress
    const readB = await request(app)
      .get(`/api/learning/progress/${tutorialId}`)
      .set(userB.authHeader);
    expect(readB.status).toBe(200);
    expect(readB.body.progress.lastPositionSeconds).toBe(0);
    expect(readB.body.progress.completed).toBe(false);

    // User B attempting to query User A's progress via ?userId= is rejected with 403
    const spoofRead = await request(app)
      .get(`/api/learning/progress/${tutorialId}?userId=${userA.userId}`)
      .set(userB.authHeader);
    expect(spoofRead.status).toBe(403);
    expect(spoofRead.body.code).toBe('CROSS_USER_ACCESS_DENIED');

    // User B attempting to overwrite User A's progress via body.userId is rejected with 403
    const spoofWrite = await request(app)
      .put(`/api/learning/progress/${tutorialId}`)
      .set(userB.authHeader)
      .send({ userId: userA.userId, lastPositionSeconds: 24, watchedSeconds: 24 });
    expect(spoofWrite.status).toBe(403);
    expect(spoofWrite.body.code).toBe('CROSS_USER_ACCESS_DENIED');

    // Verify User A's progress is completely untouched
    const verifyA = await request(app)
      .get(`/api/learning/progress/${tutorialId}`)
      .set(userA.authHeader);
    expect(verifyA.body.progress.lastPositionSeconds).toBe(12);
    expect(verifyA.body.progress.completed).toBe(false);
  });

  it('001S-2: enforces ADMIN RBAC on tutorial mutations and blocks unpublished tutorials from non-admin users', async () => {
    const dev = await registerAndPromoteIfNeeded('DEVELOPER');
    const admin = await registerAndPromoteIfNeeded('ADMIN');

    const slug = `draft-security-walkthrough-${Date.now()}`;
    createdTutorialSlugs.push(slug);

    const validPayload = {
      slug,
      title: 'Draft Internal Gateway Hardening Guide',
      description: 'Internal draft guide verifying unpublished access control.',
      moduleName: 'Module 2 — Protecting an API',
      lifecycleStage: 'PROTECT',
      category: 'Security Policies',
      difficulty: 'Advanced',
      videoProvider: 'none',
      videoReference: null,
      durationSeconds: 180,
      learningObjectives: ['Verify unpublished draft isolation'],
      steps: [{ stepNumber: 1, title: 'Step One', instruction: 'Inspect policies.', actionPath: '/security' }],
      published: false,
      featured: false,
      sortOrder: 900,
    };

    // 1. Standard DEVELOPER cannot create tutorials -> 403
    const devCreate = await request(app)
      .post('/api/learning/admin/tutorials')
      .set(dev.authHeader)
      .send(validPayload);
    expect(devCreate.status).toBe(403);
    expect(devCreate.body.code).toBe('ADMIN_ROLE_REQUIRED');

    // 2. ADMIN creates unpublished draft -> 201
    const adminCreate = await request(app)
      .post('/api/learning/admin/tutorials')
      .set(admin.authHeader)
      .send(validPayload);
    expect(adminCreate.status).toBe(201);
    const createdId = adminCreate.body.tutorial.id as string;

    // 3. Standard DEVELOPER cannot fetch unpublished tutorial by slug, list it, or update progress on it -> 404
    const devFetchSlug = await request(app)
      .get(`/api/learning/tutorials/${slug}`)
      .set(dev.authHeader);
    expect(devFetchSlug.status).toBe(404);

    const devList = await request(app)
      .get('/api/learning/tutorials?includeUnpublished=true')
      .set(dev.authHeader);
    expect(devList.body.tutorials.some((t: any) => t.slug === slug)).toBe(false);

    const devProg = await request(app)
      .put(`/api/learning/progress/${createdId}`)
      .set(dev.authHeader)
      .send({ lastPositionSeconds: 10 });
    expect(devProg.status).toBe(404);

    // 4. Standard DEVELOPER cannot PATCH tutorial -> 403
    const devPatch = await request(app)
      .patch(`/api/learning/admin/tutorials/${createdId}`)
      .set(dev.authHeader)
      .send({ published: true });
    expect(devPatch.status).toBe(403);

    // 5. ADMIN can view unpublished draft and publish it -> 200
    const adminList = await request(app)
      .get('/api/learning/tutorials?includeUnpublished=true')
      .set(admin.authHeader);
    expect(adminList.body.tutorials.some((t: any) => t.slug === slug)).toBe(true);

    const adminPublish = await request(app)
      .patch(`/api/learning/admin/tutorials/${createdId}`)
      .set(admin.authHeader)
      .send({ published: true });
    expect(adminPublish.status).toBe(200);

    // Now visible to DEVELOPER
    const devFetchPublished = await request(app)
      .get(`/api/learning/tutorials/${slug}`)
      .set(dev.authHeader);
    expect(devFetchPublished.status).toBe(200);
  });

  it('001S-3: rejects malicious video URLs, javascript:/data: schemes, raw <iframe> HTML, path traversal, and SSRF hosts', async () => {
    const admin = await registerAndPromoteIfNeeded('ADMIN');

    const maliciousCases: Array<{ provider: string; ref: string; desc: string }> = [
      { provider: 'self_hosted', ref: 'javascript:alert(document.cookie)', desc: 'javascript URI' },
      { provider: 'self_hosted', ref: 'data:text/html,<script>alert(1)</script>', desc: 'data URI' },
      { provider: 'youtube_nocookie', ref: '<iframe src="https://evil.test"></iframe>', desc: 'raw iframe HTML' },
      { provider: 'self_hosted', ref: '/learning/videos/../../etc/passwd.mp4', desc: 'path traversal' },
      { provider: 'https_allowlist', ref: 'https://127.0.0.1/learning/video.mp4', desc: 'loopback SSRF' },
      { provider: 'https_allowlist', ref: 'https://169.254.169.254/latest/video.mp4', desc: 'metadata SSRF' },
      { provider: 'https_allowlist', ref: 'https://untrusted-cdn.example.com/video.mp4', desc: 'non-allowlisted domain' },
      { provider: 'https_allowlist', ref: 'http://cdn.fortix.test/video.mp4', desc: 'cleartext HTTP' },
      { provider: 'https_allowlist', ref: 'https://user:secret@cdn.fortix.test/video.mp4', desc: 'embedded credentials' },
    ];

    for (const tc of maliciousCases) {
      const check = validateVideoSource(tc.provider, tc.ref, {
        LEARNING_ALLOWED_VIDEO_ORIGINS: 'https://cdn.fortix.test',
      } as any);
      expect(check.valid, `Expected validator to reject ${tc.desc}`).toBe(false);

      const apiRes = await request(app)
        .post('/api/learning/admin/tutorials')
        .set(admin.authHeader)
        .send({
          slug: `sec-check-${Math.random().toString(36).slice(2, 8)}`,
          title: 'Malicious Video Rejection Test',
          description: 'Testing strict video URL validation.',
          moduleName: 'Module 1 — Getting Started',
          lifecycleStage: 'PROTECT',
          category: 'Getting Started',
          difficulty: 'Beginner',
          videoProvider: tc.provider,
          videoReference: tc.ref,
          durationSeconds: 60,
          learningObjectives: ['Reject unsafe video sources'],
          steps: [{ stepNumber: 1, title: 'Step', instruction: 'Test step.' }],
        });
      expect(apiRes.status, `Expected 400 for ${tc.desc}`).toBe(400);
      expect(apiRes.body.code).toBe('UNSAFE_VIDEO_SOURCE');
    }

    // Verify allowlisted HTTPS media origin + youtube_nocookie 11-char ID succeed cleanly
    const allowlistedOk = validateVideoSource(
      'https_allowlist',
      'https://cdn.fortix.test/tutorials/intro.mp4',
      { LEARNING_ALLOWED_VIDEO_ORIGINS: 'https://cdn.fortix.test' } as any
    );
    expect(allowlistedOk.valid).toBe(true);

    const ytResolved = resolveSafeVideoPlayback({
      videoProvider: 'youtube_nocookie',
      videoReference: 'dQw4w9WgXcQ',
    });
    expect(ytResolved.playable).toBe(true);
    expect(ytResolved.renderMode).toBe('trusted_embed');
    expect(ytResolved.playbackUrl).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&modestbranding=1'
    );

    // Verify captions & slug validators and duration formatting helper
    expect(validateCaptionsUrl('/learning/captions/../secret.vtt').valid).toBe(false);
    expect(validateCaptionsUrl('/learning/captions/what-is-fortix.vtt').valid).toBe(true);
    expect(validateTutorialSlug('Bad Slug!!').valid).toBe(false);
    expect(formatDurationLabel(25)).toBe('0:25');
    expect(formatDurationLabel(305)).toBe('5:05');
  });
});
