import { expect, test, type Page } from '@playwright/test';

async function performFirstLegalHumanMove(page: Page): Promise<boolean> {
  const cells = page.locator('button[aria-label^="Board cell"]');
  const total = await cells.count();

  for (let index = 0; index < total; index += 1) {
    const cell = cells.nth(index);
    const title = await cell.getAttribute('title');

    if (!title || !title.startsWith('red ')) {
      continue;
    }

    if (title === 'red flag' || title === 'red bomb') {
      continue;
    }

    await cell.click();
    const legalTargets = page.locator('button.cell--legal');
    const legalCount = await legalTargets.count();

    if (legalCount === 0) {
      continue;
    }

    await legalTargets.first().click();
    return true;
  }

  return false;
}

test('startup smoke: app renders board and controls', async ({ page }) => {
  await page.goto('./');

  await expect(page.getByRole('heading', { name: 'Stratego' })).toBeVisible();
  await expect(page.locator('button[aria-label^="Board cell"]')).toHaveCount(100);
  await expect(page.getByRole('button', { name: 'New Game' })).toBeVisible();
  await expect(page.getByText('Moves: 0')).toBeVisible();
});

test('move flow smoke: human move increments move counter', async ({ page }) => {
  await page.goto('./?debug=1');

  await page.getByRole('button', { name: 'AI: ON' }).click();
  const moved = await performFirstLegalHumanMove(page);

  expect(moved).toBeTruthy();
  await expect(page.getByText('Moves: 1')).toBeVisible();
  await expect(page.getByText('Turn: BLUE')).toBeVisible();
});

test('ai turn smoke: AI responds after player move', async ({ page }) => {
  await page.goto('./?debug=1');

  const moved = await performFirstLegalHumanMove(page);
  expect(moved).toBeTruthy();

  await expect(page.getByText('Moves: 2')).toBeVisible({ timeout: 7_000 });
  await expect(page.getByText('Turn: RED')).toBeVisible({ timeout: 7_000 });
});

test('crash fallback smoke: forced render crash shows recovery UI', async ({ page }) => {
  await page.goto('./?debug=1&forceRenderCrash=1');

  await expect(page.getByRole('heading', { name: 'Stratego encountered an error' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reset Saved State' })).toBeVisible();
});
