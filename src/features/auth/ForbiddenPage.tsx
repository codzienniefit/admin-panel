import { auth, signOutAndLeave } from "@/auth";
import { useStore } from "@/lib/store";
import { Button } from "@/ui/Button";

/** Signed in, but the account has no admin access. */
export function ForbiddenPage() {
	const session = useStore(auth.session);
	const user = session.status === "forbidden" ? session.user : null;

	return (
		<div className="flex min-h-full items-center justify-center p-4">
			<div
				data-tone="amber"
				className="w-full max-w-md rounded-dialog border border-(--tone) bg-(--tone-soft) p-6 md:p-8"
			>
				<h1 className="text-2xl font-semibold tracking-tight text-(--tone-ink)">
					Brak dostępu
				</h1>
				<p className="mt-2 text-sm text-subtle">
					{user
						? `Konto ${user.displayName}${user.email ? ` (${user.email})` : ""} nie ma uprawnień administratora.`
						: "To konto nie ma uprawnień administratora."}{" "}
					Jeśli powinno je mieć, poproś o nadanie dostępu, a potem zaloguj się
					ponownie.
				</p>
				<Button
					variant="primary"
					size="md"
					className="mt-5"
					onClick={() => void signOutAndLeave()}
				>
					Wyloguj i zmień konto
				</Button>
			</div>
		</div>
	);
}
