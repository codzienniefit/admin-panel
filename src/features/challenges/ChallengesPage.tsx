import { useLiveQuery } from "@tanstack/react-db";
import { useState } from "react";
import { challengesCollection } from "@/data/collections/challenges";
import type { Challenge, ContentStatus } from "@/data/schemas/challenge";
import {
	type ChallengeFilters,
	type ChallengeSort,
	filterChallenges,
} from "@/domain/challengeFilters";
import {
	type ChallengeKind,
	challengeKind,
	KIND_LABELS,
} from "@/domain/challengeRules";
import { formatDate } from "@/domain/dates";
import { plural } from "@/domain/text";
import { useConfig } from "@/features/config/useConfig";
import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";
import { STATUS_META } from "@/ui/enums";
import { Select, type SelectOption } from "@/ui/Select";
import { Skeleton, useDelayedLoading } from "@/ui/Skeleton";
import { StatusBadge } from "@/ui/StatusBadge";
import { type Column, Table } from "@/ui/Table";
import { Tag } from "@/ui/Tag";
import { ChallengeCard, KIND_TONES } from "./ChallengeCard";
import { PromotedChallenge } from "./PromotedChallenge";

const PAGE = 48;

const STATUS_OPTIONS: SelectOption<ContentStatus>[] = (
	["draft", "published", "hidden", "deleted"] as const
).map((status) => ({
	value: status,
	label: status === "deleted" ? "Kosz" : STATUS_META[status].label,
	tone: STATUS_META[status].tone,
}));

const KIND_OPTIONS: SelectOption<ChallengeKind>[] = (
	Object.keys(KIND_LABELS) as ChallengeKind[]
).map((kind) => ({
	value: kind,
	label: KIND_LABELS[kind],
	tone: KIND_TONES[kind],
}));

const SORT_OPTIONS: SelectOption<ChallengeSort>[] = [
	{ value: "updated", label: "Ostatnio zmieniane" },
	{ value: "added", label: "Najnowsze" },
	{ value: "premiere", label: "Data premiery" },
	{ value: "title", label: "Nazwa A–Z" },
];

export type ChallengesView = "cards" | "table";

interface ChallengesPageProps {
	filters: ChallengeFilters;
	view: ChallengesView;
	onChange: (
		patch: Partial<ChallengeFilters> & { view?: ChallengesView },
	) => void;
	onOpen: (challengeId: string) => void;
	onCreate: () => void;
}

