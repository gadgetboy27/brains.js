/**
 * Places library — common hospital destinations to speed up building a
 * venue. Each entry is a ready-made POI: the name visitors expect, the other
 * things people call it (so search finds it), and a category. The admin
 * panel offers these as suggestions and fills the form from them; nothing
 * here is placed automatically — a place only exists once staff put it on a
 * node.
 *
 * Te reo Māori names are included where they are in common signage use;
 * they should still be reviewed by the venue's Māori health team, and any
 * venue can override names in its own JSON.
 *
 * `access: 'staff'` marks places that should not be offered to visitors.
 * Entries with `external: true` are destinations *outside* the building
 * (train station, bus stop): route to the exit nearest them and let the HUD
 * say "leave by …".
 */

/**
 * @typedef {Object} PlaceTemplate
 * @property {string} name
 * @property {string[]} aliases
 * @property {string} category
 * @property {'public' | 'staff'} [access]
 * @property {boolean} [external]
 * @property {string} [note]   Guidance for the person placing it.
 */

/** @type {ReadonlyArray<PlaceTemplate>} */
export const HOSPITAL_PLACES = Object.freeze([
  // --- entrances and getting there
  {
    name: 'Main entrance',
    aliases: ['Front entrance', 'Main door', 'Entrance', 'Exit', 'Way out', 'Tomokanga matua'],
    category: 'exit',
    note: 'Put a QR anchor here.',
  },
  {
    name: 'Emergency Department entrance',
    aliases: ['ED entrance', 'A&E', 'Emergency', 'Accident and emergency'],
    category: 'exit',
    note: 'Separate from the main entrance at most hospitals; QR anchor.',
  },
  {
    name: 'Drop-off zone',
    aliases: ['Pick-up', 'Patient drop-off', 'Set-down'],
    category: 'exit',
    external: true,
  },
  {
    name: 'Main car park',
    aliases: ['Car park', 'Parking', 'Visitor parking'],
    category: 'exit',
    external: true,
  },
  {
    name: 'Mobility parking',
    aliases: ['Disabled parking', 'Accessible parking'],
    category: 'exit',
    external: true,
  },
  { name: 'Bus stop', aliases: ['Bus', 'Buses'], category: 'exit', external: true },
  {
    name: 'Train station',
    aliases: ['Railway station', 'Trains', 'Station'],
    category: 'exit',
    external: true,
    note: 'Route to the nearest exit; the HUD names it.',
  },
  { name: 'Taxi rank', aliases: ['Taxis', 'Rideshare', 'Uber'], category: 'exit', external: true },
  {
    name: 'Shuttle stop',
    aliases: ['Shuttle', 'Hospital shuttle'],
    category: 'exit',
    external: true,
  },

  // --- reception and help
  {
    name: 'Main reception',
    aliases: [
      'Public reception',
      'Reception',
      'Front desk',
      'Information desk',
      'Enquiries',
      'Check-in',
    ],
    category: 'service',
    note: 'QR anchor: people stop here.',
  },
  {
    name: 'Emergency Department reception',
    aliases: ['ED reception', 'ED triage', 'Triage', 'Emergency reception'],
    category: 'service',
  },
  {
    name: 'Outpatients reception',
    aliases: ['Outpatients', 'OPD', 'Clinic reception'],
    category: 'service',
  },
  { name: 'Volunteer desk', aliases: ['Volunteers', 'Guides', 'Help desk'], category: 'service' },
  { name: 'Security office', aliases: ['Security'], category: 'service' },
  {
    name: 'Patient information',
    aliases: ['Patient advocate', 'Feedback', 'Complaints', 'Patient affairs'],
    category: 'service',
  },
  {
    name: 'Kaupapa Māori health service',
    aliases: ['Māori health', 'Whānau support', 'Kaiāwhina', 'Hauora Māori'],
    category: 'service',
  },
  {
    name: 'Pacific health service',
    aliases: ['Pasifika support', 'Pacific navigators'],
    category: 'service',
  },
  {
    name: 'Interpreter service',
    aliases: ['Interpreters', 'Language support'],
    category: 'service',
  },
  { name: 'Social work', aliases: ['Social workers'], category: 'service' },

  // --- departments visitors are sent to
  {
    name: 'Radiology',
    aliases: ['X-ray', 'Imaging', 'Medical imaging', 'Scan', 'CT', 'MRI', 'Ultrasound'],
    category: 'clinic',
  },
  {
    name: 'Blood tests',
    aliases: ['Laboratory', 'Lab', 'Pathology', 'Phlebotomy', 'Blood collection'],
    category: 'clinic',
  },
  {
    name: 'Pharmacy',
    aliases: ['Chemist', 'Dispensary', 'Prescriptions', 'Medicines'],
    category: 'clinic',
  },
  {
    name: 'Day stay unit',
    aliases: ['Day surgery', 'Day unit', 'Day procedures'],
    category: 'clinic',
  },
  {
    name: 'Pre-admission clinic',
    aliases: ['Pre-op', 'Pre-assessment', 'Surgical admissions'],
    category: 'clinic',
  },
  {
    name: 'Maternity',
    aliases: ['Birthing unit', 'Delivery suite', 'Labour ward', 'Women’s health', 'Antenatal'],
    category: 'clinic',
  },
  {
    name: 'Children’s ward',
    aliases: ['Paediatrics', 'Kids ward', 'Child health', 'Tamariki'],
    category: 'clinic',
  },
  {
    name: 'Intensive care unit',
    aliases: ['ICU', 'Critical care', 'HDU', 'High dependency'],
    category: 'clinic',
    note: 'Visiting is controlled; route to the ICU waiting area instead if there is one.',
  },
  { name: 'Cardiology', aliases: ['Heart', 'Cardiac', 'ECG'], category: 'clinic' },
  {
    name: 'Oncology',
    aliases: ['Cancer centre', 'Chemotherapy', 'Cancer services'],
    category: 'clinic',
  },
  { name: 'Renal unit', aliases: ['Dialysis', 'Kidney'], category: 'clinic' },
  {
    name: 'Physiotherapy',
    aliases: ['Physio', 'Rehabilitation', 'Rehab', 'Allied health'],
    category: 'clinic',
  },
  { name: 'Eye clinic', aliases: ['Ophthalmology', 'Eyes'], category: 'clinic' },
  { name: 'Ear, nose and throat', aliases: ['ENT', 'Audiology', 'Hearing'], category: 'clinic' },
  { name: 'Dental', aliases: ['Oral health', 'Dentist'], category: 'clinic' },
  {
    name: 'Mental health',
    aliases: ['Psychiatry', 'Mental health services', 'Crisis team'],
    category: 'clinic',
  },
  {
    name: 'Fracture clinic',
    aliases: ['Orthopaedics', 'Plaster room', 'Broken bones'],
    category: 'clinic',
  },
  { name: 'Diabetes centre', aliases: ['Diabetes', 'Endocrinology'], category: 'clinic' },
  {
    name: 'Ward',
    aliases: ['Inpatients'],
    category: 'clinic',
    note: 'Duplicate this per ward with its real name/number (e.g. "Ward 4 North").',
  },
  {
    name: 'Theatre reception',
    aliases: ['Operating theatres', 'Surgery', 'Theatres'],
    category: 'clinic',
    access: 'staff',
    note: 'Usually staff-only; visitors go to the surgical waiting area.',
  },
  {
    name: 'Surgical waiting area',
    aliases: ['Theatre waiting', 'Family waiting room'],
    category: 'facility',
  },

  // --- facilities
  {
    name: 'Toilets',
    aliases: ['WC', 'Restrooms', 'Bathroom', 'Wharepaku', 'Loo'],
    category: 'facility',
    note: 'One per location; the app copes with duplicate names.',
  },
  {
    name: 'Accessible toilet',
    aliases: ['Disabled toilet', 'Wheelchair toilet', 'Changing Places'],
    category: 'facility',
  },
  {
    name: 'Baby change',
    aliases: ['Parents room', 'Nappy change', 'Feeding room'],
    category: 'facility',
  },
  {
    name: 'Lift',
    aliases: ['Elevator', 'Lifts'],
    category: 'facility',
    note: 'Also mark the lift edge in the route graph; QR anchor in the lobby.',
  },
  { name: 'Stairs', aliases: ['Stairwell', 'Staircase'], category: 'facility' },
  { name: 'Café', aliases: ['Cafe', 'Coffee', 'Food', 'Cafeteria', 'Kai'], category: 'food' },
  {
    name: 'Shop',
    aliases: ['Kiosk', 'Gift shop', 'Dairy', 'Flowers', 'Newspapers'],
    category: 'retail',
  },
  { name: 'Vending machines', aliases: ['Snacks', 'Drinks'], category: 'food' },
  { name: 'Water fountain', aliases: ['Drinking water', 'Water'], category: 'facility' },
  { name: 'ATM', aliases: ['Cash machine', 'Cashpoint', 'Bank'], category: 'facility' },
  {
    name: 'Chapel',
    aliases: ['Whare karakia', 'Prayer room', 'Quiet room', 'Multi-faith room', 'Spiritual care'],
    category: 'facility',
  },
  {
    name: 'Whānau room',
    aliases: ['Family room', 'Whānau lounge', 'Rūma whānau'],
    category: 'facility',
  },
  { name: 'Waiting area', aliases: ['Waiting room', 'Seating'], category: 'facility' },
  { name: 'Phone charging', aliases: ['Charging point', 'Power'], category: 'facility' },
  { name: 'Lost property', aliases: ['Lost and found'], category: 'service' },
  {
    name: 'Wheelchair pickup',
    aliases: ['Wheelchairs', 'Borrow a wheelchair'],
    category: 'facility',
    note: 'Usually by the main entrance.',
  },
  {
    name: 'Smoke-free area notice',
    aliases: ['Smoking', 'Vaping'],
    category: 'facility',
    note: 'Hospitals are smoke-free; place this where people ask.',
  },

  // --- staff only (hidden from visitors)
  { name: 'Staff entrance', aliases: ['Staff door'], category: 'staff', access: 'staff' },
  { name: 'Staff room', aliases: ['Tea room', 'Break room'], category: 'staff', access: 'staff' },
  { name: 'Clean utility', aliases: ['Supplies'], category: 'staff', access: 'staff' },
  {
    name: 'Mortuary',
    aliases: ['Morgue'],
    category: 'staff',
    access: 'staff',
    note: 'Family viewing is escorted; do not offer publicly.',
  },
]);

