// Knowledge Base defaults: glossary, CP forms, vessel sizes, stowage factors. Our own short explanations;
// links go to handybulk lessons (slugs from its sitemap). The size and SF tables are editable in the KB tab
// (the edited table is stored on the server and replaces these defaults until "Reset").
import { get } from '../core/api.js';

export const LESSON_BASE = 'https://www.handybulk.com/';
export const lessonUrl = (slug) => (slug ? LESSON_BASE + slug + '/' : null);

/** [abbreviation, expansion, explanation, handybulk slug | null] */
export const GLOSSARY = [
    ['AA', 'Always afloat', 'The vessel must remain afloat at all states of tide at the berth/port; the opposite of NAABSA.', 'safe-port-in-ship-chartering-meaning-safe-berth-naabsa-and-charterers-liability'],
    ['A/E', 'Auxiliary engine', 'Generators; their consumption counts in port and at sea on top of the main engine.', null],
    ['APS', 'Arrival pilot station', 'Delivery / redelivery point at the pilot station on arrival, before berthing.', null],
    ['ATS', 'All time saved', 'Despatch is paid on all time saved, including time that would have been excepted (weekends, holidays).', 'despatch-in-ship-chartering'],
    ['BB', 'Ballast bonus / Bareboat', 'In time charter: lumpsum paid to owners for the ballast leg to delivery. In other contexts: bareboat charter.', 'ballast-bonus'],
    ['BBB', 'Before breaking bulk', 'Freight earned and payable before discharge commences.', null],
    ['BOD / BOR', 'Bunkers on delivery / on redelivery', 'Quantities and prices of fuel on board at delivery (charterers pay owners) and redelivery (owners pay charterers).', 'ship-bunkers-on-time-charter'],
    ['B/L', 'Bill of lading', 'Receipt for the cargo, evidence of the contract of carriage and document of title.', 'bill-of-lading-in-dry-bulk-shipping'],
    ['C/V/E', 'Cable, victualling, entertainment', 'Monthly lumpsum paid by time charterers to owners for communications, crew meals and representation.', null],
    ['COA', 'Contract of affreightment', 'Contract to carry a total quantity over a period in several shipments; the owner nominates vessels.', null],
    ['CP', 'Charter party', 'The contract between owners and charterers (voyage, time or bareboat).', 'charterparty'],
    ['CQD', 'Customary quick despatch', 'No fixed laytime: cargo is to be worked as fast as the port customarily allows.', null],
    ['CTM', 'Cash to master', 'Cash advance delivered to the master at port for disbursements, usually deducted from hire/freight.', null],
    ['DHD', 'Despatch half demurrage', 'Despatch rate is half of the demurrage rate.', 'despatch-in-ship-chartering'],
    ['DLOSP', 'Dropping last outward sea pilot', 'Delivery/redelivery when the last pilot disembarks on departure.', null],
    ['DOP', 'Dropping outward pilot', 'Delivery/redelivery point when the outward pilot leaves the vessel.', null],
    ['DWA', 'Dock water allowance', 'Extra sinkage allowed when loading in water lighter than sea water (FWA × (1025 − ρ) / 25).', 'tpc-tons-per-centimeter'],
    ['DWCC', 'Deadweight cargo capacity', 'Deadweight less bunkers, fresh water, stores and constants: what the ship can actually lift.', 'what-is-deadweight-tonnage-dwt'],
    ['DWT / SDWT', 'Deadweight / summer deadweight', 'Total weight the ship can carry (cargo, bunkers, water, stores) at the summer load line.', 'what-is-deadweight-tonnage-dwt'],
    ['ETA / ETD / ETC', 'Estimated time of arrival / departure / completion', 'Planning times; ETA notices to charterers/receivers are usually required by the CP.', null],
    ['ETS', 'EU Emissions Trading System', 'EU carbon allowances (EUA) must be surrendered for CO2 from voyages to, from and within the EU.', 'ship-environmental-regulations-guide-marpol-ballast-water-and-emissions'],
    ['FHEX', 'Fridays and holidays excepted', 'Laytime convention in some Middle-East ports where Friday is the weekly rest day.', 'laytime'],
    ['FIO / FIOS / FIOT / FIOST', 'Free in and out (stowed / trimmed)', 'Loading and discharging (and stowing / trimming) are for charterers’ account, not included in freight.', 'fio-in-ship-chartering-free-in-and-out-fios-fiot-and-fiost-explained'],
    ['FWA', 'Fresh water allowance', 'How much the draft increases in fresh water vs sea water: displacement ÷ (4 × TPC), in mm.', 'tpc-tons-per-centimeter'],
    ['HO/HA', 'Holds / hatches', 'Number of cargo holds and hatches, e.g. 5HO/5HA.', 'what-is-handysize-bulk-carrier'],
    ['ILOHC', 'In lieu of hold cleaning', 'Lumpsum paid instead of the charterers cleaning the holds before redelivery.', 'cargo-hold-cleaning-in-dry-bulk-shipping-standards-charterparty-duties-and-hold-inspection'],
    ['Laycan', 'Laydays / cancelling', 'The window in which the ship must tender NOR; arriving after the cancelling date gives charterers the option to cancel.', 'what-is-laycan-lay-days-cancellation-days'],
    ['LOI', 'Letter of indemnity', 'Indemnity given to owners, typically to deliver cargo without original B/Ls or at a different port.', 'standard-letter-of-indemnity-loi-delivery-without-original-bills-of-lading-cargo-release-security-and-english-law'],
    ['MOLOO / MOLCHOPT', 'More or less in owners’ / charterers’ option', 'Who declares the final quantity within the agreed tolerance (e.g. 10%).', 'dry-bulk-cargo-order-examples-in-chartering-stowage-factor-cargo-intake-and-voyage-orders'],
    ['NAABSA', 'Not always afloat but safely aground', 'The ship may lie on soft bottom at low tide without damage.', 'port-restrictions-in-ship-chartering-draft-airdraft-loa-naabsa-and-canal-limits'],
    ['NDAS', 'Not done anything since', 'Broker shorthand: the vessel has not been fixed since the previous report.', 'ship-positions-example'],
    ['NOR', 'Notice of readiness', 'Notice from the master that the ship has arrived and is ready in all respects; triggers laytime after the turn time.', 'notice-of-readiness-nor-in-shipping-meaning-validity-laytime-and-demurrage-explained'],
    ['PWWD', 'Per weather working day', 'Daily rate that counts only days on which the weather allows work.', 'weather-working-days'],
    ['Recap', 'Fixture recapitulation', 'Summary of all agreed terms sent after fixing; the CP is drawn up from it.', 'ship-charter-negotiation-records-offers-counter-offers-subjects-and-fixture-recaps'],
    ['ROB', 'Remaining on board', 'Quantity of bunkers (or cargo) still on board.', 'bunkers-under-a-time-charterparty'],
    ['SDBC', 'Single deck bulk carrier', 'The standard dry bulk carrier design.', 'bulk-carrier-ship-sizes'],
    ['SF', 'Stowage factor', 'Volume one tonne of cargo occupies (cbm/mt or cuft/lt); decides whether volume or weight limits the intake.', 'stowage-factor'],
    ['SHEX', 'Sundays and holidays excepted', 'Sundays and holidays do not count as laytime (but count if used under SHEXUU).', 'laytime'],
    ['SHEXEIU', 'SHEX even if used', 'Sundays and holidays never count, even when the ship works.', 'laytime'],
    ['SHEXUU', 'SHEX unless used', 'Sundays and holidays do not count unless cargo is actually worked; then the time used counts.', 'laytime'],
    ['SHINC', 'Sundays and holidays included', 'Laytime runs continuously, every day counts.', 'laytime'],
    ['SOF', 'Statement of facts', 'Port record of events and times (arrival, NOR, berthing, loading, stoppages); the basis of the time sheet.', 'statement-of-facts-in-ship-chartering'],
    ['SSHEX', 'Saturdays, Sundays, holidays excepted', 'Weekends and holidays do not count as laytime.', 'laytime'],
    ['SSSB / SB / SP / SA', 'Safe berth / safe port / safe anchorage', 'Charterers’ warranty that the nominated place is safe for the ship.', 'safe-port-in-ship-chartering-meaning-safe-berth-naabsa-and-charterers-liability'],
    ['STEM', 'Subject to enough merchandise', 'Cargo is confirmed available at the load port for the laycan; also a bunker supply order.', 'charterparty-fixing-on-subjects-subject-stem-subject-details-and-lifting-subjects'],
    ['SUBS', 'Subjects', 'Conditions that must be lifted before a fixture is fully binding (e.g. shippers’ approval, board approval).', 'charterparty-fixing-on-subjects-subject-stem-subject-details-and-lifting-subjects'],
    ['TC / TCT', 'Time charter / trip time charter', 'Ship hired for a period or one trip at a daily hire; charterers pay bunkers and port costs.', 'time-charter'],
    ['TCE', 'Time charter equivalent', 'Voyage result expressed as daily hire: (net freight − voyage costs) ÷ voyage days.', 'voyage-estimation'],
    ['TPC', 'Tonnes per centimetre', 'Weight needed to change the mean draft by 1 cm at a given draft.', 'tpc-tons-per-centimeter'],
    ['WCCON', 'Whether customs cleared or not', 'NOR may be tendered before customs clearance.', 'notice-of-readiness-nor-and-commencement-of-laytime-in-ship-chartering'],
    ['WIBON', 'Whether in berth or not', 'NOR may be tendered on arrival at the port even if no berth is available.', 'notice-of-readiness-nor-and-commencement-of-laytime-in-ship-chartering'],
    ['WIFPON', 'Whether in free pratique or not', 'NOR may be tendered before free pratique (health clearance) is granted.', 'notice-of-readiness-nor-and-commencement-of-laytime-in-ship-chartering'],
    ['WIPON', 'Whether in port or not', 'NOR may be tendered at the customary waiting place even outside port limits.', 'notice-of-readiness-nor-and-commencement-of-laytime-in-ship-chartering'],
    ['WWD', 'Weather working day', 'A day on which work is not prevented by weather; bad-weather periods are excluded from laytime.', 'weather-working-days'],
    ['Abt', 'About', 'Usual tolerance on speed (≈0.5 kn) and consumption (≈5%) in a vessel description.', 'time-charter-party-main-features-hire-off-hire-speed-bunkers-and-nype-clauses'],
    ['Off-hire', 'Off-hire', 'Periods when hire stops under the CP (breakdown, deficiency of crew, etc.).', 'off-hire-clause-in-a-time-charterparty'],
    ['Once on demurrage', 'Always on demurrage', 'After laytime expires every minute counts, laytime exceptions (weather, holidays) no longer apply.', 'demurrage-in-a-voyage-charterparty'],
    ['Reversible', 'Reversible laytime', 'Load and discharge laytime are added together into one pool.', 'averaging-and-reversing-laytime'],
];

