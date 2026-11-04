import fs from 'fs';
import path from 'path';
import { test, expect } from '@playwright/test';

const SCREENSHOT_DIR = path.join(process.cwd(), 'docs', 'learning', 'screenshots');

test.describe('FTX-LEARN-001: FortiX In-App Video Learning Center E2E', () => {
  test.beforeAll(() => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  });

  test('completes full 10-step learning journey: browse, filter, watch, save progress, navigate away, resume, complete, contextual help, and responsive layout', async ({
    browser,
  }) => {
    const context = await browser.newContext({ viewport: { width: 1366, height: 860 } });
    const page = await context.newPage();

    // Register a clean isolated operator user so progress assertions start at 0%
    const uniqueEmail = `e2e-learner-${Date.now()}@fortix.test`;
    await page.goto('/login');
    await page.getByRole('button', { name: 'Create an account' }).click();
    await page.getByLabel('Email address').fill(uniqueEmail);
    await page.getByLabel('Password', { exact: true }).fill('StrongPass!2026');
    await page.getByRole('button', { name: 'Create an account' }).click();
    await expect(page.getByRole('button', { name: 'Sign Out' })).toBeVisible({ timeout: 15000 });

    // 1. User opens Learning Center via sidebar entry
    const sidebarLink = page.getByRole('link', { name: 'Learning Center' });
    await expect(sidebarLink).toBeVisible();
    await sidebarLink.click();
    await expect(page).toHaveURL(/\/learning-center$/);
    await expect(page.getByRole('heading', { name: 'Learn FortiX' })).toBeVisible();
    await expect(page.getByTestId('summary-completion-pct')).toHaveText('0%');

    // Capture Screenshot 1: Learning Center Landing & Catalog (Dark Mode)
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '01-learning-center-catalog-dark.png'),
      fullPage: false,
    });

    // Test search & category filtering
    const searchInput = page.getByTestId('learning-search-input');
    await searchInput.fill('INCONCLUSIVE');
    await expect(
      page.getByTestId('catalog-row-understanding-verification-results')
    ).toBeVisible();
    await page.getByTestId('learning-reset-filters-btn').click();
    await expect(page.getByTestId('featured-tutorial-what-is-fortix')).toBeVisible();

    // 2. User selects a recorded tutorial ("FortiX in 5 Minutes")
    await page.getByTestId('featured-tutorial-what-is-fortix').click();
    await expect(page).toHaveURL(/\/learning-center\/what-is-fortix$/);
    await expect(
      page.getByRole('heading', { name: /FortiX in 5 Minutes/i })
    ).toBeVisible();

    // 3. Video loads cleanly with captions track and does NOT mark complete merely from opening
    const videoEl = page.getByTestId('html5-video-element');
    await expect(videoEl).toBeVisible();
    await expect(page.getByTestId('mark-tutorial-complete-btn')).toBeVisible();

    await expect
      .poll(
        async () =>
          videoEl.evaluate((v: HTMLVideoElement) => v.readyState >= 1 && v.duration > 0),
        { timeout: 15000 }
      )
      .toBe(true);

    // 4 & 5. User watches part of the video (~10s) -> progress saved to backend
    await page.getByTestId('video-play-pause-btn').click();
    await page.waitForTimeout(1600);
    // Advance playback to 10s while playing so active captions cue is visible, then pause to persist
    await videoEl.evaluate((v: HTMLVideoElement) => {
      v.currentTime = 10.5;
    });
    await page.waitForTimeout(500);

    const putPromise = page.waitForResponse(
      (res) =>
        res.url().includes('/api/learning/progress/') &&
        res.request().method() === 'PUT' &&
        res.status() === 200
    );
    await page.getByTestId('video-play-pause-btn').click();

    const savedRes = await putPromise;
    const savedJson = await savedRes.json();
    expect(savedJson.progress.lastPositionSeconds).toBeGreaterThanOrEqual(10);
    expect(savedJson.progress.completed).toBe(false);

    // Capture Screenshot 2: Tutorial Detail & Video Player with Captions
    await page.evaluate(() => {
      const scroller = document.querySelector('main div.overflow-y-auto');
      scroller?.scrollTo({ top: 0 });
    });
    await page.waitForTimeout(200);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '02-tutorial-video-player-captions.png'),
      fullPage: false,
    });

    // 6. User navigates away to Protected APIs and verifies unobtrusive contextual help link
    await page.getByRole('link', { name: 'Protected APIs' }).click();
    await expect(page).toHaveURL(/\/apis$/);
    await expect(page.getByTestId('contextual-help-creating-your-first-api')).toBeVisible();

    // Capture Screenshot 3: Contextual Help Link on Protected APIs
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '03-contextual-help-protected-apis.png'),
      fullPage: false,
    });

    // Return to Learning Center landing -> Continue Learning section shows saved resume state
    await page.getByRole('link', { name: 'Learning Center' }).click();
    await expect(page.getByTestId('continue-watching-what-is-fortix')).toBeVisible();

    // 7 & 8. User returns to the tutorial -> video resumes from saved position (~10s)
    await page.getByTestId('continue-watching-what-is-fortix').getByRole('link', { name: 'Resume' }).click();
    await expect(page).toHaveURL(/\/learning-center\/what-is-fortix$/);
    await expect(page.getByTestId('video-resume-banner')).toBeVisible();

    await expect
      .poll(
        async () =>
          videoEl.evaluate((v: HTMLVideoElement) => Math.round(v.currentTime)),
        { timeout: 10000 }
      )
      .toBeGreaterThanOrEqual(9);

    // 9 & 10. User completes the tutorial -> completion status updates and persists across reload
    const completeRespPromise = page.waitForResponse(
      (res) =>
        res.url().includes('/api/learning/progress/') &&
        res.url().endsWith('/complete') &&
        res.status() === 200
    );
    await page.getByTestId('mark-tutorial-complete-btn').click();
    await completeRespPromise;

    await expect(page.getByTestId('tutorial-completed-indicator')).toBeVisible();

    // Reload browser page and verify completion persists
    await page.reload();
    await expect(page.getByTestId('tutorial-completed-indicator')).toBeVisible();

    // Verify graceful written-guide state on an unrecorded curriculum item + Light Mode contrast
    await page.goto('/learning-center/fortix-architecture-overview');
    await expect(page.getByTestId('video-unavailable-panel')).toBeVisible();
    await page.getByRole('button', { name: 'Toggle Theme' }).click();
    await page.waitForTimeout(300);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '04-written-guide-light-mode.png'),
      fullPage: false,
    });

    // Switch back to Dark Mode & capture Mobile viewport screenshot
    await page.getByRole('button', { name: 'Toggle Theme' }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/learning-center');
    await expect(page.getByRole('heading', { name: 'Learn FortiX' })).toBeVisible();
    await expect(page.getByTestId('summary-completion-pct')).not.toHaveText('0%');
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '05-learning-center-mobile.png'),
      fullPage: false,
    });

    await context.close();
  });
});
