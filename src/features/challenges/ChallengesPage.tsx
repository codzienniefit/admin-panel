import { useLiveQuery } from "@tanstack/react-db";
import { challengesCollection } from "@/data/collections/challenges";
import type { Challenge, ContentStatus } from "@/data/schemas/challenge";
import {
	type ChallengeFilters,
	type ChallengeSort,
	filterChallenges,
	NO_FOLDER,
} from "@/domain/challengeFilters";
import {
	type ChallengeKind,
	challengeKind,
	KIND_LABELS,
} from "@/domain/challengeRules";
import { formatDate } from "@/domain/dates";
import { plural } from "@/domain/text";
import { useConfig } from "@/features/config/useConfig";
import { usePlanningById } from "@/features/planner/usePlanning";
import { usePlannerSettings } from "@/features/settings/usePlannerSettings";
import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";
import { STATUS_META } from "@/ui/enums";
import { SearchInput } from "@/ui/ListPage";
import { Loading, useDelayedLoading } from "@/ui/Loading";
import { Segmented } from "@/ui/Segmented";
import { Select, type SelectOption } from "@/ui/Select";
import { StatusBadge } from "@/ui/StatusBadge";
import { type Column, Table } from "@/ui/Table";
import { Tag } from "@/ui/Tag";
import { ChallengeCard, KIND_TONES } from "./ChallengeCard";
import { ChallengesViewSwitch } from "./ChallengesViewSwitch";
import { PromotedChallenge } from "./PromotedChallenge";

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
	const showLoading = useDelayedLoading(isLoading);

	const planningById = usePlanningById();
	const folders = usePlannerSettings()?.folders ?? [];
	const folderIds = new Set(folders.map((folder) => folder.id));
	// A folder that was deleted in the settings counts as "no folder".
	const folderOf = (challengeId: string) => {
		const id = planningById.get(challengeId)?.folderId ?? null;
		return id && folderIds.has(id) ? id : null;
	};

	const all = data ?? [];
	// Every challenge that matches, never a first page of them.
	const challenges = filterChallenges(all, filters, folderOf);
	const filtered = Boolean(
		filters.q || filters.status || filters.kind || filters.folder,
	);
	const change = onChange;

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
			<header className="mb-5 flex flex-wrap items-center gap-3">
				<h1 className="text-3xl font-semibold tracking-tight">Wyzwania</h1>
				<ChallengesViewSwitch />
				<Button
					variant="primary"
					size="md"
					className="ml-auto"
					onClick={onCreate}
				>
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
				<SearchInput
					label="Szukaj wyzwania"
					placeholder="Szukaj po nazwie, podtytule, komentarzu lub ID…"
					value={filters.q ?? ""}
					onChange={(q) => change({ q: q || undefined })}
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
				{folders.length > 0 && (
					<Select
						label="Folder"
						placeholder="Folder: wszystkie"
						options={[
							{ value: NO_FOLDER, label: "Bez folderu" },
							...folders.map((folder) => ({
								value: folder.id,
								label: folder.name,
							})),
						]}
						value={filters.folder ?? null}
						onChange={(folder) => change({ folder: folder ?? undefined })}
						clearable
						className="min-w-40 flex-1"
					/>
				)}
				<Select
					label="Kolejność"
					options={SORT_OPTIONS}
					value={filters.sort ?? "updated"}
					onChange={(sort) => change({ sort: sort ?? undefined })}
					className="min-w-40 flex-1"
				/>
				<Segmented
					label="Układ listy"
					options={[
						{ value: "cards", label: "Karty" },
						{ value: "table", label: "Tabela" },
					]}
					value={view}
					onChange={(next) => change({ view: next })}
				/>
			</div>

			<p className="mb-3 text-xs text-muted">
				{isLoading
					? "Wczytywanie…"
					: filters.status === "deleted"
						? `${challenges.length} w koszu`
						: plural(challenges.length, "pozycja", "pozycje", "pozycji")}
			</p>

			{isLoading ? (
				showLoading && (
					<div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
						{[1, 2, 3, 4].map((n) => (
							<Loading key={n} />
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
					rows={challenges}
					rowKey={(challenge) => challenge.id}
					onRowClick={(challenge) => onOpen(challenge.id)}
				/>
			) : (
				<div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
					{challenges.map((challenge) => (
						<ChallengeCard
							key={challenge.id}
							challenge={challenge}
							promoted={challenge.id === promotedId}
						/>
					))}
				</div>
			)}
		</div>
	);
}