/** [form, type, what it is, slug] — check the edition actually agreed in the recap. */
export const CP_FORMS_INFO = [
    ['GENCON 94', 'Voyage', 'BIMCO general-purpose voyage charter; the most common dry-cargo voyage form (GENCON 2022 is the latest edition).', 'gencon-voyage-charterparty-guide-clauses-freight-laytime-demurrage-and-chartering-practice'],
    ['NYPE 46 / 93 / 2015', 'Time', 'New York Produce Exchange time charter; 46 is still widely used for dry bulk, 93 and 2015 are the BIMCO/ASBA revisions.', 'time-charter-party-main-features-hire-off-hire-speed-bunkers-and-nype-clauses'],
    ['ASBATIME', 'Time', 'ASBA’s revision of NYPE 46 time charter.', 'asbatime-time-charter-hire-off-hire-bunkers-cargo-operations-protective-clauses-and-rider-terms'],
    ['AMWELSH 93', 'Voyage', 'Americanized Welsh coal charter for coal cargoes.', 'amwelsh-93-coal-voyage-charter-freight-laytime-cargo-operations-protective-clauses-and-arbitration'],
    ['SYNACOMEX', 'Voyage', 'Continental grain voyage charter (French origin), widely used for grain from the Black Sea and Europe.', 'grain-charterparty-explained-graincon-norgrain-synacomex-2023-grain-voyage-charter-parties-and-bulk-grain-shipping'],
    ['NORGRAIN 89', 'Voyage', 'North American grain voyage charter.', 'norgrain-89-grain-voyage-charter-freight-laytime-cargo-handling-ice-war-risks-and-arbitration'],
    ['GRAINCON', 'Voyage', 'BIMCO standard grain voyage charter.', 'grain-charterparty-explained-graincon-norgrain-synacomex-2023-grain-voyage-charter-parties-and-bulk-grain-shipping'],
    ['BARECON 2001 / 2017', 'Bareboat', 'BIMCO bareboat charter: charterers take over the ship with their own crew.', 'bareboat-charter-agreement-example-barecon-2017-clauses-and-ship-registr'],
    ['SHIPMAN 2009', 'Management', 'BIMCO ship management agreement between owners and a manager.', 'ship-management-technical-management-crew-management-shipman-port-agents-and-shipowner-responsibilities-explained'],
    ['BIMCO ETS clauses', 'Clause', 'BIMCO emission trading scheme clauses for time charters (2022) and voyage charters (2023): who surrenders and pays the EUAs.', 'ship-environmental-regulations-guide-marpol-ballast-water-and-emissions'],
];

