// Pure TypeScript (no React Native imports) so `npm test` can run it in Node.

/**
 * The New customer form. Field names are VK Nex's (sales.customers / SaveCustomerDto), and the
 * checks are the server's own refusals, so a shop saved here is not refused at upload.
 */

/** VK Nex's GST types (party rules D2). */
export const GST_TYPES = ['UNREGISTERED', 'REGULAR', 'COMPOSITION', 'SEZ', 'OVERSEAS'] as const;
export type GstType = (typeof GST_TYPES)[number];
/** These need a GSTIN; the other two refuse one. */
const GSTIN_NEEDED: readonly GstType[] = ['REGULAR', 'COMPOSITION', 'SEZ'];
/** State code 96, "Other Country": the only state an OVERSEAS customer may have. */
export const OVERSEAS_STATE_CODE = '96';

export interface NewCustomerForm {
  cusName: string;
  cusGroupId: string;
  cusAreaId: string;
  cusContactPerson: string;
  cusAddr1: string;
  cusAddr2: string;
  cusLandmark: string;
  cusCity: string;
  cusDistrict: string;
  cusStateCode: string;
  cusPin: string;
  cusPhone1: string;
  cusPhone2: string;
  cusWhatsappNo: string;
  cusEmail: string;
  cusGstType: GstType;
  cusGstNo: string;
  cusPanNo: string;
  cusAadharNo: string;
}

export type FormField = keyof NewCustomerForm;
export type FieldError =
  | 'required'
  | 'mobile'
  | 'phone'
  | 'pincode'
  | 'email'
  | 'gstin'
  | 'gstinState'
  | 'overseasState'
  | 'pan'
  | 'aadhaar'
  | 'nameExists';

export const emptyNewCustomer = (stateCode: string): NewCustomerForm => ({
  cusName: '',
  cusGroupId: '',
  cusAreaId: '',
  cusContactPerson: '',
  cusAddr1: '',
  cusAddr2: '',
  cusLandmark: '',
  cusCity: '',
  cusDistrict: '',
  cusStateCode: stateCode,
  cusPin: '',
  cusPhone1: '',
  cusPhone2: '',
  cusWhatsappNo: '',
  cusEmail: '',
  cusGstType: 'UNREGISTERED',
  cusGstNo: '',
  cusPanNo: '',
  cusAadharNo: '',
});

/** What the server requires (cusPriceLevelId aside: VK Nex sets it at upload), plus GSTIN by GST type. */
export function requiredFields(gstType: GstType): ReadonlySet<FormField> {
  const always: FormField[] = ['cusName', 'cusGroupId', 'cusAreaId', 'cusStateCode'];
  return new Set(GSTIN_NEEDED.includes(gstType) ? [...always, 'cusGstNo'] : always);
}

/** May the GSTIN field be filled at all? (UNREGISTERED and OVERSEAS refuse one.) */
export const gstinAllowed = (gstType: GstType): boolean => GSTIN_NEEDED.includes(gstType);

const digits = (s: string) => s.replace(/\D/g, '');

/** "+91 98430 12345" or "098430 12345" → "9843012345". Other numbers keep their digits only. */
export function cleanPhone(s: string): string {
  const d = digits(s);
  return d.length === 12 && d.startsWith('91') ? d.slice(2) : d.length === 11 && d.startsWith('0') && /^0[6-9]/.test(d) ? d.slice(1) : d;
}

const MOBILE = /^[6-9]\d{9}$/;
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN = /^[A-Z]{5}\d{4}[A-Z]$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The values as they will be saved: trimmed, numbers without spaces, codes in capitals. */
export function cleanNewCustomer(f: NewCustomerForm): NewCustomerForm {
  const trim = (s: string) => s.trim().replace(/\s+/g, ' ');
  return {
    ...f,
    cusName: trim(f.cusName),
    cusContactPerson: trim(f.cusContactPerson),
    cusAddr1: trim(f.cusAddr1),
    cusAddr2: trim(f.cusAddr2),
    cusLandmark: trim(f.cusLandmark),
    cusCity: trim(f.cusCity),
    cusDistrict: trim(f.cusDistrict),
    cusPin: digits(f.cusPin),
    cusPhone1: cleanPhone(f.cusPhone1),
    cusPhone2: cleanPhone(f.cusPhone2),
    cusWhatsappNo: cleanPhone(f.cusWhatsappNo),
    cusEmail: f.cusEmail.trim(),
    // The form hides GSTIN for UNREGISTERED / OVERSEAS (the server refuses one there), so a GSTIN
    // typed before switching to those is dropped, not left to be refused at upload.
    cusGstNo: gstinAllowed(f.cusGstType) ? f.cusGstNo.replace(/\s/g, '').toUpperCase() : '',
    cusPanNo: f.cusPanNo.replace(/\s/g, '').toUpperCase(),
    cusAadharNo: digits(f.cusAadharNo),
  };
}

/** Problems per field (empty object = OK to save). Formats are checked only when a value is given. */
export function validateNewCustomer(form: NewCustomerForm): Partial<Record<FormField, FieldError>> {
  const f = cleanNewCustomer(form);
  const errors: Partial<Record<FormField, FieldError>> = {};
  const set = (field: FormField, e: FieldError) => {
    errors[field] ??= e;
  };
  for (const field of requiredFields(f.cusGstType)) if (!f[field]) set(field, 'required');
  if (f.cusPhone1 && !MOBILE.test(f.cusPhone1)) set('cusPhone1', 'mobile');
  if (f.cusWhatsappNo && !MOBILE.test(f.cusWhatsappNo)) set('cusWhatsappNo', 'mobile');
  // Phone 2 may be a landline with its STD code.
  if (f.cusPhone2 && !/^\d{6,15}$/.test(f.cusPhone2)) set('cusPhone2', 'phone');
  if (f.cusPin && !/^[1-9]\d{5}$/.test(f.cusPin)) set('cusPin', 'pincode');
  if (f.cusEmail && !EMAIL.test(f.cusEmail)) set('cusEmail', 'email');
  if (f.cusGstNo && !GSTIN.test(f.cusGstNo)) set('cusGstNo', 'gstin');
  if (f.cusGstNo && f.cusStateCode && f.cusGstNo.slice(0, 2) !== f.cusStateCode) set('cusGstNo', 'gstinState');
  if (f.cusGstType === 'OVERSEAS' && f.cusStateCode !== OVERSEAS_STATE_CODE) set('cusStateCode', 'overseasState');
  if (f.cusPanNo && !PAN.test(f.cusPanNo)) set('cusPanNo', 'pan');
  if (f.cusAadharNo && !/^[2-9]\d{11}$/.test(f.cusAadharNo)) set('cusAadharNo', 'aadhaar');
  return errors;
}
