import { telOf } from '../hubReach';
import { Icon } from './Icon';

/**
 * A NUMBER TO CALL, AS A BUTTON THAT OPENS THE PHONE APP — never printed (the user, 2026-10-26: "the phone number under a
 * button that opens the phone app"). A link and not a button: the phone opens its dialler on it, a computer offers what
 * it has for calls. Its words say who is called, never the number.
 */
export function CallButton({ phone, label, variant = 'outline', full = false }: { phone: string; label: string; variant?: 'outline' | 'link' | 'primary'; full?: boolean }) {
  return (
    <a class={`btn btn--${variant} btn--call${full ? ' btn--full' : ''}`} href={telOf(phone)}>
      <Icon name="phone" size={20} />
      <span>{label}</span>
    </a>
  );
}
