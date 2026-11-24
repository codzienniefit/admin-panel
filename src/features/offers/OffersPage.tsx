import { useLiveQuery } from "@tanstack/react-db";
import { offersCollection } from "@/data/collections/offers";
import type { Offer } from "@/data/schemas/offer";
import { formatDateTime } from "@/domain/dates";
import type { OfferState } from "@/domain/offerRules";
import { offerState } from "@/domain/offerRules";
import { plural } from "@/domain/text";
import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";
import { ListPage, SearchInput } from "@/ui/ListPage";
import { refreshing } from "@/ui/RefreshButton";
import { Select, type SelectOption } from "@/ui/Select";
import { type Column, Table } from "@/ui/Table";
import { Tag } from "@/ui/Tag";
import {
	filterOffers,
	OFFER_STATE_META,
	OFFER_STATES,
	type OfferFilters,
} from "./offerMeta";

const STATE_OPTIONS: SelectOption<OfferState>[] = OFFER_STATES.map((state) => ({
	value: state,
	label: OFFER_STATE_META[state].label,
	tone: OFFER_STATE_META[state].tone,
}));

interface OffersPageProps {
	filters: OfferFilters;
	onFiltersChange: (patch: Partial<OfferFilters>) => void;
	onOpen: (offerId: string) => void;
	onCreate: () => void;
}

/** When an offer works: "od … do …", or "bez końca". */
export function offerPeriod(offer: Offer): string {
	const from = offer.validFromUtc
		? `od ${formatDateTime(offer.validFromUtc)}`
		: "";
	const until = offer.expiresAtUtc
		? `do ${formatDateTime(offer.expiresAtUtc)}`
		: "bez końca";
	return [from, until].filter(Boolean).join(" ");
}

export function OffersPage({
	filters,
	onFiltersChange,
	onOpen,
	onCreate,
}: OffersPageProps) {
	const { data, isLoading } = useLiveQuery({
		query: (q) => q.from({ offer: offersCollection }),
	});
	const now = new Date().toISOString();
	const offers = filterOffers(data ?? [], filters, now);
	const filtered = Boolean(filters.q || filters.state);

	const columns: Column<Offer>[] = [
		{
			key: "code",
			header: "Kod",
			primary: true,
			cell: (offer) => (
				<span className="min-w-0">
					<span className="block font-mono [overflow-wrap:anywhere]">
						{offer.code}
					</span>
					<span className="block max-w-md truncate text-xs font-normal text-muted">
						{offer.title ?? "Bez tytułu"}
					</span>
				</span>
			),
		},
		{
			key: "state",
			header: "Stan",
			cell: (offer) => {
				const meta = OFFER_STATE_META[offerState(offer, now)];
				return <Tag tone={meta.tone}>{meta.label}</Tag>;
			},
		},
		{
			key: "period",
			header: "Kiedy działa",
			cell: (offer) => (
				<span className="text-subtle">{offerPeriod(offer)}</span>
			),
		},
		{
			key: "offering",
			header: "Offering",
			cell: (offer) => (
				<span className="font-mono text-xs text-subtle [overflow-wrap:anywhere]">
					{offer.offeringId}
				</span>
			),
		},
		{
			key: "purchases",
			header: "Zakupy",
			cell: (offer) => <span className="tabular-nums">{offer.purchases}</span>,
		},
	];

	return (
		<ListPage
			onRefresh={refreshing(offersCollection)}
			title="Oferty specjalne"
			action={
				<Button variant="primary" size="md" onClick={onCreate}>
					Nowa oferta
				</Button>
			}
			filters={
				<>
					<SearchInput
						label="Szukaj oferty"
						placeholder="Szukaj po kodzie, tytule lub offeringu…"
						value={filters.q ?? ""}
						onChange={(q) => onFiltersChange({ q: q || undefined })}
					/>
					<Select
						label="Stan"
						placeholder="Stan: wszystkie"
						options={STATE_OPTIONS}
						value={filters.state ?? null}
						onChange={(state) => onFiltersChange({ state: state ?? undefined })}
						clearable
						className="min-w-44 flex-1"
					/>
				</>
			}
			summary={plural(offers.length, "oferta", "oferty", "ofert")}
			loading={isLoading}
		>
			<Table
				columns={columns}
				rows={offers}
				rowKey={(offer) => offer.id}
				onRowClick={(offer) => onOpen(offer.id)}
				empty={
					<EmptyState
						title={filtered ? "Nic nie pasuje do filtrów" : "Brak ofert"}
						action={
							filtered ? (
								<Button
									onClick={() =>
										onFiltersChange({ q: undefined, state: undefined })
									}
								>
									Wyczyść filtry
								</Button>
							) : (
								<Button variant="primary" onClick={onCreate}>
									Nowa oferta
								</Button>
							)
						}
					>
						{filtered
							? "Zmień wyszukiwanie albo wyczyść filtry."
							: "Oferta to kod kampanii: link z nim otwiera w aplikacji wybrany offering RevenueCat."}
					</EmptyState>
				}
			/>
		</ListPage>
	);
}
