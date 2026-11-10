import { createStore, useStore } from "@/lib/store";
import { Button } from "./Button";
import { Dialog } from "./Dialog";

// The panel's replacement for window.confirm: `await confirm({...})` from
// anywhere, including outside React. <ConfirmHost /> is mounted once, in the
// root route.

export interface ConfirmOptions {
	title: string;
	description?: string;
	confirmLabel?: string;
	cancelLabel?: string;
	/** Red confirm button, for actions that discard or delete. */
	destructive?: boolean;
}

interface Pending extends ConfirmOptions {
	resolve: (confirmed: boolean) => void;
}

const pending = createStore<Pending | null>(null);

export function confirm(options: ConfirmOptions): Promise<boolean> {
	// Only one question at a time; a newer one answers the older with "no".
	pending.get()?.resolve(false);
	return new Promise((resolve) => pending.set({ ...options, resolve }));
}

function answer(confirmed: boolean) {
	const current = pending.get();
	if (!current) return;
	pending.set(null);
	current.resolve(confirmed);
}

export function ConfirmHost() {
	const current = useStore(pending);
	return (
		<Dialog
			open={current !== null}
			onOpenChange={(open) => {
				if (!open) answer(false);
			}}
			title={current?.title ?? ""}
			description={current?.description}
			size="sm"
			footer={
				<>
					<Button size="md" onClick={() => answer(false)}>
						{current?.cancelLabel ?? "Anuluj"}
					</Button>
					<Button
						size="md"
						variant={current?.destructive ? "danger" : "primary"}
						onClick={() => answer(true)}
					>
						{current?.confirmLabel ?? "Potwierdź"}
					</Button>
				</>
			}
		/>
	);
}