/** Typical ranges (approximate, edit in the KB). */
export const VESSEL_SIZES = [
    { size: 'Handysize', dwt: '15,000–40,000', draft: '9.5–10.5', loa: '130–180', beam: '23–30', note: 'Geared, small ports' },
    { size: 'Handymax', dwt: '40,000–50,000', draft: '11–11.5', loa: '180–190', beam: '30–32', note: 'Geared' },
    { size: 'Supramax', dwt: '50,000–60,000', draft: '12.5–13', loa: '190–200', beam: '32.26', note: '4×30–36 t cranes' },
    { size: 'Ultramax', dwt: '60,000–66,000', draft: '13–13.5', loa: '199–200', beam: '32.26–36', note: 'Geared' },
    { size: 'Panamax', dwt: '65,000–80,000', draft: '13.5–14.2', loa: '225', beam: '32.26', note: 'Old Panama canal beam, gearless' },
    { size: 'Kamsarmax', dwt: '80,000–85,000', draft: '14.3–14.5', loa: '229', beam: '32.26', note: 'Max LOA for Port Kamsar' },
    { size: 'Post-Panamax', dwt: '85,000–100,000', draft: '14.5–15', loa: '230–240', beam: '36–43', note: 'Neo-Panamax locks' },
    { size: 'Capesize', dwt: '150,000–200,000', draft: '17–18.5', loa: '280–300', beam: '45–50', note: 'Iron ore / coal' },
    { size: 'Newcastlemax', dwt: '200,000–210,000', draft: '18.2–18.5', loa: '299.9', beam: '50', note: 'Max for Newcastle NSW' },
    { size: 'Valemax (VLOC)', dwt: '380,000–400,000', draft: '22–23', loa: '360–362', beam: '65', note: 'Brazil – China ore' },
];

