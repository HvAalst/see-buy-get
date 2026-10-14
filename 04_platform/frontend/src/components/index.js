// WS-UX shared component kit (ticket T-007).
// Low-literacy-first, accessible (WCAG 2.2 AA), dependency-free building blocks.
// All visuals use the design tokens in ../styles.css; component styles live in ./components.css.

export { el, mount } from './dom.js';
export { BigButton } from './bigButton.js';
export { StepProgress } from './stepProgress.js';
export { StatusBadge, STATUS_MAP } from './statusBadge.js';
export { AmountHero } from './amountHero.js';
export { PhotoCapture } from './photoCapture.js';
export { MapPinPicker } from './mapPinPicker.js';
export { CardList } from './cardList.js';
export { TierLadder, DEFAULT_TIERS } from './tierLadder.js';
export { ReadAloud, speak, stopSpeaking, isSpeechSupported } from './readAloud.js';
