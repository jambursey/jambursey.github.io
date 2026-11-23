const { test, expect } = require('@playwright/test');

const UNLOCK_HASH = 'd9fb92e3bbe65be1f1aad4a82eef4567f7a1ebe2cd110c8049b9698be7a70c88';

test.beforeEach(async ({ context }) => {
  await context.addInitScript(h => localStorage.setItem('jb-unlocked', h), UNLOCK_HASH);
});

// The statement image used to render twice (CSS background + <img>) below 1280px.
for (const width of [375, 479, 480, 767, 768, 991, 992, 1100, 1279, 1280, 1439, 1440, 1920]) {
  test(`art statement image renders once at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/art');
    const box = page.locator('.div-block-266');
    await box.scrollIntoViewIfNeeded();
    const info = await box.evaluate(el => {
      const img = el.querySelector('img');
      const r = img.getBoundingClientRect();
      return {
        bg: getComputedStyle(el).backgroundImage,
        boxHeight: el.getBoundingClientRect().height,
        imgHeight: r.height,
      };
    });
    expect(info.bg).toBe('none');
    // The container must wrap the image, not clip or pad around it.
    expect(Math.abs(info.boxHeight - info.imgHeight)).toBeLessThan(2);
  });
}
