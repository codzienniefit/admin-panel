import {
	test as base,
	expect,
	type Locator,
	type Page,
} from "@playwright/test";

// The rules every UI test runs under. Specs import `test` and `expect` from
// here, never from "@playwright/test".
//
//   1. Test environment only. playwright.config.ts starts every browser with
//      the Test environment selected; here every request that would leave
//      this machine is refused, and fails the test.
//   2. A fixed "today", so screens that depend on the date (the calendar,
//      "premiere in N days") give the same result on any day.
//   3. No errors in the browser console: a broken screen fails the test even
//      when the thing being clicked still works.

/** The day every test runs on: two days after the sample data's "now". */
export const TODAY = new Date("2026-11-12T10:00:00+01:00");

const isLocal = (url: URL) =>
	url.protocol === "data:" ||
	url.protocol === "blob:" ||
	url.hostname === "localhost" ||
	url.hostname === "127.0.0.1";

export const test = base.extend<{ rules: undefined }>({
	rules: [
		async ({ context, page }, use) => {
			const outside: string[] = [];
			await context.route(
				(url) => !isLocal(url),
				(route) => {
					outside.push(route.request().url());
					return route.abort();
				},
			);

			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			page.on("console", (message) => {
				if (message.type() === "error") errors.push(message.text());
			});

			await page.clock.setFixedTime(TODAY);

			await use(undefined);

			expect(outside, "requests that tried to leave this machine").toEqual([]);
			expect(errors, "errors in the browser console").toEqual([]);
		},
		{ auto: true },
	],
});

export { expect };

/** Opens a screen and waits until the panel's frame is there. */
export async function open(page: Page, path: string): Promise<void> {
	await page.goto(path);
	// Not by role: behind an open dialog the frame is hidden from roles.
	await expect(page.locator("main")).toBeVisible();
}

/** The small message that confirms an action, e.g. "Zapisano". */
export const toast = (page: Page, text: string | RegExp): Locator =>
	page.getByRole("status").filter({ hasText: text });

/** An open dialog, by its title. */
export const dialog = (page: Page, title: string | RegExp): Locator =>
	page.getByRole("dialog", { name: title });

/** Answers the panel's "are you sure?" question with its confirm button. */
export async function confirm(
	page: Page,
	title: string | RegExp,
	button: string,
): Promise<void> {
	const question = dialog(page, title);
	await question.getByRole("button", { name: button, exact: true }).click();
	await expect(question).toBeHidden();
}

/** Picks an option in one of the panel's dropdowns. */
export async function choose(
	scope: Page | Locator,
	label: string,
	option: string | RegExp,
): Promise<void> {
	await scope.getByRole("combobox", { name: label, exact: true }).click();
	const page = "page" in scope ? scope.page() : scope;
	await page.getByRole("option", { name: option }).first().click();
}

/** One action from a "⋯" or "Więcej" menu. */
export async function pick(
	scope: Page | Locator,
	menu: string | RegExp,
	action: string | RegExp,
): Promise<void> {
	await scope.getByRole("button", { name: menu, exact: true }).click();
	const page = "page" in scope ? scope.page() : scope;
	await page.getByRole("menuitem", { name: action }).click();
}

/**
 * Drags one thing onto another with the mouse: pressed, moved in steps and
 * released, as a hand does it. The panel starts a drag only after the mouse
 * has moved a little, so a plain click stays a click.
 */
export async function dragTo(
	page: Page,
	source: Locator,
	target: Locator,
): Promise<void> {
	const centre = async (locator: Locator) => {
		const box = await locator.boundingBox();
		if (!box)
			throw new Error("Nothing to drag from or to: it is not on screen");
		return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	};
	const from = await centre(source);
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(from.x + 12, from.y + 12, { steps: 4 });
	// Aimed once the drag has begun: picking something up can shift the page.
	const to = await centre(target);
	await page.mouse.move(to.x, to.y, { steps: 12 });
	await page.mouse.up();
}
