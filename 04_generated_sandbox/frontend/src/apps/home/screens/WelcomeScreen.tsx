import { Button, Card, Checklist, Icon, ReadAloud } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { welcomeSpoken } from '../logic';
import type { HomeActions } from '../useHomeApp';

export interface WelcomeScreenProps {
  actions: HomeActions;
}

/**
 * The front door. A visitor arrives knowing one of two things: they have a parcel in
 * play, or they want to earn. Everything else is a sub-choice, so the screen offers
 * exactly those two and nothing more.
 */
export function WelcomeScreen({ actions }: WelcomeScreenProps) {
  const t = useT();
  return (
    <div class="scr">
      <h1 class="scr__title">{t('home.welcome.title')}</h1>
      <p class="scr__lede">{t('home.welcome.lede')}</p>

      <div class="scr__cta">
        <a class="btn btn--primary btn--full" href="/send/">
          {t('home.welcome.sendTrack')}
          <Icon name="chevronRight" size={20} class="btn__chev" />
        </a>
      </div>

      <Button variant="outline" onClick={() => actions.go('roles')}>
        {t('home.welcome.earn')}
      </Button>

      <Card title={t('home.welcome.howTitle')} tone="soft">
        <Checklist
          items={[
            t('home.welcome.how1'),
            t('home.welcome.how2'),
            t('home.welcome.how3'),
          ]}
        />
      </Card>

      <div class="rows" role="list">
        <a class="row" href="/send/">
          <span class="row__ic">
            <Icon name="search" size={24} />
          </span>
          <span class="row__body">
            <span class="row__t">{t('home.welcome.trackTitle')}</span>
            <span class="row__s">{t('home.welcome.trackSub')}</span>
          </span>
          <span class="row__end">
            <Icon name="chevronRight" size={22} />
          </span>
        </a>
        <button type="button" class="row" onClick={() => actions.go('signin')}>
          <span class="row__ic">
            <Icon name="key" size={24} />
          </span>
          <span class="row__body">
            <span class="row__t">{t('home.welcome.haveAccount')}</span>
            <span class="row__s">{t('home.welcome.haveAccountSub')}</span>
          </span>
          <span class="row__end">
            <Icon name="chevronRight" size={22} />
          </span>
        </button>
      </div>

      <div class="scr__foot">
        <ReadAloud text={() => welcomeSpoken(t)} label={t('home.readAloud')} />
      </div>
    </div>
  );
}
