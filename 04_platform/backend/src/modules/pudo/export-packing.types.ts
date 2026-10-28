import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBase64, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * THE PACKING LIST, IMPORTED (the user, 2026-10-28: "a matter of moving data and eliminating steps … a shipper doesn't
 * want to import by hand especially if the packing list is long and detailed, that should be dynamic and adaptable";
 * then, as recommended: import it, the letter summarises it).
 *
 * The detailed list of what is in the box, line by line, from the shipper's own file — its system's export as a
 * workbook or CSV, cells pasted from a spreadsheet, or rows its system sends with its key. Columns are recognised by
 * their headings; any the shipper matches by hand are remembered for that business, so the next file just works;
 * columns we have no field for (a batch, a lot, an expiry, a size) are KEPT and printed, never dropped. The letter of
 * instruction's goods lines are worked out from it. Signed, it stops changing, as the letter does.
 */

/** What a column can be. `keep` prints it as it is under its own heading; `ignore` leaves it out. */
/**
 * The invoice's own columns are read from the same file (2026-10-28, the commercial invoice drawn from the same lines):
 * `unitPrice`, `lineValue`, `originCountry`. Prices are kept for the invoice and never printed on the packing list.
 */
export const PACKING_FIELDS = ['marks', 'itemCode', 'description', 'hsCode', 'quantity', 'unit', 'packages', 'packageKind', 'netKg', 'grossKg', 'volumeM3', 'lengthCm', 'widthCm', 'heightCm', 'unitPrice', 'lineValue', 'originCountry'] as const;
export type PackingField = (typeof PACKING_FIELDS)[number];
export type PackingColumnUse = PackingField | 'keep' | 'ignore';
export const PACKING_USES: readonly PackingColumnUse[] = [...PACKING_FIELDS, 'keep', 'ignore'];
/** The longest list kept: a detailed packing list of a full box, with room to spare. */
export const MAX_PACKING_LINES = 3_000;

/** One line of the list, as it will be printed. */
export class PackingLine {
  @ApiPropertyOptional() marks?: string;
  @ApiPropertyOptional() itemCode?: string;
  @ApiProperty() description: string;
  /** The shipper's own HS code — we never classify. */
  @ApiPropertyOptional() hsCode?: string;
  @ApiPropertyOptional() quantity?: number;
  @ApiPropertyOptional() unit?: string;
  @ApiProperty() packages: number;
  @ApiPropertyOptional() packageKind?: string;
  @ApiPropertyOptional() netKg?: number;
  @ApiPropertyOptional() grossKg?: number;
  @ApiPropertyOptional() volumeM3?: number;
  @ApiPropertyOptional() lengthCm?: number;
  @ApiPropertyOptional() widthCm?: number;
  @ApiPropertyOptional() heightCm?: number;
  /** For the commercial invoice: the price of one unit (or of one package where no quantity is given), and the line's value. */
  @ApiPropertyOptional() unitPrice?: number;
  @ApiPropertyOptional() lineValue?: number;
  /** Where the goods on this line were made, as the shipper wrote it. */
  @ApiPropertyOptional() originCountry?: string;
  /** The columns kept as they are, by their heading. */
  @ApiPropertyOptional() extra?: Record<string, string>;
}

/** How one heading of the file was read, and why: its own words, what the business matched before, or what it chose now. */
export class PackingColumn {
  @ApiProperty() heading: string;
  @ApiProperty({ enum: PACKING_USES }) use: PackingColumnUse;
  @ApiProperty({ enum: ['heading', 'remembered', 'chosen', 'kept'] }) because: 'heading' | 'remembered' | 'chosen' | 'kept';
  /** A unit read off the heading and converted from: lb, g, cubic feet, litres. */
  @ApiPropertyOptional() convertedFrom?: string;
}

export class PackingTotals {
  @ApiProperty() lines: number;
  @ApiProperty() packages: number;
  @ApiProperty() grossKg: number;
  @ApiProperty() netKg: number;
  @ApiProperty() volumeM3: number;
}

