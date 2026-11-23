const { test, expect } = require('@playwright/test');

const PAGES = ['/', '/projects', '/pilot', '/nook', '/xesto-fit', '/about', '/art', '/definitely-not-a-page'];

test.describe('password gate', () => {
  for (const p of PAGES) {
    test(`${p} shows the password prompt to new visitors`, async ({ page }) => {
      await page.goto(p);
      await expect(page.getByLabel('Password')).toBeVisible();
      await expect(page.locator('body > *:not(#jb-gate)').first()).toBeHidden();
    });
  }

  test('wrong password is rejected and the site stays locked', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Password').pressSequentially('nope');
    await page.getByRole('button', { name: 'enter' }).click();
    await expect(page.getByRole('alert')).toHaveText('Incorrect password.');
    await expect(page.locator('#jb-gate')).toBeVisible();
  });

  test('correct password unlocks every page and is remembered', async ({ page }) => {
    await page.goto('/pilot');
    await page.getByLabel('Password').pressSequentially('opensesame');
    await page.getByRole('button', { name: 'enter' }).click();
    await expect(page.locator('#jb-gate')).toHaveCount(0);
    await expect(page.locator('.w-nav-menu')).toBeAttached();
    await page.goto('/about');
    await expect(page.locator('#jb-gate')).toHaveCount(0);
  });

  test('typed characters display as asterisks and backspace works', async ({ page }) => {
    await page.goto('/');
    const field = page.getByLabel('Password');
    await field.pressSequentially('abcd');
    await expect(field).toHaveValue('****');
    await field.press('Backspace');
    await expect(field).toHaveValue('***');
    // A literal "*" typed by the user must still count as a real character.
    await field.pressSequentially('*');
    await expect(field).toHaveValue('****');
  });

  test('the plaintext password is not shipped in gate.js', async ({ request }) => {
    const res = await request.get('/js/gate.js');
    expect(await res.text()).not.toContain('opensesame');
  });
});
