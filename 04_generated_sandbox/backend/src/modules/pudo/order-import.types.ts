import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/*
 * P1b — what checking or importing a sheet of orders answers with. In a .types file because the API contract is
 * emitted from those: the same classes inside the service published only their decorated fields.
 */

export const IMPORT_VERDICTS = ['ok', 'duplicate', 'problem'] as const;
export type ImportVerdict = (typeof IMPORT_VERDICTS)[number];

/** One line of the sheet, judged. */
export class OrderImportRow {
  /** The line as a person counts it: the header is line 1. */
  line: number;
  reference: string;
  description: string;
  weightKg: number;
  dest: string;
  deliverOn: string;
  /**
   * `ok` it can be (or was) imported · `duplicate` an order with this number is already under the contract, so it is
   * left alone · `problem` it is not imported, and `problems` says why.
   */
  @ApiProperty({ enum: IMPORT_VERDICTS }) verdict: ImportVerdict;
  @ApiProperty({ type: [String] }) problems: string[];
  /** Whether the delivery address has a point on the map. An order without one is imported, and cannot be planned until it has. */
  located: boolean;
  /** The order's code, once imported. */
  @ApiPropertyOptional() code?: string;
}

export class OrderImportResult {
  /** Why the sheet as a whole could not be read. Then there are no rows. */
  @ApiPropertyOptional() refusal?: string;
  /** Whether anything was created: false for a check, true for an import. */
  imported: boolean;
  @ApiProperty({ type: [OrderImportRow] }) rows: OrderImportRow[];
  ok: number;
  duplicates: number;
  problems: number;
  unlocated: number;
  /** Which of the sheet's own headings was read as what, and which were made nothing of. */
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } }) columns: Record<string, string>;
  @ApiProperty({ type: [String] }) ignored: string[];
  /** For a workbook: the sheet that was read — only ever the first — and the names of the ones that were not. */
  @ApiPropertyOptional() sheet?: string;
  @ApiPropertyOptional({ type: [String] }) otherSheets?: string[];
}