export class PackingProblem {
  /** The row as the spreadsheet numbers it. */
  @ApiProperty() row: number;
  @ApiProperty() says: string;
}

/** A file read, before anything is kept: how its columns were read, what it holds, and what is wrong with it. */
export class PackingCheck {
  @ApiProperty({ type: [PackingColumn] }) columns: PackingColumn[];
  /** The row its headings were found on — a company's own heading block above the table is passed by. */
  @ApiProperty() headingRow: number;
  @ApiProperty({ type: PackingTotals }) totals: PackingTotals;
  /** The first lines, as they will be kept. */
  @ApiProperty({ type: [PackingLine] }) preview: PackingLine[];
  /** Lines that cannot be kept as they are — the list is not imported while there are any. */
  @ApiProperty({ type: [PackingProblem] }) problems: PackingProblem[];
  /** What is worth knowing and does not stop it: a column missing, a total row passed by, the weight against the box. */
  @ApiProperty({ type: [String] }) notes: string[];
  @ApiPropertyOptional() sheet?: string;
  @ApiPropertyOptional() refusal?: string;
  /** A currency the price columns' headings name — "Unit price (USD)", "Value €" — offered to the invoice. */
  @ApiPropertyOptional() currency?: string;
  @ApiProperty() imported: boolean;
}

export class PackingVersion {
  @ApiProperty() version: number;
  @ApiProperty() signedBy: string;
  @ApiProperty() signedAt: string;
  /** sha256 of the frozen page's bytes. */
  @ApiProperty() fingerprint: string;
  @ApiProperty() lines: number;
  @ApiProperty() packages: number;
}

/** The list as it is held: the lines (its draft), where they came from, and the versions signed. */
export class ExportPacking {
  @ApiProperty({ type: [PackingLine] }) lines: PackingLine[];
  /** The kept columns' headings, in the file's order. */
  @ApiProperty({ type: [String] }) extraColumns: string[];
  @ApiProperty({ enum: ['workbook', 'text', 'rows'] }) source: 'workbook' | 'text' | 'rows';
  @ApiPropertyOptional() sourceName?: string;
  @ApiPropertyOptional() currency?: string;
  @ApiProperty() importedAt: string;
  @ApiProperty() importedBy: string;
  @ApiProperty({ type: [PackingVersion] }) versions: PackingVersion[];
}

/** The list as a reader sees it on the export. */
export class ExportPackingView {
  @ApiProperty() lineCount: number;
  @ApiProperty({ type: PackingTotals }) totals: PackingTotals;
  @ApiProperty({ type: [PackingLine] }) preview: PackingLine[];
  @ApiProperty({ type: [String] }) extraColumns: string[];
  @ApiProperty({ type: [PackingVersion] }) versions: PackingVersion[];
  @ApiProperty() importedAt: string;
  @ApiProperty() importedBy: string;
  @ApiPropertyOptional() sourceName?: string;
  /** The draft differs from the last signed version: sign it again for the forwarder to hold this one. */
  @ApiProperty() unsigned: boolean;
  @ApiProperty({ type: [String] }) notes: string[];
}

/* -------------------------------------------------------------------- requests -- */

export class PackingImportDto {
  /** A CSV file's text, or cells pasted from a spreadsheet (tab-separated). */
  @IsOptional() @IsString() @MaxLength(3_000_000) text?: string;
  /** An .xlsx workbook, base64 — a megabyte of workbook at most. */
  @IsOptional() @IsBase64() @MaxLength(1_400_000) workbook?: string;
  /** Rows a system sends, the headings first — read exactly as a sheet is. */
  @IsOptional() @IsArray() @ArrayMaxSize(3_001) rows?: string[][];
  /** Headings matched by hand: heading → a field, `keep` or `ignore`. Remembered for the business on import. */
  @IsOptional() @IsObject() mapping?: Record<string, string>;
  /** The file's name, said back on the export. */
  @IsOptional() @IsString() @MaxLength(160) sourceName?: string;
}

export class PackingSignDto {
  @IsString() @MaxLength(120) signatory!: string;
}
