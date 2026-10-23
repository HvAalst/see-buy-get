/**
 * WHAT THE GOODS ARE, HOW THEY ARE PACKED, WHAT BODY THE TRUCK NEEDS — said the same way where a shop takes a load
 * in, where a fleet plans it and where a business posts it. Kept under their agent.* names; the Shop app has them
 * through its own catalog (en.agent.ts), the Fleet and Business apps add them on their own (their english.ts).
 */
export const enGoods = {
  // The cargo natures (the "what's inside" picker).
  'agent.nature.gen': 'General goods',
  'agent.nature.fod': 'Dry food — rice, tins',
  'agent.nature.fop': 'Fresh or frozen food',
  'agent.nature.frg': 'Fragile — glass, electronics',
  'agent.nature.odr': 'Strong smell — perfume, fish',
  'agent.nature.hum': 'Medicine or aid',
  'agent.nature.hazChem': 'Chemicals — paint, bleach',
  'agent.nature.hazDust': 'Cement or powder',
  'agent.nature.hazBio': 'Medical or biological',
  'agent.nature.hazFlam': 'Gas, fuel or flammable',
  // The sentence beside each picture in the help sheet. Written as what the ANSWER DOES, because the nature
  // is not a description for the file — it decides what may travel alongside it and what truck may take it.
  'agent.nature.genWhy': 'Ordinary dry goods with nothing special about them. Travels with almost anything.',
  'agent.nature.fodWhy': 'Food that keeps at room temperature — rice, flour, tins, sugar. Kept away from chemicals, cement dust and anything that smells.',
  'agent.nature.fopWhy': 'Food that spoils — fresh, chilled or frozen. Needs a refrigerated truck and an unbroken cold chain, so it is never left standing.',
  'agent.nature.frgWhy': 'Breaks if dropped or crushed — glass, screens, electronics. Never on a bike or motorcycle.',
  'agent.nature.odrWhy': 'Smells strongly enough to taint what it travels with — fish, perfume, hides. Kept away from food.',
  'agent.nature.humWhy': 'Medicine, vaccines or relief supplies. Handled with priority, and cold-chain rules apply if it is chilled.',
  'agent.nature.hazChemWhy': 'Chemicals — paint, bleach, solvents, acid. Needs a certified truck and never rides with food.',
  'agent.nature.hazDustWhy': 'Fine powder that escapes and settles on everything — cement, lime, ash, flour. The risk is contamination, so it never travels with food.',
  'agent.nature.hazBioWhy': 'Medical or biological material — samples, sharps, waste. Certified transport only.',
  'agent.nature.hazFlamWhy': 'Catches fire — fuel, gas cylinders, spirits. Certified truck, and never with anything else that could ignite.',

  // FB2b — posting for negotiation, and answering the prices that come back.
  // FB5 — how it is packed. An observation, not a judgement: the clerk is looking at the load, and this is
  // the one answer here that decides both the kind of truck and whether anything has to lift it.
  'agent.accept.packaging': 'How is it packed?',
  'agent.accept.packagingNote': 'Look at the load and say what you see. Sacks and pallets are the same goods and not the same job — one is worked on and off an open deck, the other is forklifted into a closed body.',
  'agent.accept.packagingChoose': 'Choose…',
  'agent.accept.packBagged': 'In sacks or bags',
  'agent.accept.packPalletised': 'On pallets',
  'agent.accept.packLoose': 'Loose — poured, blown or tipped',
  'agent.accept.packDrummed': 'In drums',
  'agent.accept.packBaled': 'In bales',
  'agent.accept.packIbc': 'In IBC cubes or totes',
  'agent.accept.packPiece': 'One single piece',
  // The sentence beside each picture in the help sheet. Written as what the DRIVER will have to do, because
  // that is what the answer actually decides — the body that turns up, and whether anything can lift it.
  'agent.accept.packBaggedWhy': 'Sacks stacked on an open deck and sheeted over. Worked on and off by hand, by conveyor or by forklift — someone has to lift every one.',
  'agent.accept.packPalletisedWhy': 'Stacked and wrapped on wooden pallets. Forklifted into a closed body, which is also what keeps it dry.',
  'agent.accept.packLooseWhy': 'Not packed at all — poured, blown or tipped straight into the truck. Nothing lifts it, and it cannot sit on a flat deck: it needs a tipper, a silo or a tanker.',
  'agent.accept.packDrummedWhy': 'Steel or plastic drums, lifted in and strapped upright so they cannot roll.',
  'agent.accept.packBaledWhy': 'Compressed bales — cotton, wool, waste, hay. Strapped down on an open deck and sheeted.',
  'agent.accept.packIbcWhy': 'Cube-shaped tanks in a metal cage, usually about a thousand litres. Forklifted into a closed body.',
  'agent.accept.packPieceWhy': 'One item travelling on its own terms — a machine, a beam, a tank. Its size and weight decide the truck, not the wrapping.',
  'agent.accept.bodyHint': 'What kind of truck do you think it needs?',
  'agent.accept.bodyHintNote': 'Only if you know. We work it out from the size and weight either way, and your answer never stops a suitable truck taking it.',
  'agent.accept.bodyAny': "I don't know",
  // A real answer, and often the right one — the hint is advisory and a confident wrong guess is worse than
  // none, so this row says so rather than making "I don't know" feel like a failure to fill the form in.
  'agent.accept.bodyAnyWhy': 'Leave it to us. We work the truck out from the size, the weight and how it is packed — and your answer never stops a suitable truck taking it.',
  'agent.accept.bodyFlatbed': 'Open flatbed',
  'agent.accept.bodyBox': 'Closed box van',
  'agent.accept.bodyCurtain': 'Curtain-side',
  'agent.accept.bodyReefer': 'Refrigerated',
  'agent.accept.bodyTipper': 'Tipper',
  'agent.accept.bodyLowboy': 'Low-loader',
  'agent.accept.bodyContainer': 'Container chassis',
  // The sentence beside each picture in the body help sheet — what the truck IS, in the words of someone who
  // would recognise it in the yard rather than name it from a catalogue.
  'agent.accept.bodyFlatbedWhy': 'A flat open deck with no sides and no roof. Loaded from the side or lifted on from above, then strapped down and sheeted.',
  'agent.accept.bodyBoxWhy': 'A closed box on the back, with doors. Keeps everything dry and locked; loaded from the back, usually by forklift or tail-lift.',
  'agent.accept.bodyCurtainWhy': 'A box whose sides are heavy curtains that slide back. Dry like a box, but loadable along its whole length by forklift.',
  'agent.accept.bodyReeferWhy': 'An insulated closed body with a cooling unit on the front. The only one that holds a temperature.',
  'agent.accept.bodyTipperWhy': 'An open tub that lifts at the front to tip its load out of the back. For things that are poured in, never lifted.',
  'agent.accept.bodyLowboyWhy': 'A trailer that sits very low between its wheels, so a tall machine still passes under bridges. For one heavy piece that cannot be split.',
  'agent.accept.bodyContainerWhy': 'A bare steel frame that a shipping container locks onto. It carries the container, not loose goods.',
};
