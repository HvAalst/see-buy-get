import { useBackLayer } from '../nav';

/**
 * 2026-11-02 — THE PHONE'S BACK STEPS BACK THROUGH A WIZARD (the owner: "make it as native as today can be"). A sign-up or
 * a set-up of several steps is not a stack of screens, so the phone's Back would leave it from any step. Drawn once per
 * step — `key` it by the step, so each step is its own entry — while that step has one to go back to: Back takes the
 * person there, as the screen's own Back does, and only the first step lets the phone's Back leave.
 */
export function BackStep({ back }: { back: () => void }) {
  useBackLayer(true, back);
  return null;
}
