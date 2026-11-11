import { useLiveQuery } from "@tanstack/react-db";
import { useState } from "react";
import { type ApiIssue, isApiError } from "@/data/api/errors";
import { badgesCollection } from "@/data/collections/badges";
import { grantUserBadge, revokeUserBadge } from "@/data/collections/users";
import { formatDate } from "@/domain/dates";
import { plural } from "@/domain/text";
import {
	grantableBadges,
	grantIssues,
	groupUserBadges,
	type HeldBadge,
	isRevocable,
	revokeIssues,
} from "@/domain/userRules";
import { BadgeImage } from "@/features/badges/BadgeImage";
import { SPECIAL_CATEGORY_LABELS } from "@/features/badges/badgeMeta";
import { useConfig } from "@/features/config/useConfig";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { confirm } from "@/ui/confirm";
import { EmptyState } from "@/ui/EmptyState";
import { Field } from "@/ui/Field";
import { generalIssue, IssuesNotice } from "@/ui/formIssues";
import { Loading, useDelayedLoading } from "@/ui/Loading";
import { Notice } from "@/ui/Notice";
import { Select } from "@/ui/Select";
import { attempt, whileBusy } from "@/ui/tasks";
import { toast } from "@/ui/toast";
import { useUserBadges } from "./useUsers";

interface UserBadgesTabProps {
	uid: string;
	/** How the person is named in questions: their name or address. */
	person: string;
}

/** A failure of an action, as problems to show. */
function problemsOf(error: unknown): ApiIssue[] {
	if (isApiError(error) && error.kind === "validation") {
		return [...error.issues];
	}
	if (isApiError(error) && error.kind === "notFound") {
		return [
			generalIssue(
				"Tej odznaki albo tego konta już nie ma. Odśwież stronę, żeby zobaczyć aktualny stan.",
			),
		];
	}
	return [generalIssue("Nie udało się. Spróbuj ponownie za chwilę.")];
}

