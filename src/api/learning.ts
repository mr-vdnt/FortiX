import express from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { and, asc, eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { db } from '../db/index.js';
import { learningProgress, learningTutorials } from '../db/schema.js';
import { requireAdmin, type AuthRequest } from '../middleware/auth.js';
import { ensureLearningCatalogSeeded } from '../learning/catalog-seed.js';
import {
  LEARNING_CATEGORIES,
  type LearningCategory,
  type LearningCategoryStatusDto,
  type LearningDifficulty,
  type LearningLifecycleStage,
  type LearningTutorialDetailDto,
  type LearningTutorialSummaryDto,
  type TutorialDocLink,
  type TutorialStep,
  type UserTutorialProgressDto,
} from '../learning/types.js';
import {
  isValidCategory,
  isValidDifficulty,
  isValidLifecycleStage,
  resolveSafeVideoPlayback,
  validateCaptionsUrl,
  validateThumbnailUrl,
  validateTutorialSlug,
  validateVideoSource,
} from '../learning/video-validator.js';

const router = express.Router();

// Bounded rate limiter on progress writes to prevent unbounded database churn
const progressWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 90,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const authReq = req as AuthRequest;
    return authReq.user?.id || ipKeyGenerator(req.ip || '127.0.0.1');
  },
  message: {
    error: 'Too many learning progress updates. Please slow down.',
    code: 'LEARNING_PROGRESS_RATE_LIMITED',
  },
});

// Per-(user, tutorial) async serialization queue to prevent concurrent upsert races
const progressLocks = new Map<string, Promise<unknown>>();

async function withProgressLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = progressLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = prev.then(() => gate);
  progressLocks.set(key, chained);

  try {
    await prev;
    return await fn();
  } finally {
    release();
    if (progressLocks.get(key) === chained) {
      progressLocks.delete(key);
    }
  }
}

function assertNoCrossUserOverride(req: AuthRequest, res: express.Response): boolean {
  const callerId = req.user?.id;
  if (!callerId) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  const queryUserId = typeof req.query.userId === 'string' ? req.query.userId.trim() : '';
  const bodyUserId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
  if ((queryUserId && queryUserId !== callerId) || (bodyUserId && bodyUserId !== callerId)) {
    res.status(403).json({
      error: 'Forbidden: Cannot access or modify another user’s learning progress.',
      code: 'CROSS_USER_ACCESS_DENIED',
    });
    return false;
  }
  return true;
}

function formatProgressDto(
  row: typeof learningProgress.$inferSelect | undefined,
  durationSeconds: number
): UserTutorialProgressDto | null {
  if (!row) return null;
  const safeDuration = Math.max(1, durationSeconds || 1);
  const rawPct = row.completed
    ? 100
    : Math.min(99, Math.round((Math.max(0, row.maxWatchedSeconds) / safeDuration) * 100));

  return {
    tutorialId: row.tutorialId,
    lastPositionSeconds: Math.max(0, Math.min(row.lastPositionSeconds, safeDuration)),
    maxWatchedSeconds: Math.max(0, Math.min(row.maxWatchedSeconds, safeDuration)),
    percentWatched: Math.max(0, Math.min(100, rawPct)),
    completed: Boolean(row.completed),
    completedAt: row.completedAt ? new Date(row.completedAt).toISOString() : null,
    lastWatchedAt: row.lastWatchedAt ? new Date(row.lastWatchedAt).toISOString() : null,
  };
}

function formatSummaryDto(
  row: typeof learningTutorials.$inferSelect,
  progressRow?: typeof learningProgress.$inferSelect
): LearningTutorialSummaryDto {
  const video = resolveSafeVideoPlayback(row);
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    moduleName: row.moduleName,
    lifecycleStage: (isValidLifecycleStage(row.lifecycleStage)
      ? row.lifecycleStage
      : 'PROTECT') as LearningLifecycleStage,
    category: (isValidCategory(row.category) ? row.category : 'Getting Started') as LearningCategory,
    difficulty: (isValidDifficulty(row.difficulty) ? row.difficulty : 'Beginner') as LearningDifficulty,
    durationSeconds: row.durationSeconds,
    featured: Boolean(row.featured),
    published: Boolean(row.published),
    sortOrder: row.sortOrder,
    video,
    progress: formatProgressDto(progressRow, row.durationSeconds),
  };
}