/** Approximate stowage factors; confirm with shippers for each parcel. */
export const STOWAGE_FACTORS = [
    { cargo: 'Wheat', sf: 1.28, range: '1.25–1.33', note: 'Bulk; grain rules (SOLAS)', slug: 'wheat-stowage-factor' },
    { cargo: 'Corn / maize', sf: 1.33, range: '1.30–1.40', note: 'Bulk', slug: 'corn-maize-stowage-factor' },
    { cargo: 'Barley', sf: 1.48, range: '1.42–1.53', note: 'Bulk', slug: 'grain-cargoes-in-shipping-solas-grain-rules-bulk-handling-bagged-grain-oilseeds-and-stowage-factors' },
    { cargo: 'Soybeans', sf: 1.37, range: '1.33–1.42', note: 'Bulk', slug: 'grain-cargoes-in-shipping-solas-grain-rules-bulk-handling-bagged-grain-oilseeds-and-stowage-factors' },
    { cargo: 'Sugar (raw, bulk)', sf: 1.25, range: '1.20–1.30', note: '', slug: 'agricultural-cargoes-in-shipping-foodstuffs-fibres-oil-bearing-products-sugar-tapioca-and-stowage-factors' },
    { cargo: 'Rice (bagged)', sf: 1.45, range: '1.40–1.55', note: 'Bale', slug: 'agricultural-cargoes-in-shipping-foodstuffs-fibres-oil-bearing-products-sugar-tapioca-and-stowage-factors' },
    { cargo: 'Coal (steam)', sf: 1.25, range: '1.15–1.35', note: 'IMSBC hazards', slug: 'coal-stowage-factor-in-bulk-shipping' },
    { cargo: 'Petcoke', sf: 1.45, range: '1.35–1.55', note: '', slug: 'coal-cargoes-in-shipping-thermal-and-coking-coal-cargo-hazards-petcoke-coke-and-stowage-factors' },
    { cargo: 'Iron ore (fines/lump)', sf: 0.39, range: '0.33–0.45', note: 'Weight limits; TML for fines', slug: 'ferrous-ore-cargoes-in-shipping-iron-ore-concentrates-dri-ferro-alloys-cargo-hazards-and-stowage-factors' },
    { cargo: 'Iron ore pellets', sf: 0.50, range: '0.45–0.55', note: '', slug: 'ferrous-ore-cargoes-in-shipping-iron-ore-concentrates-dri-ferro-alloys-cargo-hazards-and-stowage-factors' },
    { cargo: 'Clinker', sf: 0.85, range: '0.80–0.90', note: '', slug: 'cement-cargoes-in-shipping-bagged-cement-clinker-bulk-handling-dust-control-and-stowage-factors' },
    { cargo: 'Cement (bulk)', sf: 0.82, range: '0.70–0.90', note: 'handybulk Apollon example 0.82', slug: 'cement-cargoes-in-shipping-bagged-cement-clinker-bulk-handling-dust-control-and-stowage-factors' },
    { cargo: 'Urea (bulk)', sf: 1.40, range: '1.30–1.50', note: 'Hygroscopic', slug: 'fertilizer-cargoes-in-shipping-natural-and-compound-fertilizers-bulk-handling-cargo-hazards-and-stowage-factors' },
    { cargo: 'DAP / MAP', sf: 1.10, range: '1.05–1.20', note: '', slug: 'fertilizer-cargoes-in-shipping-natural-and-compound-fertilizers-bulk-handling-cargo-hazards-and-stowage-factors' },
    { cargo: 'Salt', sf: 0.95, range: '0.85–1.05', note: 'Limewash holds', slug: 'bulk-salt-shipping-stowage-factor-hold-preparation-limewash-and-cargo-risks' },
    { cargo: 'Scrap (HMS 1&2)', sf: 1.80, range: '1.40–2.20', note: 'Volume limits', slug: 'mineral-cargoes-in-shipping-characteristics-handling-risks-and-stowage-factors' },
    { cargo: 'Steel products (coils/plates)', sf: 0.45, range: '0.30–0.60', note: 'Bale; tank-top strength', slug: 'cargo-stowage-and-handling-in-shipping-stowage-factors-ventilation-bulk-cargo-cargo-gear-and-hold-preparation' },
    { cargo: 'Logs', sf: 2.50, range: '2.20–2.80', note: 'Incl. deck cargo', slug: 'log-cargo-stowage-factors-timber-shipping-cargo-intake-and-chartering-guide' },
    { cargo: 'Wood pellets', sf: 1.55, range: '1.50–1.65', note: 'Off-gassing (CO)', slug: 'timber-cargoes-in-shipping-logs-sawn-timber-forest-products-wood-pulp-paper-and-stowage-factors' },
    { cargo: 'Bauxite', sf: 0.75, range: '0.70–0.85', note: 'Group A risk when wet', slug: 'mineral-cargoes-in-shipping-characteristics-handling-risks-and-stowage-factors' },
    { cargo: 'Manganese ore', sf: 0.45, range: '0.40–0.55', note: '', slug: 'mineral-cargoes-in-shipping-characteristics-handling-risks-and-stowage-factors' },
    { cargo: 'Sulphur', sf: 0.95, range: '0.90–1.00', note: 'Corrosive', slug: 'chemical-and-plastic-cargoes-in-shipping-cargo-properties-handling-methods-and-stowage-factors' },
];

