import {
	KeyboardSensor,
	MouseSensor,
	TouchSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";

/**
 * How a drag starts, the same everywhere: a mouse has to move a little (so a
 * click stays a click), a finger has to hold (so a swipe still scrolls), and
 * the keyboard works too.
 */
export function useDragSensors() {
	return useSensors(
		useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
		useSensor(TouchSensor, {
			activationConstraint: { delay: 250, tolerance: 8 },
		}),
		useSensor(KeyboardSensor),
	);
}
