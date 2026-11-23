import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { auth } from "@/auth";
import type { SignInMethod } from "@/auth/types";
import { errorMessage } from "@/data/api/errors";
import { Button } from "@/ui/Button";
import { EnvironmentSelect } from "@/ui/EnvironmentSelect";
import { Logo } from "@/ui/Logo";
import { Notice } from "@/ui/Notice";
import { SIGNED_OUT_TITLE, usePageTitle } from "@/ui/pageTitle";
import { attempt } from "@/ui/tasks";

/** Why a sign-in at Google came back without a session. */
const RETURN_PROBLEMS: Record<string, string> = {
	forbidden: "To konto nie ma dostępu.",
	cancelled: "Logowanie zostało przerwane.",
	disabled: "To konto jest zablokowane.",
	tooManyAttempts: "Za dużo prób. Spróbuj ponownie za kilka minut.",
	unavailable: "Logowanie jest chwilowo niedostępne. Spróbuj za chwilę.",
	misconfigured:
		"Logowanie nie jest poprawnie skonfigurowane. Daj znać administratorowi.",
};
const FALLBACK = "Nie udało się zalogować";

export const returnProblem = (code: string | undefined): string | null =>
	code ? (RETURN_PROBLEMS[code] ?? `${FALLBACK}.`) : null;

interface LoginPageProps {
	/** Where the person was heading when they were stopped. */
	redirect: string;
	/** Set when a sign-in at Google came back refused. */
	problem?: string;
}

/** Sign-in: the first thing anyone sees. */
export function LoginPage({ redirect, problem }: LoginPageProps) {
	usePageTitle(SIGNED_OUT_TITLE);
	const router = useRouter();
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(returnProblem(problem));
	const notice = auth.notice?.() ?? null;
	// Shown only next to the refusal it belongs to.
	const refusedUid =
		problem === "forbidden" ? (auth.refusedUid?.() ?? null) : null;

	const signIn = async (method: SignInMethod) => {
		setBusy(method.id);
		setError(null);
		const signedIn = await attempt(() => auth.signIn(method.id, { redirect }));
		if (!signedIn.ok) {
			setError(errorMessage(signedIn.error, FALLBACK));
			setBusy(null);
			return;
		}
		// The guard decides what happens next: the page that was asked for,
		// or "Brak dostępu".
		router.history.push(redirect);
	};

	return (
		<div className="flex min-h-full items-center justify-center p-4">
			<div className="w-full max-w-md rounded-dialog border border-line bg-surface p-6 shadow-card md:p-8">
				<div className="flex items-center justify-between gap-3">
					<h1>
						<Logo className="h-6" />
					</h1>
					<EnvironmentSelect />
				</div>

				{error && (
					<div className="mt-5">
						<Notice tone="red" role="alert" title="Nie udało się zalogować">
							{error}
							{refusedUid && (
								<span className="mt-2 block">
									Żeby dostać dostęp, przekaż ten identyfikator osobie, która go
									nadaje:{" "}
									<span className="select-all break-all font-mono">
										{refusedUid}
									</span>
								</span>
							)}
						</Notice>
					</div>
				)}
				{notice && (
					<div className="mt-5">
						<Notice tone="amber" title="Logowanie niedostępne">
							{notice}
						</Notice>
					</div>
				)}

				{auth.methods.length > 0 && (
					<div className="mt-6 flex flex-col gap-3">
						{auth.methods.map((method, index) => (
							<div key={method.id}>
								<Button
									variant={index === 0 ? "primary" : "secondary"}
									size="md"
									className="w-full"
									disabled={busy !== null}
									onClick={() => void signIn(method)}
								>
									{busy === method.id ? "Logowanie…" : method.label}
								</Button>
								<p className="mt-1 px-1 text-xs text-muted">
									{method.description}
								</p>
							</div>
						))}
					</div>
				)}

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
