import { expect, type Page, test } from '@playwright/test';

/*
 * Two different lists, two different locators. `quickAdd` runs on a list detail page and
 * `search` on the results page — a single unscoped helper covered both only because
 * neither page had a second list on it. See .orchestration/lessons/L-029.md.
 */
const rows = (page: Page) => page.getByRole('list', { name: 'Results' }).getByRole('listitem');
const todoItems = (page: Page) => page.getByRole('list', { name: 'Todos' }).getByRole('listitem');

const unique = () => `search-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

async function signUpWithList(page: Page, listName: string) {
  await page.goto('/sign-up');
  await page.getByLabel('Name').fill('Search Tester');
  await page.getByLabel('Email').fill(unique());
  await page.getByLabel('Password').fill('correct-horse-battery-staple');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await openList(page, listName, true);
}

async function openList(page: Page, listName: string, create = false) {
  await page.goto('/lists');
  if (create) {
    await page.getByLabel('New list name').fill(listName);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
  }
  await page.getByRole('link', { name: listName }).click();
  await expect(page.getByRole('heading', { name: listName })).toBeVisible();
}

async function quickAdd(page: Page, title: string) {
  await page.getByLabel('New todo').fill(title);
  await page.getByLabel('New todo').press('Enter');
  await expect(todoItems(page).filter({ hasText: title })).toBeVisible();
}

async function search(page: Page, query: string) {
  await page.goto('/search');
  await page.getByLabel('Search todos').fill(query);
  await page.getByRole('button', { name: 'Search' }).click();
}

test('search finds todos across lists and says where each lives', async ({ page }) => {
  await signUpWithList(page, 'Work');
  await quickAdd(page, 'Buy milk');

  await openList(page, 'Home', true);
  await quickAdd(page, 'Milk the cow');

  await search(page, 'milk');

  await expect(rows(page)).toHaveCount(2);
  await expect(page.getByRole('link', { name: 'Work' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Home' })).toBeVisible();
  await expect(page.getByText('2 results')).toBeVisible();
});

/*
 * Rewritten at T-19, when the engine changed from `ILIKE` to full text.
 *
 * The old assertion — `50%` returns exactly one row — encoded the *implementation*: with
 * `LIKE`, an unescaped `%` is a wildcard, and the test proved the escaping worked. Full
 * text has no wildcards to escape; the parser tokenises `50%` to `50`, so a todo containing
 * "50" is a legitimate hit rather than an escaping failure.
 *
 * The property worth keeping is the one the old test was named for: **typing punctuation
 * does not turn the query into a match-everything pattern.** That is asserted directly
 * below, together with the exactness a user actually reaches for — a quoted phrase.
 * See .orchestration/lessons/L-026.md on asserting the property, not the representation.
 */
test('punctuation in a query is not a wildcard', async ({ page }) => {
  await signUpWithList(page, 'Work');
  await quickAdd(page, '50% done');
  await quickAdd(page, '50 things');
  await quickAdd(page, 'Nothing numeric here');

  await search(page, '50%');

  // Not a match-everything pattern: the unrelated todo is absent.
  await expect(rows(page).filter({ hasText: 'Nothing numeric here' })).toHaveCount(0);
  await expect(rows(page).filter({ hasText: '50% done' })).toHaveCount(1);

  // And a quoted phrase is how a user asks for exactness.
  await search(page, '"50% done"');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('50% done');
});

test('a typed underscore is literal, not a single-character wildcard', async ({ page }) => {
  await signUpWithList(page, 'Work');
  await quickAdd(page, 'snake_case');
  await quickAdd(page, 'snakeXcase');

  await search(page, 'snake_case');

  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('snake_case');
});

test('an empty search shows everything rather than nothing', async ({ page }) => {
  await signUpWithList(page, 'Work');
  await quickAdd(page, 'One');
  await quickAdd(page, 'Two');

  await page.goto('/search');
  await expect(rows(page)).toHaveCount(2);

  // And clearing a query returns to everything, rather than emptying the screen.
  await search(page, 'One');
  await expect(rows(page)).toHaveCount(1);
  await search(page, '');
  await expect(rows(page)).toHaveCount(2);
});

test('no match says so, quoting what was searched', async ({ page }) => {
  await signUpWithList(page, 'Work');
  await quickAdd(page, 'Buy milk');

  await search(page, 'zzzznothing');
  await expect(page.getByText(/Nothing matches/)).toBeVisible();
  await expect(page.getByText(/zzzznothing/)).toBeVisible();
});

test('the query lives in the URL, so results survive a reload', async ({ page }) => {
  await signUpWithList(page, 'Work');
  await quickAdd(page, 'Buy milk');

  await search(page, 'milk');
  expect(page.url()).toContain('q=milk');

  await page.reload();
  await expect(rows(page)).toHaveCount(1);
  await expect(page.getByLabel('Search todos')).toHaveValue('milk');
});

test('one user never finds another user’s todos', async ({ page }) => {
  await signUpWithList(page, 'Work');
  await quickAdd(page, 'Secret milk');
  await page.goto('/lists');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in/);

  await signUpWithList(page, 'Mine');
  await search(page, 'milk');
  await expect(page.getByText(/Nothing matches/)).toBeVisible();
});

/** Lists are searchable too, ranked alongside the todos inside them. */
test('a list is found by its name', async ({ page }) => {
  await signUpWithList(page, 'Kitchen renovation');
  await quickAdd(page, 'Order tiles');

  await search(page, 'renovation');
  await expect(rows(page).filter({ hasText: 'Kitchen renovation' })).toHaveCount(1);
});

/*
 * Stemming is the difference between a search box and a `LIKE` query, and it is the thing
 * users assume already works: "run" should find "Running".
 */
test('a search matches other forms of the same word', async ({ page }) => {
  await signUpWithList(page, 'Work');
  await quickAdd(page, 'Running the dishwasher');

  await search(page, 'run');
  await expect(rows(page).filter({ hasText: 'Running the dishwasher' })).toHaveCount(1);
});

/*
 * The index is a generated column, so there is no indexing step that can lag: a todo is
 * searchable in the same transaction that created it. This is the acceptance criterion
 * "indexing keeps up with writes", asserted with no wait and no retry loop.
 */
test('a todo is searchable immediately after it is created', async ({ page }) => {
  await signUpWithList(page, 'Work');
  await quickAdd(page, 'Immediately findable widget');

  await search(page, 'widget');
  await expect(rows(page)).toHaveCount(1);
});
