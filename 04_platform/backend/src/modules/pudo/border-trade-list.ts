/**
 * 2026-11-10 — THE COMMON LIST OF GOODS, KENYA–ETHIOPIA ONLY: the annex to the Ethiopia and Kenya Border Trade Directive
 * No. 1144/2026 (the owner: "ok" — to extracting it from the Directive itself, as the ground for border traders). Copied
 * from the Directive as registered (justice.gov.et, July 2026), never from a secondary list: the names, the HS codes and the
 * caps exactly as printed, numbered as printed.
 *
 * WHERE A PRINTED CODE DOES NOT FIT ITS GOODS, IT IS KEPT AS PRINTED AND SAID BESIDE IT (`noted`): the Directive is the law,
 * our reading of the HS nomenclature is not. Which of the two governs at the post — the words or the code — is legal.html
 * L47, for a broker. Until then a line is matched on either.
 *
 * Nothing reads this yet: border traders are built once a broker answers how Kenya licenses them (L41).
 */
export const BORDER_TRADE_DIRECTIVE = {
  title: 'Ethiopia and Kenya Border Trade Directive',
  number: '1144/2026',
  issuedBy: 'Ministry of Trade and Regional Integration of Ethiopia',
  /** The bilateral Simplified Border Trade Regime it implements, signed in Addis Ababa. */
  regimeSigned: '2025-12-19',
  source: 'https://justice.gov.et/wp-content/uploads/2026/07/1144_Ethiopia_and_Kenya_Border_Trade_Directive_No_1144_2026.pdf',
  /** Art. 2(1): the border area — 50 km on the Ethiopian side, 100 km on the Kenyan side, from the border post. */
  borderAreaKm: { ET: 50, KE: 100 },
  /** Art. 5(2): what one trader exports or imports in a month, at most — or its equal in birr or shillings. */
  monthlyLimitUsd: 1000,
  /** Art. 5(3): trips in a month, the value cap still holding. */
  tripsPerMonth: 4,
} as const;

export interface CommonListItem {
  /** Its number in the annex. */
  no: number;
  /** As printed. */
  name: string;
  /** The HS codes as printed (headings, subheadings, a chapter), digits only. */
  hs: string[];
  /** As printed: the most one trader brings in one consignment. */
  cap?: { count: number; unit: string } | { kg: number; unit: string };
  /** Where the printed code does not fit the goods named, by the HS nomenclature: said, never corrected (L47). */
  noted?: string;
}

const each = (count: number, unit: string) => ({ count, unit });

