import type { Page } from "@playwright/test";
import {
	confirm,
	dialog,
	dragTo,
	expect,
	open,
	pick,
	test,
} from "./support/test";

const day = (page: Page, number: number) =>
	page.getByRole("group", { name: `Dzień ${number}`, exact: true });

/** Adds a workout from the catalogue to a day. */
async function addWorkout(page: Page, dayNumber: number, title: string) {
	await day(page, dayNumber)
		.getByRole("button", { name: "+ Dodaj trening" })
		.click();
	const catalogue = dialog(page, "Dodaj trening");
	await catalogue
		.getByRole("textbox", { name: "Szukaj w katalogu" })
		.fill(title);
	await catalogue
		.getByRole("button", { name: new RegExp(title) })
		.first()
		.click();
	await catalogue.getByRole("button", { name: "Gotowe" }).click();
}

test("a workout is added to a day, undone and redone", async ({ page }) => {
	// Day 3 of this draft is a rest day.
	await open(page, "/challenges/C1/plan/p-easy");
	await expect(day(page, 3).getByText("wolne")).toBeVisible();

	await addWorkout(page, 3, "Joga na dobry sen");
	await expect(day(page, 3).getByText("Joga na dobry sen")).toBeVisible();
	await expect(day(page, 3).getByText("30 min").first()).toBeVisible();

	await page.getByRole("button", { name: "Cofnij" }).click();
	await expect(day(page, 3).getByText("Joga na dobry sen")).toHaveCount(0);

	await page.getByRole("button", { name: "Ponów" }).click();
	await expect(day(page, 3).getByText("Joga na dobry sen")).toBeVisible();
});

test("a draft's plan saves by itself and survives a reload", async ({
	page,
}) => {
	await open(page, "/challenges/C1/plan/p-easy");
	await addWorkout(page, 3, "Joga na dobry sen");
	await expect(
		page.getByRole("status").filter({ hasText: "Zapisano" }),
	).toBeVisible();

	await page.reload();
	await expect(day(page, 3).getByText("Joga na dobry sen")).toBeVisible();
});

test("a workout is moved to another day from its menu", async ({ page }) => {
	await open(page, "/challenges/C1/plan/p-easy");
	await pick(day(page, 1), "Akcje: Poranna mobilność bioder", "Przenieś do…");
	const move = dialog(page, "Przenieś trening");
	await move.getByRole("combobox", { name: "Do dnia" }).click();
	await page.getByRole("option", { name: /Dzień 3/ }).click();
	await move.getByRole("button", { name: "Przenieś" }).click();

	await expect(
		day(page, 3).getByText("Poranna mobilność bioder"),
	).toBeVisible();
	await expect(day(page, 1).getByText("Poranna mobilność bioder")).toHaveCount(
		0,
	);
});

test.describe("dragging", () => {
	// Tall enough that the page never scrolls under the pointer mid-drag.
	test.use({ viewport: { width: 1280, height: 1500 } });

	test("a workout is dragged from one day to another", async ({ page }) => {
		await open(page, "/challenges/C1/plan/p-easy");
		await dragTo(
			page,
			day(page, 1).getByText("Poranna mobilność bioder"),
			day(page, 3),
		);

		await expect(
			day(page, 3).getByText("Poranna mobilność bioder"),
		).toBeVisible();
		await expect(
			day(page, 1).getByText("Poranna mobilność bioder"),
		).toHaveCount(0);
	});
});

test("a day gets a note that is kept", async ({ page }) => {
	await open(page, "/challenges/C1/plan/p-easy");
	await pick(day(page, 2), "Akcje dnia 2", "Notatka i kolor dnia…");
	const details = page.getByRole("dialog");
	await details
		.getByRole("textbox", { name: "Notatka" })
		.fill("Nagrać ponownie wstęp");
	await details.getByRole("button", { name: "Zapisz" }).click();

	await expect(day(page, 2).getByText("Nagrać ponownie wstęp")).toBeVisible();
	await expect(
		page.getByRole("status").filter({ hasText: "Zapisano" }),
	).toBeVisible();
	await page.reload();
	await expect(day(page, 2).getByText("Nagrać ponownie wstęp")).toBeVisible();
});

test.describe("a published challenge", () => {
	// What app users see changes only on a deliberate, confirmed save.
	const PLAN = "/challenges/C2/plan/p-main";

	test("changes wait for a confirmed save", async ({ page }) => {
		await open(page, PLAN);
		await pick(day(page, 1), /^Akcje: /, "Usuń z dnia");
		await expect(
			page.getByRole("button", { name: "Zapisz zmiany" }),
		).toBeEnabled();

		// Not saved yet: a fresh load still has the workout.
		const before = await page.context().newPage();
		await before.goto(PLAN);
		await expect(
			before
				.getByRole("group", { name: "Dzień 1", exact: true })
				.getByRole("button", { name: /^Akcje: / }),
		).toHaveCount(1);
		await before.close();

		await page.getByRole("button", { name: "Zapisz zmiany" }).click();
		await confirm(page, "Zapisać zmiany w planie?", "Zapisz zmiany");
		await expect(
			page.getByRole("button", { name: "Zapisz zmiany" }),
		).toHaveCount(0);

		await page.reload();
		await expect(
			day(page, 1).getByRole("button", { name: /^Akcje: / }),
		).toHaveCount(0);
	});

	test("discarding puts the plan back", async ({ page }) => {
		await open(page, PLAN);
		const cards = day(page, 1).getByRole("button", { name: /^Akcje: / });
		await expect(cards).toHaveCount(1);
		await pick(day(page, 1), /^Akcje: /, "Usuń z dnia");
		await expect(cards).toHaveCount(0);

		await page.getByRole("button", { name: "Odrzuć zmiany" }).click();
		await confirm(page, "Odrzucić zmiany w planie?", "Odrzuć zmiany");
		await expect(cards).toHaveCount(1);
	});
});
