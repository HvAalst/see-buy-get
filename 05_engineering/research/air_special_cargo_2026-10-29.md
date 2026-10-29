> Research report as delivered on 2026-10-29 (special air cargo — perishables, pharmaceuticals, live animals, dangerous goods — and the road leg to and from the airport). The downloads it names lived in a temporary folder; every claim carries its source.

# Special air cargo and the road leg to and from the airport: research report

Perishables, pharmaceuticals, live animals and dangerous goods, plus security on the road to the terminal. Every source was read on 2026-10-29.

## How this was done, and its limits
- **Research.** I split the work across four research helpers (perishables, pharma, live animals, dangerous goods with security) and merged their findings here. Each claim below carries a source code, listed at the end. Quotes are short and verbatim.
- **Search budget ran out.** The 200-searches-per-turn web budget is shared by everyone in the turn, and it ran out partway through. After that, work continued only from primary URLs we could open directly. Closing the gaps under "Could not verify" (for example, the heifer airlift programmes) needs another turn, or a higher `CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION`.
- **Blocked sites.** These refused our tools: unece.org (403), EUR-Lex (bot challenge), kenyalaw.org / new.kenyalaw.org, cites.org, kws.go.ke, nda.or.ug, ulii.org, tanzlii.org, kaa.go.ke, the NMPA site, the IATA ONE Source registry (login app), and the KSDA database.
  - For EU texts we used the EU Publications Office (Cellar), which serves the official Official Journal text, plus legislation.gov.uk "as adopted" copies.
  - For treaty membership we used the UN Treaty Collection.
