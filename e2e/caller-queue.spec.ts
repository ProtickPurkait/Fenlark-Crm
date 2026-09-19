import { test, expect, type Page } from "@playwright/test";

/** Signs in through the real login form rather than forging a session cookie:
 *  @supabase/ssr owns that cookie's name and shape, and a hand-written one
 *  would drift the moment the library changed. The stub accepts any
 *  credentials and hands back a session. */
async function signIn(page: Page) {
  await page.goto("/login");
  await page.locator("#email").fill("caller@fenlark.test");
  await page.locator("#password").fill("whatever");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/caller", { timeout: 30_000 });
}

test.describe("telecaller queue", () => {
  test("renders leads instead of an empty queue", async ({ page }) => {
    await signIn(page);

    // The regression. /caller once rendered "Showing 0 of 1006 leads" above an
    // empty state because the page size reached the server as a proxy and the
    // range went out as 0-NaN. Assert on a lead actually being on screen, not
    // just on the request succeeding — the request "succeeded" then too.
    await expect(page.getByText("Lead 1", { exact: true })).toBeVisible();
    await expect(page.getByText("Your queue is clear")).toHaveCount(0);
  });

  test("shows a bounded first page, not the whole book", async ({ page }) => {
    await signIn(page);

    // 100 of 1,006: the queue must neither ship every lead (1.3 MB on a phone)
    // nor silently truncate to nothing.
    await expect(page.getByText(/Showing 100 of 1,006 leads/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Load more" })).toBeVisible();
  });

  test("Load more appends the next page", async ({ page }) => {
    await signIn(page);
    await page.getByRole("button", { name: "Load more" }).click();
    await expect(page.getByText(/Showing 200 of 1,006 leads/)).toBeVisible();
  });

  test("a status filter narrows the queue through the URL", async ({ page }) => {
    await signIn(page);
    await page.getByRole("button", { name: "Warm", exact: true }).click();

    await expect(page).toHaveURL(/status=warm/);
    // Filtering has to happen in the query: a browser-side filter over the
    // loaded page would search 100 of 1,006 leads and call that an answer.
    await expect(page.getByText(/Showing \d+ of 201 leads/)).toBeVisible();
  });

  test("an empty filter result never claims the queue is clear", async ({ page }) => {
    await signIn(page);
    await page.getByRole("button", { name: "Converted", exact: true }).click();

    // No converted leads in the fixtures, so this is the empty path. It must
    // say the filter found nothing — "your queue is clear" reads as "you are
    // done for the day", which is when a telecaller stops working.
    await expect(page.getByText("No leads match this filter")).toBeVisible();
    await expect(page.getByText("Your queue is clear")).toHaveCount(0);
  });
});
