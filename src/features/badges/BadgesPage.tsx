import { useLiveQuery } from "@tanstack/react-db";
import { badgesCollection } from "@/data/collections/badges";
import type { Badge } from "@/data/schemas/badge";
import {
	type BadgeFilters,
	type BadgeSort,
	type BadgeVisibility,
	filterBadges,
} from "@/domain/badgeFilters";
import { badgeSummary } from "@/domain/badgeRules";
import { formatDate } from "@/domain/dates";
import { plural } from "@/domain/text";
import { useConfig } from "@/features/config/useConfig";
import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";
import { ListPage, SearchInput } from "@/ui/ListPage";
import { Select, type SelectOption } from "@/ui/Select";
import { type Column, Table } from "@/ui/Table";
import { Tag } from "@/ui/Tag";
import { BadgeImage } from "./BadgeImage";
import {
	badgeSectionLabel,
	badgeTypeMeta,
	BADGE_VISIBILITY_META as VISIBILITY,
} from "./badgeMeta";
import { useBadgeAssignments } from "./useBadgeAssignments";

const VISIBILITY_OPTIONS: SelectOption<BadgeVisibility>[] = [
	{ value: "visible", label: "Widoczne", tone: VISIBILITY.visible.tone },
	{ value: "hidden", label: "Ukryte", tone: VISIBILITY.hidden.tone },
];

const SORT_OPTIONS: SelectOption<BadgeSort>[] = [
	{ value: "name", label: "Nazwa A–Z" },
	{ value: "updated", label: "Ostatnio zmieniane" },
];

interface BadgesPageProps {
	filters: BadgeFilters;
	onFiltersChange: (patch: Partial<BadgeFilters>) => void;
	onOpen: (badgeId: string) => void;
	onCreate: () => void;
}

export function BadgesPage({
	filters,
	onFiltersChange,
	onOpen,
	onCreate,
}: BadgesPageProps) {
	const { badgeTypes, badgeSections } = useConfig().internal;
	const { data, isLoading } = useLiveQuery({
		query: (q) => q.from({ badge: badgesCollection }),
	});
	const assignments = useBadgeAssignments();

	const badges = filterBadges(data ?? [], filters);
	const filtered = Boolean(
		filters.q || filters.type || filters.section || filters.visibility,
	);

	const columns: Column<Badge>[] = [
		{
			key: "name",
			header: "Nazwa",
			primary: true,
			cell: (badge) => (
				<span className="flex items-center gap-3">
					<BadgeImage
						path={badge.imageRelativePath}
						dimmed={Boolean(badge.isHidden)}
					/>
					<span className="min-w-0">
						<span className="block [overflow-wrap:anywhere]">
							{badge.name || "Bez nazwy"}
						</span>
						{badge.comment && (
							<span className="block max-w-md truncate text-xs font-normal text-muted">
								{badge.comment}
							</span>
						)}
					</span>
				</span>
			),
		},
		{
			key: "type",
			header: "Typ",
			cell: (badge) => {
				const meta = badgeTypeMeta(badge.type, badgeTypes);
				return <Tag tone={meta.tone}>{meta.label}</Tag>;
			},
		},
		{
			key: "section",
			header: "Sekcja",
			cell: (badge) => (
				<span className="text-subtle">
					{badgeSectionLabel(badge, badgeSections) ?? "—"}
				</span>
			),
		},
		{
			key: "visibility",
			header: "Widoczność",
			cell: (badge) => (
				<span className="flex flex-wrap items-center gap-1">
					{badge.isHidden ? (
						<Tag tone={VISIBILITY.hidden.tone}>{VISIBILITY.hidden.label}</Tag>
					) : (
						<Tag tone={VISIBILITY.visible.tone} variant="dot">
							{VISIBILITY.visible.label}
						</Tag>
					)}
					{(badge.activeFromUtc || badge.activeTillUtc) && (
						<span className="text-xs text-muted">
							{badge.activeFromUtc && `od ${formatDate(badge.activeFromUtc)} `}
							{badge.activeTillUtc && `do ${formatDate(badge.activeTillUtc)}`}
						</span>
					)}
				</span>
			),
		},
		{
			key: "info",
			header: "Jak się ją zdobywa",
			cell: (badge) => (
				<span className="text-subtle">
					{badge.type === "normal" && !assignments.ready
						? "…"
						: badgeSummary(badge, assignments.of(badge.id))}
				</span>
			),
		},
	];

	return (
		<ListPage
			title="Odznaki"
			action={
				<Button variant="primary" size="md" onClick={onCreate}>
					Nowa odznaka
				</Button>
			}
			filters={
				<>
					<SearchInput
						label="Szukaj odznaki"
						placeholder="Szukaj po nazwie lub opisie…"
						value={filters.q ?? ""}
						onChange={(q) => onFiltersChange({ q: q || undefined })}
					/>
					<Select
						label="Typ odznaki"
						placeholder="Typ: wszystkie"
						options={badgeTypes.map((type) => ({
							value: type.value,
							label: type.label,
							tone: badgeTypeMeta(type.value, badgeTypes).tone,
						}))}
						value={filters.type ?? null}
						onChange={(type) => onFiltersChange({ type: type ?? undefined })}
						clearable
						className="min-w-44 flex-1"
					/>
					<Select
						label="Sekcja"
						placeholder="Sekcja: wszystkie"
						options={badgeSections.map((section) => ({
							value: section.id,
							label: section.label,
						}))}
						value={filters.section ?? null}
						onChange={(section) =>
							onFiltersChange({ section: section ?? undefined })
						}
						clearable
						className="min-w-44 flex-1"
					/>
					<Select
						label="Widoczność"
						placeholder="Widoczność: wszystkie"
						options={VISIBILITY_OPTIONS}
						value={filters.visibility ?? null}
						onChange={(visibility) =>
							onFiltersChange({ visibility: visibility ?? undefined })
						}
						clearable
						className="min-w-44 flex-1"
					/>
					<Select
						label="Kolejność"
						options={SORT_OPTIONS}
						value={filters.sort ?? "name"}
						onChange={(sort) => onFiltersChange({ sort: sort ?? undefined })}
						className="min-w-44 flex-1"
					/>
				</>
			}
			summary={plural(badges.length, "odznaka", "odznaki", "odznak")}
			loading={isLoading}
		>
			<Table
				columns={columns}
				rows={badges}
				rowKey={(badge) => badge.id}
				onRowClick={(badge) => onOpen(badge.id)}
				empty={
					<EmptyState
						title={filtered ? "Nic nie pasuje do filtrów" : "Brak odznak"}
						action={
							filtered ? (
								<Button
									onClick={() =>
										onFiltersChange({
											q: undefined,
											type: undefined,
											section: undefined,
											visibility: undefined,
										})
									}
								>
									Wyczyść filtry
								</Button>
							) : (
								<Button variant="primary" onClick={onCreate}>
									Nowa odznaka
								</Button>
							)
						}
					>
						{filtered
							? "Zmień wyszukiwanie albo wyczyść filtry."
							: "Dodaj pierwszą odznakę, żeby móc ją przypisać do treningu lub wyzwania."}
					</EmptyState>
				}
			/>
		</ListPage>
	);
}
