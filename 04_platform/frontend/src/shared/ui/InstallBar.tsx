import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { useT, type MessageKey } from '../i18n';
import { useInstall, type InstallPlatform, type InstallState } from '../install';
import { Button } from './Button';
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import { AllowPicture, AndroidAppInfoPicture, AndroidBatteryPicture, AndroidHoldPicture, AndroidInstallPicture, AndroidNotificationsPicture, IosAddPicture, IosSettingsPicture } from './InstallPictures';

/**
 * 2026-11-02 — THE CALL TO INSTALL, pinned under the top bar of every app that installs until it is installed (the owner:
 * "sticky until the moment the app is installed"). Tapping it does not install: it opens the sheet below, which says
 * what installing gives and shows how, then how to let the app's notifications through.
 */
/** The apps that install, by their folder's name: each is named in the words ("Shop", "Hub" …). */
export type InstallApp = 'agent' | 'mdp' | 'driver' | 'fleet' | 'vendor' | 'send';
const nameOf = (t: (k: MessageKey) => string, app: InstallApp) => t(`install.app.${app}` as MessageKey);

export function InstallBar({ app: key }: { app: InstallApp }) {
  const t = useT();
  const app = nameOf(t, key);
  const install = useInstall();
  const [open, setOpen] = useState(false);
  if (!install.offer && !open) return null;
  return (
    <>
      {install.offer ? (
        <button type="button" class="installbar" aria-haspopup="dialog" onClick={() => setOpen(true)}>
          <span class="installbar__ic" aria-hidden="true">
            <Icon name="arrowUp" size={20} />
          </span>
          <span class="installbar__body">
            <span class="installbar__t">{t('install.bar.title', { app })}</span>
            <span class="installbar__s">{t('install.bar.sub')}</span>
          </span>
          <span class="installbar__how">
            {t('install.bar.how')}
            <Icon name="chevronRight" size={18} />
          </span>
        </button>
      ) : null}
      <InstallSheet open={open} onClose={() => setOpen(false)} app={key} install={install} />
    </>
  );
}

/**
 * 2026-11-02 — THE MOST OUT OF THE APP, from the account menu once the bar has gone: the same sheet, its install step left
 * out when the app is already on the home screen. Notifications can be turned off later, or held back by the battery,
 * long after the day it was installed.
 */
export function InstallGuideSheet({ open, onClose, app }: { open: boolean; onClose: () => void; app: InstallApp }) {
  const install = useInstall();
  return <InstallSheet open={open} onClose={onClose} app={app} install={install} />;
}

/** One step: its number, its title, and its pictures each with the words that say what to tap. */
function Step({ n, title, children }: { n: number; title: string; children: JSX.Element | JSX.Element[] | null }) {
  return (
    <section class="iguide__step">
      <h3 class="iguide__h">
        <span class="iguide__n" aria-hidden="true">
          {n}
        </span>
        {title}
      </h3>
      {children}
    </section>
  );
}

function Shot({ picture, text }: { picture: () => JSX.Element; text: string }) {
  const Picture = picture;
  return (
    <figure class="iguide__shot">
      <Picture />
      <figcaption class="iguide__cap">{text}</figcaption>
    </figure>
  );
}

/** Which steps the sheet shows, in order — for the phone in hand, and without installing what is installed. */
export function guideSteps(platform: Exclude<InstallPlatform, 'other'>, installed: boolean): Array<'home' | 'allow' | 'fix' | 'battery'> {
  return [...(installed ? [] : (['home'] as const)), 'allow', 'fix', ...(platform === 'android' ? (['battery'] as const) : [])];
}

export function InstallSheet({ open, onClose, app: key, install }: { open: boolean; onClose: () => void; app: InstallApp; install: InstallState }) {
  const t = useT();
  const app = nameOf(t, key);
  // The phone in hand, or the other one — somebody may be setting up a colleague's.
  const [phone, setPhone] = useState<'android' | 'ios'>(install.platform === 'ios' ? 'ios' : 'android');
  const [said, setSaid] = useState<string | null>(null);
  const steps = guideSteps(phone, install.installed);
  const android = phone === 'android';

  const installNow = async () => {
    const r = await install.install();
    if (r === 'accepted') onClose();
    else setSaid(t(r === 'dismissed' ? 'install.result.dismissed' : 'install.result.unavailable'));
  };

  return (
    <Sheet open={open} onClose={onClose} title={t('install.sheet.title', { app })}>
      <p class="iguide__lede">{t(install.installed ? 'install.sheet.ledeInstalled' : 'install.sheet.lede')}</p>
      <div class="tapset iguide__phone" role="group" aria-label={t('install.platform.label')}>
        {(['android', 'ios'] as const).map((p) => (
          <button key={p} type="button" class={`tapset__btn${phone === p ? ' tapset__btn--on' : ''}`} aria-pressed={phone === p} onClick={() => setPhone(p)}>
            {t(`install.platform.${p}`)}
          </button>
        ))}
      </div>

      {steps.map((step, i) => {
        const n = i + 1;
        if (step === 'home')
          return (
            <Step key={step} n={n} title={t('install.step.home.title')}>
              {android ? (
                <>
                  <Shot picture={AndroidInstallPicture} text={t(install.canPrompt ? 'install.step.home.androidPrompt' : 'install.step.home.android')} />
                  {install.canPrompt ? (
                    <Button chevron={false} onClick={() => void installNow()}>
                      {t('install.now')}
                    </Button>
                  ) : null}
                </>
              ) : (
                <Shot picture={IosAddPicture} text={t('install.step.home.ios')} />
              )}
            </Step>
          );
        if (step === 'allow')
          return (
            <Step key={step} n={n} title={t('install.step.allow.title')}>
              <Shot picture={AllowPicture} text={t(android ? 'install.step.allow.text' : 'install.step.allow.ios')} />
            </Step>
          );
        if (step === 'fix')
          return (
            <Step key={step} n={n} title={t('install.step.fix.title')}>
              {android ? (
                <>
                  <Shot picture={AndroidHoldPicture} text={t('install.step.fix.hold')} />
                  <Shot picture={AndroidAppInfoPicture} text={t('install.step.fix.info')} />
                  <Shot picture={AndroidNotificationsPicture} text={t('install.step.fix.on')} />
                </>
              ) : (
                <Shot picture={IosSettingsPicture} text={t('install.step.fix.ios', { app })} />
              )}
            </Step>
          );
        return (
          <Step key={step} n={n} title={t('install.step.battery.title')}>
            <Shot picture={AndroidBatteryPicture} text={t('install.step.battery.text')} />
          </Step>
        );
      })}

      {said ? (
        <p class="iguide__said" role="status">
          {said}
        </p>
      ) : null}
      {!install.installed && install.offer ? (
        <Button
          variant="outline"
          chevron={false}
          onClick={() => {
            install.markInstalled();
            onClose();
          }}
        >
          {t('install.done')}
        </Button>
      ) : null}
      <Button variant="link" onClick={onClose}>
        {t('common.close')}
      </Button>
    </Sheet>
  );
}
