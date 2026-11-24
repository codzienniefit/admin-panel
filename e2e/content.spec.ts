import type { Locator, Page } from "@playwright/test";
import { confirm, dialog, expect, open, test, toast } from "./support/test";

// The content editor ("Opis" of a workout or challenge, "Treść" of a
// message). It sits inside the form, not in a window of its own: blocks
// first, pasted text behind one button, and a preview that can also show the
// JSON that will be saved.
//
// A text block is a rich-text field: bold looks bold and a link looks like a
// link, with no tags on screen. What is saved is still one string with <b>
// and <a href>, and the JSON view is where these tests read it.

const WORKOUT = "Poranna mobilność bioder";

/** The first sample workout's editor and the "Opis" field inside it. */
async function openWorkout(
	page: Page,
): Promise<{ editor: Locator; description: Locator }> {
	await open(page, "/workouts/W1");
	const editor = dialog(page, WORKOUT);
	return {
		editor,
		description: editor.getByRole("group", { name: "Opis", exact: true }),
	};
}

async function save(page: Page, editor: Locator): Promise<void> {
	await editor.getByRole("button", { name: "Zapisz zmiany" }).click();
	await expect(toast(page, "Trening zapisany")).toBeVisible();
}

/** A new, empty text block under the sample workout's two: block 3. */
async function addTextBlock(description: Locator): Promise<Locator> {
	await description.getByRole("textbox", { name: "Tekst, blok 2" }).click();
	await description.getByRole("button", { name: "+ Tekst" }).click();
	const added = description.getByRole("textbox", { name: "Tekst, blok 3" });
	await expect(added).toBeFocused();
	return added;
}

/**
 * The pane switch of a narrow editor. A workout's window is wide enough for
 * blocks and preview side by side, and then there is no switch to press.
 */
async function showPane(description: Locator, name: RegExp): Promise<void> {
	const tab = description
		.getByRole("group", { name: "Część edytora" })
		.getByRole("button", { name });
	if (await tab.isVisible()) await tab.click();
}

/** The left side's switch between the blocks and their JSON. */
const contentView = (description: Locator) =>
	description.getByRole("group", { name: "Widok treści" });

/** The content as it will be saved, editable, where the blocks are. */
async function showJson(description: Locator): Promise<Locator> {
	await showPane(description, /^Bloki/);
	await contentView(description)
		.getByRole("button", { name: "JSON", exact: true })
		.click();
	return description.getByRole("textbox", { name: "Treść jako JSON" });
}

async function showBlocks(description: Locator): Promise<void> {
	await showPane(description, /^Bloki/);
	await contentView(description)
		.getByRole("button", { name: "Bloki", exact: true })
		.click();
}

/** Extends the selection back from the caret, as Shift + arrow does. */
async function selectBack(page: Page, characters: number): Promise<void> {
	for (let i = 0; i < characters; i += 1) {
		await page.keyboard.press("Shift+ArrowLeft");
	}
}

/** The small panel that opens next to a link in a text block. */
const linkPanel = (page: Page) => page.getByRole("dialog", { name: "Link" });

/**
 * The same panel once it has finished appearing. It fades in, and a click
 * sent at something that is still moving makes Playwright scroll the page
 * under the window to steady it: the panel then follows its link, and the
 * click lands beside the button (seen once in a hundred runs).
 */
async function shownLinkPanel(page: Page): Promise<Locator> {
	const panel = linkPanel(page);
	await expect(panel).toHaveCSS("opacity", "1");
	return panel;
}

