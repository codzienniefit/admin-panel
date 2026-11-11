import type { Locator, Page } from "@playwright/test";
import { expect, open, test } from "./support/test";

const SECTIONS = [
	{ link: "Wyzwania", heading: "Wyzwania", path: "/challenges" },
	{ link: "Treningi", heading: "Treningi", path: "/workouts" },
	{ link: "Media", heading: "Media", path: "/media" },
	{ link: "Wiadomości", heading: "Wiadomości", path: "/messages" },
	{ link: "Odznaki", heading: "Odznaki", path: "/badges" },
	{ link: "Użytkownicy", heading: "Użytkownicy", path: "/users" },
	{ link: "Ustawienia", heading: "Ustawienia", path: "/settings" },
];

test("every section opens from the main menu", async ({ page }) => {
	await open(page, "/");
	const menu = page.getByRole("navigation", { name: "Główne" });
	for (const section of SECTIONS) {
		await menu.getByRole("link", { name: section.link, exact: true }).click();
		await expect(page).toHaveURL(new RegExp(section.path));
		await expect(
			page.getByRole("heading", { level: 1, name: section.heading }),
		).toBeVisible();
	}
});

test("an address that does not exist says so instead of breaking", async ({
	page,
}) => {
	await open(page, "/challenges/NIE-MA-TAKIEGO");
	await expect(page.getByText("Nie ma takiego wyzwania")).toBeVisible();
});

test.describe("on a phone", () => {
	test.use({ viewport: { width: 375, height: 812 } });

	// Each screen with something that is there only once its data has loaded:
	// the width is measured with real content, not with a placeholder.
	const SCREENS: Array<{ path: string; loaded: (page: Page) => Locator }> = [
		{
			path: "/challenges",
			loaded: (page) => page.getByRole("link", { name: /Wiosenny start/ }),
		},
		{
			path: "/workouts",
			loaded: (page) => page.getByText("146 treningów"),
		},
		{
			path: "/challenges/C1",
			loaded: (page) => page.getByRole("heading", { name: "Warianty (2)" }),
		},
		{
			path: "/challenges/C1/plan/p-easy",
			loaded: (page) =>
				page.getByRole("group", { name: "Dzień 1", exact: true }),
		},
		{
			path: "/challenges/calendar?y=2026&m=11",
			loaded: (page) => page.getByRole("heading", { name: /Bez daty/ }),
		},
		{
			path: "/messages",
			loaded: (page) => page.getByText("16 wiadomości"),
		},
		{
			path: "/badges",
			loaded: (page) => page.getByText("23 odznaki"),
		},
		{
			path: "/settings/plan-types",
			loaded: (page) => page.getByRole("heading", { name: "Zbalansowany" }),
		},
	];

	for (const { path, loaded } of SCREENS) {
		test(`${path} fits the screen without sideways scrolling`, async ({
			page,
		}) => {
			await open(page, path);
			await expect(loaded(page)).toBeVisible();
			const overflow = await page.evaluate(
				() =>
					document.documentElement.scrollWidth -
					document.documentElement.clientWidth,
			);
			expect(overflow).toBeLessThanOrEqual(0);
		});
	}
});
