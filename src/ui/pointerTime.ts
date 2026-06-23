// The latest timeline time (seconds) the pointer hovered over a lane, or null if the pointer
// hasn't been over the timeline. Kept as a module-level value rather than store state so the
// per-pointermove updates don't churn React re-renders. Read by the paste shortcut so a paste
// lands under the cursor (see useKeyboard + store.paste).

let pointerTime: number | null = null;

export function setPointerTime(t: number | null): void {
  pointerTime = t;
}

export function getPointerTime(): number | null {
  return pointerTime;
}