- **Downloads.** They are untrusted and nothing in them was executed. They are in subfolders `perishables`, `pharma`, `animals`, `dg-security` and `txt` of `C:\Users\yukel\AppData\Local\Temp\claude\c--Users-yukel-Documents-Projects-GLOS\c6864fe7-8bbf-4d3c-81ab-f48a65491801\scratchpad\air-special\`.
  - One helper also left read-only Node parsers in `C:\Users\yukel\AppData\Local\Temp\claude\c--Users-yukel-Documents-Projects-GLOS\c6864fe7-8bbf-4d3c-81ab-f48a65491801\scratchpad\scripts-perish\`.
  - No project file was touched.

**Labels used throughout**
- **[LAW]** a statute, regulation or treaty.
- **[STD]** an international standard binding on States (ICAO Annexes and Technical Instructions, IPPC ISPMs, WOAH Code).
- **[IATA]** an airline industry rule. It binds through airline contracts and IATA Resolutions, and an airline will refuse at the terminal on it.
- **[GUIDE]** regulator or WHO guidance.
- **[CODE]** a voluntary industry code or certification.
- **[PRACTICE]** commercial practice.
- **[DRAFT]** not in force.

---

## 1. Perishables by air: cut flowers, fresh produce, fish

### 1.1 IATA Perishable Cargo Regulations (PCR) [IATA]
- **Edition.** The current product is the "26th edition (2027)" [P1]. It adds a "Quality and Risk Management chapter [which] replaces the previous Chapter on the Air Transport of Flowers", adds pre-loading advance cargo information (PLACI) and EU requirements, and moves to "must" wording [P2].
- **Contents.** They cover shipper and carrier responsibilities, packaging, and "Documentation and labelling (waybill, cargo handling codes, captain notification, marking, labelling)" [P1]. The temperature tables are behind the paywall.
- **IATA's public summary** [P3]:
  - The shipper must "Declare all details of the shipment", "Provide details of booking, special handling, or conditions needed" and "Obtain permits, including CITES".
  - "Each perishable air freight shipment should be labeled with a standard IATA 'perishable' label."
  - "The Air Waybill is a required document for all perishable air cargo shipments."
  - Dry ice needs dangerous goods labelling.
- **The road leg, in IATA's words** [P4]: "Ensure the transport vehicle has been properly preconditioned to the required temperature" and "Include temperature data logger in transport vehicle cargo compartment when required".
- **Handling codes.** These come from an airline's list, not an IATA primary source [P5]:
  - "PER Perishables, main code"; "PEF Flowers"; "PEP Fruit and vegetables"; "PES Fish and seafood – non live"; "PEM Meat".
  - "COL Cool store … +2 - +8 degrees C".
  - "FRO" (frozen; the bands vary by carrier).
- **The Time and Temperature Sensitive (TTS) label is for healthcare, not flowers.** IATA's FAQ says the label "is foreseen specifically to the healthcare industry" [P6].
  - It shows the external transport range, not the product temperature.
  - "There must be one temperature range that is identical on Air Waybill, Booking" and the SOP/SLA [P6].
  - Flowers, produce and fish carry the Perishable label plus handling codes.
- **CEIV Fresh** [CODE] is based on the PCR and covers "Transportation - Including by road as well as by air" [P7].
  - Swissport Kenya was certified in October 2021, as "the only ground handler with this certification at … JKIA". Perishables were "about 80% of cargo handled by Swissport in Kenya" [P8].
  - Whether that is still current in 2026 is not verified. No CEIV Fresh evidence was found for Kenya Airways, AFGO, Siginon or Ethiopian Cargo.

### 1.2 Plant health

**The phytosanitary certificate, ISPM 12 [STD]**
- Only an NPPO (National Plant Protection Organisation) may issue it. It "can be issued only by a public officer who is technically qualified and duly authorized by an NPPO", and that officer is "not … a private company" employee [P9].
- It certifies that the goods are "considered to be free from the quarantine pests specified by the importing contracting party" [P9].
- The exporting NPPO "may decide to restrict the duration of the validity" of a certificate [P9].
- Electronic certificates "should be directly available to the relevant NPPO officials" [P9].
- So we hold its reference; we never issue it.

**ePhyto Hub status**
Source: the IPPC ePhyto Hub's own data feed [P10]. Overall, 105 countries are exchanging, 42 testing and 5 registered.

| Country | Status | System | Live since |
|---|---|---|---|
| KE | Exchanging | own system | 2021-01 |
| UG | Exchanging | GeNS (the IPPC's generic system) | 2020-08 |
| TZ | Testing (since 2023-01) | own system | the feed also shows "live 2023-12", so the feed contradicts itself |
| RW | Testing (since 2020-07) | own system | — |
| ET | Exchanging | own system | 2026-07 |
| NL | Exchanging | own system | 2018-01 (each EU state is listed separately) |
| GB | Exchanging | own system | 2023-09 |
| ZA | Exchanging | own system | 2019-07 |
| IN | Exchanging | own system | 2022-12 |
| CN | Testing only | own system | — |
| AE | Not on the Hub | — | — |

- KEPHIS (2021): "Kenya is doing both paper and ephyto certificates to the Netherlands and through the ePhyto Hub" [P11].

**Kenya: KEPHIS**
- **Legal basis**, as stated by KEPHIS: "The Plant Protection Act (CAP 324), and the Agricultural produce (Export) Act (Cap 319) provide the legal framework" [P12]. The Act texts were not read (Kenya Law was blocked).
- **Drafts.** The Plant Protection Bill 2021 and the Plant Protection (Import and Export) Regulations 2021 are drafts under review [P13].
- **Where inspection happens** [P12]:
  - Inspectors visit growers "during the active growing period".
  - The "Embu, Kisumu, Naivasha and Nakuru Offices: Farm export certification".
  - "Jomo Kenyatta, Mombasa and Eldoret airport…: Import/export controls, grading and inspection".
- **Prerequisites** [P11, P14]:
  - The exporter is registered with the Horticultural Crops Directorate (HCD).
  - The exporter registers with KEPHIS, which needs an "HCD Export license", a company certificate, a KRA PIN, the farm details and a system audit.
  - Applications go through the KEPHIS Electronic Certification System (ECS).
- **Per consignment.** This comes only from the DRAFT 2021 Regulations, so it is not law [P15]:
  - an ECS application "for exit point inspection";
  - "a commercial invoice and packing list";
  - goods available at the inspection point "not later than three hours before the inspection";
  - the certificate "deemed invalid" if the goods do not leave "within twenty four hours to seven days depending on the commodity type".
- **Farm or airport?** Whether the phyto is issued before the truck leaves the farm, or after exit inspection at JKIA, is NOT VERIFIED. KEPHIS sources show both. The Dutch government reports that "Exit point inspections are conducted at export facilities" [P16].

**Ethiopia**
- The NPPO is the Ethiopian Agricultural Authority (EAA) [P17].
- Its legal list includes Plant Protection Decree 56/1971, Plant Quarantine Regulation 4/1992 and Regulation 509/2022. These are scans and were not read.
- The EAA links "IEICS (ePhyto)" and the Electronic Single Window [P17].

**EU [LAW]**
- **A phyto for every plant.** Implementing Regulation (EU) 2019/2072, Art. 11(3): "All plants … shall only be introduced into the Union, if they are accompanied by a phytosanitary certificate" [P18].
- **Cut flowers named.** Annex XI Part A point 6 names cut flowers of Aster, Eryngium, Hypericum, Lisianthus, Rosa and Trachelium. This holds in the consolidated text of 15.10.2026 [P18].
- **False codling moth (FCM).** Annex VII point 62 was replaced by Regulation (EU) 2024/2004 and applies "from 26 April 2025" [P19].
  - It covers "Cut flowers of Rosa L. and fruits of Capsicum (L.), Citrus L. [some species excepted], Prunus persica … and Punica granatum L."
  - It applies to goods from "Countries of the African continent, Cape Verde, Saint Helena, Madagascar, La Reunion, Mauritius and Israel".
  - It requires an "Official statement" of one of four things:
    - (a) the country is free from *Thaumatotibia leucotreta*;
    - (b) a pest-free area under ISPM 4, named on the phyto;
    - (c) a pest-free place of production under ISPM 10, inspected during the season and before export at "at least the detection of a 2 % level of infestation, with a level of confidence of 95 %", with a phyto "that indicates the place of production codes";
    - (d) an "approved site of production" with "an effective systems approach … ISPM 14 … or an effective stand-alone post-harvest treatment", inspected before export at the same 2 %/95 % level, with a phyto that "indicates the production site codes and mentions the details of the post-harvest treatment used, or the use of the systems approach".
  - **Consequence for us:** the phyto for a rose consignment to the EU must carry production-site or place-of-production codes.
- **Interceptions** (EFSA 2023, from EUROPHYT/TRACES data [P20]):
  - "From 2014 until January 2023, T. leucotreta was intercepted in 148 shipments of cut roses originating from Kenya, 84 … Uganda, 46 from Tanzania, 36 from Ethiopia, 20 from Zambia, 14 from Zimbabwe and 3 from Rwanda".
  - Kenya by year: 2018: 37; 2019: 39; 2020: 9; 2021: 44; 2022: 18.
  - 238 of the 261 rose interceptions were made in the Netherlands.
  - The Commission's mandate said Kenya's place in reduced checks "is put in question due to the number of interceptions" [P20].
  - Data from 2023 onward sits only in a dashboard that could not be read [P21].
- **Checks on Kenyan roses** (Dutch government report): "Back in 2018, only 5% of shipments were inspected." From 1 May 2024, "inspection levels have been increased to 25%" [P16]. The EU act behind this was not identified.
- **Prior notification:** "at least one working day before the expected arrival", or "at least four hours" where logistics require it (Implementing Reg. 2019/1013, Art. 1) [P22].

**What happens to an intercepted consignment at Schiphol** (destroyed or re-exported): NOT VERIFIED.

### 1.3 Documents for a flower export, Naivasha to Amsterdam

| Document | Who issues it | When |
|---|---|---|
| Phytosanitary certificate (paper and/or ePhyto) carrying the FCM option and site codes | KEPHIS inspector [P9, P12, P19] | After inspection. Farm or exit point is not verified; allow both. |
| HCD export licence | AFA / Horticultural Crops Directorate [P14] | A standing registration before any consignment. A per-consignment HCD permit is not verified. |
| KEPHIS exporter registration and an ECS account | KEPHIS [P11, P14] | Standing |
| Commercial invoice and packing list | Exporter | Needed for exit inspection (draft rules) [P15] |
| Customs export entry (KRA iCMS) | Lodged by the exporter or its customs agent | Before departure. KenTrade steps not verified. |
| Proof of origin under the EU–Kenya EPA, in force from 1 July 2024 [P23] | Either a movement certificate EUR.1, which "shall be issued by the customs authorities of the exporting country" (Reg. 2016/1076 Annex II Art. 15), or an invoice declaration by an approved exporter, or by any exporter for consignments "not exceed[ing] EUR 6 000" (Art. 19) [P24] | At export |
| Air waybill | Carrier or its agent [P3] | At booking and handover |
| EU prior notification | Importer | At least 1 working day before arrival [P22] |

### 1.4 The cold chain on the road leg

**The ATP Agreement** [LAW, a UNECE treaty for perishable foodstuffs]
- **When it applies.** Art. 3(1): it applies only where loading and unloading "are in two different States and the point at which the goods are … unloaded is situated in the territory of a Contracting Party" [P25].
- **What it covers.** Annex 3 lists only chilled meat, milk, dairy, poultry, offal and fish products; for "Untreated fish, molluscs and crustaceans" the rule is "On melting ice". **Fresh fruit, vegetables and cut flowers are outside ATP** [P25].
- **Equipment classes.** For example "FRA" (Class A, selectable between +12 °C and 0 °C) and "FRC" (Class C, between +12 °C and −20 °C), each with a certificate of compliance [P25].
- **Parties.** There are 52 parties. In Africa only Morocco (1981) and Tunisia (2007) belong. NL (1978) and UK (1979) are parties. **KE, UG, TZ, RW, ET, AE, ZA, IN and CN are not** [P26].
- **Result:** ATP does not reach a farm-to-JKIA leg.

**Kenya, national rules** [NOT VERIFIED]
- These could not be read: the Food, Drugs and Chemical Substances Act, the Crops (Horticultural Crops) Regulations 2020, KEBS cold-chain standards and the Fisheries Act.
- **No source read makes a reefer a legal requirement for flowers on Kenyan roads.**
- **Fish.** The Kenya Fisheries Service is "the Competent Authority". It issues a "Certificate Of Compliance" and a "Fish Health Certificate", and an export permit for live fish. It states no vehicle rule [P27].

**Codes** [CODE]
- The Kenya Flower Council's FOSS code is benchmarked to GLOBALG.A.P. Its cold-chain clauses are not public and were not verified [P28].

**Practice** [PRACTICE, as cited by EFSA]
- Roses are "stored in water at a temperature of 2–6°C … During transport by truck/trailer, a constant temperature of 4–6°C and humidity level (60–80%) is maintained" [P20].
- Short peaks happen: "up to 8°C" in handling and "up to 16°C" when reloading into the aircraft [P20].

**EU leg [LAW]**
- Reg. 852/2004 Annex II Ch. IV(7): conveyances, "where necessary", must be "capable of maintaining foodstuffs at appropriate temperatures and allow those temperatures to be monitored" [P29].
- Reg. 853/2004: fresh fish at "a temperature approaching that of melting ice"; frozen fish "not more than -18 °C" [P30].
- **Fish into the EU** needs:
  - a listed country: Annex IX of Reg. 2021/405 (original text) includes KE, UG and TZ; RW and ET were not found; amendments not checked [P31];
  - listed establishments (Reg. 2017/625 Art. 127(3)(e)) [P32];
  - certificate model FISH-CRUST-HC (Reg. 2020/2235) [P33].

**UK**
- Plants: "upload a copy of the phytosanitary certificate on IPAFFS" (the UK's import notification system), pre-notified "at least 4 working hours before the goods land … for air"; the paper original goes to APHA within 3 days [P34].
- Defra says the EU rose/FCM change has "No impact on GB goods" [P35].
- The UK risk category for Kenyan roses was not verified.

---

## 2. Pharmaceuticals and temperature-controlled cargo

### 2.1 IATA Temperature Control Regulations (TCR) [IATA]
- The TCR provides "the requirements and standards for the transportation and handling of pharmaceutical products, including the compulsory use of the Time and Temperature Sensitive Label" [M1].
- **The label.** "Mandatory from July 2012 … It must be affixed to all shipments booked as time and temperature sensitive cargo and indicate the external transportation temperature range" [M1]. In detail [P6]:
  - "The lower half of the label must never be left blank."
  - Celsius only.
  - If the label and the waybill differ, "the transportation temperature range indicated on the Air Waybill prevails".
  - A label without the matching booking means the "airline will treat it as general cargo".
  - It does not apply to "airmail, parcel or passenger/courier bags".
- **The 15th edition (2027)** adds "Enhanced requirements for … ground transportation" and "New requirements to ensure transport equipment is fit for purpose" [M2].
- **Acceptance checklist, TCR Ed. 14** — this is the gate at the terminal for our road leg [M3]:
  - "A1 Single temperature range indicated on the Air Waybill"
  - "A2 24 hours emergency contact number(s)"
  - "**B1 Shipment delivered on temperature-controlled truck set at the correct temperature within the range as per the Air Waybill**"
  - the label affixed, with the range matching the waybill;
  - checks on active containers (ACT).
- **Refusal.** IATA's FAQ says these items "are mandatory … overseen by IATA Resolutions, to which airlines are bound", and airlines "can refuse to accept a shipment" when an item is answered "No" [M4].
- The codes and bands for PIL, COL, ERT and FRO are not verified from an IATA primary source. CRT means "controlled room temperature" (WHO glossary) [M13].

### 2.2 CEIV Pharma [CODE]
- The audit is against "Appendix D of the Guidelines for CEIV Pharma Audit of the … TCR". It includes "Transportation - Including route planning and set-up, by road as well as by air" and "tarmac transportation". The on-site assessment lasts "three (3) to four (4) days". The register sits in IATA ONE Source, which could not be read [M5].

| Airport | Entity | What was found |
|---|---|---|
| ADD | Ethiopian Cargo | Its homepage says "The First African IATA CEIV Pharma Certified Airline" [M6]. Self-declared; year not verified. |
| NBO | Kenya Airways Cargo | Handles "in accordance to the IATA CEIV, GDP and WHO guidelines" in about 600 m² [M7]. This is not a certification claim. |
| DXB | Emirates SkyCargo | Claims a "GDP (Good Distribution Practice) certified dedicated pharma handling hub in Dubai" (press release, 1 Oct 2026) [M8]. CEIV not stated. |
| NBO (Swissport), EBB, KGL, DAR, JNB, DXB/DWC (dnata), DOH (Qatar Airways Cargo / QAS) | — | NOT VERIFIED |

### 2.3 EU Good Distribution Practice guidelines (2013/C 343/01) [GUIDE, made binding on wholesale licence holders by Directive 2001/83/EC Art. 80(g)] [M9]

**Chapter 9, Transportation**
- **9.1, who carries the duty:** "It is the responsibility of the supplying wholesale distributor to … ensure that temperature conditions are maintained within acceptable limits during transport. Regardless of the mode of transport, it should be possible to demonstrate that the medicines have not been exposed to conditions that may compromise their quality".
- **9.2, deviations:** "If a deviation such as temperature excursion or product damage has occurred during transportation, this should be reported to the distributor and recipient of the affected medicinal products." There must also be a procedure for investigating excursions.
- **9.2, equipment:** monitoring equipment is calibrated "at least once a year". "Dedicated vehicles and equipment should be used, where possible".
- **9.2, delivery:** "Medicinal products should not be left on alternative premises."
- **9.2, third parties:** "Where transportation is performed by a third party, the contract in place should encompass the requirements of Chapter 7". At hubs, "particular attention should be paid to temperature monitoring, cleanliness and the security of any intermediate storage facilities".
- **9.3, packaging:** chosen with "the estimated maximum time for transportation including transit storage at customs" in mind.
- **9.4, narcotics:** a "safe and secure supply chain".
- **Temperature-sensitive products:** "qualified equipment (e.g. … temperature-controlled vehicles)". "Temperature mapping under representative conditions should be carried out and should take into account seasonal variations."

**Chapter 7, Outsourced activities**
- "There must be a written contract".
- The contract giver is responsible for "assessing the competence of the contract acceptor … An audit … should be performed before commencement".
- No subcontracting without "prior evaluation and approval".

**Glossary:** "Transport: Moving medicinal products between two locations without storing them for unjustified periods of time" [M9].

**Active substances** (2015/C 95/01, 6.12): where transport is contracted out, there "must be a written contract" [M10].

### 2.4 WHO [GUIDE]

**TRS 1025 Annex 7 (2020)** [M11]
- **Scope** (1.4): it includes "transport companies and forwarding agents".
- **Drivers** (18.17): "Drivers of vehicles should be identified and present appropriate documentation to demonstrate that they are authorized to transport medical products."
- **Vehicles** (18.24): "Vehicles … should be qualified, where applicable … There should be a maintenance programme for the cooling/heating system."
- **Records** (18.25): conditions are "maintained, monitored and recorded", and the records are available "for inspection by the regulatory or other oversight body".
- **Dispatch records** (18.34) include the "entity responsible for the transportation", the "applicable transport and storage conditions", "a unique number to allow identification of the delivery order", and the batch and expiry.
- **Deviations** (18.40): a deviation noticed "by the person or entity responsible for transportation … should be reported to the supplier, distributor and recipient".
- **Outsourcing** (19.1): by "appropriately authorized parties, in accordance with national legislation and the terms of a written contract".
- **Ranges** (Table A7.1):
  - controlled room temperature 15–25 °C
  - cool 8–15 °C
  - refrigerator 5 ± 3 °C (that is, 2–8 °C)
  - freezer −20 ± 5 °C
  - deep freezer −70 ± 10 °C

**TRS 961 Annex 9 (2011)** [M12]
- **At the airport** (1.1.2): "As soon as possible after arrival, remove … shipments from the wharf or airport apron to a safe and suitable temperature-controlled storage location."
- **Refrigerated road vehicles** (6.4.2) must:
  - hold the range "when the vehicle is in motion, or parked with the main engine stopped";
  - have calibrated sensors at the temperature extremes;
  - have driver alarms;
  - have seals or locks;
  - be qualified.
- **Monitoring** (6.5.2): a "minimum recording frequency of six times per hour for each sensor position … document transit temperatures for every … shipment".
- **Controlled and high-value products** (6.4.3): "Security-cleared delivery drivers", "Signed dispatch and arrival records", and drivers told "the maximum acceptable transport time".

**Supplement 12** (road and air operations) [M13]
- "Book the shipment with the prequalified and approved freight forwarder or transport service provider".
- "Cooling units must remain active throughout the entire journey, including during stops."
- "Energy-saving modes … should not be used".
- "only use secure parking areas".
- At arrival, "Retrieve temperature data from the driver … or a print-out obtained from the driver and attached to the arrival forms."

### 2.5 National regulators: what a road carrier of medicines must hold

**KENYA: Pharmacy and Poisons Board (PPB)** — the strongest rule found

*Pharmacy and Poisons Act, Cap. 244* [LAW] [M14]
- The PPB licenses "manufacture, importation, exportation, distribution and sale" (s.3B(2)(e)) and inspects and licenses "importing and exporting agents, wholesalers, distributors" (s.3B(2)(j)).
- It regulates narcotics under the 1961, 1971 and 1988 Conventions (s.3B(2)(h)).
- Rules may cover "the importation, exportation, transport and labelling of poisons" (s.44(1)(f)).

*Pharmacy and Poisons (Transportation of Pharmaceuticals) Rules, 2022, Legal Notice 97 of 9 June 2022* [LAW] — listed by the PPB as current [M15]
- **r.5(1):** "A person who intends to engage in the business of transporting pharmaceuticals shall make an application for a licence to the Board in Form 1". The application includes:
  - an appointed registered pharmacist or enrolled pharmaceutical technologist;
  - registration and inspection documents for each vehicle;
  - "a licence for every operator of a vehicle";
  - inspection reports on each vehicle's suitability;
  - for cold chain, "a copy of a job card showing the installation and validation of the cold-chain control, monitoring and recording system with in-built alarm and alert capabilities".
- **Form 1** also asks for the premises registration certificate and the wholesale dealer's licence.
- **Form 2, the licence:** it expires on 31 December. "No change of the transport vessel without the authority of the Board"; "Any new vessel must be inspected by the Board".
- **r.7(1):** the consignor verifies "that the consignee is authorized to possess the pharmaceuticals".
- **r.7(4):** no motorcycles for narcotics, psychotropics or precursors.
- **r.8:** lockable doors or an alarm; "document and track all deliveries"; "keep signed dispatch and arrival records".
- **r.9 (air):** the TTS label and the acceptance checklist; notify the PPB at the port of entry.
- **r.11:** "tracking devices and engine kill buttons are installed on every vehicle"; "the use of dedicated vehicles and equipment".
- **r.13–16:** calibrated sensors at the extremes, alarms, seals, ±0.5 °C, calibration "at least once every year by the Kenya Bureau of Standards or any other certified standards accreditation body".
- **r.19:** records kept for 2 years.
- **In use:** the PPB's online services include "Apply for a License to Transport Pharmaceuticals" [M16].
- Whether these rules were later annulled or amended is NOT VERIFIED (Kenya Law was blocked).

*PPB GDP guidelines, Rev. 03, effective 3 Feb 2025* [GUIDE] [M17]
- "All import/export consignments … must be accompanied with import/export authorizations from the Pharmacy and Poisons Board."
- The importer alerts customs in advance, so goods move "without breaking the cold chain".
- "The superintendent of a registered pharmacy **or transporter** may apply … for … a Certificate of GDP Compliance". It is valid for 2 years.
- The gazetted ports of entry include JKIA and Eldoret [M18].

*Is the PPB being replaced?* No replacement was found. The Quality Healthcare and Patient Safety Bill (NA No. 41 of 2025; passed by the National Assembly on 2 June 2026, Senate first reading 15 July 2026) concerns health facilities only [M19].

**UGANDA: National Drug Authority (NDA)** — NOT VERIFIED; every source was blocked.

**TANZANIA: Tanzania Medicines and Medical Devices Authority (TMDA)**
- [LAW] GN 312/2015, r.28(1): "No imported pharmaceutical product shall be removed out of the ports of entry before it is inspected and released by the inspector" [M20]. So our truck at the airport must wait for TMDA release.
- [DRAFT] The GSDP Regulations 2021 ("Not signed version") would register "vehicles" as premises and put duties on a "transporter" [M21].

**RWANDA: Rwanda FDA**
- [LAW] Law 47/2012 Art. 3: any activity related to the "… distribution, supply, **transport** of … pharmaceutical products … must be registered" [M22].
- Physical inspection happens "at port of entry or at importer's premise for the consignments released under seal" [M23].

**ETHIOPIA: Ethiopian Food and Drug Authority (EFDA)**
- [LAW] Proclamation 1112/2019 Art. 26(1): products "stored, transported, and sold in accordance with good storage and distribution practices" [M24].
- [Directive] 872/2022 Art. 27(10): "Medicines may be transported by third bodies transporting firms. However, there shall be an appropriate agreement between the transporting firm and the seller or buyer … the transporting firm shall present evidences of establishments for such purposes." Art. 27(9): the authority may require "records of data logger" [M25].
- [GUIDE] EFDA GDP 2024: drivers "present appropriate documentation to demonstrate that they are authorized" [M26].

**NL / EU**
- The Dutch Medicines Act art. 18(1) licenses holding in stock, delivering, exporting and wholesale. Pure transport is not listed [M27]. The carrier sits under the wholesaler's contract (GDP Ch. 7 and 9).

**UK: MHRA**
- A wholesale dealer's licence is needed to "distribute … by way of wholesale dealing" (HMR 2012 reg. 18), and the holder must follow GDP (reg. 43) [M28].
- MHRA: "the supplier is responsible for delivery … A written agreement between supplier and third-party courier" [M29].
- That a carrier needs no licence of its own is an inference.

**UAE: Emirates Drug Establishment (EDE)**
- Federal Decree-Law No. 38 of 2024 [M30]. Its transport provisions were NOT VERIFIED (the Arabic PDF had no extractable text).

**SOUTH AFRICA: SAHPRA**
- [LAW] Act 101 of 1965, s.22C(1)(b): licences for import, wholesale and distribution [M31].
- [GUIDE] SAHPGL-INSP-03 v5 [M32]:
  - service agreements cover "Couriers and freight forwarding … clearing agent";
  - "the contract giver is obliged to perform an annual vendor inspection";
  - vehicles "must … Have solid sides" and must not carry contaminating non-pharmaceutical goods.

**INDIA: CDSCO**
- [DRAFT GUIDE] GDP 2018: "A written agreement between the manufacturer, … agent and Transport Company shall be in place"; subcontractors are "appropriately authorized" [M33].

**CHINA: NMPA** — NOT VERIFIED.

### 2.6 Vaccines [GUIDE, WHO model Effective Vaccine Management SOPs, 2013] [M34]
- **24 hours:** "Vaccines must be cleared through customs so that the shipment can be transported to the primary store, checked and unpacked within 24 hours of flight arrival."
- **Vehicles:** "Refrigerated vehicles, used for transporting vaccine, must be equipped with cab-mounted continuous temperature recording equipment and alarm systems. In addition, at least one freeze indicator device must also accompany every shipment."
- **Papers:** the shipment comes with an invoice, packing list, lot release certificate and a Vaccine Arrival Report (VAR). The VAR is signed by two people and sent to UNICEF within 48 hours (the 2007 VAR guidelines say 24 hours).
- **Arrival checks:** the shake test (for aluminium-adsorbed vaccines that may have frozen) and the vaccine vial monitor.
- Kenya's NVIP/KEMSA and Ethiopia's EPSS arrival practice: NOT VERIFIED.

### 2.7 Controlled drugs [LAW, UN treaties]
- **1961 Convention, Art. 31:** a separate authorisation for each import and export. "A copy of the export authorization shall accompany each consignment" (31(6)). Unaccompanied consignments "shall be detained" (31(10)) [M35].
- **1971 Convention, Art. 12:** the same for psychotropics in Schedules I and II [M36].
- **Kenya:** PPB authorisations accompany the consignment [M17]; no motorcycles [M15].

---

## 3. Live animals: livestock imports and the road leg from the airport

### 3.1 IATA Live Animals Regulations (LAR) [IATA, adopted into EU law by reference]
- **Status.** IATA calls the LAR "the worldwide standard"; "It is the role of governments to set and enforce the rules" [A1].
- **Editions.** The 52nd edition is in force for 1 Jan–31 Dec 2026 [A2]; the 53rd (2027) is on sale. The LAR is revised by IATA's Live Animals & Perishables Board "in consultation with … CITES, … WOAH" [A3]. Kenya Airways files its own operator variations [A3].
- **Container Requirements** confirmed in public sources: CR1 (dogs and cats), CR82 (reinforced kennel for listed strong breeds) [A2], CR2 (horses) [A3]. The CR numbers for cattle, goats and day-old chicks are NOT VERIFIED.
- **Shipper's Certification for Live Animals:** "required … for each shipment", "completed in English", "signed in duplicate" [A4].
  - **The checklist's item 14** asks whether it was "signed by the shipper or their authorized agent? (Check that this is not an IATA cargo agent, consolidator, forwarder or indirect air carrier.)" [A5]. **So SeeBuyGet must never sign it.**
  - An airline's form states the animals are "in proper condition for carriage by air according to the current edition of the IATA Live Animals Regulations … in good health". It also asks for a vet certificate that "the animal is fit to travel, and that there is no risk of birth occurring during the entire journey" [A6].
- **The carrier's acceptance checklist** [A5]:
  - "If any question is answered 'NO', do not accept the shipment".
  - Item 3: "advance arrangements … at the airport of destination, i.e. for quarantine and delivery".
  - Item 11: permits including CITES "securely attached to the air waybill and copies … affixed to the container".
  - Items 16–17: the consignee and a 24-hour phone number on each container.
- **CEIV Live Animals.** Its register sits in ONE Source [A7]. No certified African handler or airport was confirmed. Ethiopian Cargo signed a project agreement in June 2023 (search summary only; the outcome is not verified).
- **EU law adopts the LAR.** Reg. 1/2005 Annex I Ch. II 4.1: containers must "comply with International Air Transport Association (IATA) live animals Regulations" [A8].

### 3.2 WOAH Terrestrial Animal Health Code [STD]
Source: the WOAH chapter PDFs, with 2022 footers [A9]. The chapters were last revised: 7.3 and 7.4 in 2011, 7.2 in 2008, 7.1 in 2019. Later revisions are not verified.

**Chapter 7.3, transport by land**
- **Journey time:** "The amount of time animals spend on a journey should be kept to the minimum" (7.3.1). There are no numeric limits.
- **The handler:** "an animal handler competent for the species"; "the truck driver may be the sole animal handler" (7.3.3(1)(c)). The handler keeps "a journey log" (7.3.3(3)).
- **Transporters** choose "appropriate vehicles for the species", keep "contingency plans", and produce "a journey plan which includes a loading plan, journey duration, itinerary and location of resting places" (7.3.3(4)).
- **Vehicles** (7.3.5(4)):
  - "secure smooth fittings free from sharp protrusions";
  - weather protection;
  - "designed to permit thorough cleaning and disinfection, and the containment of faeces and urine";
  - "adequate ventilation … effective when the vehicle is stationary, and the airflow should be adjustable";
  - bedding "to minimise slipping".
- **Documents:** "Animals should not be loaded until the documentation required to that point is complete." The papers that travel: journey plan, emergency plan, veterinary certification, identification, stocking density and journey log (7.3.6).
- **Before loading:** "Before each journey, vehicles and containers should be thoroughly cleaned" (7.3.7(1)(f)).
- **Unfit animals** include the sick or injured, a "newborn with an unhealed navel", "pregnant animals which would be in the final 10% of their gestation period at the planned time of unloading", and females that gave birth within 48 hours (7.3.7(3)).
- **Loading:** "Loading ramps and other facilities should have a non-slippery flooring" (7.3.8).
- **Heat:** in hot weather, "vehicles should be parked under shade" (7.3.9).

**Chapter 7.4, transport by air**
- Container ventilation of "at least 16% of the wall area"; for cattle crates, "at least 30% of the roof and four walls as open space" (7.4.1).
- Guide maximum pregnancy: 250 days for cows, 115 for goats (7.4.2).
- At the arrival airport, holding and loading facilities "including ramps, trucks, and air-conditioning units" must be arranged; above 25 °C, air-conditioning must be ready (7.4.4). **This is the handover to our road leg.**

**Chapter 5.2, certification:** a certificate is signed by a vet "authorised by the Veterinary Authority of the exporting country", and "Only original certificates are acceptable" (5.2.3). **A copy held by SeeBuyGet is a record; the original travels with the animals.**

### 3.3 CITES
- NOT VERIFIED from primary text (cites.org and kws.go.ke were blocked). That includes the permit rules, the Kenya Wildlife Service as Management Authority, and Resolution Conf. 10.21 (which, by recollection, recommends the LAR for air).
- Confirmed through IATA: CITES documents must be attached to the air waybill, with copies on the container [A5].
- Confirmed through the LAR addendum: Lufthansa takes Appendix I species only for members of the zoo associations WAZA, EAZA or VDZ; Cathay Pacific does not take them [A2].

### 3.4 Veterinary import requirements

**KENYA: Directorate of Veterinary Services (DVS), State Department for Livestock Development** [A10]
- [LAW] Animal Diseases Act Cap 364 [A11]:
  - s.8(1): the Director may "prohibit … or regulate, the importation … of all animals or any specified kinds of animals … from any specified country, port or territory".
  - s.9: rules on "(d) prescribing ports and places for the importation … (f) prescribing quarantine for imported animals … (g) prescribing conditions under which animals may be imported", and the "(h)(ii) cleansing and disinfection of … motor vehicles, aircraft".
  - The permit wording itself sits in the Animal Diseases Rules: NOT VERIFIED.
- [GOV] The trade portal lists permit types [A12]:
  - VS01 dogs and cats
  - VS02 live poultry
  - VS03 breeding cattle
  - VS05 breeding sheep and goats
  - VS11 fertile hatching eggs
  - VS14 breeding pigs
  - VS31 slaughter cattle
  - VS35 breeding camels
  - VS37 embryos
  - VS38 rabbits
  - It also names procedures for "Cattle import procedure through the Jomo Kenyatta International Airport (JKIA)", live poultry through JKIA, and dogs and cats through JKIA. Their steps load by script and were not read.
- [DRAFT] Livestock (Breeding) Regulations 2023, r.13(1): authorisation from the Authority, then permits [A13].
- [DRAFT] ANITRAC (animal identification and traceability) Regulations 2020: imported animals are tagged; "livestock movement permits bearing unique animal identification numbers" [A14].
- **Quarantine:** the Draft 2026 Veterinary Policy names Bachuma and Lamu stations, used for export [A15]. **Where an air import through JKIA is quarantined is NOT VERIFIED.**

**UGANDA: Ministry of Agriculture, Animal Industry and Fisheries (MAAIF), Commissioner Animal Health** [GOV] [A16]
- Apply for the import permit "at least 7 days prior". The permit states "the animal health requirements and port of entry".
- An "official Veterinary Health Certificate, in English" is required.
- Animals "shall be moved to animal quarantine/holding facilities after general examination on arrival", for "21-30 days". Final release comes after tests.

**TANZANIA: Ministry of Livestock and Fisheries** [A17, A18]
- A permit is needed before import ("lazima awe amekwisha omba kibali", Swahili: "must already have applied for a permit"), through the MIMIS system.
- The movement regulations (GN 478C of 2022) set fees for "quarantine, animal holding grounds and check points".

**RWANDA: Rwanda Agriculture Board (RAB)** — offers "Animal Transportation Permits" online [A19]. The import law is not verified.

**ETHIOPIA** [LAW] Proclamation 267/2002 [A20]
- Art. 13(1): "obtain an entrance permit … stating the type of product, country of origin, quantity, means of transport, date of arrival, port of entry and transit countries prior to importation".
- Art. 14(1): animals and "hatching-eggs" must be "accompanied by recognized international animal health or sanitary certificate".
- Whether it has been superseded is not verified.

**Heifer and breeding-cattle airlift programmes into East Africa:** NOT VERIFIED. The search budget ran out before this was reached.

### 3.5 The road leg from the airport

**Kenya**
- [LAW] Cap 364 [A11]:
  - s.5(d): the Director may "prohibit the movement of animals".
  - s.7(1)(a): in an infected area, "no stock shall be moved … without the written permission of the Director".
  - s.14: inspectors may enter "any … truck, motor vehicle, aircraft".
- Counties are responsible for "animal movement control and welfare" (Draft 2026 Veterinary Policy) [A15].
- The Prevention of Cruelty to Animals Act Cap 360 is "a colonial-era statute"; its text was not read. The Animal Welfare and Protection Bill "remained unenacted as at 2026" [A15].
- [DRAFT] Poultry Regulations 2023, r.34–35: the transporter provides handlers, "appropriate vehicles", a journey plan and records. Crates are "well ventilated", have "rigid floors" and are "transported in an upright position" [A21].

**Tanzania** [LAW] GN 478C reg. 6(1): "A person shall not move animals … from one area to another within or outside the district without a permit in writing granted and signed by an inspector" [A18].

**Ethiopia** [LAW] Proclamation 267/2002: officers may inspect "prior to transport, during transport and after transport" (Art. 9(2)); check-posts control movement between regions (Art. 11(2)) [A20].

**EU reference standard: Reg. (EC) 1/2005** [LAW] [A8]
- **Art. 3:** "No person shall transport animals or cause animals to be transported in a way likely to cause injury or undue suffering".
- **Art. 4(1):** papers carried: origin, owner, departure, destination, expected duration.
- **Art. 6(5):** "No person shall drive, or act as an attendant on a road vehicle … [of equidae,] bovine, ovine, caprine or porcine species or poultry unless he holds a certificate of competence".
- **Art. 10–11:** transporter authorisation; Type 2 for "long journey" (over 8 h).
- **Art. 18:** long-journey vehicles approved for up to 5 years.
- **Annex I Ch. I, unfit animals:** "pregnant females for whom 90 % or more of the expected gestation period has already passed"; "calves of less than ten days" (except under 100 km); "dogs and cats of less than eight weeks" without their mother.
- **Annex I Ch. II, the vehicle:** "flooring surface that is anti-slip"; "Partitions shall be strong enough to withstand the weight of animals"; marked as carrying live animals.
- **Annex I Ch. III, ramps:** no steeper than "20 degrees … for pigs, calves and horses" and "26 degrees 34 minutes … for sheep and cattle other than calves"; foot battens above 10°; lateral protection.
- **Annex I Ch. V, journey times:**
  - 8 h, unless the vehicle meets Ch. VI;
  - unweaned calves 9 h + 1 h rest + 9 h;
  - other cattle, sheep and goats 14 h + 1 h + 14 h, then 24 h rest;
  - chicks: food and water may be omitted for "24 hours … provided that it is completed within 72 hours after hatching".
- **Annex I Ch. VI, long-journey vehicles:** ventilation holding "5 °C to 30 °C", temperature recording and a navigation system.
- **Replacement:** the proposed new regulation (2023/0448(COD)) is not adopted [A22].

**UK:** SI 2006/3260 Art. 5 makes breach of Reg. 1/2005's key articles an offence [A23]. Since 22 July 2024 no livestock may be exported for slaughter [A24].

**Netherlands (NVWA):** "bijna alle vervoerders van dieren" ("almost all animal transporters") must comply with Reg. 1/2005; "Meestal is een vervoerdersvergunning nodig" ("a transporter's licence is usually needed") [A25].

---

## 4. Dangerous goods by air

### 4.1 Legal status and editions
- **Annex 18 / Technical Instructions [STD].** Annex 18 ¶2.2.1 requires States to "achieve compliance" with the Technical Instructions [D2].
  - The 2025–2026 Technical Instructions are "required to be used for operations from 1 January 2025" and "remain valid until 31 December 2026" [D1].
  - No State variations are filed for KE, UG, TZ, RW or ET. AE, IN, CN, GB, NL and ZA have variations [D2].
- **IATA DGR [IATA].** "IATA airlines are somewhat stricter … than the ICAO Technical Instructions", and airlines may add rules [D3]. EASA: "The DGR can only be more restrictive than the Doc 9284" [D11].
  - The 67th edition is in force for 2026 [D5]. The 68th edition applies from 1 Jan 2027 [D4].
- **Kenya [LAW].** The Civil Aviation (Security) Regulations 2025 define the Technical Instructions as Doc 9284. Reg. 49(6) makes operators require regulated agents to comply with them [D16].
  - The KCAA says the Kenya Civil Aviation Regulations 2018 require competency-based dangerous goods training, given only by organisations "approved by the Director General" [D19].
- **South Africa:** SACAR Part 92 [D31].

### 4.2 The Shipper's Declaration for Dangerous Goods (DGD) [IATA, mirroring the Technical Instructions]
- **Who signs.** "By signing the Shipper's Declaration, the shipper is making a legal statement that all the applicable provisions of the DGR have been complied with" [D6]. When a forwarder may sign as shipper is NOT VERIFIED (that DGR text is not public).
- **Training** (DGR 1.5) [D9]:
  - The employer ensures staff "are competent … prior to performing any of these functions".
  - The function "Complete the Shipper's Declaration" belongs to staff who prepare dangerous goods consignments.
  - Shippers of Section II lithium batteries are "not subject to the formal … training requirements set out in DGR 1.5" but need "adequate instruction" (DGR 1.6) [D6].
- **No DGD needed** (DGR 8.2.3), for example for dry ice UN1845 or Section II batteries: the air waybill's "Nature and Quantity of Goods" box must show the UN number, proper shipping name, number of packages, net quantity (for dry ice), and any mandatory statement such as "lithium-ion batteries in compliance with section II of PI 967" [D5, D6].
- **Electronic DGD:** allowed. Signatures "may be electronic"; in the electronic process "No paper will be accepted". Acceptance varies by airline [D7, D8].

### 4.3 Forbidden, Cargo Aircraft Only (CAO), and lithium batteries
- **Two columns.** The list has separate "Passenger and Cargo Aircraft" and "Cargo Aircraft Only" columns [D5]:
  - UN0030 electric blasting detonators (1.1B): "Forbidden" everywhere.
  - UN0255 (1.4B): CAO only.
  - That UN0030 is carriable by road under ADR was not verified (the ADR text was blocked).
- **Lithium-ion alone:** "All lithium-ion cells and batteries shipped by themselves (UN 3480) are forbidden for transport as cargo on passenger aircraft. All packages prepared in accordance with Packing Instruction 965, Section IA and IB, must bear a Cargo Aircraft Only label" [D6]. The same holds for UN3090 (PI 968) and sodium-ion UN3551.
- **State of charge (SoC):** "From 1 January 2026, lithium-ion batteries that are packed with equipment … must be offered … at a reduced state of charge … (Special Provision A331)", adopted "into the 2025-2026 edition of the Technical Instructions" [D6].
  - UN3480: ≤30 %.
  - UN3481 PI 966: Section I ≤30 %; Section II ≤30 % for cells and batteries above 2.7 Wh.
  - UN3481 PI 967 (contained in equipment): ≤30 % is "strongly recommended", "not mandatory".
  - Vehicles under PI 952 with batteries over 100 Wh: ≤30 % or ≤25 % indicated capacity.
- **Per-package limits by section** [D6]:

| UN / packing instruction | Section | Passenger aircraft | CAO | Handling code |
|---|---|---|---|---|
| UN3480 / PI 965 | IA | Forbidden | 35 kg | RBI |
| UN3480 / PI 965 | IB | Forbidden | 10 kg | RBI |
| UN3481 / PI 966–967 | I | 5 kg | 35 kg | RLI |
| UN3481 / PI 966–967 | II | 5 kg | 5 kg | ELI |
| UN3090 / PI 968 | IA | Forbidden | 35 kg | RBM |
| UN3090 / PI 968 | IB | Forbidden | 2.5 kg | RBM |
| UN3091 / PI 969–970 | I | 5 kg | 35 kg | RLM |
| UN3091 / PI 969–970 | II | 5 kg | 5 kg | ELM |

- **Testing:** all cells and batteries must pass UN 38.3; no test summary is needed with each shipment unless a State or operator requires it [D6].
- **68th edition (2027):** button cells are excluded from the Section II count; new entries UN3563 and UN3564; excepted quantities apply "only … to substances and not articles" [D4].

### 4.4 High-consequence dangerous goods
- IATA (white paper, 24 Sep 2026): they "have the potential to be misused for a deliberate attack", and "The whole supply chain must apply security measures to prevent theft or misuse of DG" [D10].
- The texts of Technical Instructions Part 1;4 and ADR 1.10 were NOT VERIFIED.

### 4.5 Road versus air
- **ADR parties** [D12]: 55. In Africa: Morocco, Tunisia, Nigeria and **Uganda (accession 23 Aug 2022)**. NL (1963) and UK (1968) are parties. **KE, TZ, RW, ET, ZA, AE, IN and CN are not.**
- **Kenya [LAW], Traffic Act s.52B:** "No vehicle carrying explosives, ammunition, petroleum or any inflammable substance shall remain stationary for more than fifteen minutes within the boundaries of a trading centre, township, municipality or city except— (a) when unloading; or (b) in an area designated by the Minister" [D14]. No general Kenyan dangerous-goods-by-road rule was found. The EPRA petroleum road-transport regulations of 2025 exist (snippet only).
- **Region:** the COMESA-EAC-SADC model law on transporting dangerous goods by road was "approved by Tripartite Committee of Ministers in June 2021" [D13]. Whether any country has made it national law is not verified.

---

## 5. Cargo security on the road leg

### 5.1 ICAO Annex 17 [STD], through IATA and Kenyan law
- **4.6.1:** "security controls, including screening where practicable, are applied to cargo and mail, prior to their being loaded" [D10].
- Once secured, cargo "must be protected from unauthorized interference from the point of screening or other security controls are applied until aircraft departure" [D10].
- **Definitions**, as reproduced in Kenyan law [D16]:
  - "known consignor" means "a consignor who originates cargo or mail for its own account and whose procedures meet common security rules and standards sufficient to allow the carriage of cargo or mail on any aircraft";
  - "regulated agent" means "an agent, freight forwarder or other entity who conducts business with an operator and provides security controls that are accepted or required by the Authority in respect of cargo and mail".
- **Account consignors:** ICAO's phase-out "has come into effect on 30 June 2021" [D27]. The EU still allows a third-country account consignor (AC3) only "on behalf of the regulated agent" [D24].
- **Consignment security declaration (CSD)**, from South Africa's form in the ICAO format [D30]:
  - the regulated agent's ID;
  - the air waybill;
  - the security status, SPX or SHR;
  - how it was secured: from a known consignor (with its number) or by a screening method;
  - who issued it, and when.
  - The issuer confirms: "The goods will be protected and secured during storage and transport at all stages of transit."

### 5.2 EU regime for cargo flown into the EU (Kenyan flowers to Amsterdam)
- **ACC3:** each air carrier flying into the EU from a third-country airport needs an ACC3 designation, after validation, for up to 5 years [D25].
- **RA3 / KC3:** they must pass "an EU aviation security validation", valid 5 years. "If you are not validated and approved according to the EU requirements, you may not form part of the secure supply chain of an ACC3." [D24]
- **The haulier, Reg. 2015/1998 point 6.6.1.1 (as adopted)** [D20]:
  - consignments "packed or sealed … so as to ensure that any tampering would be evident";
  - the load compartment "locked or sealed", curtain-siders "secured with TIR cords", flatbeds "kept under observation";
  - and "the haulier declaration as contained in Attachment 6-E shall be agreed by the haulier … unless the haulier is itself approved as a regulated agent".
- **Attachment 6-E**, verbatim from the Austrian ministry's official form [D22]. The haulier declares:
  - all staff have "general security awareness training";
  - staff integrity is checked;
  - "Load compartments in vehicles will be sealed or locked. Curtain sided vehicles will be secured with TIR cords";
  - "Immediately prior to loading, the load compartment will be searched";
  - "Each driver will carry an identity card, passport, driving licence or other document, containing a photograph";
  - "Drivers will not make unscheduled stops between collection and delivery". Where a stop is unavoidable, seals are checked; if there is tampering, a supervisor is told, and the goods are not delivered without notification;
  - subcontracting only to parties bound the same way;
  - "I accept full responsibility for this declaration."
  - The Austrian form adds: "This declaration has a validity of three years."
- **From 1 January 2027** (Reg. 2024/1255, as reported by the Latvian CAA, 8 Sep 2026): "ground transport within the EU of secured cargo may be carried out only by: a regulated agent; a known consignor; an approved haulier". Hauliers' "declarations of commitment" "will no longer apply from 1 January 2027" [D23]. Whether this reaches legs in Kenya (known consignor to RA3) is NOT VERIFIED.
- **Pre-loading information (ICS2/PLACI) [LAW, customs]:** "a minimum set of information must also be filed prior to loading". A referral may require "high risk cargo and mail screening or not to load the cargo" [D26].
- **Kenyan entities with EU RA3 numbers** (KCAA list of 30 Apr 2025) [D18]: Kenya Airways/KAHL, Swissport Cargo Services, Siginon, Africa Flight Services, Kuehne + Nagel, DB Schenker, DHL Express, Freightwings and others. Several "Till" dates have already passed. Treat this as a lead, not proof; the EU database could not be reached.

### 5.3 Kenya [LAW]: Civil Aviation (Security) Regulations 2025
Legal Notice 31, Gazette Supplement of 3 Mar 2026; it revokes LN 128/2020 [D15, D16].
- **Reg. 5(e):** the Authority certifies "regulated agents and/or known consignors … once every two years".
- **Reg. 15(1):** "A person shall not operate an enterprise or an organisation whose purpose is the movement of cargo or mail, by air within or from Kenya without a Regulated Agent Security Programme approved by the Authority and a certificate issued by the Authority."
- **Reg. 15(2)(e):** procedures for "ensuring that screened air cargo or mail is protected from interference and accounted for at every stage of its journey" and for "transportation and delivery".
- **Reg. 47(1)(b):** the regulated agent establishes "the credentials of the person who delivers the cargo or mail as an agent of the known consignor"; (h) the security status accompanies the cargo "throughout the secure supply chain".
- **Reg. 49(4):** cargo to be loaded is "(a) delivered by an established employee of a handling agent, aircraft operator or regulated agent" and "(c) covered by a valid consignment security declaration", "(d) … no evidence of having been tampered with" — "… or (f) screened".
  - My reading: a third-party truck delivering to the airport probably triggers screening unless the chain is documented.
- **Reg. 28(3):** airport security permits "for persons and vehicles".
- **Reg. 70:** false declarations carry up to KSh 500,000 and/or 6 months.
- **Not in the text:** there is no haulier approval or declaration. That detail would sit in the National Civil Aviation Security Programme, which is not public: NOT VERIFIED.
- **KCAA practice:** regulated-agent certification is "site-specific" [D17].
- **Kenya Airports Authority (KAA) truck and driver permits at the JKIA cargo village:** NOT VERIFIED (403).

### 5.4 Other countries
- **Tanzania (TCAA):** Civil Aviation (Security) Regulations 2018, amended by GN 261 of 18 Sep 2026; scheme not verified [D32].
- **Uganda (UCAA), Rwanda (RCAA), Ethiopia (ECAA):** schemes not verified [D33].
- **UK (CAA, with the DfT deciding):** "any air carrier carrying cargo or mail from another country into any UK airport must hold a UK ACC3 designation"; supply-chain entities may need to be UK-RA3 or UK-KC3 [D28]. Chapter 6 of the retained 2015/1998 was "omitted (1.6.2024)" [D21].
- **South Africa (SACAA):** "Part 108 applies to all persons engaged in the acceptance, forwarding, storage and carriage of cargo by air". Forms CA 108-01 Known Consignor and CA 108-02 Regulated Agent [D29].
- **UAE (GCAA), India (BCAS), China (CAAC):** regulators named; schemes not verified [D33].

---

## 6. Per-country summary table

"n.v." means not verified.

| Country | Plant health (NPPO; ePhyto) | Veterinary imports | Medicines regulator; what a carrier must hold | Air cargo security; regulated agent / known consignor | Road rule: perishables / animals / dangerous goods | Sources |
|---|---|---|---|---|---|---|
| **KE** | KEPHIS; Hub, live 2021 | DVS; permits VS01–VS38; Cap 364 | PPB; **its own PPB transport licence** (LN 97/2022), optional GDP certificate | KCAA; RA certificate and programme, known consignor defined (CASR 2025) | Perishables: no law found, not an ATP party. Animals: Cap 364 ss.5, 7, 14 (Cap 360 n.v.). DG: not an ADR party; Traffic Act s.52B | P10–P15, A10–A15, M14–M18, D14–D19 |
| **UG** | MAAIF crop inspection; Hub via GeNS, 2020 | MAAIF Commissioner Animal Health; permit 7 days ahead; quarantine 21–30 days | NDA; n.v. | UCAA; n.v. | Animals n.v.; **ADR party since 2022** | P10, P36, A16, D12, D33 |
| **TZ** | Tanzania Plant Health and Pesticides Authority (TPHPA); testing (feed inconsistent) | Ministry of Livestock and Fisheries; permit through MIMIS | TMDA; no removal from the port before inspection (GN 312/2015 r.28); vehicle registration only in a draft | TCAA; Security Regs 2018 (amended 2026); scheme n.v. | Animals: movement permit (GN 478C reg. 6). Not an ADR party | P10, A17–A18, M20–M21, D32 |
| **RW** | RICA (Rwanda Inspectorate, Competition and Consumer Protection Authority); testing | RAB; transport permits online; import law n.v. | Rwanda FDA; transport "must be registered" (Law 47/2012 Art. 3) | RCAA; n.v. | RAB animal transport permit; not an ADR party | P10, P36, A19, M22–M23, D33 |
| **ET** | EAA; Hub, live 2026-07 | Ministry of Agriculture; entrance permit plus certificate (Proc. 267/2002 Arts 13–14) | EFDA; agreement with seller or buyer plus "evidences of establishments" (Dir. 872/2022) | ECAA; n.v. | Animals: inspection and check-posts (Proc. 267/2002 Arts 9, 11). Not an ADR party | P10, P17, A20, M24–M26, D33 |
| **NL/EU** | NVWA; Hub, live 2018 | NVWA; border control post plus CHED (EU common health entry document); Reg. 2017/625 | IGJ/CBG; the carrier works under the wholesaler's contract (GDP Ch. 7, 9) | National authority n.v.; RA/KC; ACC3/RA3/KC3; **approved haulier from 1 Jan 2027** | ATP party; Reg. 852/2004 and 853/2004; Reg. 1/2005; ADR party | P18–P22, P26, P29–P33, A8, A25, M9, M27, D20–D26 |
| **UK** | Defra/APHA; Hub, live 2023; IPAFFS 4 working hours | Defra/APHA; IPAFFS 1 working day | MHRA; wholesale licence holder, carrier under contract (inference) | CAA/DfT; UK ACC3, UK-RA3, UK-KC3 | ATP; SI 2006/3260; ADR | P34–P35, A23–A24, A26, M28–M29, D21, D28 |
| **AE** | Ministry of Climate Change and Environment (MOCCAE); **not on the Hub** | MOCCAE (n.v.) | EDE; Decree-Law 38/2024 (n.v.) | GCAA; n.v. | Not ATP, not ADR; n.v. | P10, M30, D33 |
| **ZA** | Department of Agriculture (DALRRD); Hub, live 2019 | Department of Agriculture, Animal Health | SAHPRA; contract acceptor under a service agreement, annual vendor inspection | SACAA Part 108: RA, known consignor | Not ATP, not ADR; NRTR Ch. VIII not read | P10, A27, M31–M32, D29–D31 |
| **IN** | Ministry of Agriculture, Plant Protection; Hub, live 2022 | DAHD (n.v.) | CDSCO; written agreement (draft GDP) | BCAS; n.v. | Not ATP, not ADR; n.v. | P10, M33, D33 |
| **CN** | MARA (IPPC listing); **testing only** | GACC (n.v.) | NMPA; n.v. | CAAC; n.v. | Not ATP, not ADR; n.v. | P10, D33 |

---

## SYNTHESIS: what the platform should ask of a load to or from an airport

### Common to every special-cargo load
1. **Air facts:**
   - the airport and the cargo terminal or handler (for example Swissport, KQ or AFS at JKIA);
   - the air waybill number;
   - flight or cut-off time;
   - passenger or freighter aircraft — this decides whether CAO goods may go;
   - direction (export to the terminal, or import from it).
2. **Documents.** We never sign or issue any of these:
   - the phytosanitary certificate, which only a public NPPO officer may issue [P9];
   - the DGD, which the shipper signs [D6];
   - the Shipper's Certification for Live Animals, which a forwarder may not sign [A5];
   - the CSD, which a regulated agent issues [D30];
   - vet certificates and CITES permits.

   We hold copies and references. Where an original must travel with the goods, the note says so and the driver confirms it at pickup:
   - vet certificates: "Only original certificates are acceptable" [A9];
   - CITES permits, attached to the waybill [A5];
   - controlled drugs: "A copy of the export authorization shall accompany each consignment" [M35].
3. **Mirror the airline's acceptance checklist, so we never send a truck for a load the terminal will refuse:**
   - TCR B1 (delivered on a temperature-controlled truck set within the waybill range) [M3];
   - the LAR checklist, where any "No" means refusal [A5];
   - the dangerous goods acceptance checklist [D5].
4. **Rules as data:** each rule row carries its country or bloc, its kind (LAW / STD / IATA / GUIDE / CODE / PRACTICE / DRAFT), its source URL and the date checked. A refusal should say which kind it rests on. Refusing on a LAW row differs from warning that "the airline will refuse" (IATA) or that "the shipper's code asks for it" (CODE/PRACTICE).

### A. Perishables (flowers, produce, fish)
- **Facts to collect:**
  - commodity and CN code (roses: 0603 11 00);
  - the farm or packhouse;
  - the destination country;
  - for roses and other point-62 goods to the EU, the option used and the place-of-production or production-site code;
  - the phyto status: issued (with its number, and ePhyto yes/no) or pending exit inspection at the airport — allow both [P12, P16];
  - the HCD export licence number and KEPHIS registration (Kenya);
  - the customs export entry;
  - the shipper's temperature range as one min–max in °C, plus humidity if given;
  - pre-cooled yes/no;
  - number of pallets;
  - for fish, the EU-listed establishment and the health certificate.
- **Documents to hold:** the phyto copy or ePhyto reference, the HCD licence, invoice, packing list, export entry, EUR.1 or invoice declaration, air waybill, and after the trip, the temperature log.
- **Truck:** a reefer with a set-point inside the shipper's range, pre-cooled, with a logger, doors sealed and seal numbers recorded.
  - For flowers in Kenya this is **PRACTICE or the shipper's requirement, not verified law** (EFSA-cited practice is 4–6 °C on the truck [P20]). Store it as such.
  - For fish, "melting ice" or ≤ −18 °C is LAW at the EU end [P30].
  - ATP certification applies only to international legs between ATP parties carrying Annex 3 foods. It never applies to a Kenyan farm-to-JKIA trip [P25, P26].
- **Refuse when:**
  - the shipper's range calls for a reefer and the truck has none;
  - a rose consignment to the EU has no site code or option recorded (point 62 is LAW);
  - the HCD licence or KEPHIS registration is missing for a Kenyan exporter;
  - a phyto has passed the validity window (the 24 h–7 day rule exists only in the KEPHIS draft, so warn rather than refuse).

### B. Pharmaceuticals and temperature-controlled healthcare
- **Facts to collect:**
  - product class: medicine, vaccine, controlled drug, or medical device;
  - one temperature range, identical on the booking, the waybill and the TTS label [P6, M3] (2–8, 15–25, frozen, and so on);
  - packaging type: passive, or an active container (ACT);
  - the maximum transport time;
  - the import or export authorisation number (Kenya PPB, per consignment [M17]);
  - the consignee's licence (Kenya r.7(1): the consignee is "authorized to possess" [M15]);
  - for controlled drugs, the export authorisation;
  - for vaccines, the destination store and the 24-hour clock from flight arrival [M34];
  - in Tanzania, whether TMDA has released the goods [M20].
- **Documents to hold:** the import permit or authorisation, the waybill showing the range, the carrier's licence, the logger record, and signed dispatch and arrival records [M15, M12]; for vaccines, the VAR is the consignee's — we hold a copy.
- **Truck and crew:**
  - **Kenya:** the carrier holds a **PPB transport licence, with this vehicle on it** [M15]. The cold chain is validated (job card), with an alarmed monitoring system, sensors calibrated yearly (KEBS or another accredited body), tracking and an engine-kill button, dedicated vehicles, and lockable doors.
  - **Rwanda:** the transport activity is registered [M22].
  - **Ethiopia:** a written agreement with the seller or buyer [M25].
  - **EU, UK, ZA, IN:** the carrier is the wholesaler's contract acceptor. It needs the wholesaler's written agreement and, often, an audit [M9, M32, M33].
  - **Everywhere:** cooling on throughout, including stops; no energy-saving mode; secure parking [M13].
- **Refuse when:**
  - Kenya and the carrier has no PPB transport licence, or the vehicle is not on it;
  - the range has no reefer or active container to match;
  - there is no logger or alarm;
  - the permit or authorisation is missing;
  - the consignee is not authorised;
  - a controlled drug has no authorisation copy, or a motorcycle is offered [M15];
  - Tanzania and the goods have no TMDA release.
- **Excursions:** report every excursion to both the shipper and the receiver, in the app, never by text [M9 9.2, M11 18.40].

### C. Live animals
- **Facts to collect:**
  - species, number, individual weights, and age (calves under 10 days; chicks within 72 hours of hatching [A8]);
  - pregnancy stage (WOAH: final 10 %; EU: 90 % of gestation; air guide 250 days for cows, 115 for goats [A9]);
  - the import permit number and type (Kenya VS03 and so on);
  - the destination named on the permit — often the quarantine or holding facility, not the farm (Uganda [A16]);
  - a movement permit where one is needed (Tanzania reg. 6; Kenya in infected areas; Rwanda's transport permit);
  - CITES, if the species is listed;
  - the ambient temperature at arrival;
  - the journey plan (duration, rests, an emergency plan) and the attendant.
- **Documents to hold:** copies of the import permit, vet certificate, CITES permit and movement permit (the originals travel), the journey plan and journey log, and the cleaning and disinfection record.
- **Truck:**
  - **For livestock**, a livestock body with:
    - anti-slip floor;
    - partitions strong enough for the animals' weight;
    - ventilation that works when stationary and can be adjusted;
    - roof and weather protection;
    - containment of faeces and urine;
    - surfaces that can be cleaned and disinfected;
    - lighting;
    - a ramp or lift with side protection, no steeper than 20° for calves and 26.6° for adult cattle and goats, with foot battens [A8, A9].
  - **For crated chicks and pets:** a closed, ventilated, temperature-managed van, crates upright, ventilation never blocked [A9, A21].
  - **Crew:** a competent handler, who may be the driver [A9]. In the EU or UK, a certificate of competence plus transporter authorisation, and Type 2 with an approved vehicle for journeys over 8 hours [A8].
- **Refuse when:**
  - papers are incomplete ("should not be loaded until the documentation … is complete" [A9]);
  - a required movement permit is missing;
  - the cleaning and disinfection record is missing;
  - the body is not animal-fit;
  - an animal is unfit (late pregnancy, unhealed navel, just given birth);
  - there is no heat plan above 25 °C;
  - the drop-off differs from the facility on the permit.
- Never sign the Shipper's Certification.

### D. Dangerous goods to an airport
- **Facts to collect:** the common UN Model description (UN number, proper shipping name, class and subsidiary hazard, packing group, number and type of packages, net quantity), plus the air layer:
  - passenger-and-cargo or CAO;
  - a CAO label present;
  - for lithium batteries, the packing instruction and Section, and state-of-charge compliance (A331);
  - DGD held (the shipper's, with a reference and the signer's training) or the waybill statement (Section II, dry ice);
  - a flag where the item is forbidden by air altogether.
- **Road layer:** ADR fields (tunnel code, orange plates, ADR driver certificate) only where ADR applies — Uganda, the EU and the UK [D12]. In Kenya: no general rule found; Traffic Act s.52B applies to stops in towns [D14].
- **Refuse when:**
  - the goods are forbidden by air (no truck to the airport);
  - UN3480, UN3090 or another CAO item is booked on a passenger flight;
  - a required DGD is not held, or packages are not marked or labelled for air;
  - state of charge is unknown where it is mandatory.
  - For high-consequence goods: no security plan (needs confirming against ADR 1.10 and Technical Instructions Part 1;4).

### E. Secure cargo (known consignor or regulated agent → airport)
- **Facts to collect:**
  - the security status, secured (SPX or SHR) or unsecured (it will be screened at the terminal);
  - the regulated agent or known consignor's name and number (KCAA, EU RA3/KC3);
  - the CSD reference;
  - seal numbers at pickup and at delivery;
  - the driver's photo ID document;
  - the vehicle can be locked or sealed (a curtain-sider needs a TIR cord).
- **Documents to hold:** the carrier's haulier declaration (Attachment 6-E pattern; 3 years on the Austrian form [D22]).
- **Conduct:** no unscheduled stops; any break in a seal is reported, never delivered silently [D22].
- **EU, from 1 Jan 2027:** inside the EU, only a regulated agent, a known consignor or an approved haulier may move secured cargo [D23].
- **Refuse** secured cargo when the vehicle cannot be locked or sealed, or the driver has no photo ID.
- Outside the EU, for a carrier without a haulier declaration, **warn** that the cargo loses its secure status and will be screened (Kenya reg. 49(4) [D16]).

---

## Questions for a lawyer
Each gives the moment it arises, the countries, and a use case.

1. **Must SeeBuyGet itself hold a Kenyan PPB transport licence?**
   - Moment: when a business posts a medicines load and SeeBuyGet stands as the contracting carrier (CMR box 16).
   - Countries: KE; similar questions in RW (Law 47/2012 Art. 3 "transport … must be registered") and ET (Directive 872/2022 "evidences of establishments").
   - Use case: a Nairobi wholesaler books 2–8 °C insulin from JKIA to its Industrial Area store.
   - Also: are LN 97/2022 rules still in force unamended?
2. **Does Kenya's reg. 15(1) reach a trucking platform?**
   - Moment: carrying known-consignor-secured flowers to JKIA.
   - Country: KE (Civil Aviation (Security) Regulations 2025).
   - Is SeeBuyGet "an enterprise … whose purpose is the movement of cargo … by air" that needs a regulated agent certificate? Or does a haulier need only the regulated agent's acceptance?
3. **Does the EU approved-haulier rule apply in Kenya?**
   - Moment: from 1 Jan 2027, any truck from a Kenyan known consignor (KC3) to an RA3.
   - Countries: EU/NL, KE, ET, UG.
   - Use case: a Naivasha farm (KC3) to an RA3 at JKIA, then to Schiphol. Does Reg. 2024/1255 reach that leg through RA3/ACC3 validation?
4. **Who bears a temperature excursion, and on what terms?**
   - Moment: the logger shows an excursion at the terminal, and the airline refuses under TCR B1.
   - Countries: KE (domestic, no CMR), and cross-border CMR legs.
   - Use case: a flower load rejected for warm pulp, or a vaccine load breached.
   - Also: how our "damage is reported, not judged" rule fits the GDP rule that excursions are "reported to the distributor and recipient".
5. **Who applies for movement permits and the destination for imported animals?**
   - Moment: booking a truck from JKIA, EBB or DAR for imported heifers.
   - Countries: KE (Cap 364, county movement control), TZ (GN 478C reg. 6), RW (RAB permit), UG (quarantine).
   - Who applies, the importer or the carrier? May the truck go to a farm, or only to the facility on the permit?
6. **What does Kenya's Prevention of Cruelty to Animals Act Cap 360 require of a carrier?**
   - Moment: any livestock load in KE.
   - Use case: a 6-hour drive with no rest stop, or no attendant.
   - Is there a driver duty or liability when the importer's attendant leaves?
7. **Signing as agent.**
   - Moment: the export or import desk, when a customer asks SeeBuyGet to "fill in and sign" a DGD, a Shipper's Certification for Live Animals or a CSD.
   - Countries: all.
   - Confirm we must refuse, and what liability follows if staff do it anyway (IATA checklist item 14; Kenya reg. 70 false declarations).
8. **Copies and originals.**
   - Moment: a roadside veterinary or police check between the airport and quarantine.
   - Countries: KE, UG, TZ, ET.
   - Does a held digital copy of the vet certificate or permit suffice, or must the original ride in the cab (WOAH 5.2.3)?
9. **Dangerous goods by road in a non-ADR state.**
   - Moment: a lithium-battery or flammable load trucked to JKIA, or Kampala to JKIA crossing from an ADR state into a non-ADR state.
   - Countries: KE, TZ, RW, ET (not ADR parties), UG (an ADR party).
   - Which standard binds the domestic leg? Is the Tripartite model law in force anywhere?
10. **Controlled drugs.**
    - Moment: posting a narcotic or psychotropic consignment from JKIA.
    - Country: KE (the Narcotic Drugs and Psychotropic Substances Act was not read).
    - Does the carrier need its own authorisation or escort, beyond the PPB transport licence and the authorisation copy?
11. **Tanzania release under seal.**
    - Moment: collecting medicines at JNIA released to the importer's premises under seal.
    - Country: TZ (GN 312/2015 r.28(2): such places are "deemed to be the ports of entry").
    - Who is responsible for the seal en route, and does the carrier become part of the "port"?
12. **Driver identity data.**
    - Moment: sharing a driver's photo ID and vehicle details with a regulated agent or the airline for secure cargo.
    - Countries: KE (Data Protection Act), EU (GDPR).
    - What lawful basis covers it, and how long may it be kept?

---

## Could not verify
- **IATA:** the ONE Source register (CEIV Pharma, Fresh and Live Animals) for:
  - JKIA handlers, including whether Swissport's 2021 CEIV Fresh is current;
  - Ethiopian's certification year;
  - EBB, KGL, DAR, JNB, dnata and QAS;
  - Emirates' CEIV status (as distinct from its GDP claim).
  
  Also: the primary handling-code list and bands (PIL, COL, ERT, FRO); the PCR and LAR container texts, including the CR numbers for cattle, goats and chicks; when a forwarder may sign a DGD; the full DGD field list.
- **ICAO:** the verbatim Annex 17 definitions and 4.6.x; Doc 8973; Technical Instructions Part 1;4 and 5;4.1.6 (snippet only); whether the 2027–2028 Technical Instructions are published.
- **UNECE ADR text** (403): Arts 1–2, 1.1.4.2 (transport chains including air), 1.10 security plans, 8.2 driver training, the dry ice exemption, and road carriage of UN0030.
- **EU:**
  - the consolidated 2015/1998, including the third-country (RA3/KC3) haulier provisions and PLACI;
  - the full text of 2024/1255;
  - the KSDA database (current Kenyan RA3s and any KC3s);
  - the act behind the 25 % check rate on Kenyan roses;
  - interceptions from 2023 to 2026;
  - what NVWA does with an intercepted consignment at Schiphol;
  - amendments to Annex IX of 2021/405;
  - Art. 1(5) of Reg. 1/2005 (pets and non-commercial transport).
- **Kenya:**
  - the texts of Cap 324, Cap 319, the KEPHIS Act, the Crops (Horticultural Crops) Regulations 2020, any per-consignment HCD permit, KEBS cold-chain standards and the Fisheries Act;
  - any legal reefer requirement for flowers, produce or fish;
  - whether the phyto is issued at the farm or at JKIA;
  - the Animal Diseases Rules permit wording, the post-entry quarantine station for JKIA imports, the DVS pet and rabies conditions, any day-old chick ban, and the Cap 360 text;
  - whether LN 97/2022 was later amended;
  - the Narcotic Drugs and Psychotropic Substances Act;
  - the NCASP haulier and known-consignor provisions, and KAA cargo-village permits;
  - KenTrade/iCMS steps;
  - the KFC FOSS and KenyaGAP cold-chain clauses;
  - the NVIP/KEMSA vaccine arrival practice at JKIA.
- **Uganda:** the whole of NDA (blocked); the Animal Diseases Act and cruelty law; the UCAA cargo scheme; how ADR is applied nationally.
- **Tanzania:** whether the TMDA GSDP Regulations were gazetted; the animal import regulations and ports; the Animal Welfare Act Cap 154; the TCAA scheme; the ePhyto feed discrepancy.
- **Rwanda:** the animal import law, quarantine and ports; a Rwanda FDA GDP guideline; whether Law 47/2012 Art. 3 still stands beside Law 003/2018; the RCAA scheme.
- **Ethiopia:** whether Proclamation 267/2002 has been superseded; quarantine stations; any welfare-in-transport rule; the ECAA scheme; the EPSS vaccine flow; the EAA phytosanitary legal texts (scans).
- **AE, IN, CN, ZA:** veterinary import laws; the medicines transport provisions (UAE Decree-Law 38/2024, NMPA GSP, Indian Drugs and Cosmetics Rules licences); the security scheme names (GCAA, BCAS, CAAC); South Africa's road dangerous goods rules (NRTR Ch. VIII) and SANS 1488; ePhyto arrangements outside the Hub for the UAE and China.
- **CITES:** all primary text (Res. Conf. 10.21, the permit rules, KWS as Management Authority, the African grey parrot listing).
- **Heifer and breeding-cattle airlifts into East Africa** (numbers, airlines, quarantine used): not researched; the search budget ran out.
- **The search budget** was used up. Another turn, or a higher `CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION`, would let the CEIV registers, the heifer programmes, Uganda NDA and the Kenyan statutes (through other official copies) be checked.

---

## Sources (all read 2026-10-29)

**Perishables**
- P1 https://www.iata.org/en/publications/manuals/perishable-cargo-regulations/
- P2 https://www.iata.org/en/publications/store/perishable-cargo-regulations/
- P3 https://www.iata.org/en/publications/newsletters/iata-knowledge-hub/how-to-ship-perishable-goods-by-air/
- P4 https://www.iata.org/en/publications/newsletters/iata-knowledge-hub/how-to-avoid-loss-and-waste-of-perishable-goods-when-shipping-by-air/
- P5 https://edge.sitecorecloud.io/sascargo1-cargoweb-prod-ae6c/media/Files/Pdf/Special-Handling-Codes---2025.pdf
- P6 https://www.iata.org/contentassets/6d7404d9ccca4e4e9c4ce146e4a2acb1/time-temperature-faq.pdf
- P7 https://www.iata.org/en/services/certification/special-cargo/ceiv-fresh/
- P8 https://www.swissport.com/en/news/current-news/2021/swissport-awarded-iata-ceiv-fresh-certification-in-kenya
- P9 http://www.fao.org/3/k5129e/k5129e.pdf (from https://www.ippc.int/en/publications/609/)
- P10 https://www.ephytoexchange.org/hub/api/lookups/landingdata (map: https://www.ephytoexchange.org/landing/)
- P11 https://kephis.org/images/Newsletters/kephis-Newsletter-May-2021.pdf
- P12 https://www.kephis.go.ke/phytosanitary-services
- P13 https://www.kephis.go.ke/laws-regulations-and-rules-under-review-or-development
- P14 https://www.kephis.go.ke/sites/default/files/2024-10/Procedure%20for%20registration%20as%20an%20exporter.pdf
- P15 https://kephis.org/images/article-of-the-month/DRAFT%20PLANT%20PROTECTION%20(IMPORT%20AND%20EXPORT)%20REGULATIONS%202021.pdf
- P16 https://www.agroberichtenbuitenland.nl/actueel/nieuws/2025/01/06/safeguarding-kenyas-floriculture-exports-from-the-effects-of-the-false-codling-moth-fcm
- P17 https://www.ippc.int/en/countries/ethiopia/ ; https://eaa.gov.et/guidelines/
- P18 http://publications.europa.eu/resource/celex/32019R2072 ; http://publications.europa.eu/resource/celex/02019R2072-20261015
- P19 http://publications.europa.eu/resource/celex/32024R2004
- P20 https://doi.org/10.2903/j.efsa.2023.8107 (full text: https://www.ebi.ac.uk/europepmc/webservices/rest/PMC10585611/fullTextXML)
- P21 https://food.ec.europa.eu/plants/plant-health-and-biosecurity/europhyt/interceptions_en
- P22 http://publications.europa.eu/resource/celex/32019R1013
- P23 http://publications.europa.eu/resource/celex/22024X01684 ; http://data.europa.eu/eli/agree_internation/2024/1648/oj
- P24 http://publications.europa.eu/resource/celex/32016R1076
- P25 https://digitallibrary.un.org/record/4090548/files/ECE_TRANS_347-EN.pdf
- P26 https://treaties.un.org/Pages/ViewDetails.aspx?src=TREATY&mtdsg_no=XI-B-22&chapter=11&clang=_en
- P27 https://www.kefs.go.ke/importexport
- P28 https://www.kenyaflowercouncil.org/index.php/certification/our-standard/f-o-s-s
- P29 http://publications.europa.eu/resource/celex/32004R0852
- P30 http://publications.europa.eu/resource/celex/32004R0853
- P31 http://publications.europa.eu/resource/celex/32021R0405
- P32 http://publications.europa.eu/resource/celex/32017R0625
- P33 http://publications.europa.eu/resource/celex/32020R2235
- P34 https://www.gov.uk/guidance/import-plants-and-plant-products-from-non-eu-countries-to-great-britain
- P35 https://planthealthportal.defra.gov.uk/assets/Regulation-EU-2024.2004-v2.pdf
- P36 https://www.ippc.int/en/countries/ (one page per country)

**Pharma**
- M1 https://www.iata.org/en/programs/cargo/pharma/
- M2 https://www.iata.org/en/publications/manuals/temperature-control-regulations/
- M3 https://www.iata.org/contentassets/6d7404d9ccca4e4e9c4ce146e4a2acb1/en_tcr_acceptance_checklist.pdf
- M4 https://www.iata.org/contentassets/6d7404d9ccca4e4e9c4ce146e4a2acb1/faq-checklist-pharma-2014-en.pdf
- M5 https://www.iata.org/en/services/certification/special-cargo/ceiv-pharma/
- M6 https://cargo.ethiopianairlines.com/
- M7 https://www.kqcargo.com/en/products-services/products/kq-pharma/
- M8 https://www.skycargo.com/media-centre/a-decade-of-delivering-health-and-wellbeing-emirates-skycargo-surpasses-one-million-pharma-shipments-through-dubai
- M9 http://publications.europa.eu/resource/cellar/b9c5c838-5415-11e3-8945-01aa75ed71a1 (CELEX 52013XC1123(01))
- M10 Cellar 59360211-cf5c-11e4-9a66-01aa75ed71a1 (CELEX 52015XC0321(01))
- M11 https://www.who.int/publications/m/item/trs-1025-annex-7
- M12 https://www.who.int/publications/m/item/trs961-annex9-modelguidanceforstoragetransport
- M13 https://cdn.who.int/media/docs/default-source/medicines/norms-and-standards/guidelines/distribution/trs961-annex9-supp12.pdf
- M14 https://web.pharmacyboardkenya.org/wp-content/uploads/2026/05/Pharmacy-and-Poisons-Act.pdf
- M15 https://web.pharmacyboardkenya.org/download/ppb-rules-june-2022/
- M16 https://web.pharmacyboardkenya.org/online-systems/
- M17 https://web.pharmacyboardkenya.org/download/guidelines-for-good-distribution-practices-for-medical-products-and-health-technologies-in-kenya/
- M18 https://web.pharmacyboardkenya.org/ports-of-entry/
- M19 https://www.parliament.go.ke/sites/default/files/2026-07/Bill%20Digest%20-The%20Quality%20HealthCare%20and%20Patient%20Safety%20Bill%2C%20%28NA%20Bill%20No.41%20of%202025%29.pdf
- M20 https://www.tmda.go.tz/uploads/publications/en1597131974-Registration%20of%20Premises,%20Importation%20and%20Exportation%20of%20Pharmaceutical%20Products%20and%20Raw%20Materials%20Regulations,%202015.pdf
- M21 https://www.tmda.go.tz/uploads/publications/en1669647328-en1610787589-TMDA%20(GSDP)%20Regulations,%20Not%20signed%20version.pdf
- M22 https://www.rwandafda.gov.rw/fileadmin/user_upload/RwandaFDA/Publications/Laws___Regulations/General_Laws/Law-relating-to-the-regulation-and-inspection-of-food-and-pharmaceutical-products.pdf
- M23 https://www.rwandafda.gov.rw/fileadmin/user_upload/RwandaFDA/Publications/Laws___Regulations/Import___Export/Regulation-Governing-control-of-import_export-of-pharmaceutical-products_medical-devices.pdf
- M24 https://www.efda.gov.et/wp-content/uploads/2020/06/Food-and-Medicine-Administration-Proclamation-1112.pdf
- M25 https://www.efda.gov.et/wp-content/uploads/2023/06/Medicine-and-Medical-Device-Import-Export-and-Wholesale-Control-Directive-872-2022.pdf
- M26 https://www.efda.gov.et/wp-content/uploads/2024/10/GDPGSP-and-Re-call-Guideline-Revised-Second-edition.pdf
- M27 https://wetten.overheid.nl/BWBR0021505/2025-01-01
- M28 https://www.legislation.gov.uk/uksi/2012/1916/regulation/18 ; https://www.legislation.gov.uk/uksi/2012/1916/regulation/43
- M29 https://mhrainspectorate.blog.gov.uk/2020/07/15/a-practical-example-of-applying-quality-risk-management-in-gdp-transportation-risks
- M30 https://www.ede.gov.ae/en/legislations
- M31 https://www.sahpra.org.za/wp-content/uploads/2019/09/Medicines-and-Related-Substances-Act_101-of-1965_Act_GG-40869_2017-05-26.pdf
- M32 https://www.sahpra.org.za/wp-content/uploads/2022/09/SAHPGL-INSP-03_v5-Guideline-on-South-African-Good-Wholesaling-Practice-for-Wholesalers.pdf
- M33 https://cdsco.gov.in/opencms/resources/UploadCDSCOWeb/2022/Guidance_doc/GDP.pdf
- M34 https://cdn.who.int/media/docs/default-source/immunization/supply-chain/evm-model-sop-manual-en-june-2013-compact.pdf
- M35 https://www.unodc.org/pdf/convention_1961_en.pdf
- M36 https://www.unodc.org/pdf/convention_1971_en.pdf

**Animals**
- A1 https://www.iata.org/en/programs/cargo/live-animals/
- A2 https://www.iata.org/contentassets/80b3908be0ca4ebe8d359292c46cdac2/20260101-lar-addendum-i-v1.0-final_ext.pdf
- A3 https://www.iata.org/contentassets/d7c512eb9a704ba2a8056e3186a31921/lar-49-significant-changes.pdf
- A4 https://www.iata.org/en/publications/newsletters/iata-knowledge-hub/questions-and-answers-for-shipping-live-animals-by-air/
- A5 https://www.iata.org/contentassets/d7c512eb9a704ba2a8056e3186a31921/lar_en_live_animals_acceptance_checklist.pdf
- A6 https://aircanada.com/cargo/assets/file/forms/shipper-certification-en.pdf
- A7 https://www.iata.org/en/services/certification/special-cargo/ceiv-animals/
- A8 https://www.legislation.gov.uk/eur/2005/1/annex/I/chapter/II/adopted (and other parts of /eur/2005/1/, including /annex/VI)
- A9 https://www.woah.org/fileadmin/Home/eng/Health_standards/tahc/current/chapitre_aw_land_transpt.pdf (and chapitre_aw_air_transpt.pdf, chapitre_aw_sea_transpt.pdf, chapitre_aw_introduction.pdf, chapitre_certification_general.pdf, chapitre_certification_procedures.pdf)
- A10 https://kilimo.go.ke/dvs-2/
- A11 https://infotradekenya.go.ke/media/201_AnimaldiseasesAct4of1965.pdf
- A12 https://infotradekenya.go.ke/
- A13 https://kilimo.go.ke/wp-content/uploads/2024/10/15.05.2023-LIVESTOCK-BREEDING-REGULATIONS-2023.pdf
- A14 https://kilimo.go.ke/wp-content/uploads/2024/08/ANITRAC-Kenya-Regulations-Cap-364-version-2020-3rd-September-2020-1.pdf
- A15 https://kilimo.go.ke/wp-content/uploads/2026/10/Draft-2026.-Sessional-Paper-No.-2-on-the-Veterinary-Policy-.pdf
- A16 https://www.agriculture.go.ug/import-export-and-transit-of-animals-and-animal-products-in-uganda/ ; https://www.agriculture.go.ug/acts/
- A17 https://www.mifugouvuvi.go.tz/services/vibali-vya-mifugo
- A18 https://www.mifugouvuvi.go.tz/uploads/documents/sw-1761253441-GN-478C%20THE%20ANIMAL%20DISEASES%20(ANIMALS%20AND%20ANIMAL%20PRODUCTS%20MOVEMENT%20CONTROL)REGULATIONS,%202022(2).pdf
- A19 https://www.rab.gov.rw/online-services
- A20 https://www.moa.gov.et/wp-content/uploads/2024/12/Proc-No.-267-2002-Animal-Diseases-Prevention-and-Control.pdf
- A21 https://kilimo.go.ke/wp-content/uploads/2024/08/Reviewed-Poultry-Regulations-15.05.2023.pdf
- A22 https://oeil.europarl.europa.eu/oeil/en/procedure-file?reference=2023/0448(COD)
- A23 https://www.legislation.gov.uk/uksi/2006/3260/article/5
- A24 https://www.legislation.gov.uk/ukpga/2024/11/section/1
- A25 https://www.nvwa.nl/onderwerpen/dier/import-dieren-en-dierlijke-producten ; https://www.nvwa.nl/onderwerpen/dier/vervoer-levende-dieren
- A26 https://www.gov.uk/guidance/importing-live-animals-or-animal-products-from-non-eu-countries
- A27 https://www.nda.gov.za/index.php/core-business/agricultural-production/animal-production/animal-health

**Dangerous goods and security**
- D1 https://www.icao.int/Dangerous-Goods/Technical-Instructions
- D2 https://www.icao.int/sites/default/files/safety/DangerousGoods/htmls/StateVariation.en.html
- D3 https://www.iata.org/en/programs/cargo/dgr/
- D4 https://www.iata.org/contentassets/9dece0d6bb3c41d2bd95456b18215908/dgr-68-en-significant-changes.pdf
- D5 https://www.iata.org/contentassets/90f8038b0eea42069554b2f4530f49ea/dgr-67-addendum-1---en---01-january-2026.pdf
- D6 https://www.iata.org/contentassets/05e6d8742b0047259bf3a700bc9d42b9/lithium-battery-guidance-document.pdf
- D7 https://www.iata.org/en/programs/cargo/dangerous-goods/shippers-declaration/
- D8 https://www.iata.org/contentassets/a9f496cd8c87466b98142fa6d4cdb209/iata_edgd_implementationguide.pdf
- D9 https://www.iata.org/contentassets/90f8038b0eea42069554b2f4530f49ea/dgcbta-1-en.pdf
- D10 https://www.iata.org/contentassets/90f8038b0eea42069554b2f4530f49ea/white-paper-safety-and-security-in-the-cargo-supply-chain.pdf
- D11 https://www.icao.int/sites/default/files/APAC/Meetings/2025/2025%20COSCAPSEA%20%20EASA%20DGI/5-Presentations/01-Introduction-about-DG.pdf
- D12 https://treaties.un.org/Pages/ViewDetails.aspx?src=TREATY&mtdsg_no=XI-B-14&chapter=11&clang=_en
- D13 https://sadc.int/latest-news/comesa-sadc-and-eac-collaborate-ease-movement-people-and-goods-regions-boost-intra
- D14 https://infotradekenya.go.ke/media/Traffic%20Act%20CAP%20403.pdf
- D15 https://www.kcaa.or.ke/safety-security-oversight/aviation-security/aviation-security-legislation
- D16 https://www.kcaa.or.ke/sites/default/files/regulation/Legal%20Notice%20No.%2031%20-%20Civil%20Aviation%20(Security)%20Regulations%2C%202025.pdf
- D17 https://www.kcaa.or.ke/safety-security-oversight/aviation-security/in-flight-catering-operators
- D18 https://www.kcaa.or.ke/sites/default/files/LIST%20OF%20CERTIFIED%20REGULATED%20AGENTS%20IN%20KENYA%20AS%20OF%2030%20APRIL%202025.pdf
- D19 https://www.kcaa.or.ke/safety-security-oversight/air-operations/carriage-of-dangerous-goods
- D20 https://www.legislation.gov.uk/eur/2015/1998/annex/adopted
- D21 https://www.legislation.gov.uk/eur/2015/1998/annex ; https://www.legislation.gov.uk/uksi/2024/590/made
- D22 https://www.bmimi.gv.at/dam/jcr:24477480-d029-4f94-a224-08b99e46385a/transporteurserklaerung_6E_EN_202208.pdf
- D23 https://www.caa.gov.lv/en/article/changes-transport-air-cargo-and-mail-1-january-2027
- D24 https://transport.ec.europa.eu/transport-modes/air/aviation-security/air-cargo-and-mail/information-cargo-handling-entities-non-eu-countries_en
- D25 https://transport.ec.europa.eu/transport-modes/air/aviation-security/air-cargo-and-mail/information-air-carriers_en
- D26 https://taxation-customs.ec.europa.eu/customs-4/customs-security/import-control-system-2-ics2-0_en
- D27 https://www.icao.int/Security/aircargo/Pages/The-Phase-Out-of-Account-Consignors.aspx
- D28 https://www.caa.co.uk/commercial-industry/security/aviation-security-services-and-charges/uk-acc3-scheme/
- D29 https://www.caa.co.za/industry-information/aviation-security/
- D30 https://caasanwebsitestorage.blob.core.windows.net/aviation-security-forms/Declaration.pdf
- D31 https://www.caa.co.za/industry-information/dangerous-goods/
- D32 https://www.tcaa.go.tz/publications/civil-aviation-regulations
- D33 https://caa.go.ug/ ; https://www.caa.gov.rw/ ; https://ecaa.gov.et/ ; https://www.gcaa.gov.ae/en/ ; https://www.bcasindia.gov.in/