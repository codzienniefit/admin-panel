import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { auth } from "@/auth";
import { currentEnvironment, ENVIRONMENTS } from "@/data/environment";
import { Button } from "@/ui/Button";
import { Notice } from "@/ui/Notice";
import { Tag } from "@/ui/Tag";

/** Sign-in. `redirect` is where the person was heading when they were stopped. */
export function LoginPage({ redirect }: { redirect: string }) {
	const router = useRouter();
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const environment = ENVIRONMENTS.find(
		(e) => e.value === currentEnvironment(),
	);

	const signIn = async (methodId: string) => {
		setBusy(methodId);
		setError(null);
		try {
			await auth.signIn(methodId);
			// The guard decides what happens next: the page that was asked for,
			// or "Brak dostępu".
			router.history.push(redirect);
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : "Nie udało się zalogować",
			);
			setBusy(null);
		}
	};

	return (
		<div className="flex min-h-full items-center justify-center p-4">
			<div className="w-full max-w-md rounded-dialog border border-line bg-surface p-6 shadow-card md:p-8">
				<div className="flex items-center justify-between gap-3">
					<h1 className="text-2xl font-semibold tracking-tight">
						Codziennie Fit
					</h1>
					{environment && (
						<Tag tone={environment.tone}>{environment.label}</Tag>
					)}
				</div>
				<p className="mt-1 text-sm text-muted">Panel administracyjny</p>

				{error && (
					<div className="mt-5">
						<Notice tone="red" role="alert" title="Nie udało się zalogować">
							{error}
						</Notice>
					</div>
				)}

				<div className="mt-6 flex flex-col gap-3">
					{auth.methods.map((method, index) => (
						<div key={method.id}>
							<Button
								variant={index === 0 ? "primary" : "secondary"}
								size="md"
								className="w-full"
								disabled={busy !== null}
								onClick={() => void signIn(method.id)}
							>
								{busy === method.id ? "Logowanie…" : method.label}
							</Button>
							<p className="mt-1 px-1 text-xs text-muted">
								{method.description}
							</p>
						</div>
					))}
				</div>

				{redirect !== "/" && (
					<p className="mt-6 border-line border-t pt-4 text-xs text-muted">
						Po zalogowaniu wrócisz do:{" "}
						<span className="font-mono">{redirect}</span>
					</p>
				)}
			</div>
		</div>
	);
}
