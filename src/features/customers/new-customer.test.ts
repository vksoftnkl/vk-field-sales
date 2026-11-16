// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GST_STATES, stateName } from '../../lib/gst-states.ts';
import {
  changedEditFields,
  cleanCustomerEdit,
  cleanNewCustomer,
  cleanPhone,
  emptyNewCustomer,
  validateCustomerEdit,
  validateNewCustomer,
  type NewCustomerForm,
} from './new-customer.ts';

const ok: NewCustomerForm = { ...emptyNewCustomer('33'), cusName: 'Sri Balaji Stores', cusGroupId: 'type-retail', cusAreaId: 'beat-nkl-east' };
const regular = { ...ok, cusGstType: 'REGULAR' as const, cusGstNo: '33AABCS1234K1Z5' };

test('name, group (type), area (beat) and state are required, as on the server', () => {
  assert.deepEqual(validateNewCustomer(emptyNewCustomer('')), {
    cusName: 'required',
    cusGroupId: 'required',
    cusAreaId: 'required',
    cusStateCode: 'required',
  });
  assert.deepEqual(validateNewCustomer(ok), {});
  assert.deepEqual(validateNewCustomer({ ...ok, cusName: '   ' }), { cusName: 'required' });
});

test('REGULAR, COMPOSITION and SEZ need a GSTIN that starts with the state code', () => {
  for (const cusGstType of ['REGULAR', 'COMPOSITION', 'SEZ'] as const) {
    assert.deepEqual(validateNewCustomer({ ...ok, cusGstType }), { cusGstNo: 'required' });
  }
  assert.deepEqual(validateNewCustomer(regular), {});
  assert.deepEqual(validateNewCustomer({ ...regular, cusGstNo: '33aabcs1234k1z5 ' }), {});
  assert.deepEqual(validateNewCustomer({ ...regular, cusGstNo: '33AABCS1234K1Z' }), { cusGstNo: 'gstin' });
  assert.deepEqual(validateNewCustomer({ ...regular, cusGstNo: '32AABCS1234K1Z5' }), { cusGstNo: 'gstinState' });
});

test('UNREGISTERED and OVERSEAS keep no GSTIN; OVERSEAS must be state 96', () => {
  assert.equal(cleanNewCustomer({ ...regular, cusGstType: 'UNREGISTERED' }).cusGstNo, '');
  assert.deepEqual(validateNewCustomer({ ...regular, cusGstType: 'UNREGISTERED' }), {});
  assert.deepEqual(validateNewCustomer({ ...ok, cusGstType: 'OVERSEAS' }), { cusStateCode: 'overseasState' });
  assert.deepEqual(validateNewCustomer({ ...ok, cusGstType: 'OVERSEAS', cusStateCode: '96' }), {});
});

test('formats are checked only when a value is given', () => {
  assert.deepEqual(validateNewCustomer({ ...ok, cusPhone1: '12345' }), { cusPhone1: 'mobile' });
  assert.deepEqual(validateNewCustomer({ ...ok, cusWhatsappNo: '5843012345' }), { cusWhatsappNo: 'mobile' });
  assert.deepEqual(validateNewCustomer({ ...ok, cusPhone2: '04286 222333' }), {});
  assert.deepEqual(validateNewCustomer({ ...ok, cusPhone2: '123' }), { cusPhone2: 'phone' });
  assert.deepEqual(validateNewCustomer({ ...ok, cusPin: '037001' }), { cusPin: 'pincode' });
  assert.deepEqual(validateNewCustomer({ ...ok, cusEmail: 'shop@' }), { cusEmail: 'email' });
  assert.deepEqual(validateNewCustomer({ ...ok, cusPanNo: 'ABCDE1234' }), { cusPanNo: 'pan' });
  assert.deepEqual(validateNewCustomer({ ...ok, cusAadharNo: '1234 5678 9012' }), { cusAadharNo: 'aadhaar' });
  assert.deepEqual(
    validateNewCustomer({ ...ok, cusPhone1: '+91 98430 12345', cusPin: '637 001', cusEmail: 'a@b.in', cusPanNo: 'abcde1234f', cusAadharNo: '2345 6789 0123' }),
    {},
  );
});

test('values are cleaned before saving', () => {
  assert.equal(cleanPhone('+91 98430 12345'), '9843012345');
  assert.equal(cleanPhone('098430 12345'), '9843012345');
  assert.equal(cleanPhone('04286 222333'), '04286222333');
  const c = cleanNewCustomer({ ...regular, cusName: '  Sri   Balaji  Stores ', cusPin: '637 001', cusPanNo: 'abcde1234f', cusAadharNo: '2345-6789-0123' });
  assert.equal(c.cusName, 'Sri Balaji Stores');
  assert.equal(c.cusPin, '637001');
  assert.equal(c.cusPanNo, 'ABCDE1234F');
  assert.equal(c.cusAadharNo, '234567890123');
});

test('GST state list: unique two-digit codes, Tamil Nadu is 33', () => {
  const codes = GST_STATES.map((s) => s.code);
  assert.equal(new Set(codes).size, codes.length);
  assert.ok(codes.every((c) => /^\d{2}$/.test(c)));
  assert.equal(stateName('33'), 'Tamil Nadu');
  assert.equal(stateName('96'), 'Other Country');
  assert.equal(stateName('99'), undefined);
});

test('Edit customer: mobiles, PAN and Aadhaar checked as on New customer; all may be blank', () => {
  const blank = { cusPhone1: '', cusPhone2: '', cusAadharNo: '', cusPanNo: '' };
  assert.deepEqual(validateCustomerEdit(blank), {});
  assert.deepEqual(validateCustomerEdit({ ...blank, cusPhone1: '98420 678' }), { cusPhone1: 'mobile' });
  assert.deepEqual(validateCustomerEdit({ ...blank, cusPhone2: '04286 222333' }), {});
  assert.deepEqual(validateCustomerEdit({ ...blank, cusPanNo: 'abcde1234', cusAadharNo: '1234 5678 9012' }), { cusPanNo: 'pan', cusAadharNo: 'aadhaar' });
  assert.deepEqual(cleanCustomerEdit({ cusPhone1: '+91 98430 12345', cusPhone2: '', cusAadharNo: '2345-6789-0123', cusPanNo: 'abcde1234f ' }), {
    cusPhone1: '9843012345',
    cusPhone2: '',
    cusAadharNo: '234567890123',
    cusPanNo: 'ABCDE1234F',
  });
});

test('Edit customer checks only what the salesman changed', () => {
  const was = { cusPhone1: '04286222333', cusPhone2: '', cusAadharNo: '', cusPanNo: '' };
  const now = { ...was, cusPanNo: 'abcde1234f' };
  assert.deepEqual(changedEditFields(now, was), ['cusPanNo']);
  assert.deepEqual(validateCustomerEdit(now, was), {});
  assert.deepEqual(validateCustomerEdit({ ...now, cusPhone1: '04286 222334' }, was), { cusPhone1: 'mobile' });
  assert.deepEqual(changedEditFields({ ...was, cusPhone1: '04286 222333' }, was), []);
});
