import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { chromium, type Page } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const OUTPUT_DIR = path.join(process.cwd(), 'public', 'learning', 'videos');
const TMP_DIR = path.join(process.cwd(), 'test-results', 'raw-learning-captures');

interface WalkthroughSpec {
  slug: string;
  startPath: string;
  run: (page: Page) => Promise<void>;
}

async function loginToFortiX(page: Page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Email address or phone number').fill('admin@fortix.io');
  await page.getByLabel('Password', { exact: true }).fill('AdminPassword123!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'Sign Out' }).waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(800);
}

async function navSidebar(page: Page, label: string, waitMs = 2400) {
  await page.getByRole('link', { name: label, exact: true }).click();
  await page.waitForTimeout(waitMs);
}

const WALKTHROUGHS: WalkthroughSpec[] = [
  {
    slug: 'what-is-fortix',
    startPath: '/',
    run: async (page) => {
      await page.waitForTimeout(2400);
      await navSidebar(page, 'API Studio', 2400);
      await navSidebar(page, 'Security', 2400);
      await navSidebar(page, 'Experiments', 2400);
      await navSidebar(page, 'Verifications', 2800);
    },
  },
  {
    slug: 'creating-your-first-api',
    startPath: '/apis',
    run: async (page) => {
      await page.waitForTimeout(2200);
      const addRouteBtn = page.getByRole('button', { name: /Add API Route/i });
      if (await addRouteBtn.isVisible().catch(() => false)) {
        await addRouteBtn.click();
        await page.waitForTimeout(2500);
      }
      await navSidebar(page, 'Security', 2400);
      const configBtn = page.getByRole('button', { name: /Configure Route Policy/i });
      if (await configBtn.isEnabled().catch(() => false)) {
        await configBtn.click();
        await page.waitForTimeout(3000);
      } else {
        await page.waitForTimeout(3000);
      }
    },
  },
  {
    slug: 'creating-your-first-experiment',
    startPath: '/experiments',
    run: async (page) => {
      await page.waitForTimeout(2500);
      const selectFault = page.locator('select').nth(1);
      if (await selectFault.isVisible().catch(() => false)) {
        await selectFault.selectOption('latency').catch(() => {});
        await page.waitForTimeout(2000);
      }
      const authCheckbox = page.locator('input[type="checkbox"]').first();
      if (await authCheckbox.isVisible().catch(() => false)) {
        await authCheckbox.check().catch(() => {});
        await page.waitForTimeout(2500);
      }
      await navSidebar(page, 'Resilience', 3000);
    },
  },
  {
    slug: 'understanding-verification-results',
    startPath: '/resilience',
    run: async (page) => {
      await page.waitForTimeout(2800);
      await navSidebar(page, 'Verifications', 3200);
      await page.evaluate(() => {
        const scroller = document.querySelector('main div.overflow-y-auto');
        scroller?.scrollBy({ top: 260, behavior: 'smooth' });
      });
      await page.waitForTimeout(2800);
      await page.evaluate(() => {
        const scroller = document.querySelector('main div.overflow-y-auto');
        scroller?.scrollTo({ top: 0, behavior: 'smooth' });
      });
      await page.waitForTimeout(2200);
    },
  },
  {
    slug: 'creating-an-api-using-api-studio',
    startPath: '/studio',
    run: async (page) => {
      await page.waitForTimeout(2200);
      const createProductsBtn = page.getByRole('button', {
        name: /Create Products API/i,
      });
      if (await createProductsBtn.isVisible().catch(() => false)) {
        await createProductsBtn.click();
        await page.waitForTimeout(3500);
      }
      const sendBtn = page.getByRole('button', { name: /Send Request/i }).first();
      if (await sendBtn.isVisible().catch(() => false)) {
        await sendBtn.click().catch(() => {});
        await page.waitForTimeout(3200);
      } else {
        await page.waitForTimeout(3200);
      }
    },
  },
];

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.mkdirSync(TMP_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    const authContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const authPage = await authContext.newPage();
    await loginToFortiX(authPage);
    const storageState = await authContext.storageState();
    await authContext.close();

    for (const item of WALKTHROUGHS) {
      console.log(`[Recorder] Capturing live FortiX UI walkthrough: ${item.slug}...`);
      const itemTmpDir = path.join(TMP_DIR, item.slug);
      fs.rmSync(itemTmpDir, { recursive: true, force: true });
      fs.mkdirSync(itemTmpDir, { recursive: true });

      const recContext = await browser.newContext({
        storageState,
        viewport: { width: 1280, height: 720 },
        recordVideo: {
          dir: itemTmpDir,
          size: { width: 1280, height: 720 },
        },
      });

      const page = await recContext.newPage();
      await page.goto(`${BASE_URL}${item.startPath}`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'Sign Out' }).waitFor({ state: 'visible', timeout: 15000 });
      await page.waitForTimeout(600);
      await item.run(page);

      const videoHandle = page.video();
      await recContext.close();

      const rawVideoPath = videoHandle ? await videoHandle.path() : null;
      if (!rawVideoPath || !fs.existsSync(rawVideoPath)) {
        throw new Error(`No video produced for ${item.slug}`);
      }

      const targetPath = path.join(OUTPUT_DIR, `${item.slug}.webm`);

      // Trim initial 0.8s lazy-chunk bootstrap and normalize cleanly to 25.0s VP9 WebM
      execFileSync(
        'ffmpeg',
        [
          '-y',
          '-ss',
          '0.8',
          '-i',
          rawVideoPath,
          '-vf',
          'scale=1280:720,fps=24,tpad=stop_mode=clone:stop_duration=20',
          '-t',
          '25',
          '-an',
          '-c:v',
          'libvpx-vp9',
          '-b:v',
          '550k',
          '-crf',
          '34',
          '-deadline',
          'realtime',
          '-cpu-used',
          '5',
          targetPath,
        ],
        { stdio: 'ignore' }
      );

      const stat = fs.statSync(targetPath);
      console.log(`[Recorder] Saved ${targetPath} (${Math.round(stat.size / 1024)} KB, 25.0s)`);
    }
  } finally {
    await browser.close();
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('[Recorder] Fatal error:', err);
  process.exit(1);
});