// ---------------------------------------------------------------------------
// GET /api/learning/tutorials
// ---------------------------------------------------------------------------
router.get('/tutorials', async (req: AuthRequest, res) => {
  if (!assertNoCrossUserOverride(req, res)) return;
  try {
    await ensureLearningCatalogSeeded();
    const userId = req.user!.id;
    const isAdmin = req.user!.role === 'ADMIN';
    const includeUnpublished = isAdmin && req.query.includeUnpublished === 'true';

    const allRows = await db
      .select()
      .from(learningTutorials)
      .orderBy(asc(learningTutorials.sortOrder), asc(learningTutorials.title));

    const visibleRows = includeUnpublished ? allRows : allRows.filter((r) => r.published);

    const progressRows = await db
      .select()
      .from(learningProgress)
      .where(eq(learningProgress.userId, userId));

    const progressByTutorialId = new Map(progressRows.map((p) => [p.tutorialId, p]));

    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const categoryFilter = typeof req.query.category === 'string' ? req.query.category.trim() : '';
    const difficultyFilter = typeof req.query.difficulty === 'string' ? req.query.difficulty.trim() : '';
    const lifecycleFilter = typeof req.query.lifecycleStage === 'string' ? req.query.lifecycleStage.trim() : '';
    const statusFilter = typeof req.query.status === 'string' ? req.query.status.trim() : '';

    let filtered = visibleRows.map((row) => formatSummaryDto(row, progressByTutorialId.get(row.id)));

    if (categoryFilter && categoryFilter !== 'all') {
      filtered = filtered.filter((item) => item.category === categoryFilter);
    }
    if (difficultyFilter && difficultyFilter !== 'all') {
      filtered = filtered.filter((item) => item.difficulty === difficultyFilter);
    }
    if (lifecycleFilter && lifecycleFilter !== 'all') {
      filtered = filtered.filter((item) => item.lifecycleStage === lifecycleFilter);
    }
    if (statusFilter === 'completed') {
      filtered = filtered.filter((item) => item.progress?.completed === true);
    } else if (statusFilter === 'in_progress') {
      filtered = filtered.filter(
        (item) =>
          item.progress !== null &&
          !item.progress.completed &&
          (item.progress.lastPositionSeconds > 0 || item.progress.maxWatchedSeconds > 0)
      );
    } else if (statusFilter === 'recorded') {
      filtered = filtered.filter((item) => item.video.playable);
    }

    if (q) {
      const tokens = q.split(/\s+/).filter(Boolean);
      filtered = filtered.filter((item) => {
        const hay = `${item.title} ${item.description} ${item.category} ${item.moduleName} ${item.difficulty} ${item.lifecycleStage}`.toLowerCase();
        return tokens.every((token) => hay.includes(token));
      });
    }

    const total = filtered.length;
    const rawLimit = Number.parseInt(String(req.query.limit || '100'), 10);
    const rawOffset = Number.parseInt(String(req.query.offset || '0'), 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(1, rawLimit), 100) : 100;
    const offset = Number.isFinite(rawOffset) ? Math.max(0, rawOffset) : 0;

    const paginated = filtered.slice(offset, offset + limit);

    res.json({
      tutorials: paginated,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    });
  } catch {
    res.status(500).json({ error: 'Failed to load learning tutorials.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/learning/categories
// ---------------------------------------------------------------------------
router.get('/categories', async (req: AuthRequest, res) => {
  if (!assertNoCrossUserOverride(req, res)) return;
  try {
    await ensureLearningCatalogSeeded();
    const userId = req.user!.id;

    const allRows = await db
      .select()
      .from(learningTutorials)
      .where(eq(learningTutorials.published, true));

    const progressRows = await db
      .select()
      .from(learningProgress)
      .where(eq(learningProgress.userId, userId));

    const completedSet = new Set(progressRows.filter((p) => p.completed).map((p) => p.tutorialId));

    const categories: LearningCategoryStatusDto[] = LEARNING_CATEGORIES.map((cat) => {
      const matching = allRows.filter((r) => r.category === cat);
      const recordedVideoCount = matching.filter((r) => resolveSafeVideoPlayback(r).playable).length;
      const completedCount = matching.filter((r) => completedSet.has(r.id)).length;
      return {
        name: cat,
        publishedCount: matching.length,
        recordedVideoCount,
        completedCount,
        comingSoon: matching.length === 0,
      };
    });

    res.json({ categories });
  } catch {
    res.status(500).json({ error: 'Failed to load learning categories.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/learning/tutorials/:slug
// ---------------------------------------------------------------------------
router.get('/tutorials/:slug', async (req: AuthRequest, res) => {
  if (!assertNoCrossUserOverride(req, res)) return;
  try {
    await ensureLearningCatalogSeeded();
    const userId = req.user!.id;
    const isAdmin = req.user!.role === 'ADMIN';
    const slug = String(req.params.slug || '').trim().toLowerCase();

    const allRows = await db
      .select()
      .from(learningTutorials)
      .orderBy(asc(learningTutorials.sortOrder), asc(learningTutorials.title));

    const target = allRows.find((r) => r.slug === slug);
    if (!target || (!target.published && !isAdmin)) {
      return res.status(404).json({
        error: 'Tutorial not found.',
        code: 'TUTORIAL_NOT_FOUND',
      });
    }

    const publishedOrdered = allRows.filter((r) => r.published);
    const currentIndex = publishedOrdered.findIndex((r) => r.id === target.id);
    const prevRow = currentIndex > 0 ? publishedOrdered[currentIndex - 1] : null;
    const nextRow =
      currentIndex >= 0 && currentIndex < publishedOrdered.length - 1
        ? publishedOrdered[currentIndex + 1]
        : null;

    const progressRows = await db
      .select()
      .from(learningProgress)
      .where(eq(learningProgress.userId, userId));
    const progressByTutorialId = new Map(progressRows.map((p) => [p.tutorialId, p]));

    const summary = formatSummaryDto(target, progressByTutorialId.get(target.id));

    const relatedSlugs = Array.isArray(target.relatedSlugs)
      ? target.relatedSlugs.filter((s): s is string => typeof s === 'string')
      : [];

    const relatedTutorials = relatedSlugs
      .map((relSlug) => publishedOrdered.find((r) => r.slug === relSlug))
      .filter((r): r is typeof learningTutorials.$inferSelect => Boolean(r))
      .map((r) => ({
        id: r.id,
        slug: r.slug,
        title: r.title,
        category: (isValidCategory(r.category) ? r.category : 'Getting Started') as LearningCategory,
        difficulty: (isValidDifficulty(r.difficulty) ? r.difficulty : 'Beginner') as LearningDifficulty,
        durationSeconds: r.durationSeconds,
        hasVideo: resolveSafeVideoPlayback(r).playable,
        completed: Boolean(progressByTutorialId.get(r.id)?.completed),
      }));

    const detail: LearningTutorialDetailDto = {
      ...summary,
      learningObjectives: Array.isArray(target.learningObjectives)
        ? target.learningObjectives.filter((v): v is string => typeof v === 'string')
        : [],
      prerequisites: Array.isArray(target.prerequisites)
        ? target.prerequisites.filter((v): v is string => typeof v === 'string')
        : [],
      steps: Array.isArray(target.steps) ? (target.steps as TutorialStep[]) : [],
      warnings: Array.isArray(target.warnings)
        ? target.warnings.filter((v): v is string => typeof v === 'string')
        : [],
      relatedSlugs,
      relatedTutorials,
      docLinks: Array.isArray(target.docLinks) ? (target.docLinks as TutorialDocLink[]) : [],
      previousTutorial: prevRow
        ? { slug: prevRow.slug, title: prevRow.title, moduleName: prevRow.moduleName }
        : null,
      nextTutorial: nextRow
        ? { slug: nextRow.slug, title: nextRow.title, moduleName: nextRow.moduleName }
        : null,
    };

    res.json(detail);
  } catch {
    res.status(500).json({ error: 'Failed to load tutorial details.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/learning/progress
// ---------------------------------------------------------------------------
router.get('/progress', async (req: AuthRequest, res) => {
  if (!assertNoCrossUserOverride(req, res)) return;
  try {
    await ensureLearningCatalogSeeded();
    const userId = req.user!.id;

    const publishedRows = await db
      .select()
      .from(learningTutorials)
      .where(eq(learningTutorials.published, true))
      .orderBy(asc(learningTutorials.sortOrder), asc(learningTutorials.title));

    const progressRows = await db
      .select()
      .from(learningProgress)
      .where(eq(learningProgress.userId, userId));

    const progressByTutorialId = new Map(progressRows.map((p) => [p.tutorialId, p]));

    const enriched = publishedRows.map((row) => formatSummaryDto(row, progressByTutorialId.get(row.id)));
    const completedCount = enriched.filter((t) => t.progress?.completed).length;
    const inProgress = enriched
      .filter(
        (t) =>
          t.progress !== null &&
          !t.progress.completed &&
          (t.progress.lastPositionSeconds > 0 || t.progress.maxWatchedSeconds > 0)
      )
      .sort((a, b) => {
        const ta = a.progress?.lastWatchedAt ? Date.parse(a.progress.lastWatchedAt) : 0;
        const tb = b.progress?.lastWatchedAt ? Date.parse(b.progress.lastWatchedAt) : 0;
        return tb - ta;
      });

    const recentlyWatched = enriched
      .filter((t) => t.progress !== null && t.progress.lastWatchedAt !== null)
      .sort((a, b) => {
        const ta = a.progress?.lastWatchedAt ? Date.parse(a.progress.lastWatchedAt) : 0;
        const tb = b.progress?.lastWatchedAt ? Date.parse(b.progress.lastWatchedAt) : 0;
        return tb - ta;
      })
      .slice(0, 6);

    const recommendedNext =
      inProgress[0] ||
      enriched.find((t) => t.featured && !t.progress?.completed) ||
      enriched.find((t) => !t.progress?.completed) ||
      null;

    const totalPublished = enriched.length;
    const overallCompletionPercent =
      totalPublished > 0 ? Math.round((completedCount / totalPublished) * 100) : 0;

    res.json({
      summary: {
        totalTutorials: totalPublished,
        completedCount,
        inProgressCount: inProgress.length,
        overallCompletionPercent,
      },
      continueWatching: inProgress.slice(0, 4),
      recentlyWatched,
      recommendedNext,
      items: enriched
        .filter((t) => t.progress !== null)
        .map((t) => t.progress!),
    });
  } catch {
    res.status(500).json({ error: 'Failed to load learning progress.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/learning/progress/:tutorialId
// ---------------------------------------------------------------------------
router.get('/progress/:tutorialId', async (req: AuthRequest, res) => {
  if (!assertNoCrossUserOverride(req, res)) return;
  try {
    await ensureLearningCatalogSeeded();
    const userId = req.user!.id;
    const isAdmin = req.user!.role === 'ADMIN';
    const tutorialId = String(req.params.tutorialId || '').trim();

    const [tutorial] = await db
      .select()
      .from(learningTutorials)
      .where(eq(learningTutorials.id, tutorialId))
      .limit(1);

    if (!tutorial || (!tutorial.published && !isAdmin)) {
      return res.status(404).json({ error: 'Tutorial not found.', code: 'TUTORIAL_NOT_FOUND' });
    }

    const [progressRow] = await db
      .select()
      .from(learningProgress)
      .where(and(eq(learningProgress.userId, userId), eq(learningProgress.tutorialId, tutorialId)))
      .limit(1);

    res.json({
      progress:
        formatProgressDto(progressRow, tutorial.durationSeconds) ?? {
          tutorialId: tutorial.id,
          lastPositionSeconds: 0,
          maxWatchedSeconds: 0,
          percentWatched: 0,
          completed: false,
          completedAt: null,
          lastWatchedAt: null,
        },
    });
  } catch {
    res.status(500).json({ error: 'Failed to load tutorial progress.' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/learning/progress/:tutorialId
// ---------------------------------------------------------------------------
router.put('/progress/:tutorialId', progressWriteLimiter, async (req: AuthRequest, res) => {
  if (!assertNoCrossUserOverride(req, res)) return;
  try {
    await ensureLearningCatalogSeeded();
    const userId = req.user!.id;
    const isAdmin = req.user!.role === 'ADMIN';
    const tutorialId = String(req.params.tutorialId || '').trim();

    const [tutorial] = await db
      .select()
      .from(learningTutorials)
      .where(eq(learningTutorials.id, tutorialId))
      .limit(1);

    if (!tutorial || (!tutorial.published && !isAdmin)) {
      return res.status(404).json({ error: 'Tutorial not found.', code: 'TUTORIAL_NOT_FOUND' });
    }

    const rawPos = req.body?.lastPositionSeconds;
    if (typeof rawPos !== 'number' || !Number.isFinite(rawPos)) {
      return res.status(400).json({
        error: 'lastPositionSeconds must be a finite number.',
        code: 'INVALID_PLAYBACK_POSITION',
      });
    }

    if (rawPos < 0) {
      return res.status(400).json({
        error: 'Playback position cannot be negative.',
        code: 'NEGATIVE_PLAYBACK_POSITION',
      });
    }

    const maxAllowedWithSlack = tutorial.durationSeconds + 2;
    if (rawPos > maxAllowedWithSlack) {
      return res.status(400).json({
        error: `Playback position (${rawPos}s) exceeds tutorial duration (${tutorial.durationSeconds}s).`,
        code: 'IMPOSSIBLE_PLAYBACK_POSITION',
      });
    }

    const rawWatched = req.body?.watchedSeconds;
    if (rawWatched !== undefined) {
      if (typeof rawWatched !== 'number' || !Number.isFinite(rawWatched) || rawWatched < 0 || rawWatched > maxAllowedWithSlack) {
        return res.status(400).json({
          error: 'watchedSeconds must be a non-negative number within tutorial duration.',
          code: 'INVALID_WATCHED_SECONDS',
        });
      }
    }

    const clampedPos = Math.min(tutorial.durationSeconds, Math.floor(rawPos));
    const clampedWatched =
      rawWatched !== undefined
        ? Math.min(tutorial.durationSeconds, Math.floor(rawWatched))
        : clampedPos;

    const saved = await withProgressLock(`${userId}:${tutorialId}`, async () => {
      const [existing] = await db
        .select()
        .from(learningProgress)
        .where(and(eq(learningProgress.userId, userId), eq(learningProgress.tutorialId, tutorialId)))
        .limit(1);

      const nextMaxWatched = Math.max(existing?.maxWatchedSeconds ?? 0, clampedWatched);
      const completionThreshold = Math.max(1, Math.ceil(tutorial.durationSeconds * 0.9));
      const reachedThreshold = tutorial.durationSeconds > 0 && nextMaxWatched >= completionThreshold;
      const nextCompleted = Boolean(existing?.completed) || reachedThreshold;
      const now = new Date();
      const nextCompletedAt = existing?.completedAt
        ? existing.completedAt
        : nextCompleted
          ? now
          : null;

      if (existing) {
        const [updated] = await db
          .update(learningProgress)
          .set({
            lastPositionSeconds: clampedPos,
            maxWatchedSeconds: nextMaxWatched,
            completed: nextCompleted,
            completedAt: nextCompletedAt,
            lastWatchedAt: now,
            updatedAt: now,
          })
          .where(eq(learningProgress.id, existing.id))
          .returning();
        return updated;
      }

      const [inserted] = await db
        .insert(learningProgress)
        .values({
          id: uuidv4(),
          userId,
          tutorialId,
          lastPositionSeconds: clampedPos,
          maxWatchedSeconds: nextMaxWatched,
          completed: nextCompleted,
          completedAt: nextCompletedAt,
          lastWatchedAt: now,
          updatedAt: now,
        })
        .returning();
      return inserted;
    });

    res.json({
      progress: formatProgressDto(saved, tutorial.durationSeconds),
    });
  } catch {
    res.status(500).json({ error: 'Failed to save learning progress.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/learning/progress/:tutorialId/complete
// ---------------------------------------------------------------------------
router.post('/progress/:tutorialId/complete', progressWriteLimiter, async (req: AuthRequest, res) => {
  if (!assertNoCrossUserOverride(req, res)) return;
  try {
    await ensureLearningCatalogSeeded();
    const userId = req.user!.id;
    const isAdmin = req.user!.role === 'ADMIN';
    const tutorialId = String(req.params.tutorialId || '').trim();

    const [tutorial] = await db
      .select()
      .from(learningTutorials)
      .where(eq(learningTutorials.id, tutorialId))
      .limit(1);

    if (!tutorial || (!tutorial.published && !isAdmin)) {
      return res.status(404).json({ error: 'Tutorial not found.', code: 'TUTORIAL_NOT_FOUND' });
    }

    const saved = await withProgressLock(`${userId}:${tutorialId}`, async () => {
      const [existing] = await db
        .select()
        .from(learningProgress)
        .where(and(eq(learningProgress.userId, userId), eq(learningProgress.tutorialId, tutorialId)))
        .limit(1);

      const now = new Date();
      const targetWatched = Math.max(existing?.maxWatchedSeconds ?? 0, tutorial.durationSeconds);

      if (existing) {
        const [updated] = await db
          .update(learningProgress)
          .set({
            maxWatchedSeconds: targetWatched,
            completed: true,
            completedAt: existing.completedAt ?? now,
            lastWatchedAt: now,
            updatedAt: now,
          })
          .where(eq(learningProgress.id, existing.id))
          .returning();
        return updated;
      }

      const [inserted] = await db
        .insert(learningProgress)
        .values({
          id: uuidv4(),
          userId,
          tutorialId,
          lastPositionSeconds: 0,
          maxWatchedSeconds: targetWatched,
          completed: true,
          completedAt: now,
          lastWatchedAt: now,
          updatedAt: now,
        })
        .returning();
      return inserted;
    });

    res.json({
      progress: formatProgressDto(saved, tutorial.durationSeconds),
    });
  } catch {
    res.status(500).json({ error: 'Failed to mark tutorial completed.' });
  }
});

// ---------------------------------------------------------------------------
// ADMIN CONTENT MANAGEMENT ENDPOINTS (RBAC: ADMIN ONLY)
// ---------------------------------------------------------------------------
const tutorialStepSchema = z.object({
  stepNumber: z.number().int().min(1).max(50),
  title: z.string().trim().min(2).max(160),
  instruction: z.string().trim().min(4).max(1200),
  actionPath: z
    .string()
    .trim()
    .regex(/^\/[a-zA-Z0-9/_-]*$/, 'actionPath must be an internal FortiX path starting with "/"')
    .optional(),
  actionLabel: z.string().trim().min(2).max(60).optional(),
});

const tutorialDocLinkSchema = z.object({
  title: z.string().trim().min(2).max(120),
  href: z
    .string()
    .trim()
    .regex(/^\/[a-zA-Z0-9/_-]*$/, 'docLinks.href must be an internal FortiX path starting with "/"'),
  kind: z.enum(['workspace', 'openapi', 'guide']),
});

const createTutorialSchema = z.object({
  slug: z.string().trim().min(3).max(96),
  title: z.string().trim().min(4).max(180),
  description: z.string().trim().min(10).max(1000),
  moduleName: z.string().trim().min(3).max(120),
  lifecycleStage: z.string().trim(),
  category: z.string().trim(),
  difficulty: z.string().trim(),
  videoProvider: z.string().trim().default('none'),
  videoReference: z.string().nullable().optional(),
  videoSourceNote: z.string().trim().max(280).nullable().optional(),
  thumbnailUrl: z.string().nullable().optional(),
  captionsUrl: z.string().nullable().optional(),
  durationSeconds: z.number().int().min(5).max(7200),
  learningObjectives: z.array(z.string().trim().min(3).max(300)).min(1).max(12),
  prerequisites: z.array(z.string().trim().min(2).max(300)).max(10).default([]),
  steps: z.array(tutorialStepSchema).min(1).max(20),
  warnings: z.array(z.string().trim().min(3).max(400)).max(10).default([]),
  relatedSlugs: z.array(z.string().trim().min(3).max(96)).max(8).default([]),
  docLinks: z.array(tutorialDocLinkSchema).max(8).default([]),
  featured: z.boolean().default(false),
  published: z.boolean().default(false),
  sortOrder: z.number().int().min(1).max(10000).default(500),
});

const patchTutorialSchema = createTutorialSchema.partial();

router.post('/admin/tutorials', requireAdmin, async (req: AuthRequest, res) => {
  try {
    await ensureLearningCatalogSeeded();
    const parsed = createTutorialSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid tutorial payload.',
        code: 'INVALID_TUTORIAL_PAYLOAD',
        issues: parsed.error.issues,
      });
    }

    const data = parsed.data;
    const slugCheck = validateTutorialSlug(data.slug);
    if (!slugCheck.valid || !slugCheck.slug) {
      return res.status(400).json({ error: slugCheck.error, code: 'INVALID_TUTORIAL_SLUG' });
    }
    if (!isValidCategory(data.category)) {
      return res.status(400).json({ error: 'Unsupported tutorial category.', code: 'INVALID_CATEGORY' });
    }
    if (!isValidDifficulty(data.difficulty)) {
      return res.status(400).json({ error: 'Unsupported difficulty level.', code: 'INVALID_DIFFICULTY' });
    }
    if (!isValidLifecycleStage(data.lifecycleStage)) {
      return res.status(400).json({ error: 'Unsupported lifecycleStage.', code: 'INVALID_LIFECYCLE_STAGE' });
    }

    const videoCheck = validateVideoSource(data.videoProvider, data.videoReference ?? null);
    if (!videoCheck.valid || !videoCheck.provider) {
      return res.status(400).json({ error: videoCheck.error, code: 'UNSAFE_VIDEO_SOURCE' });
    }

    const captionsCheck = validateCaptionsUrl(data.captionsUrl ?? null);
    if (!captionsCheck.valid) {
      return res.status(400).json({ error: captionsCheck.error, code: 'INVALID_CAPTIONS_URL' });
    }

    const thumbCheck = validateThumbnailUrl(data.thumbnailUrl ?? null);
    if (!thumbCheck.valid) {
      return res.status(400).json({ error: thumbCheck.error, code: 'INVALID_THUMBNAIL_URL' });
    }

    const [dup] = await db
      .select({ id: learningTutorials.id })
      .from(learningTutorials)
      .where(eq(learningTutorials.slug, slugCheck.slug))
      .limit(1);

    if (dup) {
      return res.status(409).json({
        error: `A tutorial with slug "${slugCheck.slug}" already exists.`,
        code: 'DUPLICATE_TUTORIAL_SLUG',
      });
    }

    const now = new Date();
    const [created] = await db
      .insert(learningTutorials)
      .values({
        id: uuidv4(),
        slug: slugCheck.slug,
        title: data.title,
        description: data.description,
        moduleName: data.moduleName,
        lifecycleStage: data.lifecycleStage,
        category: data.category,
        difficulty: data.difficulty,
        videoProvider: videoCheck.provider,
        videoReference: videoCheck.reference ?? null,
        videoSourceNote: data.videoSourceNote ?? null,
        thumbnailUrl: thumbCheck.url,
        captionsUrl: captionsCheck.url,
        durationSeconds: data.durationSeconds,
        learningObjectives: data.learningObjectives,
        prerequisites: data.prerequisites,
        steps: data.steps,
        warnings: data.warnings,
        relatedSlugs: data.relatedSlugs,
        docLinks: data.docLinks,
        featured: data.featured,
        published: data.published,
        sortOrder: data.sortOrder,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    res.status(201).json({ tutorial: formatSummaryDto(created) });
  } catch {
    res.status(500).json({ error: 'Failed to create tutorial.' });
  }
});

router.patch('/admin/tutorials/:id', requireAdmin, async (req: AuthRequest, res) => {
  try {
    await ensureLearningCatalogSeeded();
    const id = String(req.params.id || '').trim();
    const [existing] = await db
      .select()
      .from(learningTutorials)
      .where(eq(learningTutorials.id, id))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: 'Tutorial not found.', code: 'TUTORIAL_NOT_FOUND' });
    }

    const parsed = patchTutorialSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid tutorial update payload.',
        code: 'INVALID_TUTORIAL_PAYLOAD',
        issues: parsed.error.issues,
      });
    }

    const data = parsed.data;
    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (data.slug !== undefined) {
      const slugCheck = validateTutorialSlug(data.slug);
      if (!slugCheck.valid || !slugCheck.slug) {
        return res.status(400).json({ error: slugCheck.error, code: 'INVALID_TUTORIAL_SLUG' });
      }
      if (slugCheck.slug !== existing.slug) {
        const [dup] = await db
          .select({ id: learningTutorials.id })
          .from(learningTutorials)
          .where(eq(learningTutorials.slug, slugCheck.slug))
          .limit(1);
        if (dup) {
          return res.status(409).json({ error: 'Duplicate tutorial slug.', code: 'DUPLICATE_TUTORIAL_SLUG' });
        }
      }
      updates.slug = slugCheck.slug;
    }

    if (data.category !== undefined) {
      if (!isValidCategory(data.category)) {
        return res.status(400).json({ error: 'Unsupported tutorial category.', code: 'INVALID_CATEGORY' });
      }
      updates.category = data.category;
    }

    if (data.difficulty !== undefined) {
      if (!isValidDifficulty(data.difficulty)) {
        return res.status(400).json({ error: 'Unsupported difficulty level.', code: 'INVALID_DIFFICULTY' });
      }
      updates.difficulty = data.difficulty;
    }

    if (data.lifecycleStage !== undefined) {
      if (!isValidLifecycleStage(data.lifecycleStage)) {
        return res.status(400).json({ error: 'Unsupported lifecycleStage.', code: 'INVALID_LIFECYCLE_STAGE' });
      }
      updates.lifecycleStage = data.lifecycleStage;
    }

    if (data.videoProvider !== undefined || data.videoReference !== undefined) {
      const nextProvider = data.videoProvider ?? existing.videoProvider;
      const nextRef =
        data.videoReference !== undefined
          ? data.videoReference
          : nextProvider === 'none'
            ? null
            : existing.videoReference;
      const videoCheck = validateVideoSource(nextProvider, nextRef);
      if (!videoCheck.valid || !videoCheck.provider) {
        return res.status(400).json({ error: videoCheck.error, code: 'UNSAFE_VIDEO_SOURCE' });
      }
      updates.videoProvider = videoCheck.provider;
      updates.videoReference = videoCheck.reference ?? null;
    }

    if (data.captionsUrl !== undefined) {
      const captionsCheck = validateCaptionsUrl(data.captionsUrl);
      if (!captionsCheck.valid) {
        return res.status(400).json({ error: captionsCheck.error, code: 'INVALID_CAPTIONS_URL' });
      }
      updates.captionsUrl = captionsCheck.url;
    }

    if (data.thumbnailUrl !== undefined) {
      const thumbCheck = validateThumbnailUrl(data.thumbnailUrl);
      if (!thumbCheck.valid) {
        return res.status(400).json({ error: thumbCheck.error, code: 'INVALID_THUMBNAIL_URL' });
      }
      updates.thumbnailUrl = thumbCheck.url;
    }

    if (data.title !== undefined) updates.title = data.title;
    if (data.description !== undefined) updates.description = data.description;
    if (data.moduleName !== undefined) updates.moduleName = data.moduleName;
    if (data.videoSourceNote !== undefined) updates.videoSourceNote = data.videoSourceNote;
    if (data.durationSeconds !== undefined) updates.durationSeconds = data.durationSeconds;
    if (data.learningObjectives !== undefined) updates.learningObjectives = data.learningObjectives;
    if (data.prerequisites !== undefined) updates.prerequisites = data.prerequisites;
    if (data.steps !== undefined) updates.steps = data.steps;
    if (data.warnings !== undefined) updates.warnings = data.warnings;
    if (data.relatedSlugs !== undefined) updates.relatedSlugs = data.relatedSlugs;
    if (data.docLinks !== undefined) updates.docLinks = data.docLinks;
    if (data.featured !== undefined) updates.featured = data.featured;
    if (data.published !== undefined) updates.published = data.published;
    if (data.sortOrder !== undefined) updates.sortOrder = data.sortOrder;

    const [updated] = await db
      .update(learningTutorials)
      .set(updates)
      .where(eq(learningTutorials.id, id))
      .returning();

    res.json({ tutorial: formatSummaryDto(updated) });
  } catch {
    res.status(500).json({ error: 'Failed to update tutorial.' });
  }
});

export const learningRouter = router;
