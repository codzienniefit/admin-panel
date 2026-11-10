import { Link } from "@tanstack/react-router";
import { mediaUrl } from "@/data/collections/media";
import type { Challenge } from "@/data/schemas/challenge";
import { challengeKind, KIND_LABELS } from "@/domain/challengeRules";
import { plural } from "@/domain/text";
import { levelMeta } from "@/ui/enums";
import { StatusBadge } from "@/ui/StatusBadge";
import { Tag } from "@/ui/Tag";
import type { Tone } from "@/ui/tones";

export const KIND_TONES: Record<ReturnType<typeof challengeKind>, Tone> = {
	challenge: "pink",
	main: "blue",
	supplementary: "teal",
	archived: "grey",
	plan: "indigo",
};

interface ChallengeCardProps {
	challenge: Challenge;
	promoted?: boolean;
}

export function ChallengeCard({ challenge, promoted }: ChallengeCardProps) {
	const weeks = Math.ceil(challenge.lengthDays / 7);
	const kind = challengeKind(challenge);
	return (
		<Link
			to="/challenges/$challengeId"
			params={{ challengeId: challenge.id }}
			className="flex flex-col overflow-hidden rounded-card border border-line bg-surface transition hover:-translate-y-0.5 hover:border-primary hover:shadow-card"
		>
			{challenge.imageRelativePath ? (
				<img
					src={mediaUrl(challenge.imageRelativePath)}
					alt=""
					loading="lazy"
					className="aspect-[5/2] w-full bg-hover object-cover"
				/>
			) : (
				<div className="flex aspect-[5/2] w-full items-center justify-center bg-bg text-xs text-muted">
					brak grafiki
				</div>
			)}
			<div className="flex flex-1 flex-col gap-3 p-4">
				<div className="flex items-start justify-between gap-3">
					{/* Always two lines tall, so tags align across a row of cards. */}
					<h2
						title={challenge.title}
						className="line-clamp-2 min-h-[2lh] text-lg font-semibold leading-snug"
					>
						{challenge.title || "Bez nazwy"}
					</h2>
					<StatusBadge status={challenge.status} />
				</div>
				<div className="flex flex-wrap gap-1.5">
					<Tag tone={KIND_TONES[kind]}>{KIND_LABELS[kind]}</Tag>
					{promoted && <Tag tone="amber">Promowane</Tag>}
					{challenge.pro && <Tag tone="indigo">Pro</Tag>}
					{challenge.paths.map((path) => {
						const level = levelMeta(path.levelId);
						return (
							<Tag key={path.pathId} tone={level.tone} variant="dot">
								{level.label}
							</Tag>
						);
					})}
				</div>
				<p className="mt-auto text-sm text-muted">
					{challenge.id} · {challenge.lengthDays} dni ·{" "}
					{plural(weeks, "tydzień", "tygodnie", "tygodni")}
				</p>
			</div>
		</Link>
	);
}
