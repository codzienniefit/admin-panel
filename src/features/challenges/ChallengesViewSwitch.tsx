import { Link } from "@tanstack/react-router";
import { segmentedItem, segmentedTrack } from "@/ui/Segmented";

/**
 * Switches between the list of challenges and their calendar. The router
 * marks the link of the current page (aria-current), which styles it.
 */
export function ChallengesViewSwitch() {
	return (
		<nav aria-label="Widok wyzwań" className={segmentedTrack}>
			<Link
				to="/challenges"
				activeOptions={{ exact: true, includeSearch: false }}
				className={segmentedItem}
			>
				Lista
			</Link>
			<Link
				to="/challenges/calendar"
				activeOptions={{ includeSearch: false }}
				className={segmentedItem}
			>
				Kalendarz
			</Link>
		</nav>
	);
}
