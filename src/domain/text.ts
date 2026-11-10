/** Lower-case, without Polish diacritics, so "lodz" finds "Łódź". */
export function normalizeText(text: string): string {
	return text
		.toLowerCase()
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/ł/g, "l");
}

/** True when every word of the query appears somewhere in the haystack. */
export function matchesQuery(haystack: string, query: string): boolean {
	const words = normalizeText(query).split(/\s+/).filter(Boolean);
	if (words.length === 0) return true;
	const text = normalizeText(haystack);
	return words.every((word) => text.includes(word));
}

/**
 * A count with the right Polish form: 1 blok, 2 bloki, 5 bloków, 22 bloki.
 */
export function plural(
	count: number,
	one: string,
	few: string,
	many: string,
): string {
	const n = Math.abs(count);
	const lastTwo = n % 100;
	const last = n % 10;
	const form =
		n === 1
			? one
			: last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)
				? few
				: many;
	return `${count} ${form}`;
}

/** A file or path segment the storage accepts: lower-case ASCII, no spaces. */
export function slugify(text: string): string {
	return normalizeText(text)
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
}