export const KB_DEFAULTS = {
    sf: STOWAGE_FACTORS,
    sizes: VESSEL_SIZES,
    glossary: GLOSSARY.map(([abbr, expansion, text, slug]) => ({ abbr, expansion, text, slug })),
};

let cache = null;
/** Effective KB tables (the edited version from the server, else the defaults). `meta` says which are customised. */
export async function kbTables(force = false) {
    if (!cache || force) {
        const saved = await get('chartering/kb').catch(() => ({}));
        cache = { ...Object.fromEntries(Object.entries(KB_DEFAULTS).map(([k, v]) => [k, saved[k]?.rows ?? v])), meta: saved };
    }
    return cache;
}

const SF_GENERIC = ['bulk', 'bagged', 'fines', 'lump', 'products', 'coils', 'plates', 'steam'];
/** Stowage factor (cbm/mt) for a cargo name from the KB table: exact, then partial match. */
export function sfFor(table, cargo) {
    const c = String(cargo ?? '').toLowerCase().trim();
    if (!c) return null;
    const rows = table.filter((r) => Number(r.sf) > 0);
    const hit = rows.find((r) => r.cargo.toLowerCase() === c)
        ?? rows.find((r) => r.cargo.toLowerCase().split(/[\s/(),&]+/).some((w) => w.length > 3 && !SF_GENERIC.includes(w) && c.includes(w)));
    return hit ?? null;
}

/** Contact roles (Contacts tab). */
export const CONTACT_KINDS = { owner: 'Owners', operator: 'Operators', charterer: 'Charterers', broker: 'Brokers', agent: 'Agents', surveyor: 'Surveyors', bunker: 'Bunker suppliers', other: 'Other' };