test("content is edited in the form, block by block, and saved with it", async ({
	page,
}) => {
	const { editor, description } = await openWorkout(page);

	// The blocks are there at once: no button to press, no second window,
	// and the paste box is folded away.
	await expect(
		description.getByRole("textbox", { name: "Tytuł, blok 1" }),
	).toHaveValue("Co Cię czeka");
	await expect(page.getByRole("dialog")).toHaveCount(1);
	await expect(
		description.getByRole("textbox", { name: "Tekst źródłowy" }),
	).toHaveCount(0);

	// Text that is already there shows its formatting, not its tags.
	const existing = description.getByRole("textbox", { name: "Tekst, blok 2" });
	await expect(existing).toHaveText(
		"Poranna mobilność bioder. Przygotuj matę i butelkę wody.",
	);
	await expect(existing.getByRole("strong")).toHaveText("matę");

	// A new block goes under the one being worked on, empty and ready.
	const added = await addTextBlock(description);
	const placeholder = description.getByText("Wpisz tekst", { exact: true });
	await expect(placeholder).toBeVisible();
	await added.fill("Na koniec napij się wody.");
	await expect(placeholder).toBeHidden();

	// beside the blocks, or the other pane of a narrow editor
	await showPane(description, /^Podgląd/);
	const preview = description.getByRole("region", {
		name: "Podgląd",
		exact: true,
	});
	await expect(preview.getByText("Na koniec napij się wody.")).toBeVisible();

	// The same content as it will be saved, where the blocks are.
	const json = await showJson(description);
	await expect(json).toHaveValue(/"type": "Text"/);
	await expect(json).toHaveValue(/"content": "Na koniec napij się wody\."/);
	await showBlocks(description);
	await expect(json).toHaveCount(0);
	await expect(
		description.getByRole("textbox", { name: "Tekst, blok 3" }),
	).toHaveText("Na koniec napij się wody.");

	await save(page, editor);

	const reopened = await openWorkout(page);
	await expect(
		reopened.description.getByRole("textbox", { name: "Tekst, blok 3" }),
	).toHaveText("Na koniec napij się wody.");
});

test("JSON typed where the blocks are reaches the preview, and a mistake is shown under it", async ({
	page,
}) => {
	const { description } = await openWorkout(page);
	const preview = description.getByRole("region", {
		name: "Podgląd",
		exact: true,
	});
	const json = await showJson(description);

	await json.fill(
		JSON.stringify([
			{ type: "Title", content: "Z JSON-a", metadata: null },
			{ type: "Text", content: "Prosto do podglądu.", metadata: null },
		]),
	);
	await expect(preview.getByText("Z JSON-a", { exact: true })).toBeVisible();
	await expect(json).not.toHaveAttribute("aria-invalid", "true");

	// broken JSON: said right under it, the preview keeps the last good one
	await json.fill('[{ "type": "Title", ');
	await expect(json).toHaveAttribute("aria-invalid", "true");
	await expect(description.getByRole("alert")).toContainText(
		"To nie jest poprawny JSON",
	);
	await expect(preview.getByText("Z JSON-a", { exact: true })).toBeVisible();

	// valid JSON with a block the rules refuse: listed under it, border red
	await json.fill(
		JSON.stringify([{ type: "Title", content: "", metadata: null }]),
	);
	await expect(json).toHaveAttribute("aria-invalid", "true");
	await expect(description.getByText(/Błędy: 1/)).toBeVisible();

	// back to the blocks: what the JSON said is what they are
	await showBlocks(description);
	await expect(
		description.getByRole("textbox", { name: "Tytuł, blok 1" }),
	).toHaveValue("");
});

test("JSON with an incomplete block keeps the JSON on screen and marks the block", async ({
	page,
}) => {
	const { description } = await openWorkout(page);
	const preview = description.getByRole("region", {
		name: "Podgląd",
		exact: true,
	});
	const json = await showJson(description);
	await json.fill(
		JSON.stringify([
			{ type: "Title" },
			{ type: "Text", content: "Ten jest dobry.", metadata: null },
		]),
	);

	await expect(description.getByRole("alert")).toContainText(
		"Blok 1: brakuje pola „content”",
	);
	await expect(preview.getByText("Błąd w JSON-ie:")).toBeVisible();
	await expect(preview.getByText("Ten jest dobry.")).toBeVisible();
	// the blocks would be out of date: they cannot be opened until it is fixed
	const toBlocks = contentView(description).getByRole("button", {
		name: "Bloki",
		exact: true,
	});
	await expect(toBlocks).toHaveAttribute("aria-disabled", "true");
	await expect(toBlocks).toHaveAttribute("title", /Najpierw popraw JSON/);
	await toBlocks.dispatchEvent("click");
	await expect(json).toBeVisible();

	await json.fill(
		JSON.stringify([{ type: "Title", content: "Naprawione", metadata: null }]),
	);
	await expect(toBlocks).not.toHaveAttribute("aria-disabled", "true");
	await showBlocks(description);
	await expect(
		description.getByRole("textbox", { name: "Tytuł, blok 1" }),
	).toHaveValue("Naprawione");
});

