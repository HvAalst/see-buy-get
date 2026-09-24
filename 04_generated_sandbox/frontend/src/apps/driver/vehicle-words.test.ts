import { describe, expect, it } from 'vitest';
import { isRidden, namedVehicleClass, stickerPlace, vehicleWord } from './vehicle-words';
import { t } from '../../shared/i18n'; // English is the base catalog, so the real `t` yields the English literals

/**
 * THE APP SAYS WHAT THE PERSON ACTUALLY RIDES.
 *
 * "My van" was hard-coded for everybody. A bicycle courier has no van, and an app that keeps saying so is
 * telling them quietly and constantly that it was built for somebody else.
 *
 * The map itself is complete BY COMPILATION — its type comes off the generated schema, so an eighth
 * vehicle class on the server stops this app building until somebody writes the word for it. What these
 * tests hold is the part a compiler cannot: that the word is right, and that the sticker instruction stops
 * telling a cyclist to use a dashboard.
 */

describe('naming the app after the registered vehicle', () => {
  it('gives each class its own word', () => {
    expect(vehicleWord('van', t)).toBe('van');
    expect(vehicleWord('bike', t)).toBe('bike');
    expect(vehicleWord('truck', t)).toBe('truck');
    expect(vehicleWord('tuktuk', t)).toBe('tuk-tuk');
  });

  it('falls back to a plain noun rather than guessing, for a class this build has never heard of', () => {
    // A phone running last month's bundle against a server that has learned an eighth class. Slightly
    // generic is honest; "van" would be the exact mistake this replaces, and `undefined` would be a bug.
    expect(vehicleWord('hovercraft', t)).toBe('vehicle');
    expect(vehicleWord(undefined, t)).toBe('vehicle');
  });

  describe('where the sticker goes — the trap the user spotted before it was built', () => {
    it('says dashboard for anything with a cab', () => {
      expect(stickerPlace('van', t)).toBe('dashboard');
      expect(stickerPlace('truck', t)).toBe('dashboard');
      expect(stickerPlace('tuktuk', t)).toBe('dashboard');
    });

    it('never says dashboard to somebody on two wheels', () => {
      // "Put it on the dashboard, where it can be scanned from the driver's seat" is good instruction in a
      // truck and nonsense on a bicycle — and wrong is worse than vague here, because a courier reads it,
      // finds no dashboard, and concludes the sticker is not for them.
      expect(stickerPlace('bike', t)).toBe('frame');
      expect(stickerPlace('motorcycle', t)).toBe('frame');
      expect(isRidden('bike')).toBe(true);
      expect(isRidden('van')).toBe(false);
    });

    it('sends an unknown class to the dashboard wording, which is the safer of the two to be wrong about', () => {
      // A cyclist told "dashboard" is confused. A driver told "frame" about their truck is also confused —
      // but every class this app does not recognise is, by the enum's own history, a bigger vehicle.
      expect(stickerPlace('hovercraft', t)).toBe('dashboard');
    });
  });

  describe('which vehicle the app is named after', () => {
    it('is the one they coupled to this morning', () => {
      expect(namedVehicleClass({ vehicleClass: 'bike' }, [{ vehicleClass: 'truck' }])).toBe('bike');
    });

    it('falls back to what they last drove, so the tab is right BEFORE the shift starts', () => {
      // Off shift there is no coupling, and the tab still has to say something. Most recent first.
      expect(namedVehicleClass(null, [{ vehicleClass: 'bike' }, { vehicleClass: 'van' }])).toBe('bike');
    });

    it('answers nothing for a driver on their first morning, and every caller then says "vehicle"', () => {
      expect(namedVehicleClass(null, [])).toBeUndefined();
      expect(vehicleWord(namedVehicleClass(null, []), t)).toBe('vehicle');
    });
  });
});
