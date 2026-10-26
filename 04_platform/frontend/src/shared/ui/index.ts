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
export { CheckGate, type CheckGateItem, type CheckGateProps } from './CheckGate';
export { PhotoField, type PhotoFieldProps } from './PhotoField';
export { GlanceNumber, type GlanceNumberProps } from './GlanceNumber';
export { SwipeDeck, type SwipeDeckProps } from './SwipeDeck';
export { Sheet, type SheetProps } from './Sheet';
export { DocumentButton } from './DocumentButton';
export { TopBar, type TopBarProps } from './TopBar';
export { BrandMark, type BrandMarkProps } from './BrandMark';
export { OutboxNote } from './OutboxNote';
export { ConnectivityNote } from './ConnectivityNote';
export { NeedsSignalNote } from './NeedsSignalNote';
export { BottomNav, type BottomNavProps, type NavItem } from './BottomNav';
export { ReadAloud, speak, stopSpeaking, isSpeechSupported, type ReadAloudProps } from './ReadAloud';
export { LanguageSwitcher } from './LanguageSwitcher';
export { ErrorNote, Note, RefusalNote, errorSentence, refusalSentence, type ErrorNoteProps, type NoteProps } from './ErrorNote';
export { TopUpCostNote } from './TopUpCostNote';
export { Explainer, ExplainerBlock, ExplainerReset } from './Explainer';
export { Icon, type IconName, type IconProps } from './Icon';
export { Info, type InfoProps } from './Info';
export { Abbr, Abbreviated } from './Abbr';
export { CallButton } from './CallButton';
export { HubReach } from './HubReach';
export { OptionInfo, type OptionHelpItem, type OptionInfoProps } from './OptionInfo';
export { OptionPicker, type OptionPickerProps, type PickerOption } from './OptionPicker';
export { NotificationBell, type NotificationBellProps } from './NotificationBell';
export { PushPrompt, type PushPromptProps } from './PushPrompt';
export { OpenInMaps, type OpenInMapsProps } from './OpenInMaps';
export { ShopDetailSheet, type ShopDetailSheetProps } from './ShopDetailSheet';
export { SearchInput, type SearchInputProps } from './SearchInput';
export { Pager, type PagerProps } from './Pager';
export { Checkbox, type CheckboxProps } from './Checkbox';
export { SelectionBar, type SelectionBarProps } from './SelectionBar';
export { Chip, type ChipProps } from './Chip';
export { AuthImage, type AuthImageProps } from './AuthImage';
export { MediaLibrary, type MediaLibraryProps } from './MediaLibrary';
export { BandScale, type BandScaleProps } from './BandScale';
export { CodeBoxes, type CodeBoxesProps } from './CodeBoxes';
export { CodeCard, type CodeCardProps } from './CodeCard';
export { PlaceMap, type PlaceMapLine, type PlaceMapPin, type PlaceMapProps } from './PlaceMap';
export { OsmCredit } from './OsmCredit';
export { PhoneField, type PhoneFieldProps } from './PhoneField';
export { PlacePicker, type PlaceNote, type PlacePickerProps } from './PlacePicker';
export { QrBlock, type QrBlockProps } from './QrBlock';
export { Scanner, type ScannerProps } from './Scanner';
export { ScanField, type ScanFieldProps } from './ScanField';
export { FeedbackFlash } from './FeedbackFlash';