test("the block being edited is marked in the preview", async ({ page }) => {
	const { description } = await openWorkout(page);
	const preview = description.getByRole("region", {
		name: "Podgląd",
		exact: true,
	});
	await description.getByRole("textbox", { name: "Tekst, blok 2" }).click();
	const marked = preview.locator('[data-block-index="1"]');
	await expect(marked).toHaveClass(/bg-\[#eceefa\]/);
	await expect(preview.locator('[data-block-index="0"]')).not.toHaveClass(
		/bg-\[#eceefa\]/,
	);

	// a block's number in the preview leads back to it in the editor
	await preview
		.getByRole("button", { name: "Pokaż blok 1 w edytorze" })
		.click();
	await expect(
		description.getByRole("textbox", { name: "Tytuł, blok 1" }),
	).toBeFocused();
	await expect(preview.locator('[data-block-index="0"]')).toHaveClass(
		/bg-\[#eceefa\]/,
	);
});

test("ready text is pasted from a panel that stays out of the way", async ({
	page,
}) => {
	const { editor, description } = await openWorkout(page);
	const source = description.getByRole("textbox", { name: "Tekst źródłowy" });

	await description
		.getByRole("button", { name: "Wklej gotowy tekst…" })
		.click();
	await expect(source).toBeFocused();

	// Tags in ready text are kept, and the block shows what they mean.
	await source.fill(
		"Rozgrzewka\n\nZacznij od <b>pięciu minut</b> marszu w miejscu. Potem krążenia ramion.",
	);
	await description.getByRole("button", { name: "Utwórz bloki" }).click();
	await confirm(page, "Zastąpić obecne bloki?", "Zastąp");

	// The blocks are made and the panel folds itself away again.
	await expect(toast(page, "Utworzono: 2 bloki")).toBeVisible();
	await expect(source).toHaveCount(0);
	await expect(
		description.getByRole("textbox", { name: "Tytuł, blok 1" }),
	).toHaveValue("Rozgrzewka");
	const pasted = description.getByRole("textbox", { name: "Tekst, blok 2" });
	await expect(pasted).toHaveText(
		"Zacznij od pięciu minut marszu w miejscu. Potem krążenia ramion.",
	);
	await expect(pasted.getByRole("strong")).toHaveText("pięciu minut");
	await expect(await showJson(description)).toHaveValue(
		/"content": "Zacznij od <b>pięciu minut<\/b> marszu w miejscu\. Potem krążenia ramion\."/,
	);

	await save(page, editor);

	const reopened = await openWorkout(page);
	await expect(
		reopened.description.getByRole("textbox", { name: "Tytuł, blok 1" }),
	).toHaveValue("Rozgrzewka");
	await expect(
		reopened.description.getByRole("textbox", { name: "Tekst, blok 3" }),
	).toHaveCount(0);
});

test("empty content opens on the paste box, previewed while it is typed", async ({
	page,
}) => {
	await open(page, "/workouts/new");
	const editor = dialog(page, "Nowy trening");
	const description = editor.getByRole("group", { name: "Opis", exact: true });
	const source = description.getByRole("textbox", { name: "Tekst źródłowy" });
	const preview = description.getByRole("region", { name: "Podgląd" });

	// no button to find first: there is nothing else to start from
	await expect(source).toBeVisible();
	await expect(
		description.getByRole("button", { name: "Wklej gotowy tekst…" }),
	).toHaveAttribute("aria-expanded", "true");

	// A short line over a sentence is a heading and its text.
	await source.fill(
		"Dla kogo\nSilne nogi 14 dni: plan krok po kroku, z dniami odpoczynku.",
	);
	await expect(preview.getByText("Wklejany tekst")).toBeVisible();
	await expect(preview.getByText("Dla kogo", { exact: true })).toBeVisible();
	await expect(description.getByText("1 tytuł", { exact: true })).toBeVisible();

	// corrected in the box, and the preview follows
	await source.fill(
		"Dla kogo\nSilne nogi 14 dni: plan krok po kroku, z dniami odpoczynku.\n\nSprzęt\nHantle i mata, nic więcej.",
	);
	await expect(preview.getByText("Sprzęt", { exact: true })).toBeVisible();

	// Nothing to replace yet, so no question: the blocks are made.
	await description.getByRole("button", { name: "Utwórz bloki" }).click();
	await expect(toast(page, "Utworzono: 4 bloki")).toBeVisible();
	await expect(
		description.getByRole("textbox", { name: "Tytuł, blok 1" }),
	).toHaveValue("Dla kogo");
	await expect(
		description.getByRole("textbox", { name: "Tekst, blok 2" }),
	).toHaveText("Silne nogi 14 dni: plan krok po kroku, z dniami odpoczynku.");
	await expect(preview.getByText("Wklejany tekst")).toHaveCount(0);
	await expect(source).toHaveCount(0);
});

test("the paste panel can be hidden again, and the blocks are untouched", async ({
	page,
}) => {
	const { description } = await openWorkout(page);
	const reveal = description.getByRole("button", {
		name: "Wklej gotowy tekst…",
	});
	const source = description.getByRole("textbox", { name: "Tekst źródłowy" });

	await reveal.click();
	await expect(source).toBeVisible();
	await description
		.getByRole("region", { name: "Wklej tekst" })
		.getByRole("button", { name: "Ukryj" })
		.click();

	await expect(source).toHaveCount(0);
	await expect(reveal).toBeFocused();
	await expect(
		description.getByRole("textbox", { name: "Tytuł, blok 1" }),
	).toHaveValue("Co Cię czeka");
});

test("a change in a block is an unsaved change of the form", async ({
	page,
}) => {
	const { editor, description } = await openWorkout(page);
	await description
		.getByRole("textbox", { name: "Tytuł, blok 1" })
		.fill("Zmieniony tytuł");

	// There is no "accept" step in the editor: the form already knows.
	await editor.getByRole("button", { name: "Anuluj" }).click();
	await confirm(page, "Zamknąć bez zapisywania?", "Zamknij bez zapisu");
	await expect(editor).toBeHidden();

	const reopened = await openWorkout(page);
	await expect(
		reopened.description.getByRole("textbox", { name: "Tytuł, blok 1" }),
	).toHaveValue("Co Cię czeka");
});

test("looking into a text block is not a change", async ({ page }) => {
	const { editor, description } = await openWorkout(page);
	await description.getByRole("textbox", { name: "Tekst, blok 2" }).click();
	await page.keyboard.press("ArrowRight");

	// Nothing was typed, so there is nothing to ask about.
	await editor.getByRole("button", { name: "Anuluj" }).click();
	await expect(editor).toBeHidden();
});

test("bold is switched on and off for the selected word, and is never doubled", async ({
	page,
}) => {
	const { description } = await openWorkout(page);
	const field = await addTextBlock(description);
	const bold = description.getByRole("button", {
		name: "Pogrubienie, blok 3",
	});

	await field.pressSequentially("Pij wodę");
	await selectBack(page, 4);
	await expect(bold).toHaveAttribute("aria-pressed", "false");
	await bold.click();

	// Bold on screen, and no tag to read.
	await expect(field.getByRole("strong")).toHaveText("wodę");
	await expect(field).toHaveText("Pij wodę");
	await expect(bold).toHaveAttribute("aria-pressed", "true");
	const json = await showJson(description);
	await expect(json).toHaveValue(/"content": "Pij <b>wodę<\/b>"/);

	// The same button takes it off again: the text is as it was.
	await showBlocks(description);
	await bold.click();
	await expect(field.getByRole("strong")).toHaveCount(0);
	await expect(bold).toHaveAttribute("aria-pressed", "false");
	await showJson(description);
	await expect(json).toHaveValue(/"content": "Pij wodę"/);

	// The keyboard does the same as the button.
	await showBlocks(description);
	await field.press("ControlOrMeta+b");
	await expect(field.getByRole("strong")).toHaveText("wodę");
	await expect(bold).toHaveAttribute("aria-pressed", "true");
	await field.press("ControlOrMeta+z");
	await expect(field.getByRole("strong")).toHaveCount(0);
	await expect(field).toHaveText("Pij wodę");
});

test("a selection becomes a link with a checked address", async ({ page }) => {
	const { editor, description } = await openWorkout(page);
	const field = await addTextBlock(description);
	await field.pressSequentially("Zobacz FAQ");
	await selectBack(page, 3);
	await description.getByRole("button", { name: "Link, blok 3" }).click();

	const panel = await shownLinkPanel(page);
	const address = panel.getByRole("textbox", { name: "Adres" });
	await expect(panel.getByRole("textbox", { name: "Tekst" })).toHaveValue(
		"FAQ",
	);
	await expect(address).toBeFocused();

	// An address the app must never open is refused, and says why.
	await address.fill("javascript:alert(1)");
	await expect(
		panel.getByRole("button", { name: "Otwórz w nowej karcie" }),
	).toBeDisabled();
	await panel.getByRole("button", { name: "Zapisz" }).click();
	await expect(panel.getByRole("alert")).toHaveText(
		"Adres linku „javascript:alert(1)” jest niedozwolony. Link musi zaczynać się od https://",
	);
	await expect(field.getByText("FAQ", { exact: true })).toHaveCount(0);

	await address.fill("https://example.com");
	await panel.getByRole("button", { name: "Zapisz" }).click();
	await expect(panel).toBeHidden();

	// A link on screen, no tag to read, and the tag in what is saved.
	await expect(field).toHaveText("Zobacz FAQ");
	await expect(field.getByText("FAQ", { exact: true })).toBeVisible();
	await expect(await showJson(description)).toHaveValue(
		/"content": "Zobacz <a href=\\"https:\/\/example\.com\\">FAQ<\/a>"/,
	);

	// Escape puts the panel away and nothing else: the workout's window stays,
	// without its "close without saving?" question, and typing goes on.
	await showBlocks(description);
	await field.getByText("FAQ", { exact: true }).click();
	await shownLinkPanel(page);
	await expect(panel.getByRole("textbox", { name: "Tekst" })).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(panel).toBeHidden();
	await expect(page.getByRole("dialog")).toHaveCount(1);
	await expect(editor).toBeVisible();
	await expect(field).toBeFocused();
});

test("a click on a link opens its panel: edit, try in a new tab, remove", async ({
	page,
	context,
	baseURL,
}) => {
	const { description } = await openWorkout(page);
	const field = await addTextBlock(description);
	const panel = linkPanel(page);
	const text = panel.getByRole("textbox", { name: "Tekst" });
	const address = panel.getByRole("textbox", { name: "Adres" });
	// On this machine: the tests refuse every request that would leave it.
	const target = `${baseURL}/workouts`;

	// With nothing selected the button inserts a new link.
	await field.pressSequentially("Zobacz ");
	await description.getByRole("button", { name: "Link, blok 3" }).click();
	await shownLinkPanel(page);
	await expect(text).toBeFocused();
	await text.fill("listę");
	await address.fill(target);
	await address.press("Enter");
	await expect(panel).toBeHidden();
	await expect(field).toHaveText("Zobacz listę");

	// A click in the text never follows the link: it opens the panel.
	await field.getByText("listę", { exact: true }).click();
	await shownLinkPanel(page);
	await expect(text).toHaveValue("listę");
	await expect(address).toHaveValue(target);
	await expect(page).toHaveURL(/\/workouts\/W1$/);

	const opening = context.waitForEvent("page");
	await panel.getByRole("button", { name: "Otwórz w nowej karcie" }).click();
	const opened = await opening;
	await expect(opened).toHaveURL(target);
	await opened.close();
	await expect(page).toHaveURL(/\/workouts\/W1$/);

	// New words for the same address.
	await text.fill("wszystkie treningi");
	await panel.getByRole("button", { name: "Zapisz" }).click();
	await expect(panel).toBeHidden();
	await expect(field).toHaveText("Zobacz wszystkie treningi");
	const json = await showJson(description);
	await expect(json).toHaveValue(/\/workouts\\">wszystkie treningi<\/a>"/);

	// Removing the link keeps the words.
	await showBlocks(description);
	await field.getByText("wszystkie treningi", { exact: true }).click();
	await shownLinkPanel(page);
	await panel.getByRole("button", { name: "Usuń link" }).click();
	await expect(panel).toBeHidden();
	await expect(field).toHaveText("Zobacz wszystkie treningi");
	await showJson(description);
	await expect(json).toHaveValue(/"content": "Zobacz wszystkie treningi"/);
});

test("Enter is a line break in the same block, and pasted text arrives plain", async ({
	page,
}) => {
	const { description } = await openWorkout(page);
	const field = await addTextBlock(description);

	await field.pressSequentially("Pierwsza");
	await field.press("Enter");
	await field.pressSequentially("druga. ");

	// What a copy from a web page or from Word carries: the same words twice,
	// once with their formatting. Only the plain ones are taken.
	await field.evaluate((element) => {
		const clipboard = new DataTransfer();
		clipboard.setData(
			"text/html",
			'<p style="color:red">Z <b>Worda</b> i <i>ze strony</i></p><h2>z <a href="https://example.com">linkiem</a></h2>',
		);
		clipboard.setData("text/plain", "Z Worda i ze strony\r\nz linkiem");
		element.dispatchEvent(
			new ClipboardEvent("paste", {
				clipboardData: clipboard,
				bubbles: true,
				cancelable: true,
			}),
		);
	});

	await expect(field).toContainText("druga. Z Worda i ze strony");
	await expect(field.getByRole("strong")).toHaveCount(0);
	// Still three blocks, and nothing in them to fix.
	await expect(
		description.getByText("Wszystkie bloki są poprawne (3)"),
	).toBeVisible();
	await expect(await showJson(description)).toHaveValue(
		/"content": "Pierwsza\\ndruga\. Z Worda i ze strony\\nz linkiem"/,
	);
});

test("formatted text is saved with the workout and comes back formatted", async ({
	page,
}) => {
	const { editor, description } = await openWorkout(page);
	const field = await addTextBlock(description);

	const bold = description.getByRole("button", {
		name: "Pogrubienie, blok 3",
	});

	// Bold switched on at the caret applies to what is typed next.
	await field.pressSequentially("Pij ");
	await bold.click();
	await field.pressSequentially("wodę");
	await bold.click();
	await field.press("Enter");
	await field.pressSequentially("Zobacz FAQ");
	await selectBack(page, 3);
	await description.getByRole("button", { name: "Link, blok 3" }).click();
	const panel = await shownLinkPanel(page);
	await panel
		.getByRole("textbox", { name: "Adres" })
		.fill("https://example.com");
	await panel.getByRole("button", { name: "Zapisz" }).click();
	await expect(panel).toBeHidden();

	// The preview draws the same text the way the app will.
	await showPane(description, /^Podgląd/);
	const preview = description.getByRole("region", {
		name: "Podgląd",
		exact: true,
	});
	await expect(preview.getByText("wodę", { exact: true })).toBeVisible();
	await expect(preview.getByTitle("https://example.com")).toHaveText("FAQ");

	await expect(await showJson(description)).toHaveValue(
		/"content": "Pij <b>wodę<\/b>\\nZobacz <a href=\\"https:\/\/example\.com\\">FAQ<\/a>"/,
	);
	await save(page, editor);

	const reopened = await openWorkout(page);
	const saved = reopened.description.getByRole("textbox", {
		name: "Tekst, blok 3",
	});
	await expect(saved).toHaveText("Pij wodęZobacz FAQ");
	await expect(saved.getByRole("strong")).toHaveText("wodę");
	await saved.getByText("FAQ", { exact: true }).click();
	await expect(
		(await shownLinkPanel(page)).getByRole("textbox", { name: "Adres" }),
	).toHaveValue("https://example.com");
});
