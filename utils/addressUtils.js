/**
 * Indian address validation and normalization utilities.
 */

const INDIAN_STATE_NAMES = [
  'Andaman and Nicobar Islands',
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chandigarh',
  'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jammu and Kashmir',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Ladakh',
  'Lakshadweep',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Puducherry',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
];

const PINCODE_REGEX = /^[1-9]\d{5}$/;

const PINCODE_ERROR = 'Please enter a valid 6-digit PIN code';
const STATE_ERROR = 'Please select a valid Indian state or union territory';
const LANDMARK_ERROR = 'Landmark is required';

const trim = (value) => String(value || '').trim();

const composeFullName = ({ firstName, middleName, lastName, name }) => {
  if (name) return trim(name);
  return [firstName, middleName, lastName].filter(Boolean).map(trim).join(' ').replace(/\s+/g, ' ').trim();
};

const parseFullName = (fullName, middleName = '') => {
  const name = trim(fullName);
  if (!name) {
    return { firstName: '', middleName: trim(middleName), lastName: '' };
  }

  const parts = name.split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0], middleName: trim(middleName), lastName: '' };
  }
  if (parts.length === 2) {
    return { firstName: parts[0], middleName: trim(middleName), lastName: parts[1] };
  }

  return {
    firstName: parts[0],
    middleName: trim(middleName) || parts.slice(1, -1).join(' '),
    lastName: parts[parts.length - 1],
  };
};

const sanitizePincode = (value) => trim(value).replace(/\D/g, '').slice(0, 6);

const isValidPincode = (pincode) => PINCODE_REGEX.test(sanitizePincode(pincode));

const isValidIndianState = (state) => INDIAN_STATE_NAMES.includes(trim(state));

const normalizeAddressFields = (body = {}) => {
  const parsed = parseFullName(body.name, body.middleName);
  const firstName = trim(body.firstName) || parsed.firstName;
  const middleName = trim(body.middleName) || parsed.middleName;
  const lastName = trim(body.lastName) || parsed.lastName;
  const name = composeFullName({ firstName, middleName, lastName, name: body.name });
  const pincode = sanitizePincode(body.pincode || body.pinCode || body.postalCode || body.zipcode);

  return {
    firstName,
    middleName,
    lastName,
    name,
    address: trim(body.address),
    city: trim(body.city),
    state: trim(body.state),
    pincode,
    landmark: trim(body.landmark),
    phone: body.phone,
    isDefault: !!body.isDefault,
  };
};

const validateAddressFields = (fields, { requirePhone = true } = {}) => {
  const errors = [];

  if (!fields.name) errors.push('Name is required');
  if (!fields.address) errors.push('Address is required');
  if (!fields.city) errors.push('City/Town is required');
  if (!fields.state) errors.push('State is required');
  else if (!isValidIndianState(fields.state)) errors.push(STATE_ERROR);
  if (!fields.pincode) errors.push('PIN Code is required');
  else if (!isValidPincode(fields.pincode)) errors.push(PINCODE_ERROR);
  if (!fields.landmark) errors.push(LANDMARK_ERROR);
  if (requirePhone && !fields.phone) errors.push('Phone number is required');

  return {
    valid: errors.length === 0,
    message: errors[0] || null,
    errors,
  };
};

const normalizeComparableAddress = (fields) => ({
  name: trim(fields.name).toLowerCase().replace(/\s+/g, ' '),
  address: trim(fields.address).toLowerCase().replace(/\s+/g, ' '),
  city: trim(fields.city).toLowerCase().replace(/\s+/g, ' '),
  state: trim(fields.state).toLowerCase().replace(/\s+/g, ' '),
  pincode: sanitizePincode(fields.pincode),
  phone: trim(fields.phone).replace(/\D/g, ''),
  landmark: trim(fields.landmark).toLowerCase().replace(/\s+/g, ' '),
});

const addressesAreDuplicate = (a, b) => {
  const left = normalizeComparableAddress(a);
  const right = normalizeComparableAddress(b);
  return (
    left.name === right.name &&
    left.address === right.address &&
    left.city === right.city &&
    left.state === right.state &&
    left.pincode === right.pincode &&
    left.phone === right.phone &&
    left.landmark === right.landmark
  );
};

module.exports = {
  INDIAN_STATE_NAMES,
  PINCODE_REGEX,
  PINCODE_ERROR,
  STATE_ERROR,
  LANDMARK_ERROR,
  composeFullName,
  parseFullName,
  sanitizePincode,
  isValidPincode,
  isValidIndianState,
  normalizeAddressFields,
  validateAddressFields,
  normalizeComparableAddress,
  addressesAreDuplicate,
};