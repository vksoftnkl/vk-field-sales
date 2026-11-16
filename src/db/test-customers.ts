// Pure TypeScript (no React Native imports) so `npm test` can check it in Node.

/**
 * TEMPORARY test beats, customer types and shops, so the customer list can be tried before
 * Sync with VK Nex exists. Remove this file (and its part of seed.ts) when customers come from Sync.
 *
 * The first seven Namakkal East shops match the approved mockup, and the beat's filter counts
 * (All 18, Un-billed 11, No collection 14) match the filter-sheet mockup. Bills are given as
 * [days ago, rupees]; seed.ts turns "days ago" into a date on the day it fills the database,
 * so the "oldest N days" figures grow from then on, as real bills would.
 */
/** Bump when the data below changes, so phones that already have test shops reload them. */
export const TEST_CUSTOMERS_VERSION = '3';

/** Firms the salesman sells for (Choose company). Not tied to TEST_CUSTOMERS_VERSION. */
export const TEST_COMPANIES = [
  { id: 'comp-balaji', name: 'Sri Balaji Distributors', place: 'Namakkal', position: 1 },
  { id: 'comp-sakthi', name: 'Sakthi Agencies', place: 'Namakkal', position: 2 },
  { id: 'comp-kongu', name: 'Kongu Traders', place: 'Rasipuram', position: 3 },
] as const;

export const TEST_BEATS = [
  { id: 'beat-nkl-east', name: 'Namakkal East', position: 1 },
  { id: 'beat-nkl-west', name: 'Namakkal West', position: 2 },
  { id: 'beat-rasipuram', name: 'Rasipuram', position: 3 },
] as const;

export const TEST_CUSTOMER_TYPES = [
  { id: 'type-retail', name: 'Retail', position: 1 },
  { id: 'type-wholesale', name: 'Wholesale', position: 2 },
  { id: 'type-super', name: 'Supermarket', position: 3 },
] as const;

type BeatId = (typeof TEST_BEATS)[number]['id'];
type TypeId = (typeof TEST_CUSTOMER_TYPES)[number]['id'];

export interface TestCustomer {
  name: string;
  place: string;
  mobile: string;
  beatId: BeatId;
  typeId: TypeId;
  /** Trip activity: B = billed, O = ordered, N = visited but no order, R = money received. */
  visit?: 'B' | 'O' | 'N' | 'R';
  bills: readonly (readonly [daysAgo: number, rupees: number])[];
}

const E = 'beat-nkl-east';
const W = 'beat-nkl-west';
const R = 'beat-rasipuram';
const RET = 'type-retail';
const WHO = 'type-wholesale';
const SUP = 'type-super';

export const TEST_CUSTOMERS: readonly TestCustomer[] = [
  // Namakkal East — 18 shops, the first seven as in the mockup.
  { name: 'Sri Murugan Stores', place: 'Mohanur Road', mobile: '9843012345', beatId: E, typeId: RET, bills: [[65, 12000], [40, 9450], [20, 10000], [5, 7000]] },
  { name: 'Annai Supermarket', place: 'Paramathi Road', mobile: '9843023456', beatId: E, typeId: SUP, visit: 'N', bills: [[21, 7200], [8, 5000]] },
  { name: 'Lakshmi Traders', place: 'Fort Road', mobile: '9843034567', beatId: E, typeId: WHO, visit: 'B', bills: [[3, 9420]] },
  { name: 'Selvam Provisions', place: 'Salem Road', mobile: '9843045678', beatId: E, typeId: RET, visit: 'O', bills: [[40, 2500], [25, 2340], [10, 2000]] },
  { name: 'Vel Kirana', place: 'Trichy Road', mobile: '9843056789', beatId: E, typeId: RET, visit: 'R', bills: [[12, 2150]] },
  { name: 'Kumaran Stores', place: 'Bus Stand', mobile: '9843067890', beatId: E, typeId: RET, bills: [] },
  { name: 'Ganesh Agencies', place: 'Mohanur Road', mobile: '9843078901', beatId: E, typeId: WHO, bills: [[33, 9780], [14, 5000]] },
  { name: 'Sakthi Stores', place: 'Paramathi Road', mobile: '9843089012', beatId: E, typeId: RET, visit: 'B', bills: [[18, 3250]] },
  { name: 'Balaji Provisions', place: 'Fort Road', mobile: '9843090123', beatId: E, typeId: RET, bills: [[52, 4100], [9, 1890]] },
  { name: 'Muthu Mini Mart', place: 'Salem Road', mobile: '9842011122', beatId: E, typeId: SUP, bills: [] },
  { name: 'Thangam Traders', place: 'Trichy Road', mobile: '9842022233', beatId: E, typeId: WHO, visit: 'O', bills: [[27, 18600], [6, 7400]] },
  { name: 'Sree Vinayaga Stores', place: 'Bus Stand', mobile: '9842033344', beatId: E, typeId: RET, visit: 'B', bills: [[2, 980]] },
  { name: 'Arul Kirana', place: 'Mohanur Road', mobile: '9842044455', beatId: E, typeId: RET, bills: [[71, 5600], [44, 2300], [30, 1200]] },
  { name: 'Mariamman Stores', place: 'Paramathi Road', mobile: '9842055566', beatId: E, typeId: RET, bills: [] },
  { name: 'Kannan Departmental Store', place: 'Fort Road', mobile: '9842066677', beatId: E, typeId: SUP, visit: 'O', bills: [[15, 11250]] },
  { name: 'Raja Provisions', place: 'Salem Road', mobile: '9842077788', beatId: E, typeId: RET, bills: [[36, 2740]] },
  { name: 'Sri Krishna Agencies', place: 'Trichy Road', mobile: '9842088899', beatId: E, typeId: WHO, bills: [[48, 22000], [19, 8500]] },
  { name: 'Devi Supermarket', place: 'Bus Stand', mobile: '9842099900', beatId: E, typeId: SUP, visit: 'B', bills: [[7, 6300]] },

  // Namakkal West
  { name: 'Ponni Stores', place: 'Tiruchengode Road', mobile: '9787011223', beatId: W, typeId: RET, bills: [[11, 3400]] },
  { name: 'Anbu Traders', place: 'Kosavampatti', mobile: '9787022334', beatId: W, typeId: WHO, bills: [[38, 15900], [4, 6100]] },
  { name: 'Saravana Supermarket', place: 'Tiruchengode Road', mobile: '9787033445', beatId: W, typeId: SUP, bills: [] },
  { name: 'Velan Provisions', place: 'Kosavampatti', mobile: '9787044556', beatId: W, typeId: RET, bills: [[23, 1875]] },
  { name: 'Malar Stores', place: 'Tiruchengode Road', mobile: '9787055667', beatId: W, typeId: RET, bills: [[60, 2200]] },

  // Rasipuram
  { name: 'Rasi Traders', place: 'Rasipuram', mobile: '9791011224', beatId: R, typeId: WHO, bills: [[29, 12400]] },
  { name: 'Sri Amman Stores', place: 'Andagalur Gate', mobile: '9791022335', beatId: R, typeId: RET, bills: [] },
  { name: 'Kaveri Kirana', place: 'Rasipuram', mobile: '9791033446', beatId: R, typeId: RET, bills: [[16, 1560], [3, 900]] },
  { name: 'Senthil Agencies', place: 'Andagalur Gate', mobile: '9791044557', beatId: R, typeId: WHO, bills: [[42, 9900]] },
];
