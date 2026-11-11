/** A short random id with a prefix, for things the panel creates itself. */
export const newId = (prefix: string): string =>
	`${prefix}-${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
