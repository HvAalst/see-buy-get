/**
 * EVERY FILE THIS SERVER TAKES, AND THE MOST OF EACH — in one place (2026-11-02).
 *
 * The owner, 2026-11-02: "if we put a filesize limit, it needs to show or tell. For example I wanted to upload a profile
 * image that was large. It silently refused." A limit that lives in five services and a start-up file is five limits
 * nobody can see together: the apps cannot say it before a file is chosen, and the body parser in front of a route can
 * quietly be smaller than the file the route itself accepts (it was, for every paper but one). So each limit is named
 * here once; the service that enforces it reads it from here, the body parser is sized from it (body-limits.ts), and
 * the apps carry the same numbers under the same names (frontend src/shared/upload.ts — a test there reads this file
 * and refuses a difference).
 *
 * Bytes of the FILE, after its base64 is decoded — not of the request that carries it.
 */
export const UPLOAD_LIMITS = {
  /** A photograph of anything: proof, damage, a seal, a paper, a face. The phone makes it smaller before it is sent. */
  photo: 500 * 1024,
  /** The small copy of a photograph the media grid shows. */
  photoThumb: 64 * 1024,
  /** A help illustration an administrator curates: a diagram, fetched by every clerk on every booking. */
  helpPicture: 150 * 1024,
  /** A company's paper: a registration certificate, a licence, a policy, a proforma — a PDF or a photo of one. */
  document: 8 * 1024 * 1024,
  /** What shows a paper is wrong: a screenshot, a photograph, a scan at most. */
  evidence: 6 * 1024 * 1024,
  /** A voice message in a conversation: about two minutes at a phone's bitrate. */
  voice: 900_000,
  /** A spreadsheet (.xlsx) of orders or of a packing list. */
  workbook: 1_000_000,
  /** A sheet of orders pasted or sent as text (CSV), in characters — ImportOrdersDto.text. */
  orderSheetText: 1_500_000,
  /** A packing list pasted or sent as text, in characters — PackingImportDto.text. */
  packingText: 3_000_000,
  /** A country's official areas as a boundary file (GeoJSON), in characters — ImportZoneAreasDto.geojson. About a ward map's twice. */
  zoneAreasText: 6_000_000,
} as const;

export type UploadLimitName = keyof typeof UPLOAD_LIMITS;
