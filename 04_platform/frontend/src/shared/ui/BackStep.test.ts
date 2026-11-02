import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/*
 * THE PHONE'S BACK STEPS BACK THROUGH A WIZARD (2026-11-02). A sign-up or set-up is not a stack of screens, so the
 * phone's Back left it from any step. Each step that has a way back now holds one Back (shared/ui/BackStep.tsx, keyed by
 * the step so every step is its own entry; the back stack itself is tested in shared/nav.test.ts).
 */
const src = (f: string) => readFileSync(`src/${f}`, 'utf8');

describe('the phone’s Back, step by step', () => {
  it('is held by the signed-out bar wherever it shows Back, keyed by the step', () => {
    expect(src('shared/ui/BackStep.tsx')).toMatch(/useBackLayer\(true, back\)/);
    expect(src('shared/ui/SignedOutBar.tsx')).toMatch(/\{onBack \? <BackStep key=\{backKey \?\? 'back'\} back=\{onBack\} \/> : null\}/);
  });

  it('steps back through every sign-up and sign-in of several steps', () => {
    const keyed: Record<string, RegExp> = {
      'apps/home/screens/JoinScreen.tsx': /backKey=\{state\.step\}/,
      'apps/driver/screens/SignInScreen.tsx': /backKey=\{step\}/,
      'apps/agent/screens/StaffSignIn.tsx': /backKey=\{step\}/,
      'apps/business/screens/SignInScreen.tsx': /backKey=\{step\}/,
      'apps/genesis/screens/AuthScreen.tsx': /backKey=\{state\.authStep\}/,
    };
    for (const [file, key] of Object.entries(keyed)) expect({ file, keyed: key.test(src(file)) }).toEqual({ file, keyed: true });
    // The business set-up's own Back buttons: the phone's Back follows them.
    expect(src('apps/business/screens/ChooseScreen.tsx')).toMatch(/\{back \? <BackStep key=\{step\} back=\{\(\) => go\(back\)\} \/> : null\}/);
  });
});
