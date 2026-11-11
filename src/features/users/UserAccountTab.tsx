import { useState } from "react";
import { useForm } from "react-hook-form";
import { type ApiIssue, isApiError } from "@/data/api/errors";
import { changeUserEmail } from "@/data/collections/users";
import type { UserAccount } from "@/data/schemas/user";
import { formatDateTime } from "@/domain/dates";
import { emailIssues, normalizeEmail } from "@/domain/userRules";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { confirm } from "@/ui/confirm";
import { Facts } from "@/ui/Facts";
import { TextField } from "@/ui/Field";
import { generalIssue, IssuesNotice, placeIssues } from "@/ui/formIssues";
import { attempt, whileBusy } from "@/ui/tasks";
import { toast } from "@/ui/toast";
import { AccountTags } from "./AccountTags";
import { providerLabel } from "./userMeta";

interface EmailForm {
	email: string;
}

const FIELDS = ["email"] as const;

/** The account itself, and the one thing about it the panel may change. */
export function UserAccountTab({ account }: { account: UserAccount }) {
	const form = useForm<EmailForm>({ defaultValues: { email: "" } });
	const [busy, setBusy] = useState(false);
	const [problems, setProblems] = useState<readonly ApiIssue[]>([]);

	const show = (issues: readonly ApiIssue[]) =>
		setProblems(placeIssues(form, FIELDS, issues));

	const changeEmail = async () => {
		if (busy) return;
		form.clearErrors();
		setProblems([]);
		const next = normalizeEmail(form.getValues("email"));

		// The same rules the server applies, checked before anything is asked.
		const issues = emailIssues(next, account.email);
		if (issues.length > 0) {
			show(issues);
			return;
		}
		const sure = await confirm({
			title: "Zmienić adres e-mail?",
			description: account.email
				? `Adres konta zmieni się z ${account.email} na ${next}. Sprawdź oba, zanim potwierdzisz.`
				: `Konto nie ma dotąd adresu. Nowy adres to ${next}.`,
			confirmLabel: "Zmień adres",
		});
		if (!sure) return;

		const changed = await whileBusy(setBusy, () =>
			attempt(() => changeUserEmail(account.uid, next)),
		);
		if (changed.ok) {
			form.reset({ email: "" });
			toast({ title: "Adres e-mail zmieniony", tone: "green" });
			return;
		}
		const { error } = changed;
		show(
			isApiError(error) && error.kind === "validation"
				? error.issues
				: [
						generalIssue(
							"Nie udało się zmienić adresu. Adres konta jest taki jak przedtem; spróbuj ponownie za chwilę.",
						),
					],
		);
	};

	return (
		<div className="flex flex-col gap-4">
			<Card>
				<h2 className="mb-3 text-lg font-semibold">Konto</h2>
				<Facts
					items={[
						{ label: "Nazwa", value: account.displayName ?? "nie podano" },
						{ label: "Adres e-mail", value: account.email ?? "brak" },
						{
							label: "Stan",
							value: <AccountTags user={account} fallback="Aktywne" />,
						},
						{
							label: "Logowanie",
							value: account.providers.map(providerLabel).join(", ") || "—",
						},
						{
							label: "Konto założone",
							value: formatDateTime(account.createdAtUtc),
						},
						{
							label: "Ostatnie logowanie",
							value: formatDateTime(account.lastSignInAtUtc),
						},
						{
							label: "Identyfikator",
							value: <span className="font-mono text-xs">{account.uid}</span>,
						},
					]}
				/>
			</Card>

			<Card>
				<h2 className="text-lg font-semibold">Zmiana adresu e-mail</h2>
				<p className="mt-1 mb-3 text-sm text-muted">
					Na prośbę osoby, która straciła dostęp do starej skrzynki albo
					pomyliła się przy rejestracji. Przed zapisaniem zobaczysz stary i nowy
					adres do potwierdzenia.
				</p>
				<form
					// Our own messages, next to the field, instead of the browser's.
					noValidate
					onSubmit={(event) => {
						event.preventDefault();
						void changeEmail();
					}}
					className="flex flex-col gap-3"
				>
					<IssuesNotice title="Nie można zmienić adresu" issues={problems} />
					<div className="flex flex-col gap-2 sm:flex-row sm:items-start">
						<div className="min-w-0 flex-1 sm:max-w-md">
							<TextField
								label="Nowy adres e-mail"
								type="email"
								inputMode="email"
								autoComplete="off"
								spellCheck={false}
								placeholder="nowy.adres@example.com"
								error={form.formState.errors.email?.message}
								disabled={busy}
								{...form.register("email")}
							/>
						</div>
						{/* Lines the button up with the field, below its label. */}
						<div className="sm:pt-[1.625rem]">
							<Button
								type="submit"
								variant="primary"
								size="md"
								className="h-10 w-full sm:w-auto"
								disabled={busy}
							>
								{busy ? "Zapisywanie…" : "Zmień adres…"}
							</Button>
						</div>
					</div>
				</form>
			</Card>
		</div>
	);
}
