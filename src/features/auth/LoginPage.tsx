import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { auth } from "@/auth";
import type { SignInMethod } from "@/auth/types";
import { errorMessage } from "@/data/api/errors";
import { onThisComputer } from "@/data/environment";
import { Button } from "@/ui/Button";
import { EnvironmentSelect } from "@/ui/EnvironmentSelect";
import { Logo } from "@/ui/Logo";
import { Notice } from "@/ui/Notice";
import { SIGNED_OUT_TITLE, usePageTitle } from "@/ui/pageTitle";
import { attempt } from "@/ui/tasks";
import {
	REFUSED_UID_HINT,
	returnProblem,
	SIGN_IN_FAILED,
} from "./returnProblems";

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
			setError(errorMessage(signedIn.error, SIGN_IN_FAILED));
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
					{/* on the deployed panel, the environments show only after sign-in */}
					{onThisComputer() && <EnvironmentSelect />}
				</div>

				{error && (
					<div className="mt-5">
						<Notice tone="red" role="alert" title={SIGN_IN_FAILED}>
							{error}
							{refusedUid && (
								<span className="mt-2 block">
									{REFUSED_UID_HINT}{" "}
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
								{method.description && (
									<p className="mt-1 px-1 text-xs text-muted">
										{method.description}
									</p>
								)}
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
