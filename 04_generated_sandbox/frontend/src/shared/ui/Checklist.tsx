import { Icon } from './Icon';

export interface ChecklistProps {
  /** Short reassurance lines — what will happen, in plain language. */
  items: string[];
}

/**
 * The reassurance list. Its orange ticks are the only orange marks in the system:
 * orange is never a panel, never a button, never a heading. Keeping it to one job
 * is what makes it read as "done / confirmed" at a glance without any reading.
 */
export function Checklist({ items }: ChecklistProps) {
  return (
    <ul class="checklist">
      {items.map((text) => (
        <li class="checklist__item" key={text}>
          <Icon name="check" size={20} class="checklist__tick" />
          <span>{text}</span>
        </li>
      ))}
    </ul>
  );
}
