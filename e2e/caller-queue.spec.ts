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

  test("the disposition drawer surfaces website-audit findings, the Maps link and the alternate number", async ({
    page,
  }) => {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await signIn(page);

    // Lead 1 is the one fixture carrying the website-audit fields (migration
    // 2700) and a second phone number — see stub-supabase.mjs.
    await page.getByText("Lead 1", { exact: true }).click();

    await expect(page.getByText("http://example-cafe.test/")).toBeVisible();
    await expect(page.getByText("Website returns error HTTP 404")).toBeVisible();
    await expect(page.getByText("Page returns 404")).toBeVisible();

    // The alternate number is offered, not silently dropped — see
    // splitPhoneNumbers() in csv.ts, which is what produces it on import.
    await expect(page.getByText("9800000001")).toBeVisible();

    // The Maps link opens a real new tab/popup, not a same-tab navigation —
    // losing the queue behind it would be worse than not having the link.
    const [popup] = await Promise.all([
      page.waitForEvent("popup"),
      page.getByRole("button", { name: "Google Maps" }).click(),
    ]);
    await expect(popup).toHaveURL(/^https:\/\/www\.google\.com\/maps\/search\//);
    await popup.close();

    // Copy actually reaches the clipboard, not just flips the button's icon.
    await page.getByRole("button", { name: "Copy number" }).click();
    await expect(page.getByText("Copied")).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe("9810000000");
  });

  test("a lead outside the website-audit pass shows no website block at all", async ({ page }) => {
    await signIn(page);

    // Lead 2 has none of the new fields set (null, not "checked and
    // empty") — the drawer must not claim "no website found" for a lead
    // that was never part of that research pass.
    await page.getByText("Lead 2", { exact: true }).click();
    await expect(page.getByText("No website found")).toHaveCount(0);
    await expect(page.getByText("Also try")).toHaveCount(0);
  });
});