export function ChallengesPage({
	filters,
	view,
	onChange,
	onOpen,
	onCreate,
}: ChallengesPageProps) {
	const promotedId = useConfig().internal.promotedChallengeId;
	const { data, isLoading } = useLiveQuery({
		query: (q) => q.from({ challenge: challengesCollection }),
	});
	const showSkeleton = useDelayedLoading(isLoading);
	const [limit, setLimit] = useState(PAGE);

	const all = data ?? [];
	const challenges = filterChallenges(all, filters);
	const shown = challenges.slice(0, limit);
	const filtered = Boolean(filters.q || filters.status || filters.kind);
	const change = (
		patch: Partial<ChallengeFilters> & { view?: ChallengesView },
	) => {
		setLimit(PAGE);
		onChange(patch);
	};

	const columns: Column<Challenge>[] = [
		{
			key: "title",
			header: "Nazwa",
			primary: true,
			cell: (challenge) => (
				<span className="block min-w-0">
					<span className="block truncate">
						{challenge.title || "Bez nazwy"}
					</span>
					<span className="block truncate text-xs font-normal text-muted">
						{challenge.id}
						{challenge.subtitle ? ` · ${challenge.subtitle}` : ""}
					</span>
				</span>
			),
		},
		{
			key: "kind",
			header: "Typ",
			cell: (challenge) => {
				const kind = challengeKind(challenge);
				return (
					<span className="flex flex-wrap gap-1">
						<Tag tone={KIND_TONES[kind]}>{KIND_LABELS[kind]}</Tag>
						{challenge.id === promotedId && <Tag tone="amber">Promowane</Tag>}
					</span>
				);
			},
		},
		{
			key: "status",
			header: "Status",
			cell: (challenge) => (
				<span className="flex flex-wrap gap-1">
					<StatusBadge status={challenge.status} />
					{challenge.pro && <Tag tone="indigo">Pro</Tag>}
				</span>
			),
		},
		{
			key: "variants",
			header: "Warianty",
			align: "end",
			cell: (challenge) => challenge.paths.length,
		},
		{
			key: "days",
			header: "Dni",
			align: "end",
			cell: (challenge) => challenge.lengthDays,
		},
		{
			key: "premiere",
			header: "Premiera",
			align: "end",
			cell: (challenge) => (
				<span className="text-subtle">{formatDate(challenge.liveAtUtc)}</span>
			),
		},
		{
			key: "updated",
			header: "Zmieniono",
			align: "end",
			cell: (challenge) => (
				<span className="text-subtle">
					{formatDate(challenge.updatedAtUtc)}
				</span>
			),
		},
	];

	return (
		<div className="mx-auto max-w-[1400px]">
			<header className="mb-5 flex flex-wrap items-center justify-between gap-3">
				<h1 className="text-3xl font-semibold tracking-tight">Wyzwania</h1>
				<Button variant="primary" size="md" onClick={onCreate}>
					Nowe wyzwanie
				</Button>
			</header>

			<div className="mb-4">
				<PromotedChallenge
					// Start again from the saved value when it changes.
					key={promotedId ?? "none"}
					challenges={all}
				/>
			</div>

			<div className="mb-3 flex flex-wrap gap-2">
				<input
					type="search"
					aria-label="Szukaj wyzwania"
					placeholder="Szukaj po nazwie, podtytule, komentarzu lub ID…"
					value={filters.q ?? ""}
					onChange={(event) => change({ q: event.target.value || undefined })}
					className="h-10 min-w-56 flex-[2] rounded-control border border-line-input bg-surface px-3 text-sm outline-none placeholder:text-muted hover:border-primary focus:border-primary focus:shadow-focus any-pointer-coarse:text-base"
				/>
				<Select
					label="Status"
					placeholder="Status: aktywne"
					options={STATUS_OPTIONS}
					value={filters.status ?? null}
					onChange={(status) => change({ status: status ?? undefined })}
					clearable
					className="min-w-40 flex-1"
				/>
				<Select
					label="Typ"
					placeholder="Typ: wszystkie"
					options={KIND_OPTIONS}
					value={filters.kind ?? null}
					onChange={(kind) => change({ kind: kind ?? undefined })}
					clearable
					className="min-w-40 flex-1"
				/>
				<Select
					label="Kolejność"
					options={SORT_OPTIONS}
					value={filters.sort ?? "updated"}
					onChange={(sort) => change({ sort: sort ?? undefined })}
					className="min-w-40 flex-1"
				/>
				<div className="flex rounded-control bg-hover p-1">
					{(
						[
							["cards", "Karty"],
							["table", "Tabela"],
						] as const
					).map(([value, label]) => (
						<button
							key={value}
							type="button"
							aria-pressed={view === value}
							onClick={() => change({ view: value })}
							className={`rounded-chip px-3 text-sm ${view === value ? "bg-surface font-semibold shadow-sm" : "text-subtle"}`}
						>
							{label}
						</button>
					))}
				</div>
			</div>

			<p className="mb-3 text-xs text-muted">
				{isLoading
					? "Wczytywanie…"
					: filters.status === "deleted"
						? `${challenges.length} w koszu`
						: plural(challenges.length, "pozycja", "pozycje", "pozycji")}
			</p>

			{isLoading ? (
				showSkeleton && (
					<div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
						{[1, 2, 3, 4].map((n) => (
							<Skeleton key={n} className="h-64 rounded-card" />
						))}
					</div>
				)
			) : challenges.length === 0 ? (
				<EmptyState
					title={filtered ? "Nic nie pasuje do filtrów" : "Brak wyzwań"}
					action={
						filtered ? (
							<Button
								onClick={() =>
									change({ q: undefined, status: undefined, kind: undefined })
								}
							>
								Wyczyść filtry
							</Button>
						) : (
							<Button variant="primary" onClick={onCreate}>
								Nowe wyzwanie
							</Button>
						)
					}
				>
					{filtered
						? "Zmień wyszukiwanie albo wyczyść filtry."
						: "Zacznij od pierwszego wyzwania albo planu."}
				</EmptyState>
			) : view === "table" ? (
				<Table
					columns={columns}
					rows={shown}
					rowKey={(challenge) => challenge.id}
					onRowClick={(challenge) => onOpen(challenge.id)}
				/>
			) : (
				<div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
					{shown.map((challenge) => (
						<ChallengeCard
							key={challenge.id}
							challenge={challenge}
							promoted={challenge.id === promotedId}
						/>
					))}
				</div>
			)}

			{challenges.length > shown.length && (
				<div className="mt-4 flex justify-center">
					<Button onClick={() => setLimit(limit + PAGE)}>
						Pokaż kolejne ({challenges.length - shown.length} pozostało)
					</Button>
				</div>
			)}
		</div>
	);
}
