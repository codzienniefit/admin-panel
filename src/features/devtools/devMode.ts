import { readStored, writeStored } from "@/lib/storage";
import { createStore } from "@/lib/store";

// Developer mode: shows the register of backend calls in the top bar. A
// preference of this browser, on until someone turns it off; it changes
// nothing about what the panel does.

const KEY = "cf.devMode";

export const devMode = createStore<boolean>(readStored(KEY) !== "off");

export function setDevMode(on: boolean): void {
	devMode.set(on);
	writeStored(KEY, on ? "on" : "off");
}
