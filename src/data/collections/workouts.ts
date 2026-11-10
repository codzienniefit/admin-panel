import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { createCollection } from "@tanstack/react-db";
import { api } from "@/data/api";
import type { NewWorkout, Workout } from "@/data/schemas/workout";
import { queryClient } from "./queryClient";
import { createSaver } from "./saver";

// The single copy of every workout, deleted ones included (the trash is a
// filter, not a separate list).
export const workoutsCollection = createCollection(
	queryCollectionOptions<Workout>({
		id: "workouts",
		queryKey: ["workouts"],
		queryClient,
		queryFn: async () => {
			const list = await api.workouts.list();
			workoutSaver.remember(list);
			return list;
		},
		getKey: (workout) => workout.id,
		onUpdate: async ({ transaction }) => {
			for (const mutation of transaction.mutations) {
				await workoutSaver.persist(
					mutation.original as Workout,
					mutation.modified,
				);
			}
		},
	}),
);

export const workoutSaver = createSaver<Workout>({
	save: (workout, options) => api.workouts.save(workout, options),
	writeBack: (workout) => workoutsCollection.utils.writeUpsert(workout),
	readVisible: (id) => workoutsCollection.get(id),
	update: async (id, change) => {
		await workoutsCollection
			.update(id, (draft) => change(draft as Workout))
			.when("settled");
	},
});

/**
 * Creates a workout. Not optimistic: the server assigns the id, so the new
 * row appears once it answers.
 */
export async function createWorkout(input: NewWorkout): Promise<Workout> {
	const saved = await api.workouts.create(input);
	workoutSaver.remember([saved]);
	await workoutsCollection.utils.writeInsert(saved);
	return saved;
}

if (import.meta.hot) {
	import.meta.hot.accept(() => window.location.reload());
}
