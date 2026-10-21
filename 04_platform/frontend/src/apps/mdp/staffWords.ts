import type { MessageKey } from '../../shared/i18n';

/*
 * A HUB'S PEOPLE, IN A HUB'S WORDS (the ISO 28000 check: "a hub's own people by name"). The hub app reuses the shop's
 * sign-in for its people and the shop owner's people sheet; these are the lines that say "counter" or "shop" there.
 */

export const HUB_STAFF_WORDS: Partial<Record<MessageKey, MessageKey>> = {
  'agent.staff.loginLede': 'mdp.staff.loginLede',
  'agent.staff.pinLede': 'mdp.staff.pinLede',
  'agent.staff.placesTitle': 'mdp.staff.placesTitle',
  'agent.staff.placesLede': 'mdp.staff.placesLede',
  'agent.staff.noPlaces': 'mdp.staff.noPlaces',
  'agent.staff.noPlacesDetail': 'mdp.staff.noPlacesDetail',
  'agent.staff.ownerInstead': 'mdp.staff.ownerInstead',
};

export const HUB_PEOPLE_WORDS: Partial<Record<MessageKey, MessageKey>> = {
  'agent.people.title': 'mdp.people.title',
  'agent.people.lede': 'mdp.people.lede',
  'agent.people.none': 'mdp.people.none',
  'agent.people.logLede': 'mdp.people.logLede',
  'agent.people.logEmpty': 'mdp.people.logEmpty',
};