/**
 * Find templates matching a typed prefix or alias (case-insensitive).
 * @param {string} query
 * @param {ReadonlyArray<PlaceTemplate>} [library]
 * @returns {PlaceTemplate[]}
 */
export function suggestPlaces(query, library = HOSPITAL_PLACES) {
  const q = String(query ?? '')
    .trim()
    .toLowerCase();
  if (!q) return [...library];
  return library.filter(
    (p) => p.name.toLowerCase().includes(q) || p.aliases.some((a) => a.toLowerCase().includes(q))
  );
}

/**
 * Exact template for a name (or alias), if any.
 * @param {string} name
 * @param {ReadonlyArray<PlaceTemplate>} [library]
 */
export function findPlace(name, library = HOSPITAL_PLACES) {
  const n = String(name ?? '')
    .trim()
    .toLowerCase();
  return (
    library.find(
      (p) => p.name.toLowerCase() === n || p.aliases.some((a) => a.toLowerCase() === n)
    ) ?? null
  );
}

/** Rows for a build-venue pois.csv, for venues built from a plan instead of a walk. */
export function toPoiCsv(
  nodeIdFor = (p) =>
    `n-${p.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')}`,
  library = HOSPITAL_PLACES
) {
  const esc = (s) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = ['id,name,node,aliases,category,access'];
  for (const p of library) {
    const id = `poi-${p.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')}`;
    lines.push(
      [id, esc(p.name), nodeIdFor(p), esc(p.aliases.join('|')), p.category, p.access ?? ''].join(
        ','
      )
    );
  }
  return `${lines.join('\n')}\n`;
}
