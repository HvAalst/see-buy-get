/**
 * CL4 — the console's view of who moves loads.
 *
 * `moves` is the SAME object the public profile page carries. Typed from the contract rather than
 * re-declared, so the two cannot drift: the moment an operator's screen can disagree with the page a
 * shipper reads, the public one stops being worth anything.
 */
import type { components } from '../../lib/sbg/schema';

export type MoversView = components['schemas']['MoversView'];
export type MoverRow = components['schemas']['MoverRow'];
export type MoverHandBack = components['schemas']['MoverHandBack'];
