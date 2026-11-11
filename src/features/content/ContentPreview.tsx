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
}

/**
 * Blocks drawn the way the app draws them. Text is split by the same rules
 * the app uses, so a tag it would not understand shows up here as typed.
 */
export function ContentPreview({
	blocks,
	compact = false,
}: ContentPreviewProps) {
	const side = compact ? "mx-4" : "mx-[45px]";

	if (blocks.length === 0) {
		return <p className={`${side} text-sm text-muted`}>Brak treści</p>;
	}

	return (
		<div style={{ color: INK }}>
			{blocks.map((block, index) => {
				const gap = index === 0 ? "" : "mt-[15px]";
				// The list only changes as a whole; position is a stable key here.
				const key = `${index}-${block.type}`;

				if (block.type === "Title") {
					return (
						<div
							key={key}
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
							className={`${side} ${gap} text-[15px] leading-normal font-light whitespace-pre-wrap [overflow-wrap:anywhere]`}
						>
							{segments.length === 0 && (
								<span className="opacity-30">Tekst</span>
							)}
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
						className={`${side} ${gap} rounded-chip border border-danger border-dashed p-2 text-xs text-danger`}
					>
						Nieznany blok „{block.type}” (aplikacja go pominie)
					</div>
				);
			})}
		</div>
	);
}
