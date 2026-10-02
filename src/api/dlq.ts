import express, { Request, Response } from 'express';
import { 
  listDlqJobs, 
  getDlqJob, 
  retryDlqJob, 
  retryAllDlqJobs, 
  discardDlqJob, 
  purgeAllDlqJobs, 
  getQueueStats 
} from '../lib/dlq.js';
import { z } from 'zod';
import { logger } from '../lib/logger.js';

const router = express.Router();

const querySchema = z.object({
  queueName: z.string().optional(),
  status: z.string().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).optional().default(50),
  offset: z.coerce.number().min(0).optional().default(0)
});

/**
 * GET /api/control/dlq/stats
 * Aggregate queue health and DLQ statistics
 */
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const stats = await getQueueStats();
    res.json(stats);
  } catch (err: any) {
    logger.error({ err }, '[DLQ API] Failed to fetch queue stats');
    res.status(500).json({ error: 'Failed to retrieve queue statistics', details: err?.message });
  }
});

/**
 * GET /api/control/dlq
 * List all dead-letter jobs with optional filtering
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const query = querySchema.parse(req.query);
    const result = await listDlqJobs(query);
    res.json(result);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation Error', details: err.issues });
    }
    logger.error({ err }, '[DLQ API] Failed to list DLQ jobs');
    res.status(500).json({ error: 'Failed to list DLQ jobs', details: err?.message });
  }
});

/**
 * POST /api/control/dlq/retry-all
 * Bulk retry all dead-letter jobs
 */
router.post('/retry-all', async (req: Request, res: Response) => {
  try {
    const queueName = req.query.queueName as string | undefined;
    const result = await retryAllDlqJobs(queueName);
    res.status(200).json(result);
  } catch (err: any) {
    logger.error({ err }, '[DLQ API] Failed to bulk retry DLQ jobs');
    res.status(500).json({ error: 'Failed to bulk retry DLQ jobs', details: err?.message });
  }
});

/**
 * DELETE /api/control/dlq/purge-all
 * Bulk purge all dead-letter jobs
 */
router.delete('/purge-all', async (req: Request, res: Response) => {
  try {
    const queueName = req.query.queueName as string | undefined;
    const result = await purgeAllDlqJobs(queueName);
    res.status(200).json(result);
  } catch (err: any) {
    logger.error({ err }, '[DLQ API] Failed to purge DLQ jobs');
    res.status(500).json({ error: 'Failed to purge DLQ jobs', details: err?.message });
  }
});

/**
 * GET /api/control/dlq/:jobId
 * Retrieve single dead-letter job with complete stacktrace
 */
router.get('/:jobId', async (req: Request, res: Response) => {
  try {
    const jobId = String(req.params.jobId);
    const job = await getDlqJob(jobId);
    if (!job) {
      return res.status(404).json({ error: `DLQ Job with ID '${jobId}' not found` });
    }
    res.json(job);
  } catch (err: any) {
    logger.error({ err, jobId: String(req.params.jobId) }, '[DLQ API] Failed to get DLQ job');
    res.status(500).json({ error: 'Failed to retrieve DLQ job', details: err?.message });
  }
});

/**
 * POST /api/control/dlq/:jobId/retry
 * Replay/retry an individual failed job
 */
router.post('/:jobId/retry', async (req: Request, res: Response) => {
  try {
    const jobId = String(req.params.jobId);
    const result = await retryDlqJob(jobId);
    if (!result.success) {
      return res.status(404).json({ error: result.message });
    }
    res.status(200).json(result);
  } catch (err: any) {
    logger.error({ err, jobId: String(req.params.jobId) }, '[DLQ API] Failed to retry DLQ job');
    res.status(500).json({ error: 'Failed to retry DLQ job', details: err?.message });
  }
});

/**
 * DELETE /api/control/dlq/:jobId
 * Discard / delete an individual failed job
 */
router.delete('/:jobId', async (req: Request, res: Response) => {
  try {
    const jobId = String(req.params.jobId);
    const result = await discardDlqJob(jobId);
    if (!result.success) {
      return res.status(404).json({ error: result.message });
    }
    res.status(200).json(result);
  } catch (err: any) {
    logger.error({ err, jobId: String(req.params.jobId) }, '[DLQ API] Failed to discard DLQ job');
    res.status(500).json({ error: 'Failed to discard DLQ job', details: err?.message });
  }
});

export const dlqRouter = router;