export const COMMON_LIST: readonly CommonListItem[] = [
  { no: 1, name: 'Camel', hs: ['01061300'], cap: each(2, 'camels') },
  { no: 2, name: 'Ox', hs: ['01022910'], cap: each(2, 'oxen') },
  { no: 3, name: 'Goat', hs: ['01042000'], cap: each(5, 'goats') },
  { no: 4, name: 'Sheep', hs: ['01041000'], cap: each(5, 'sheep') },
  { no: 5, name: 'Chick', hs: ['01059'], noted: 'Printed 0105.9 (poultry over 185 g); chicks are 0105.11–0105.15 (not over 185 g).' },
  { no: 6, name: 'Fish and fish products', hs: ['0302'], noted: 'Heading 0302 is fresh or chilled fish only; frozen (0303), fillets (0304) and dried or smoked fish (0305) are other headings.' },
  { no: 7, name: 'Milk', hs: ['0401', '0402'] },
  { no: 8, name: 'Yoghurt', hs: ['0403'] },
  { no: 9, name: 'Butter', hs: ['040510'] },
  { no: 10, name: 'Cheese', hs: ['040590'], noted: 'Printed 0405.90 (other milk fats, such as ghee); cheese is heading 0406.' },
  { no: 11, name: 'Natural honey', hs: ['040900'] },
  { no: 12, name: 'Egg', hs: ['0407'] },
  { no: 13, name: 'Edible Vegetables', hs: ['0701', '0702', '0703', '0704', '0705', '0706'], noted: 'Potatoes, tomatoes, onions and garlic, cabbages, lettuce, carrots and other roots: beans and peas (0708) are not among them.' },
  { no: 14, name: 'Edible Fruit', hs: ['0803', '0804', '0805', '0806', '0807', '0808'] },
  { no: 15, name: 'Pepper', hs: ['090411', '090412'] },
  { no: 16, name: 'Spices', hs: ['091091', '091099'] },
  { no: 17, name: 'Ginger', hs: ['091011', '091012'] },
  { no: 18, name: 'Tea', hs: ['0902'] },
  { no: 19, name: 'Maize (corn)', hs: ['1005'], cap: { kg: 100, unit: 'quintal' } },
  { no: 20, name: 'Rice', hs: ['1006'] },
  { no: 21, name: 'Millet', hs: ['100821', '100829'] },
  { no: 22, name: 'Flour', hs: ['1101', '1102', '1103'] },
  { no: 23, name: 'Cooking and edible oil', hs: ['150990'], noted: 'Printed 1509.90, an olive oil subheading; sunflower (1512), palm (1511) and soya oil (1507) are other headings.' },
  { no: 24, name: 'Candy', hs: ['170490'] },
  { no: 25, name: 'Chewing gum', hs: ['170410'] },
  { no: 26, name: 'Fruit juices', hs: ['2009'] },
  { no: 27, name: 'Powder juice sachets', hs: ['2009'], noted: 'Printed 2009 (fruit juices); a powdered drink mix is usually classified under 2106.' },
  { no: 28, name: 'Baking powder and yeasts', hs: ['2102'] },
  { no: 29, name: 'Water', hs: ['220110', '220190'] },
  { no: 30, name: 'Soft Drink', hs: ['220299'] },
  { no: 31, name: 'Beer', hs: ['2203'] },
  { no: 32, name: 'Alcoholic Drink', hs: ['2208'] },
  { no: 33, name: 'Salt', hs: ['250100'] },
  { no: 34, name: 'Cosmetics', hs: ['330300', '3304', '3305', '3306'] },
  { no: 35, name: 'Detergent', hs: ['340100'], noted: 'Printed 3401.00 (soap); detergents are heading 3402.' },
  { no: 36, name: 'Soap', hs: ['3401'] },
  { no: 37, name: 'Candles', hs: ['340600'] },
  { no: 38, name: 'Hide and skin', hs: ['41'] },
  { no: 39, name: 'Leather and leather products', hs: ['42'] },
  { no: 40, name: 'Home décor products (curtain and carpet)', hs: ['570110', '570190'], noted: 'Printed 5701 (knotted carpets); curtains are heading 6303, other carpets 5702–5705.' },
  { no: 41, name: 'Women’s or girl’s cloth', hs: ['6203', '6205', '6207'], noted: 'Printed 6203, 6205, 6207 — the headings for MEN’s or boys’ garments; women’s or girls’ are 6204, 6206, 6208.' },
  { no: 42, name: 'Men’s or boy’s cloth', hs: ['6204', '6206', '6208'], noted: 'Printed 6204, 6206, 6208 — the headings for WOMEN’s or girls’ garments; men’s or boys’ are 6203, 6205, 6207.' },
  { no: 43, name: 'Children’s cloth, including pamper', hs: ['6209'], noted: 'Heading 6209 is babies’ garments; nappies (pampers) are 9619.' },
  { no: 44, name: 'Mosquito nets', hs: ['630491', '630492'], noted: 'Printed 6304.91–92 (other furnishing articles); treated bed nets have their own subheading, 6304.20.' },
  { no: 45, name: 'Footwear', hs: ['6404'], noted: 'Heading 6404 is footwear with textile uppers only; rubber or plastic (6402) and leather (6403) are other headings.' },
  { no: 46, name: 'Aluminum products', hs: ['7615'] },
  { no: 47, name: 'Telephone sets', hs: ['851711', '851712'], noted: 'Printed 8517.12, a 2017 subheading: since HS 2022 mobile phones are 8517.13 (smartphones) and 8517.14.' },
  { no: 48, name: 'Mattresses & Mattress supports', hs: ['9404'] },
  { no: 49, name: 'Furniture', hs: ['9403'] },
  { no: 50, name: 'Stationeries (pens and pencils; Exercise books)', hs: ['9608', '9609', '482020'] },
];

/**
 * The item on the list a declared HS code falls under, by the longest printed code it starts with — or none. A code as
 * printed is matched as printed (L47): a cheese declared at 0406 falls under no printed code, and is said so, not guessed.
 */
export function commonListItemFor(hsCode: string): CommonListItem | undefined {
  const digits = hsCode.replace(/\D/g, '');
  let best: { item: CommonListItem; length: number } | undefined;
  for (const item of COMMON_LIST) {
    for (const code of item.hs) {
      if (digits.startsWith(code) && (!best || code.length > best.length)) best = { item, length: code.length };
    }
  }
  return best?.item;
}
