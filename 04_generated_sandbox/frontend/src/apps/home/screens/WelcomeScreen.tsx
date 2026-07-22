import { Button, Card, Checklist, Icon, ReadAloud } from '../../../shared/ui';
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
  return (
    <div class="scr">
      <h1 class="scr__title">Parcels, without an address</h1>
      <p class="scr__lede">
        Send it to a shop. Collect it from a shop. Pay at the counter. SeeBuyGet is the network of shops, drivers and hubs that
        moves it in between.
      </p>

      <div class="scr__cta">
        <a class="btn btn--primary btn--full" href="/send/">
          Send or track a parcel
          <Icon name="chevronRight" size={20} class="btn__chev" />
        </a>
      </div>

      <Button variant="outline" onClick={() => actions.go('roles')}>
        Earn with SeeBuyGet
      </Button>

      <Card title="How it works" tone="soft">
        <Checklist
          items={[
            'See the price before you send — no account needed',
            'Drop it at a shop near you, pay there',
            'The person collecting gets a code by message',
          ]}
        />
      </Card>

      <div class="rows" role="list">
        <a class="row" href="/send/">
          <span class="row__ic">
            <Icon name="search" size={24} />
          </span>
          <span class="row__body">
            <span class="row__t">Where is my parcel?</span>
            <span class="row__s">Track it with the code from your message</span>
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
            <span class="row__t">I already work with SeeBuyGet</span>
            <span class="row__s">Open your shop, driver, hub, store or fleet app</span>
          </span>
          <span class="row__end">
            <Icon name="chevronRight" size={22} />
          </span>
        </button>
      </div>

      <div class="scr__foot">
        <ReadAloud text={welcomeSpoken} label="Read this aloud" />
      </div>
    </div>
  );
}
