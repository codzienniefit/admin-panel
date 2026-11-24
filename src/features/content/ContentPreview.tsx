import { useEffect, useRef } from "react";
import type { ContentBlock } from "@/data/schemas/workout";
import { textSegments } from "@/domain/contentBlocks";
import { MediaImage } from "@/features/media/MediaImage";

// The colours and proportions of the mobile app, not of the panel: this is a
// picture of what a user will see. System fonts stand in for the app's own.
const INK = "#22203a";
const LINK = "#838bc5";

interface ContentPreviewProps {
	blocks: readonly ContentBlock[];
	/** Narrower side margins, for small previews inside forms. */
	compact?: boolean;
	/**
	 * The block being edited: drawn on a tinted background and scrolled into
	 * view inside the preview, so it is clear which part of the screen it is.
	 */
	highlightIndex?: number | null;
	/**
	 * Each block's number in the margin beside it, as in the list of blocks,
	 * so it is clear where one block ends and the next begins.
	 */
	numbered?: boolean;
	/** A click on a block's number: the editor selects that block. */
	onPick?: (index: number) => void;
	/** Blocks the JSON describes wrongly, by position: what is wrong. */
	problems?: ReadonlyMap<number, string>;
}

/** The tint reaches a little beyond the block, without moving anything. */
const HIGHLIGHT =
	"rounded-sm bg-[#eceefa] shadow-[0_0_0_8px_#eceefa] transition-[background-color,box-shadow]";

/**
 * Scrolls the preview's own box (never the page) so a block is in view, and
 * only when it is not already.
 */
function bringIntoView(block: HTMLElement, box: HTMLElement) {
	if (box.scrollHeight <= box.clientHeight) return;
	const top =
		block.getBoundingClientRect().top -
		box.getBoundingClientRect().top +
		box.scrollTop;
	const margin = 24;
	const fits =
		top >= box.scrollTop + margin &&
		top + block.offsetHeight <= box.scrollTop + box.clientHeight - margin;
	if (fits) return;
	box.scrollTo({ top: Math.max(0, top - margin), behavior: "smooth" });
}

/**
 * Blocks drawn the way the app draws them. Text is split by the same rules
 * the app uses, so a tag it would not understand shows up here as typed.
 */
export function ContentPreview({
	blocks,
	compact = false,
	highlightIndex = null,
	numbered = false,
	onPick,
	problems,
}: ContentPreviewProps) {
	const side = compact ? "mx-4" : "mx-[45px]";
	const root = useRef<HTMLDivElement>(null);

	// When another block is picked, not on every keystroke in it.
	useEffect(() => {
		if (highlightIndex === null) return;
		const block = root.current?.querySelector<HTMLElement>(
			`[data-block-index="${highlightIndex}"]`,
		);
		const box = root.current?.parentElement;
		if (block && box) bringIntoView(block, box);
	}, [highlightIndex]);

	if (blocks.length === 0) {
		return <p className={`${side} text-sm text-muted`}>Brak treści</p>;
	}

	const drawn = blocks.map((block, index) => {
		const gap = index === highlightIndex ? HIGHLIGHT : "";
		const problem = problems?.get(index);
		if (problem !== undefined) {
			return (
				<div
					data-block-index={index}
					className={`${side} rounded-chip border border-danger border-dashed bg-[#fff5f5] p-2 text-xs text-danger`}
				>
					<b className="font-semibold">Błąd w JSON-ie:</b> {problem}
				</div>
			);
		}
		// The list only changes as a whole; position is a stable key here.
		const key = `${index}-${block.type}`;

		if (block.type === "Title") {
			return (
				<div
					key={key}
					data-block-index={index}
					className={`${side} ${gap} text-[17px] leading-[1.3] font-bold [overflow-wrap:anywhere]`}
				>
					{block.content || <span className="opacity-30">Tytuł</span>}
				</div>
			);
		}

		if (block.type === "Text") {
			const segments = textSegments(block.content);
			return (
				<div
					key={key}
					data-block-index={index}
					className={`${side} ${gap} text-[15px] leading-normal font-light whitespace-pre-wrap [overflow-wrap:anywhere]`}
				>
					{segments.length === 0 && <span className="opacity-30">Tekst</span>}
					{segments.map((segment, i) => {
						const segmentKey = `${i}-${segment.kind}`;
						if (segment.kind === "bold") {
							return (
								<b key={segmentKey} className="font-bold">
									{segment.text}
								</b>
							);
						}
						if (segment.kind === "link") {
							return (
								<span
									key={segmentKey}
									title={segment.href}
									className="underline"
									style={{ color: LINK }}
								>
									{segment.text}
								</span>
							);
						}
						return <span key={segmentKey}>{segment.text}</span>;
					})}
				</div>
			);
		}

		if (block.type === "Image") {
			const path = block.metadata?.imageRelativePath ?? null;
			const ratio = block.metadata?.heightToWidthRatio;
			return (
				<div
					key={key}
					data-block-index={index}
					className={`${side} ${gap} flex items-center justify-center overflow-hidden bg-[#e4e4ee]`}
					style={{
						aspectRatio: `1 / ${ratio && ratio > 0 ? ratio : 0.6}`,
					}}
				>
					<MediaImage
						path={path}
						placeholder="brak obrazu"
						className="size-full"
						imageClassName="object-contain"
						placeholderClassName="p-2 text-center font-mono text-[11px] text-[#8b8aa3]"
					/>
				</div>
			);
		}

		return (
			<div
				key={key}
				data-block-index={index}
				className={`${side} ${gap} rounded-chip border border-danger border-dashed p-2 text-xs text-danger`}
			>
				Nieznany rodzaj bloku „{block.type}”. Popraw „type” w JSON-ie (Title,
				Text albo Image) albo usuń ten blok.
			</div>
		);
	});

	// The list only changes as a whole; position is a stable key here.
	const keys = blocks.map((block, index) => `${index}-${block.type}`);

	return (
		<div ref={root} style={{ color: INK }}>
			{drawn.map((element, index) => (
				<div
					key={keys[index]}
					className={`relative ${index === 0 ? "" : "mt-[15px]"}`}
				>
					{numbered && (
						// In the app's empty side margin: not part of what is drawn.
						<NumberMark
							index={index}
							current={index === highlightIndex}
							onPick={onPick}
						/>
					)}
					{element}
				</div>
			))}
		</div>
	);
}

function NumberMark({
	index,
	current,
	onPick,
}: {
	index: number;
	current: boolean;
	onPick?: (index: number) => void;
}) {
	const look = `absolute top-0.5 left-1.5 w-[33px] rounded-chip text-center font-mono text-[11px] leading-5 tabular-nums ${current ? "font-semibold text-primary" : "text-[#b4b3c6]"}`;
	if (!onPick) {
		return (
			<span aria-hidden="true" className={look}>
				{index + 1}
			</span>
		);
	}
	return (
		<button
			type="button"
			title={`Pokaż blok ${index + 1} w edytorze`}
			aria-label={`Pokaż blok ${index + 1} w edytorze`}
			onClick={() => onPick(index)}
			className={`${look} cursor-pointer outline-none hover:bg-[#eceefa] hover:text-primary focus-visible:shadow-focus`}
		>
			{index + 1}
		</button>
	);
}
