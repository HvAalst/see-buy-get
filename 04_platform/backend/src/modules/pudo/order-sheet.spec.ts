import { MAX_SHEET_ROWS, ORDER_SHEET_TEMPLATE, cellsOf, dayOfCell, delimiterOf, kilosOf, readOrderSheet } from './order-sheet';

/**
 * P1b — A SHEET OF ORDERS, READ. The sheets that go wrong are the point: a spreadsheet is typed by people, exported
 * by whatever they use, and pasted from wherever it was. What is pinned is that every line gets a verdict in words,
 * and that nothing is read by guessing.
 */
describe('reading a sheet of orders', () => {
  const TODAY = '2026-10-05';

  describe('cells', () => {
    it('reads commas, semicolons and pasted tabs, and tells them apart from the first line', () => {
      expect(delimiterOf('a,b,c\n1,2,3')).toBe(',');
      expect(delimiterOf('a;b;c\n1;2;3')).toBe(';');
      expect(delimiterOf('a\tb,c\n1\t2')).toBe('\t');
    });
    it('keeps a quoted cell whole — its delimiter, its doubled quote, its line break', () => {
      expect(cellsOf('ref,goods\nA1,"Bricks, 4 pallets"\nA2,"12"" pipe"\nA3,"two\nlines"')).toEqual([
        ['ref', 'goods'],
        ['A1', 'Bricks, 4 pallets'],
        ['A2', '12" pipe'],
        ['A3', 'two\nlines'],
      ]);
    });
    it('drops blank lines and a byte-order mark, and trims what people leave around a value', () => {
      expect(cellsOf('﻿ref , goods\r\n\r\n A1 ,  Sand \r\n,\r\n')).toEqual([
        ['ref', 'goods'],
        ['A1', 'Sand'],
      ]);
    });
  });

  describe('one value', () => {
    it('reads a weight the ways people type one, and nothing that is not one', () => {
      expect(kilosOf('4000')).toBe(4000);
      expect(kilosOf('4 000 kg')).toBe(4000);
      expect(kilosOf('4,000')).toBe(4000);
      expect(kilosOf('1,234.5')).toBe(1234.5);
      expect(kilosOf('1.5 t')).toBe(1500);
      expect(kilosOf('1,5 t')).toBe(1500);
      expect(kilosOf('12,5')).toBe(12.5);
      expect(kilosOf('heavy')).toBeUndefined();
      expect(kilosOf('0')).toBeUndefined();
      expect(kilosOf('-5')).toBeUndefined();
      expect(kilosOf('')).toBeUndefined();
    });
    it('reads a date as written or day-first, and refuses one it would have to guess at', () => {
      expect(dayOfCell('2026-10-06')).toBe('2026-10-06');
      expect(dayOfCell('2026-10-06T00:00:00.000Z')).toBe('2026-10-06');
      expect(dayOfCell('06/10/2026')).toBe('2026-10-06');
      expect(dayOfCell('6-10-2026')).toBe('2026-10-06');
      expect(dayOfCell('06.10.2026')).toBe('2026-10-06');
      // Month-first would make this the 13th month: refused, never swapped round.
      expect(dayOfCell('10/13/2026')).toBeUndefined();
      expect(dayOfCell('30/02/2026')).toBeUndefined();
      expect(dayOfCell('06/10/26')).toBeUndefined();
      expect(dayOfCell('tomorrow')).toBeUndefined();
    });
  });

  describe('a sheet', () => {
    it('reads its own template', () => {
      const r = readOrderSheet(ORDER_SHEET_TEMPLATE, TODAY);
      expect(r.refusal).toBeUndefined();
      expect(r.ignored).toEqual([]);
      expect(r.orders).toEqual([
        { line: 2, reference: 'WS-10432', description: 'Bricks, 4 pallets', weightKg: 4000, dest: 'Plot 12, Kitengela', destLocation: { lat: -1.478, lng: 36.962 }, deliverOn: '2026-10-06', window: '8-12', contactName: 'J. Mwangi', contactPhone: '+254700000000', packaging: 'palletised', instructions: 'Crane offload on site', problems: [] },
      ]);
    });

    it('takes the columns by whatever they are called, in any order, and says which it made nothing of', () => {
      const r = readOrderSheet('Datum;Adres;Gewicht (kg);Omschrijving;Ordernummer;Kleur\n06-10-2026;Dorpsstraat 1;1,5 t;Stenen;NL-7;rood', TODAY);
      expect(r.columns).toMatchObject({ deliverOn: 'Datum', dest: 'Adres', weightKg: 'Gewicht (kg)', description: 'Omschrijving', reference: 'Ordernummer' });
      expect(r.ignored).toEqual(['Kleur']);
      expect(r.orders[0]).toMatchObject({ reference: 'NL-7', description: 'Stenen', weightKg: 1500, dest: 'Dorpsstraat 1', deliverOn: '2026-10-06', problems: [] });
      expect(r.orders[0].destLocation).toBeUndefined();
    });

    it('refuses a sheet with a needed column missing, and says which in words', () => {
      const r = readOrderSheet('Order number,Goods,Deliver to\nA1,Sand,Site', TODAY);
      expect(r.refusal).toMatch(/no column for the weight, the delivery date/);
      expect(r.orders).toEqual([]);
      expect(readOrderSheet('', TODAY).refusal).toMatch(/empty/);
      expect(readOrderSheet('Order number,Goods,Weight,Deliver to,Date', TODAY).refusal).toMatch(/at least one order/);
    });

    it('refuses more than a sheet holds, rather than importing the first part of it', () => {
      const lines = Array.from({ length: MAX_SHEET_ROWS + 1 }, (_, i) => `A${i},Sand,100,Site,2026-10-06`);
      const r = readOrderSheet(['Order number,Goods,Weight,Deliver to,Date', ...lines].join('\n'), TODAY);
      expect(r.refusal).toMatch(/500 orders at most — this one has 501/);
      expect(r.orders).toEqual([]);
    });

    it('gives every bad line its own problems, by the line number a person counts, and still reads the good ones', () => {
      const r = readOrderSheet(
        [
          'Order number,Goods,Weight,Deliver to,Date,Lat,Lng,Packaging',
          'A1,Sand,100,Site A,2026-10-06,,,',
          ',Sand,100,Site B,2026-10-06,,,',
          'A1,Cement,heavy,Site C,06/10/26,,,',
          'A4,,50,,2026-10-04,91,36.9,crates',
          'A5,Tiles,25,Site E,2026-10-06,-1.4,,',
        ].join('\n'),
        TODAY,
      );
      expect(r.orders.map((o) => [o.line, o.problems])).toEqual([
        [2, []],
        [3, ['No order number']],
        [4, ['The same order number as line 2', '"heavy" is not a weight', '"06/10/26" is not a date this can read — write 2026-10-06 or 06/10/2026']],
        [5, ['Nothing says what the goods are', 'No delivery address', '2026-10-04 has gone by', 'The delivery point is not a latitude and a longitude', '"crates" is not a way of packing this knows — loose, bagged, palletised, drummed, baled, ibc or piece']],
        [6, ['The delivery point is not a latitude and a longitude']],
      ]);
    });

    it('reads the everyday words for how goods are packed', () => {
      const r = readOrderSheet('ref,goods,kg,address,date,packed\nA1,x,10,y,2026-10-06,Pallets\nA2,x,10,y,2026-10-06,bags\nA3,x,10,y,2026-10-06,drummed', TODAY);
      expect(r.orders.map((o) => o.packaging)).toEqual(['palletised', 'bagged', 'drummed']);
    });

    it('takes a collection point per line where the sheet has one', () => {
      const r = readOrderSheet('ref,goods,kg,address,date,collect from,pickup lat,pickup lng\nA1,x,10,y,2026-10-06,North yard,-1.3,36.8', TODAY);
      expect(r.orders[0]).toMatchObject({ pickup: 'North yard', pickupLocation: { lat: -1.3, lng: 36.8 }, problems: [] });
    });

    // The CMR check (2026-10-28): who receives it, its dangerous goods, its customs instructions — read where the sheet has them.
    it('reads the consignee, dangerous goods by their recognised description, and customs instructions', () => {
      const r = readOrderSheet(
        ['ref,goods,kg,address,date,consignee,UN number,class,proper shipping name,packing group,customs', 'A1,Paint,900,Plot 4 Kampala,2026-10-06,Kampala Build Co,1263,3,Paint,iii,Cleared at Malaba', 'A2,Paint,900,Plot 4,2026-10-06,K,12,,,IV,'].join('\n'),
        TODAY,
      );
      expect(r.orders[0]).toMatchObject({ consignee: 'Kampala Build Co', dangerous: { unNumber: 'UN1263', properShippingName: 'Paint', hazardClass: '3', packingGroup: 'III' }, customs: 'Cleared at Malaba', problems: [] });
      expect(r.orders[1].dangerous).toBeUndefined();
      expect(r.orders[1].problems).toEqual(['"12" is not a UN number — UN and four digits, like UN1263', 'Dangerous goods need their proper shipping name', 'Dangerous goods need their class', '"IV" is not a packing group — I, II or III']);
    });
  });
});
