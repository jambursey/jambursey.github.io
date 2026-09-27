const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const PAGES = ['/', '/projects', '/pilot', '/nook', '/xesto-fit', '/about', '/art'];
const THIRD_PARTY = /youtube|googlevideo|ytimg|ggpht|doubleclick|google\.com|gstatic\.com\/(?!s\/)|elfsight|typeform/;

test.describe('every page', () => {
  for (const p of PAGES) {
    test(`${p} loads with no errors, no Webflow requests, no horizontal overflow`, async ({ page }) => {
      const errors = [];
      const failed = [];
      const external = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('response', r => { if (r.status() >= 400 && !THIRD_PARTY.test(r.url())) failed.push(`${r.status()} ${r.url()}`); });
      page.on('request', r => {
        const u = new URL(r.url());
        if (/website-files\.com|webflow\.(com|io)|cloudfront\.net|ajax\.googleapis|cdnjs|jsdelivr/.test(u.host)) external.push(r.url());
      });
      const res = await page.goto(p);
      expect(res.status()).toBe(200);
      await page.waitForLoadState('load');
      expect(errors).toEqual([]);
      expect(failed).toEqual([]);
      expect(external).toEqual([]);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }

  test('unknown paths return the 404 page', async ({ page }) => {
    const res = await page.goto('/definitely-not-a-page');
    expect(res.status()).toBe(404);
    await expect(page.locator('h2')).toHaveText('Page Not Found');
  });
});

test('every local asset referenced by HTML and CSS exists', () => {
  const files = fs.readdirSync(root).filter(f => f.endsWith('.html')).map(f => path.join(root, f));
  files.push(path.join(root, 'css', 'site.css'));
  const missing = [];
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    for (const m of text.matchAll(/\/(assets|css|js)\/[^"'\s)&]+/g)) {
      const rel = decodeURIComponent(m[0]);
      if (!fs.existsSync(path.join(root, rel))) missing.push(`${path.basename(f)} -> ${rel}`);
    }
  }
  expect(missing).toEqual([]);
});

test('resume links all point at the current resume', async ({ page }) => {
  for (const p of ['/', '/about']) {
    await page.goto(p);
    const hrefs = await page.locator('a[href*="Resume"]').evaluateAll(as => as.map(a => a.getAttribute('href')));
    expect(hrefs.length).toBeGreaterThan(0);
    for (const h of hrefs) expect(h).toContain('Resume-2025-2.pdf');
  }
});

test.describe('anchor links', () => {
  const targetTop = page => page.evaluate(() => document.getElementById('Quick-Start-Trip-Builder').getBoundingClientRect().top);

  test('deep link /pilot#Quick-Start-Trip-Builder lands on the section', async ({ page }) => {
    await page.goto('/pilot#Quick-Start-Trip-Builder');
    await page.waitForLoadState('load');
    await page.waitForTimeout(2000);
    expect(Math.abs(await targetTop(page))).toBeLessThan(5);
  });

  test('home page "Quick Start" link opens Pilot at the section', async ({ page }) => {
    await page.goto('/');
    const link = page.locator('a[href="/pilot#Quick-Start-Trip-Builder"]');
    await expect(link).toHaveCount(1);
    await link.scrollIntoViewIfNeeded();
    await link.click();
    await page.waitForURL('**/pilot#Quick-Start-Trip-Builder');
    await page.waitForLoadState('load');
    await page.waitForTimeout(2000);
    expect(Math.abs(await targetTop(page))).toBeLessThan(5);
  });

  test('in-page case-study link smooth-scrolls to its section', async ({ page }) => {
    await page.goto('/pilot');
    await page.waitForLoadState('load');
    const link = page.locator('a[href="#Transitioning-Pilot-to-Mobile"]');
    await link.scrollIntoViewIfNeeded();
    await link.click();
    await expect(page).toHaveURL(/#Transitioning-Pilot-to-Mobile$/);
    await expect.poll(() => page.evaluate(() => Math.abs(document.getElementById('Transitioning-Pilot-to-Mobile').getBoundingClientRect().top)), { timeout: 5000 }).toBeLessThan(5);
  });

  test('"Back to Top" returns to the top of the page', async ({ page }) => {
    await page.goto('/pilot');
    await page.waitForLoadState('load');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const back = page.locator('.div-block-219 a[href="#top"]');
    await expect(back).toBeVisible();
    await expect(back).toHaveCSS('opacity', '1', { timeout: 3000 });
    await back.click();
    await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 5000 }).toBeLessThan(50);
  });
});

test.describe('scroll animations', () => {
  test('sections start hidden and fade in once scrolled into view', async ({ page }) => {
    await page.goto('/pilot');
    const section = page.locator('section[data-w-id="60e29a26-d0a8-663b-80f6-2bb23731044c"]');
    await expect(section).toHaveCSS('opacity', '0');
    await section.scrollIntoViewIfNeeded();
    await expect(section).toHaveCSS('opacity', '1', { timeout: 3000 });
  });

  test('count-up stats finish at their real values', async ({ page }) => {
    await page.goto('/pilot');
    const counters = page.locator('.counter');
    await counters.first().scrollIntoViewIfNeeded();
    await expect(counters).toHaveText(['4', '78', '48'], { timeout: 4000 });
  });

  test('lottie animations render as SVG', async ({ page }) => {
    await page.goto('/nook');
    const lottie = page.locator('[data-animation-type="lottie"]').first();
    await lottie.scrollIntoViewIfNeeded();
    await expect(lottie.locator('svg')).toHaveCount(1, { timeout: 5000 });
  });
});

test.describe('mobile navigation', () => {
  test.skip(({ isMobile }) => !isMobile, 'hamburger menu only exists at mobile widths');

  test('hamburger opens and closes the menu', async ({ page }) => {
    await page.goto('/');
    const button = page.locator('.w-nav-button');
    const menu = page.locator('.w-nav-menu');
    await expect(menu).toBeHidden();
    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(menu.getByRole('link', { name: 'Projects' })).toBeVisible();
    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(menu).toBeHidden();
  });

  test('menu links navigate', async ({ page }) => {
    await page.goto('/');
    await page.locator('.w-nav-button').click();
    await page.locator('.w-nav-menu').getByRole('link', { name: 'About' }).click();
    await expect(page).toHaveURL(/\/about$/);
  });
});

test('desktop nav shows all links without a hamburger', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop only');
  await page.goto('/');
  await expect(page.locator('.w-nav-button')).toBeHidden();
  for (const name of ['Home', 'Projects', 'About', 'Art']) {
    await expect(page.locator('.w-nav-menu').getByRole('link', { name, exact: true })).toBeVisible();
  }
});

test('xesto slider arrows move between slides', async ({ page }) => {
  await page.goto('/xesto-fit');
  const slider = page.locator('.slider-25');
  await slider.scrollIntoViewIfNeeded();
  const slides = slider.locator('.w-slide');
  await expect(slides.nth(1)).toHaveAttribute('aria-hidden', 'true');
  await slider.locator('.w-slider-arrow-right').click();
  await expect(slides.nth(1)).not.toHaveAttribute('aria-hidden', 'true');
  await page.waitForTimeout(600);
  const box = await slides.nth(1).boundingBox();
  const mask = await slider.locator('.w-slider-mask').boundingBox();
  expect(Math.abs(box.x - mask.x)).toBeLessThan(2);
});

test('background video play/pause toggle works', async ({ page }) => {
  await page.goto('/nook');
  const video = page.locator('video').first();
  await video.scrollIntoViewIfNeeded();
  await expect.poll(() => video.evaluate(v => !v.paused), { timeout: 8000 }).toBe(true);
  await page.locator('.w-background-video--control').first().click();
  await expect.poll(() => video.evaluate(v => v.paused)).toBe(true);
});