export function UserBadgesTab({ uid, person }: UserBadgesTabProps) {
	const { badgeSections } = useConfig().internal;
	const held = useUserBadges(uid);
	const { data: definitions, isLoading: loadingDefinitions } = useLiveQuery({
		query: (q) => q.from({ badge: badgesCollection }),
	});
	const loading = held.isLoading || loadingDefinitions;
	const showLoading = useDelayedLoading(loading);

	const [chosen, setChosen] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [problems, setProblems] = useState<{
		title: string;
		issues: readonly ApiIssue[];
	} | null>(null);

	if (loading) {
		return showLoading ? (
			<div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
				{[1, 2, 3, 4, 5, 6].map((n) => (
					<Loading key={n} />
				))}
			</div>
		) : null;
	}
	if (!held.data) {
		return (
			<Notice
				tone="red"
				role="alert"
				title="Nie udało się wczytać odznak"
				actions={
					<Button onClick={() => void held.refetch()}>Spróbuj ponownie</Button>
				}
			>
				Sprawdź połączenie i spróbuj jeszcze raz.
			</Notice>
		);
	}

	const badges = definitions ?? [];
	const owned = held.data;
	const sections = groupUserBadges(owned, badges, badgeSections);
	const grantable = grantableBadges(badges, owned);

	const grant = async () => {
		setProblems(null);
		const badge = badges.find((item) => item.id === chosen);
		const issues = grantIssues(
			badge,
			owned.some((item) => item.badgeId === chosen),
		);
		if (!badge || issues.length > 0) {
			setProblems({
				title: "Nie można przyznać odznaki",
				issues: chosen ? issues : [generalIssue("Wybierz odznakę z listy.")],
			});
			return;
		}
		const sure = await confirm({
			title: "Przyznać odznakę?",
			description: `Odznaka „${badge.name}” pojawi się w aplikacji u: ${person}.`,
			confirmLabel: "Przyznaj",
		});
		if (!sure) return;
		const granted = await whileBusy(setBusy, () =>
			attempt(() => grantUserBadge(uid, badge.id)),
		);
		if (!granted.ok) {
			setProblems({
				title: "Nie można przyznać odznaki",
				issues: problemsOf(granted.error),
			});
			return;
		}
		setChosen(null);
		toast({ title: "Odznaka przyznana", tone: "green" });
	};

	const revoke = async ({ held: item, badge }: HeldBadge) => {
		setProblems(null);
		const issues = revokeIssues(item);
		if (issues.length > 0) {
			setProblems({ title: "Nie można odebrać odznaki", issues });
			return;
		}
		const sure = await confirm({
			title: "Odebrać odznakę?",
			description: `Odznaka „${badge?.name ?? "bez nazwy"}” zniknie z aplikacji u: ${person}. Można ją potem przyznać ponownie.`,
			confirmLabel: "Odbierz",
			destructive: true,
		});
		if (!sure) return;
		const revoked = await whileBusy(setBusy, () =>
			attempt(() => revokeUserBadge(uid, item)),
		);
		if (!revoked.ok) {
			setProblems({
				title: "Nie można odebrać odznaki",
				issues: problemsOf(revoked.error),
			});
			return;
		}
		toast({ title: "Odznaka odebrana", tone: "green" });
	};

	return (
		<div className="flex flex-col gap-4">
			{problems && (
				<IssuesNotice title={problems.title} issues={problems.issues} />
			)}

			<Card className="flex flex-col gap-3">
				<div>
					<h2 className="text-lg font-semibold">Przyznaj odznakę</h2>
					<p className="text-sm text-muted">
						Ręcznie można dać tylko odznakę typu „Ręczne”. Pozostałe zdobywa się
						w aplikacji, za treningi i wyzwania.
					</p>
				</div>
				{grantable.length === 0 ? (
					<p className="text-sm text-subtle">
						{badges.some((badge) => badge.type === "manual")
							? "Ta osoba ma już wszystkie odznaki, które można przyznać ręcznie."
							: "Nie ma jeszcze żadnej odznaki ręcznej. Dodaj ją w sekcji Odznaki."}
					</p>
				) : (
					<div className="flex flex-col gap-2 sm:flex-row sm:items-end">
						<div className="min-w-0 flex-1 sm:max-w-md">
							<Field label="Odznaka">
								{() => (
									<Select
										label="Odznaka do przyznania"
										placeholder="Wybierz odznakę"
										options={grantable.map((badge) => ({
											value: badge.id,
											label: badge.name,
											hint: badge.isHidden ? "ukryta" : undefined,
										}))}
										value={chosen}
										onChange={setChosen}
										disabled={busy}
										className="w-full"
									/>
								)}
							</Field>
						</div>
						<Button
							variant="primary"
							size="md"
							className="h-10"
							disabled={busy || !chosen}
							onClick={() => void grant()}
						>
							Przyznaj…
						</Button>
					</div>
				)}
			</Card>

			{sections.length === 0 ? (
				<EmptyState title="Ta osoba nie ma jeszcze odznak">
					Odznaki pojawią się tu, gdy zdobędzie je w aplikacji albo gdy
					przyznasz jej odznakę ręczną powyżej.
				</EmptyState>
			) : (
				<>
					<p className="text-xs text-muted">
						{plural(owned.length, "odznaka", "odznaki", "odznak")}
					</p>
					{sections.map((section) => (
						<section key={section.id} aria-label={section.label}>
							<h2 className="mb-2 text-lg font-semibold">{section.label}</h2>
							<div className="flex flex-col gap-3">
								{section.subsections.map((subsection) => (
									<div key={subsection.id}>
										{subsection.label && (
											<h3 className="mb-2 text-sm font-semibold text-subtle">
												{subsection.label}
											</h3>
										)}
										<ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
											{subsection.badges.map((item) => (
												<li
													key={`${item.held.badgeId}-${item.held.grantId ?? "earned"}`}
												>
													<HeldBadgeTile
														item={item}
														disabled={busy}
														onRevoke={() => void revoke(item)}
													/>
												</li>
											))}
										</ul>
									</div>
								))}
							</div>
						</section>
					))}
				</>
			)}
		</div>
	);
}

interface HeldBadgeTileProps {
	item: HeldBadge;
	disabled: boolean;
	onRevoke: () => void;
}

function HeldBadgeTile({ item, disabled, onRevoke }: HeldBadgeTileProps) {
	const { badge, held } = item;
	const how = badge?.specialCategory
		? SPECIAL_CATEGORY_LABELS[badge.specialCategory]
		: undefined;
	return (
		<div
			// The note about the badge, for whoever wonders what it is for.
			title={badge?.comment ?? how}
			className="flex h-full flex-col items-center gap-1.5 rounded-cell border border-line bg-surface p-3 text-center"
		>
			<BadgeImage
				path={badge?.imageRelativePath ?? null}
				size="md"
				dimmed={Boolean(badge?.isHidden)}
			/>
			<span className="text-sm font-semibold [overflow-wrap:anywhere]">
				{badge?.name ?? "Usunięta odznaka"}
			</span>
			<span className="text-xs text-muted">
				{formatDate(held.earnedAtUtc)}
				{badge?.isHidden && " · ukryta"}
			</span>
			{isRevocable(held) && (
				<Button
					variant="ghost"
					className="mt-auto"
					disabled={disabled}
					onClick={onRevoke}
				>
					Odbierz
				</Button>
			)}
		</div>
	);
}
