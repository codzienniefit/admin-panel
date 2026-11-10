import { createFileRoute } from "@tanstack/react-router";
import { WorkoutEditor } from "@/features/workouts/WorkoutEditor";

export const Route = createFileRoute("/_app/workouts/$workoutId")({
	component: WorkoutRoute,
});

function WorkoutRoute() {
	const { workoutId } = Route.useParams();
	const navigate = Route.useNavigate();
	const back = () => navigate({ to: "/workouts", search: (prev) => prev });
	return (
		<WorkoutEditor workoutId={workoutId} onClose={back} onCreated={back} />
	);
}
