/**
 * Shared UI kit — the approved SeeBuyGet design contract as components.
 *
 * Importing this module also pulls the component stylesheet, so a screen can never render
 * a half-styled control by forgetting a CSS import.
 */
import './ui.css';

export { Button, type ButtonProps, type ButtonVariant } from './Button';
export { Card, type CardProps } from './Card';
export { Pill, type PillProps, type PillTone } from './Pill';
export { Checklist, type ChecklistProps } from './Checklist';
export { GlanceNumber, type GlanceNumberProps } from './GlanceNumber';
export { SwipeDeck, type SwipeDeckProps } from './SwipeDeck';
export { Sheet, type SheetProps } from './Sheet';
export { TopBar, type TopBarProps } from './TopBar';
export { BottomNav, type BottomNavProps, type NavItem } from './BottomNav';
export { ReadAloud, speak, stopSpeaking, isSpeechSupported, type ReadAloudProps } from './ReadAloud';
export { ErrorNote, Note, errorSentence, type ErrorNoteProps, type NoteProps } from './ErrorNote';
export { Icon, type IconName, type IconProps } from './Icon';
export { BandScale, type BandScaleProps } from './BandScale';
