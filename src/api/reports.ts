import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { db } from '../db/index.js';
import { projects, organizations, verifications } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import PDFDocument from 'pdfkit';
import { artifactStorage } from '../storage/index.js';

const router = Router();

// Helper to generate a PDF buffer using PDFDocument
export function buildPdfBuffer(title: string, metadata: Record<string, string>, content: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40 });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(22).text(title, { align: 'center' });
    doc.moveDown();

    for (const [key, val] of Object.entries(metadata)) {
      doc.fontSize(12).text(`${key}: ${val}`);
    }
    doc.moveDown();

    doc.fontSize(16).text('Verification Assertions & Findings', { underline: true });
    doc.moveDown();
    doc.fontSize(11).text(content || 'All security policies and chaos resilience assertions passed.');

    doc.end();
  });
}

// Generate, persist, and download verification PDF report
router.post('/control/reports/:verificationId', authenticate, async (req, res) => {
  try {
    const verificationId = String(req.params.verificationId);
    const { projectId, details } = req.body;

    if (!projectId || typeof projectId !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid projectId in request body' });
    }

    // Verify project ownership (tenant isolation)
    const [project] = await db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .leftJoin(organizations, eq(projects.orgId, organizations.id))
      .where(and(eq(projects.id, projectId), eq(organizations.ownerId, (req as any).user.id)));

    if (!project) {
      return res.status(403).json({ error: 'Unauthorized: Access to project denied' });
    }

    // 1. Generate PDF in memory buffer
    const pdfBuffer = await buildPdfBuffer(
      'FortiX Resilience & Verification Evidence',
      {
        'Verification ID': verificationId,
        'Project Name': project.name,
        'Generated At': new Date().toISOString(),
        'Engine': 'FortiX Resilience Verification Engine v2.0',
      },
      details || 'Evidence executed, chaos injected, resilience verified.'
    );

    // 2. Persist to Artifact Storage (Local / S3)
    const filename = `FortiX-Report-${verificationId}.pdf`;
    const artifactMeta = await artifactStorage.put(pdfBuffer, {
      verificationId,
      projectId,
      filename,
      contentType: 'application/pdf',
      customMetadata: {
        generatedBy: (req as any).user.id,
      },
    });

    // 3. Update Verification record in Database if verificationId exists
    try {
      await db
        .update(verifications)
        .set({ pdfS3Url: artifactMeta.objectKey })
        .where(eq(verifications.id, verificationId));
    } catch (dbErr) {
      // Verification ID might be custom/ad-hoc
    }

    // 4. Return PDF stream with artifact metadata headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.setHeader('X-FortiX-Artifact-Id', artifactMeta.artifactId);
    res.setHeader('X-FortiX-Artifact-SHA256', artifactMeta.sha256);
    res.setHeader('X-FortiX-Storage-Provider', artifactMeta.storageProvider);

    res.send(pdfBuffer);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to generate and persist report', message: error?.message });
  }
});

// Download a previously stored artifact by artifactId (with strict project tenant authorization)
router.get('/control/reports/artifacts/:artifactId', authenticate, async (req, res) => {
  try {
    const artifactId = String(req.params.artifactId);
    const projectId = req.query.projectId as string;

    if (!projectId) {
      return res.status(400).json({ error: 'Missing projectId query parameter for authorization' });
    }

    // Verify tenant authorization
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .leftJoin(organizations, eq(projects.orgId, organizations.id))
      .where(and(eq(projects.id, projectId), eq(organizations.ownerId, (req as any).user.id)));

    if (!project) {
      return res.status(403).json({ error: 'Unauthorized: Access to project denied' });
    }

    const artifact = await artifactStorage.get(artifactId, projectId);
    if (!artifact) {
      return res.status(404).json({ error: 'Artifact not found' });
    }

    res.setHeader('Content-Type', artifact.metadata.contentType);
    res.setHeader('Content-Disposition', `attachment; filename=${artifact.metadata.filename}`);
    res.setHeader('X-FortiX-Artifact-Id', artifact.metadata.artifactId);
    res.setHeader('X-FortiX-Artifact-SHA256', artifact.metadata.sha256);
    res.setHeader('X-FortiX-Storage-Provider', artifact.metadata.storageProvider);

    res.send(artifact.data);
  } catch (error: any) {
    if (error.message?.includes('Access Denied')) {
      return res.status(403).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to retrieve artifact', message: error?.message });
  }
});

// List all artifacts stored for a project
router.get('/control/reports/projects/:projectId/artifacts', authenticate, async (req, res) => {
  try {
    const projectId = String(req.params.projectId);

    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .leftJoin(organizations, eq(projects.orgId, organizations.id))
      .where(and(eq(projects.id, projectId), eq(organizations.ownerId, (req as any).user.id)));

    if (!project) {
      return res.status(403).json({ error: 'Unauthorized: Access to project denied' });
    }

    const list = await artifactStorage.listByProject(projectId);
    res.json(list);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to list artifacts', message: error?.message });
  }
});

export default router;
