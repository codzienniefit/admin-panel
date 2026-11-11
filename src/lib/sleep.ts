/** Resolves after `ms` milliseconds. Injected where tests must not wait. */
export const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));
