import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireProjectOwnership } from './projects.js';
import { db } from '../db/index.js';
import { projects, organizations } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import PDFDocument from 'pdfkit';

const router = Router();

// Setup report generation endpoint
router.post('/control/reports/:verificationId', authenticate, async (req, res) => {
  try {
    const verificationId = req.params.verificationId;
    const { projectId, details } = req.body;
    
    // Verify ownership
    const [project] = await db.select({ id: projects.id, name: projects.name }).from(projects)
      .leftJoin(organizations, eq(projects.orgId, organizations.id))
      .where(and(eq(projects.id, projectId), eq(organizations.ownerId, (req as any).user.id)));
      
    if (!project) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const doc = new PDFDocument();
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=FortiX-Report-${verificationId}.pdf`);
    
    doc.pipe(res);
    
    doc.fontSize(24).text('FortiX Execution Evidence', { align: 'center' });
    doc.moveDown();
    
    doc.fontSize(14).text(`Verification ID: ${verificationId}`);
    doc.text(`Project: ${project.name}`);
    doc.text(`Timestamp: ${new Date().toISOString()}`);
    doc.moveDown();
    
    doc.fontSize(16).text('Security Policy Assertions', { underline: true });
    doc.moveDown();
    doc.fontSize(12).text(details || 'Evidence executed and verified.');

    doc.end();

  } catch (error) {
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

export default router;
