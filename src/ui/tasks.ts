// Helpers for the async handlers of a screen ("save", "send", "delete").
//
// They exist to keep `try` out of components. The React Compiler leaves a
// component uncompiled when it contains try/finally, or a try/catch with a
// condition inside, and a form is exactly the kind of component that gains
// from being compiled. With these, a handler reads top to bottom:
//
//   const saved = await whileBusy(setBusy, () => attempt(() => save(values)));
//   if (!saved.ok) return showProblems(saved.error);

export type Attempt<T> = { ok: true; value: T } | { ok: false; error: unknown };

/** Runs a task and hands back its error instead of throwing it. */
export async function attempt<T>(task: () => Promise<T>): Promise<Attempt<T>> {
	try {
		return { ok: true, value: await task() };
	} catch (error) {
		return { ok: false, error };
	}
}

/** Runs a task with a "busy" flag raised for as long as it takes. */
export async function whileBusy<T>(
	setBusy: (busy: boolean) => void,
	task: () => Promise<T>,
): Promise<T> {
	setBusy(true);
	try {
		return await task();
	} finally {
		setBusy(false);
	}
}
