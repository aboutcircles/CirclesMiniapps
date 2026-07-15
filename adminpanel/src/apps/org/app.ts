import {
  concatHex,
  createPublicClient,
  decodeEventLog,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  formatEther,
  getAddress,
  hexToBytes,
  http,
  isAddress,
  numberToHex,
  parseAbiItem,
  pad,
  size,
  zeroAddress,
} from 'viem';
import { gnosis } from 'viem/chains';
import { onWalletChange, sendTransactions } from '@aboutcircles/miniapp-sdk';
import { Sdk } from '@aboutcircles/sdk';
import { cidV0ToHex } from '@aboutcircles/sdk-utils';
import { CirclesConverter } from '@aboutcircles/sdk-utils/circlesConverter';
import {
  getCompatibilityFallbackHandlerDeployment,
  getMultiSendCallOnlyDeployment,
  getProxyFactoryDeployment,
  getSafeSingletonDeployment,
} from '@safe-global/safe-deployments';

import {
  RPC_URL,
  RPC_FALLBACK_URLS,
  SAFE_VERSION,
  SAFE_TX_SERVICE_URL_LEGACY,
  SAFE_SENTINEL_OWNERS,
  ENTRYPOINT_V07_ADDRESS,
  HUB_V2_ADDRESS,
  FAUCET_XDAI_ADDRESS as FAUCET_XDAI_ADDRESS_RAW,
  FAUCET_GROUP_TOKEN_ADDRESS as FAUCET_GROUP_TOKEN_ADDRESS_RAW,
  FAUCET_CAP_WEI,
  FAUCET_PRICE_WEI,
} from '../../shared/config';
import {
  escapeHtml,
  decodeError,
  isPasskeyAutoConnectError,
  txLinks,
} from '../../shared/format';
import {
  fetchOwnerSafeCandidates,
  buildPrevalidatedSignature,
} from '../../shared/safe';

/* ── Config ──────────────────────────────────────────────────────── */

const TX_RECEIPT_TIMEOUT_MS = 12 * 60 * 1000;
const TX_RECEIPT_POLL_MS = 3000;
const ATTO_CIRCLES_DECIMALS = 18n;
const USER_OP_LOOKBACK_BLOCKS = 5000n;
const SAFE_OPERATION_CALL = 0;
const SAFE_OPERATION_DELEGATE_CALL = 1;
const FAUCET_XDAI_ADDRESS = getAddress(FAUCET_XDAI_ADDRESS_RAW);
const FAUCET_GROUP_TOKEN_ADDRESS = getAddress(FAUCET_GROUP_TOKEN_ADDRESS_RAW);
const MAX_ORG_IMAGE_BYTES = 8 * 1024 * 1024;
const ORG_PREVIEW_IMAGE_DIMENSION = 256;
const MAX_ORG_PREVIEW_IMAGE_BYTES = 150 * 1024;
const ORG_PREVIEW_IMAGE_QUALITIES = [0.9, 0.82, 0.74, 0.66, 0.58, 0.5, 0.42, 0.34, 0.26];
const HUB_SAFE_TRANSFER_FROM_ABI = [
  {
    type: 'function',
    name: 'toTokenId',
    stateMutability: 'view',
    inputs: [{ name: '_avatar', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'safeTransferFrom',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'id', type: 'uint256' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [],
  },
] as const;
const ERC20_UNWRAP_ABI = [
  {
    type: 'function',
    name: 'unwrap',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_amount', type: 'uint256' }],
    outputs: [],
  },
] as const;
const HUB_FUNDING_CHECK_ABI = [
  {
    type: 'function',
    name: 'isHuman',
    stateMutability: 'view',
    inputs: [{ name: 'avatar', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'isTrusted',
    stateMutability: 'view',
    inputs: [
      { name: 'truster', type: 'address' },
      { name: 'trustee', type: 'address' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'id', type: 'uint256' },
    ],
    outputs: [{ type: 'uint256' }],
  },
] as const;
const FAUCET_FUNDING_CHECK_ABI = [
  {
    type: 'function',
    name: 'accountXDAIClaimed',
    stateMutability: 'view',
    inputs: [{ name: 'avatar', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;
const USER_OPERATION_EVENT = parseAbiItem(
  'event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)'
);
const PROXY_CREATION_EVENT = parseAbiItem(
  'event ProxyCreation(address indexed proxy, address singleton)'
);
const REGISTER_ORGANIZATION_EVENT = parseAbiItem(
  'event RegisterOrganization(address indexed organization, string name)'
);

const publicClient = createPublicClient({
  chain: gnosis,
  transport: http(RPC_URL),
});
const receiptClients = RPC_FALLBACK_URLS.map((url) =>
  createPublicClient({
    chain: gnosis,
    transport: http(url),
  })
);

const safeSingletonDeployment = getSafeSingletonDeployment({
  network: String(gnosis.id),
  version: SAFE_VERSION,
});
const proxyFactoryDeployment = getProxyFactoryDeployment({
  network: String(gnosis.id),
  version: SAFE_VERSION,
});
const compatibilityFallbackHandlerDeployment = getCompatibilityFallbackHandlerDeployment({
  network: String(gnosis.id),
  version: SAFE_VERSION,
});
const multiSendCallOnlyDeployment = getMultiSendCallOnlyDeployment({
  network: String(gnosis.id),
  version: SAFE_VERSION,
});

export function boot() {
/* ── State ───────────────────────────────────────────────────────── */

let connectedAddress: any = null;
let humanSdk: any = null;
let orgSdk: any = null;
let avatar: any = null;
let activeOrgAddress: any = null;
let activeOrgRunner: any = null;
let lastTxHashes: any[] = [];
let cachedWithdrawableHoldings: any[] = [];
let activeSafeOwners: any[] = [];
let fundingInProgress = false;
let withdrawInProgress = false;
let trustSearchDebounceTimer: any = null;
let trustSearchRequestId = 0;
let userGroupAddresses = new Set<string>();
let selectedOrgImageDataUrl = '';
let orgImageProcessing = false;
let orgFormMode = 'create';
let orgFormBaseProfile: any = null;
let orgFormEditingAddress: any = null;
const sessionOrgSafesByOwner = new Map<string, any>();

/* ── DOM ─────────────────────────────────────────────────────────── */

// DOM lookup helper typed as `any` so the (untyped) UI code can read `.value`,
// `.disabled`, `.dataset`, etc. without per-element casts. tsconfig has
// noImplicitAny:false, so this keeps the UI wiring identical to the JS version.
const byId = (id: string): any => document.getElementById(id);

const badge = byId('badge');
const resultEl = byId('result');

const loginSection = byId('login-section');
const optionsSection = byId('options-section');
const registerSection = byId('register-section');
const dashboardSection = byId('dashboard-section');
const startCreateOrgBtn = byId('start-create-org-btn');
const cancelRegisterBtn = byId('cancel-register-btn');
const optionsOrgList = byId('options-org-list');
const orgFormTitle = byId('org-form-title');
const orgFormDescription = byId('org-form-description');

const orgNameInput = byId('org-name');
const orgDescInput = byId('org-description');
const orgImageInput = byId('org-image');
const orgImageDropzone = byId('org-image-dropzone');
const orgImagePreviewWrap = byId('org-image-preview-wrap');
const orgImagePreview = byId('org-image-preview');
const clearOrgImageBtn = byId('clear-org-image-btn');
const registerBtn = byId('register-btn');
const backToOptionsBtn = byId('back-to-options-btn');

const orgNameDisplay = byId('org-name-display');
const orgAddrDisplay = byId('org-address-display');
const orgDescriptionDisplay = byId('org-description-display');
const orgBalanceDisplay = byId('org-balance-display');
const orgDashboardAvatarWrap = byId('org-dashboard-avatar-wrap');
const orgDashboardAvatar = byId('org-dashboard-avatar');
const editOrgBtn = byId('edit-org-btn');
const trustAddrInput = byId('trust-address');
const addTrustBtn = byId('add-trust-btn');
const trustSearchResultsEl = byId('trust-search-results');
const trustListEl = byId('trust-list');
const safeSignerAddressInput = byId('safe-signer-address');
const addSafeSignerBtn = byId('add-safe-signer-btn');
const safeSignersListEl = byId('safe-signers-list');
const fundFaucetHintEl = byId('fund-faucet-hint');
const fundRecipientListEl = byId('fund-recipient-list');
const fundAmountXdaiInput = byId('fund-amount-xdai');
const withdrawAvailableEl = byId('withdraw-available');
const withdrawRecipientAddressInput = byId('withdraw-recipient-address');
const withdrawAmountInput = byId('withdraw-amount');
const withdrawMaxBtn = byId('withdraw-max-btn');
const withdrawHoldingsListEl = byId('withdraw-holdings-list');
const withdrawAllBtn = byId('withdraw-all-btn');

const ORG_FORM_COPY = {
  create: {
    title: 'Create Organization',
    description: 'Deploy a dedicated Safe for your organization and register it on the Circles Hub.',
    submitLabel: 'Create Organization',
    cancelLabel: 'Back',
  },
  edit: {
    title: 'Edit Organization',
    description: 'Update the organization name, description, and image stored in Circles metadata.',
    submitLabel: 'Save Changes',
    cancelLabel: 'Back to Organization',
  },
};
const BACK_BUTTON_ICON_HTML = `
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </svg>
`;

/* ── Helpers ─────────────────────────────────────────────────────── */

function showResult(type, html) {
  resultEl.className = `result result-${type}`;
  resultEl.innerHTML = html;
  resultEl.classList.remove('hidden');
}

function hideResult() {
  resultEl.classList.add('hidden');
}

function setStatus(text, type) {
  badge.textContent = text;
  badge.className = `badge badge-${type}`;
}

function truncAddr(a) {
  return a || '';
}

function getMultiSendCallOnlyAddress() {
  const address =
    multiSendCallOnlyDeployment?.networkAddresses?.[String(gnosis.id)] ||
    multiSendCallOnlyDeployment?.defaultAddress;

  if (!address || !isAddress(address)) {
    throw new Error('Safe MultiSendCallOnly deployment is unavailable.');
  }

  return getAddress(address);
}

function encodeMultiSendTransactions(txs) {
  if (!Array.isArray(txs) || txs.length === 0) return '0x';

  return concatHex(
    txs.map((tx) => {
      const to = tx?.to && isAddress(tx.to) ? getAddress(tx.to) : null;
      if (!to) throw new Error('Safe multisend transaction target is invalid.');

      const data = tx?.data || '0x';
      const value = tx?.value ? BigInt(tx.value) : 0n;

      return concatHex([
        pad(numberToHex(SAFE_OPERATION_CALL), { size: 1 }),
        pad(to, { size: 20 }),
        pad(numberToHex(value), { size: 32 }),
        pad(numberToHex(size(data)), { size: 32 }),
        data,
      ]);
    })
  );
}

function getDirectTransferAmount(balance) {
  if (!balance) return 0n;

  const rawAmount =
    balance.isWrapped && balance.isInflationary
      ? balance.staticAttoCircles
      : balance.attoCircles;

  if (rawAmount === undefined || rawAmount === null) return 0n;

  const amount = BigInt(rawAmount);
  return amount > 0n ? amount : 0n;
}

function getNormalizedCrcAmount(balance) {
  if (balance?.attoCircles === undefined || balance?.attoCircles === null) return 0n;
  const amount = BigInt(balance.attoCircles);
  return amount > 0n ? amount : 0n;
}

function buildWithdrawableHolding(balance) {
  const unwrapAmount = getDirectTransferAmount(balance);
  const crcAmount = getNormalizedCrcAmount(balance);
  if (crcAmount <= 0n) return null;

  const tokenAddress = typeof balance?.tokenAddress === 'string' && isAddress(balance.tokenAddress)
    ? getAddress(balance.tokenAddress)
    : null;
  const tokenOwner = typeof balance?.tokenOwner === 'string' && isAddress(balance.tokenOwner)
    ? getAddress(balance.tokenOwner)
    : null;
  const needsUnwrap = !!balance?.isWrapped;

  const supported =
    (!!tokenOwner && crcAmount > 0n && (
      !needsUnwrap || (needsUnwrap && !!tokenAddress && unwrapAmount > 0n)
    ));

  return {
    amount: crcAmount,
    amountText: attoToCirclesString(crcAmount),
    supported,
    needsUnwrap,
    unwrapAmount,
    tokenAddress,
    tokenOwner,
  };
}

function buildWithdrawableHoldings(balances) {
  return (balances || [])
    .map((balance) => buildWithdrawableHolding(balance))
    .filter(Boolean);
}

function isAcceptedCrcTrustAvatarType(info) {
  const avatarType = (info?.avatarType || info?.type || '').toLowerCase();
  return avatarType.includes('group') || avatarType.includes('human');
}

function filterAcceptedCrcTrustResults(results) {
  return (results || []).filter(
    (entry) => entry?.address && isAddress(entry.address) && isAcceptedCrcTrustAvatarType(entry)
  );
}

function rankTrustSearchResult(result) {
  const avatarType = (result?.avatarType || '').toLowerCase();
  const address = result?.address ? result.address.toLowerCase() : '';
  if (avatarType.includes('group')) {
    return userGroupAddresses.has(address) ? 0 : 1;
  }
  return 2;
}

async function refreshUserGroupMemberships(sdkInstance, ownerAddress) {
  const requestForAddress = ownerAddress ? ownerAddress.toLowerCase() : null;
  if (!sdkInstance || !requestForAddress) {
    userGroupAddresses = new Set();
    return;
  }
  try {
    const page = await sdkInstance.rpc.group.getGroupMemberships(getAddress(ownerAddress), 50);
    const rows = page?.results || [];
    if (!connectedAddress || connectedAddress.toLowerCase() !== requestForAddress) return;
    const nowSeconds = Math.floor(Date.now() / 1000);
    const next = new Set<string>();
    rows.forEach((row) => {
      if (!row?.group || !isAddress(row.group)) return;
      if (row.expiryTime && Number(row.expiryTime) < nowSeconds) return;
      next.add(row.group.toLowerCase());
    });
    userGroupAddresses = next;
  } catch (err) {
    console.warn('Failed to load user group memberships', err);
  }
}

function clearTrustSearchResults(message = '') {
  if (!trustSearchResultsEl) return;
  trustSearchResultsEl.innerHTML = message
    ? `<p class="muted">${escapeHtml(message)}</p>`
    : '';
}

function resetTrustSearchState(message = '') {
  trustSearchRequestId += 1;
  if (trustSearchDebounceTimer) {
    clearTimeout(trustSearchDebounceTimer);
    trustSearchDebounceTimer = null;
  }
  clearTrustSearchResults(message);
}

function renderTrustSearchResults(results) {
  if (!trustSearchResultsEl) return;

  const filteredResults = filterAcceptedCrcTrustResults(results);

  if (!filteredResults || filteredResults.length === 0) {
    trustSearchResultsEl.innerHTML = '<p class="muted">No matches found.</p>';
    return;
  }

  const sorted = [...filteredResults].sort((a, b) => rankTrustSearchResult(a) - rankTrustSearchResult(b));
  const uniqueByAddress = new Map();
  sorted.forEach((entry) => {
    if (!entry?.address || !isAddress(entry.address)) return;
    const normalizedAddress = getAddress(entry.address);
    const key = normalizedAddress.toLowerCase();
    if (!uniqueByAddress.has(key)) {
      uniqueByAddress.set(key, { ...entry, address: normalizedAddress });
    }
  });

  const rows = Array.from(uniqueByAddress.values())
    .slice(0, 40)
    .map((entry) => {
      const name = entry?.name?.trim() || entry?.registeredName?.trim() || 'Unnamed avatar';
      const avatarType = (entry?.avatarType || '').toLowerCase();
      const typeLabel = avatarType.includes('group') ? 'Select Group' : 'Select Human';
      const isUserGroup =
        avatarType.includes('group') && userGroupAddresses.has(entry.address.toLowerCase());
      const userGroupBadge = isUserGroup
        ? '<span class="badge badge-success trust-your-group">Your group</span>'
        : '';

      return `
        <div class="trust-item trust-search-item">
          <div>
            <div class="org-name">${escapeHtml(name)} ${userGroupBadge}</div>
            <div class="muted mono">${escapeHtml(entry.address)}</div>
          </div>
          <button class="btn-sm trust-select-btn" data-addr="${escapeHtml(entry.address)}">${typeLabel}</button>
        </div>
      `;
    })
    .join('');

  trustSearchResultsEl.innerHTML = rows || '<p class="muted">No matches found.</p>';
  trustSearchResultsEl.querySelectorAll('.trust-select-btn').forEach((btn) => {
    btn.addEventListener('click', () => addTrust(btn.dataset.addr));
  });
}

async function validateAcceptedCrcTrustAddress(address) {
  if (!humanSdk) {
    throw new Error('Connected account is not ready.');
  }

  const avatarInfo = await humanSdk.data.getAvatar(address).catch(() => null);
  if (!avatarInfo || !isAcceptedCrcTrustAvatarType(avatarInfo)) {
    throw new Error('Only human and group avatars can be accepted for CRC payments.');
  }

  return getAddress(address);
}

function attoToCirclesString(atto) {
  const formatted = formatEther(atto);
  return formatted.includes('.') ? formatted.replace(/\.?0+$/, '') : formatted;
}

function attoToBalanceDisplayString(atto, maxDecimals = 3) {
  const formatted = formatEther(atto);
  if (!formatted.includes('.')) return formatted;

  const [whole, fraction = ''] = formatted.split('.');
  const trimmedFraction = fraction.slice(0, maxDecimals).replace(/0+$/, '');
  return trimmedFraction ? `${whole}.${trimmedFraction}` : whole;
}

function parseCirclesInputToAtto(value) {
  const trimmed = value.trim();
  if (!/^\d+(\.\d{1,18})?$/.test(trimmed)) return null;

  const [wholeRaw, fractionRaw = ''] = trimmed.split('.');
  const whole = BigInt(wholeRaw);
  const fraction = BigInt(fractionRaw.padEnd(Number(ATTO_CIRCLES_DECIMALS), '0'));
  return whole * 10n ** ATTO_CIRCLES_DECIMALS + fraction;
}

function divideCeil(numerator, denominator) {
  if (denominator <= 0n) throw new Error('Division denominator must be positive.');
  return (numerator + denominator - 1n) / denominator;
}

function setDefaultWithdrawRecipient() {
  if (!withdrawRecipientAddressInput) return;
  withdrawRecipientAddressInput.value = connectedAddress && isAddress(connectedAddress)
    ? getAddress(connectedAddress)
    : '';
}

function fillWithdrawMaxAmount() {
  if (!withdrawAmountInput) return;
  const total = getSupportedWithdrawableTotal();
  withdrawAmountInput.value = total > 0n ? attoToCirclesString(total) : '';
  renderWithdrawHoldings();
  updateWithdrawButtonState();
}

function getWithdrawRecipientValue() {
  const typedValue = withdrawRecipientAddressInput?.value?.trim() || '';
  if (typedValue) return typedValue;
  return connectedAddress || '';
}

function getWithdrawRecipientAddress() {
  const value = getWithdrawRecipientValue();
  return value && isAddress(value) ? getAddress(value) : null;
}

function getWithdrawAmountAtto() {
  const rawValue = withdrawAmountInput?.value?.trim() || '';
  if (!rawValue) return null;
  return parseCirclesInputToAtto(rawValue);
}

function isUsingConnectedWithdrawRecipient() {
  if (!connectedAddress || !isAddress(connectedAddress)) return false;
  const recipient = getWithdrawRecipientAddress();
  return !!recipient && recipient.toLowerCase() === getAddress(connectedAddress).toLowerCase();
}

function estimateFaucetXdaiPayout(amountAttoCircles, alreadyClaimedWei) {
  if (alreadyClaimedWei >= FAUCET_CAP_WEI) return 0n;
  const remainingCap = FAUCET_CAP_WEI - alreadyClaimedWei;
  const maxAcceptedValue = remainingCap * FAUCET_CAP_WEI / FAUCET_PRICE_WEI;
  const acceptedValue = amountAttoCircles > maxAcceptedValue ? maxAcceptedValue : amountAttoCircles;
  return acceptedValue * FAUCET_PRICE_WEI / FAUCET_CAP_WEI;
}

function updateRegisterButtonState() {
  registerBtn.disabled = !connectedAddress || !orgNameInput.value.trim() || orgImageProcessing;
}

function setOrgFormMode(mode) {
  orgFormMode = mode === 'edit' ? 'edit' : 'create';
  const copy = ORG_FORM_COPY[orgFormMode];
  if (orgFormTitle) orgFormTitle.textContent = copy.title;
  if (orgFormDescription) orgFormDescription.textContent = copy.description;
  if (registerBtn) registerBtn.textContent = copy.submitLabel;
  if (cancelRegisterBtn) {
    cancelRegisterBtn.innerHTML = `${BACK_BUTTON_ICON_HTML}${copy.cancelLabel}`;
  }
}

function resetOrgFormState() {
  orgFormBaseProfile = null;
  orgFormEditingAddress = null;
  orgNameInput.value = '';
  orgDescInput.value = '';
  clearOrgImageSelection();
}

function populateOrgForm(profile: any = {}) {
  orgNameInput.value = profile?.name || '';
  orgDescInput.value = profile?.description || '';
  selectedOrgImageDataUrl = profile?.previewImageUrl || profile?.imageUrl || '';
  if (orgImageInput) orgImageInput.value = '';
  renderOrgImagePreview(selectedOrgImageDataUrl);
  updateRegisterButtonState();
}

function buildOrgProfileInput(baseProfile: any = null) {
  const name = orgNameInput.value.trim();
  if (!name) {
    throw new Error('Organization name is required.');
  }

  const profile: any = { ...(baseProfile || {}), name };
  const description = orgDescInput.value.trim();
  if (description) {
    profile.description = description;
  } else {
    delete profile.description;
  }

  const existingImageUrl = baseProfile?.previewImageUrl || baseProfile?.imageUrl || '';
  if (!selectedOrgImageDataUrl) {
    delete profile.previewImageUrl;
    delete profile.imageUrl;
  } else if (selectedOrgImageDataUrl !== existingImageUrl) {
    profile.previewImageUrl = selectedOrgImageDataUrl;
    delete profile.imageUrl;
  }

  return profile;
}

function openCreateOrgForm() {
  setOrgFormMode('create');
  resetOrgFormState();
  hideResult();
  hideAllSections();
  registerSection.classList.remove('hidden');
  updateRegisterButtonState();
}

async function openEditOrgForm() {
  if (!avatar || !activeOrgAddress) {
    showResult('error', 'Open an organization first.');
    return;
  }

  showResult('pending', 'Loading organization details…');

  try {
    const fallbackName = orgNameDisplay.textContent?.trim();
    const profile = (await avatar.profile.get()) || {
      name: fallbackName && fallbackName !== '—' ? fallbackName : '',
    };
    orgFormBaseProfile = { ...profile };
    orgFormEditingAddress = activeOrgAddress;
    setOrgFormMode('edit');
    populateOrgForm(orgFormBaseProfile);
    hideAllSections();
    registerSection.classList.remove('hidden');
    hideResult();
  } catch (err) {
    showResult('error', `Could not load organization details: ${decodeError(err)}`);
  }
}

function closeOrgForm() {
  registerSection.classList.add('hidden');
  hideResult();
  if (orgFormMode === 'edit' && activeOrgAddress) {
    dashboardSection.classList.remove('hidden');
    return;
  }
  optionsSection.classList.remove('hidden');
}

function renderOrgImagePreview(dataUrl = '') {
  if (!orgImagePreviewWrap || !orgImagePreview) return;

  if (!dataUrl) {
    orgImagePreview.removeAttribute('src');
    orgImagePreviewWrap.classList.add('hidden');
    if (orgImageDropzone) orgImageDropzone.classList.remove('hidden');
    return;
  }

  orgImagePreview.src = dataUrl;
  orgImagePreviewWrap.classList.remove('hidden');
  if (orgImageDropzone) orgImageDropzone.classList.add('hidden');
}

function clearOrgImageSelection() {
  selectedOrgImageDataUrl = '';
  if (orgImageInput) orgImageInput.value = '';
  renderOrgImagePreview();
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read selected image file.'));
    reader.readAsDataURL(file);
  });
}

function loadImageFromDataUrl(dataUrl): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not decode selected image.'));
    image.src = dataUrl;
  });
}

function getDataUrlByteLength(dataUrl) {
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex === -1) return 0;

  const metadata = dataUrl.slice(0, commaIndex);
  const payload = dataUrl.slice(commaIndex + 1);
  if (!payload) return 0;

  if (metadata.includes(';base64')) {
    const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
    return Math.floor((payload.length * 3) / 4) - padding;
  }

  try {
    return decodeURIComponent(payload).length;
  } catch {
    return payload.length;
  }
}

async function convertImageFileToProfileDataUrl(file) {
  if (!file?.type?.startsWith('image/')) {
    throw new Error('Please select a valid image file.');
  }
  if (file.size > MAX_ORG_IMAGE_BYTES) {
    throw new Error('Image size must be 8MB or less.');
  }

  const sourceDataUrl = await readFileAsDataUrl(file);
  const sourceImage = await loadImageFromDataUrl(sourceDataUrl);
  const sourceWidth = sourceImage.naturalWidth || sourceImage.width;
  const sourceHeight = sourceImage.naturalHeight || sourceImage.height;
  if (!sourceWidth || !sourceHeight) {
    throw new Error('Selected image has invalid dimensions.');
  }

  const canvas = document.createElement('canvas');
  canvas.width = ORG_PREVIEW_IMAGE_DIMENSION;
  canvas.height = ORG_PREVIEW_IMAGE_DIMENSION;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Image processing is unavailable in this browser.');
  }

  const squareSide = Math.min(sourceWidth, sourceHeight);
  const sourceX = Math.floor((sourceWidth - squareSide) / 2);
  const sourceY = Math.floor((sourceHeight - squareSide) / 2);

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, ORG_PREVIEW_IMAGE_DIMENSION, ORG_PREVIEW_IMAGE_DIMENSION);
  context.drawImage(
    sourceImage,
    sourceX,
    sourceY,
    squareSide,
    squareSide,
    0,
    0,
    ORG_PREVIEW_IMAGE_DIMENSION,
    ORG_PREVIEW_IMAGE_DIMENSION
  );

  for (const quality of ORG_PREVIEW_IMAGE_QUALITIES) {
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    if (getDataUrlByteLength(dataUrl) <= MAX_ORG_PREVIEW_IMAGE_BYTES) {
      return dataUrl;
    }
  }

  throw new Error('Could not compress image to 256x256 under 150KB.');
}

async function handleOrgImageChange() {
  const file = orgImageInput?.files?.[0];
  if (!file) {
    clearOrgImageSelection();
    updateRegisterButtonState();
    return;
  }

  orgImageProcessing = true;
  updateRegisterButtonState();

  try {
    selectedOrgImageDataUrl = await convertImageFileToProfileDataUrl(file);
    renderOrgImagePreview(selectedOrgImageDataUrl);
    hideResult();
  } catch (err) {
    clearOrgImageSelection();
    showResult('error', `Could not prepare organization image: ${decodeError(err)}`);
  } finally {
    orgImageProcessing = false;
    updateRegisterButtonState();
  }
}

function getSupportedWithdrawableHoldings() {
  return cachedWithdrawableHoldings.filter((holding) => holding.supported && holding.amount > 0n);
}

function getSupportedWithdrawableTotal() {
  return getSupportedWithdrawableHoldings().reduce((sum, holding) => sum + holding.amount, 0n);
}

function renderWithdrawHoldings() {
  if (!withdrawHoldingsListEl) return;

  if (!connectedAddress) {
    withdrawHoldingsListEl.innerHTML = '<p class="muted">Connect a wallet to prepare a full CRC withdrawal.</p>';
    return;
  }

  const supportedHoldings = getSupportedWithdrawableHoldings();

  if (cachedWithdrawableHoldings.length === 0) {
    withdrawHoldingsListEl.innerHTML = '<p class="muted">No token balances yet.</p>';
    return;
  }

  if (supportedHoldings.length === 0) {
    withdrawHoldingsListEl.innerHTML = '<p class="muted">Current balances cannot be normalized into withdrawable CRC.</p>';
    return;
  }

  if (!getWithdrawRecipientAddress()) {
    withdrawHoldingsListEl.innerHTML = '<p class="muted">Enter a valid withdrawal address.</p>';
    return;
  }

  const amountAtto = getWithdrawAmountAtto();
  if (amountAtto === null) {
    withdrawHoldingsListEl.innerHTML = '';
    return;
  }

  if (amountAtto <= 0n) {
    withdrawHoldingsListEl.innerHTML = '<p class="muted">Enter an amount greater than 0 CRC.</p>';
    return;
  }

  const total = getSupportedWithdrawableTotal();
  if (amountAtto > total) {
    withdrawHoldingsListEl.innerHTML = `<p class="muted">Amount exceeds the available balance of ${escapeHtml(attoToCirclesString(total))} CRC.</p>`;
    return;
  }

  withdrawHoldingsListEl.innerHTML = '';
}

function updateWithdrawAvailableText() {
  if (!withdrawAvailableEl) return;

  const supportedHoldings = getSupportedWithdrawableHoldings();
  const total = getSupportedWithdrawableTotal();

  if (supportedHoldings.length === 0) {
    withdrawAvailableEl.textContent = 'Available CRC balance: 0 CRC';
    if (orgBalanceDisplay) orgBalanceDisplay.textContent = '0 CRC';
    return;
  }

  const totalText = `${attoToBalanceDisplayString(total)} CRC`;
  withdrawAvailableEl.textContent = `Available CRC balance: ${totalText}`;
  if (orgBalanceDisplay) orgBalanceDisplay.textContent = totalText;
}

function updateWithdrawButtonState() {
  const recipientValid = !!getWithdrawRecipientAddress();
  const amountAtto = getWithdrawAmountAtto();
  const amountValid =
    amountAtto !== null &&
    amountAtto > 0n &&
    amountAtto <= getSupportedWithdrawableTotal();
  const hasSupportedHoldings = getSupportedWithdrawableHoldings().length > 0;
  if (withdrawAllBtn) {
    withdrawAllBtn.disabled =
      !(!!connectedAddress && recipientValid && hasSupportedHoldings && amountValid) || withdrawInProgress;
  }
  if (withdrawMaxBtn) {
    withdrawMaxBtn.disabled = !hasSupportedHoldings;
  }
}

function hasAdditionalSafeSigner() {
  if (!connectedAddress || activeSafeOwners.length === 0) return false;
  return activeSafeOwners.some(
    (owner) => owner.toLowerCase() !== connectedAddress.toLowerCase()
  );
}

function getAdditionalSafeSignerAddresses() {
  if (!connectedAddress) return [];
  return activeSafeOwners.filter(
    (owner) => owner.toLowerCase() !== connectedAddress.toLowerCase()
  );
}

function renderFundRecipientActions() {
  if (!fundRecipientListEl) return;

  const recipients = getAdditionalSafeSignerAddresses();
  if (recipients.length === 0) {
    fundRecipientListEl.innerHTML = '<p class="muted">Add an EOA signer first.</p>';
    return;
  }

  fundRecipientListEl.innerHTML = recipients
    .map(
      (address) => `
        <div class="trust-item">
          <span class="mono">${escapeHtml(address)}</span>
          <button class="btn-sm fund-gas-btn" data-recipient="${escapeHtml(address)}">Fund with gas</button>
        </div>
      `
    )
    .join('');

  fundRecipientListEl.querySelectorAll('.fund-gas-btn').forEach((btn) => {
    btn.addEventListener('click', () => fundFaucetXdai(btn.dataset.recipient));
  });
}

function updateFundFaucetButtonState() {
  const hasAdditionalSigner = hasAdditionalSafeSigner();
  const amountAttoCircles = parseCirclesInputToAtto(fundAmountXdaiInput?.value || '');
  const amountValid = amountAttoCircles !== null && amountAttoCircles > 0n;
  const canFund = hasAdditionalSigner && amountValid && !fundingInProgress;
  fundRecipientListEl?.querySelectorAll('.fund-gas-btn').forEach((button) => {
    button.disabled = !canFund;
  });

  if (!fundFaucetHintEl) return;
  if (!hasAdditionalSigner) {
    fundFaucetHintEl.textContent = 'Add at least one additional EOA signer to enable funding.';
    return;
  }
  if (!amountValid) {
    fundFaucetHintEl.textContent = 'Enter a CRC amount, then click "Fund with gas" next to an EOA.';
    return;
  }
  if (fundingInProgress) {
    fundFaucetHintEl.textContent = 'Funding transaction in progress…';
    return;
  }
  fundFaucetHintEl.textContent = 'Click "Fund with gas" next to the EOA you want to fund.';
}

function hideAllSections() {
  loginSection.classList.add('hidden');
  optionsSection.classList.add('hidden');
  registerSection.classList.add('hidden');
  dashboardSection.classList.add('hidden');
  byId('explorer-section')?.classList.add('hidden');
}

function showDisconnectedState() {
  hideAllSections();
  hideResult();
  setStatus('Not connected', 'disconnected');
  setOrgFormMode('create');
  resetOrgFormState();
  registerBtn.disabled = true;
  if (withdrawRecipientAddressInput) withdrawRecipientAddressInput.value = '';
  if (withdrawAmountInput) withdrawAmountInput.value = '';
  if (editOrgBtn) editOrgBtn.disabled = true;
  safeSignersListEl.innerHTML = '<p class="muted">No signers loaded yet.</p>';
  activeSafeOwners = [];
  withdrawInProgress = false;
  cachedWithdrawableHoldings = [];
  setDefaultWithdrawRecipient();
  resetTrustSearchState('Connect a wallet to search.');
  renderWithdrawHoldings();
  renderFundRecipientActions();
  updateWithdrawAvailableText();
  updateWithdrawButtonState();
  updateFundFaucetButtonState();
  loginSection.classList.remove('hidden');
}

function showCreateOrgOptions(orgOptions: any[] = []) {
  hideAllSections();
  setOrgFormMode('create');
  resetOrgFormState();
  setStatus('Logged in', 'success');
  renderOwnedOrgOptions(orgOptions);
  optionsSection.classList.remove('hidden');
}

function renderOwnedOrgOptions(orgOptions) {
  if (!orgOptions || orgOptions.length === 0) {
    optionsOrgList.innerHTML = '<p class="muted">No organizations yet. Create one below to get started.</p>';
    return;
  }

  optionsOrgList.innerHTML = orgOptions
    .map(
      (org) => {
        const imgHtml = org.imageUrl
          ? `<img class="org-avatar" src="${escapeHtml(org.imageUrl)}" alt="" />`
          : `<div class="org-avatar org-avatar-placeholder"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></div>`;
        return `
      <div class="org-item">
        ${imgHtml}
        <div class="org-item-info">
          <div class="org-name">${escapeHtml(org.name || truncAddr(org.address))}</div>
          <a class="org-link mono" href="https://explorer.aboutcircles.com/avatar/${org.address}/" target="_blank" rel="noopener">${escapeHtml(truncAddr(org.address))}</a>
        </div>
        <button class="btn-sm org-open-btn" data-org-safe="${org.address}">Open</button>
      </div>
    `;
      }
    )
    .join('');

  optionsOrgList.querySelectorAll('.org-open-btn').forEach((btn) => {
    btn.addEventListener('click', () => openOwnedOrganization(btn.dataset.orgSafe));
  });
}

async function enrichOrganizationOptions(orgAddresses, sdkInstance) {
  if (!orgAddresses || orgAddresses.length === 0) return [];

  const options = await Promise.all(
    orgAddresses.map(async (address) => {
      try {
        const profile = await sdkInstance.rpc.profile.getProfileByAddress(address);
        const name = profile?.name?.trim();
        const imageUrl = profile?.previewImageUrl || profile?.imageUrl || null;
        return { address, name: name || null, imageUrl };
      } catch {
        return { address, name: null, imageUrl: null };
      }
    })
  );

  return options.sort((a, b) => (a.name || a.address).localeCompare(b.name || b.address));
}

function toHexValue(value) {
  return value ? `0x${BigInt(value).toString(16)}` : '0x0';
}

function formatTxForHost(tx) {
  return {
    to: tx.to,
    data: tx.data || '0x',
    value: toHexValue(tx.value || 0n),
  };
}

function isOrganizationType(info) {
  const typeLower = (info?.type || info?.avatarType || '').toLowerCase();
  return typeLower.includes('organization') || typeLower.includes('org');
}

function normalizeOrgSafes(value): any[] {
  const values = Array.isArray(value) ? value : [value];
  const seen = new Set<string>();
  const out: any[] = [];

  for (const candidate of values) {
    if (typeof candidate !== 'string' || !isAddress(candidate)) continue;
    const normalized = getAddress(candidate);
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }

  return out;
}

function getSessionOrgSafes(ownerAddress) {
  const key = ownerAddress.toLowerCase();
  return normalizeOrgSafes(sessionOrgSafesByOwner.get(key) || []);
}

function setSessionOrgSafes(ownerAddress, orgSafeAddresses) {
  const key = ownerAddress.toLowerCase();
  sessionOrgSafesByOwner.set(key, normalizeOrgSafes(orgSafeAddresses));
}

function addSessionOrgSafe(ownerAddress, orgSafeAddress) {
  const existing = getSessionOrgSafes(ownerAddress);
  existing.push(getAddress(orgSafeAddress));
  setSessionOrgSafes(ownerAddress, existing);
}

async function fetchOwnerOrgSafeCandidates(ownerAddress, sdkInstance) {
  const ownerSafes = await fetchOwnerSafeCandidates(SAFE_TX_SERVICE_URL_LEGACY, ownerAddress);
  if (!sdkInstance) return ownerSafes;

  const orgSafes: any[] = [];
  for (const safeAddress of ownerSafes) {
    try {
      const info = await sdkInstance.data.getAvatar(safeAddress);
      if (isOrganizationType(info)) orgSafes.push(safeAddress);
    } catch {
      // Ignore addresses that are not registered org avatars.
    }
  }

  return orgSafes;
}

function getDeploymentAddress(deployment) {
  if (!deployment) throw new Error('Safe deployment metadata is missing.');
  const networkAddress = deployment.networkAddresses?.[String(gnosis.id)] || deployment.defaultAddress;
  if (!networkAddress) {
    throw new Error('Safe deployment for this network is missing.');
  }
  return getAddress(networkAddress);
}

function randomSaltNonce() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let value = 0n;
  for (const b of bytes) value = (value << 8n) + BigInt(b);
  return value.toString();
}

async function waitForReceipts(hashes): Promise<any[]> {
  const receipts: any[] = [];
  for (const hash of hashes) {
    receipts.push(await waitForReceiptFromAnyRpc(hash));
  }
  return receipts;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForReceiptFromAnyRpc(hash: any) {
  const deadline = Date.now() + TX_RECEIPT_TIMEOUT_MS;
  let lastErrorMessage = '';
  let round = 0;

  while (Date.now() < deadline) {
    round += 1;

    for (const client of receiptClients) {
      try {
        const receipt = await client.getTransactionReceipt({ hash });
        if (receipt) return receipt;
      } catch (err) {
        lastErrorMessage = decodeError(err);
      }
    }

    if (round % 2 === 0) {
      for (const client of receiptClients) {
        const receipt = await tryResolveUserOpReceipt(client, hash);
        if (receipt) return receipt;
      }
    }

    await sleep(TX_RECEIPT_POLL_MS);
  }

  const detail = lastErrorMessage ? ` Last RPC error: ${lastErrorMessage}` : '';
  throw new Error(
    `Timed out while waiting for transaction with hash "${hash}" to be confirmed.${detail}`
  );
}

async function tryResolveUserOpReceipt(client, userOpHash) {
  try {
    const latest = await client.getBlockNumber();
    const fromBlock = latest > USER_OP_LOOKBACK_BLOCKS ? latest - USER_OP_LOOKBACK_BLOCKS : 0n;

    const logs = await client.getLogs({
      address: ENTRYPOINT_V07_ADDRESS,
      event: USER_OPERATION_EVENT,
      args: { userOpHash },
      fromBlock,
      toBlock: latest,
    });

    if (!logs || logs.length === 0) return null;
    const txHash = logs[logs.length - 1]?.transactionHash;
    if (!txHash) return null;

    return await client.getTransactionReceipt({ hash: txHash });
  } catch {
    return null;
  }
}

async function preflightEthCall({ label, to, data = '0x', value = 0n, account }: any) {
  try {
    await publicClient.call({
      to: getAddress(to),
      data,
      value: BigInt(value),
      account,
    });
  } catch (err) {
    throw new Error(`${label} preflight failed: ${decodeError(err)}`);
  }
}

function assertSafeExecutionSuccess(receipt, safeAddress, safeAbi) {
  let sawSuccess = false;

  for (const log of receipt.logs) {
    if (!log.address || log.address.toLowerCase() !== safeAddress.toLowerCase()) continue;

    try {
      const decoded: any = decodeEventLog({
        abi: safeAbi,
        data: log.data,
        topics: log.topics,
        strict: false,
      });

      if (decoded?.eventName === 'ExecutionFailure') {
        throw new Error('Safe execution failed.');
      }

      if (decoded?.eventName === 'ExecutionSuccess') {
        sawSuccess = true;
      }
    } catch (err: any) {
      if (err?.message === 'Safe execution failed.') throw err;
    }
  }

  if (!sawSuccess) {
    throw new Error('Safe execution status could not be confirmed.');
  }
}

function deriveOrganizationAddressFromReceipts(receipts, proxyFactoryAddress, hubAddress) {
  let proxyAddress: any = null;
  let registeredOrgAddress: any = null;

  for (const receipt of receipts) {
    for (const log of receipt.logs) {
      if (!log.address) continue;

      if (log.address.toLowerCase() === proxyFactoryAddress.toLowerCase()) {
        try {
          const decoded: any = decodeEventLog({
            abi: [PROXY_CREATION_EVENT],
            data: log.data,
            topics: log.topics,
            strict: false,
          });
          if (decoded?.eventName === 'ProxyCreation' && decoded.args?.proxy) {
            proxyAddress = getAddress(decoded.args.proxy);
          }
        } catch { }
      }

      if (log.address.toLowerCase() === hubAddress.toLowerCase()) {
        try {
          const decoded: any = decodeEventLog({
            abi: [REGISTER_ORGANIZATION_EVENT],
            data: log.data,
            topics: log.topics,
            strict: false,
          });
          if (decoded?.eventName === 'RegisterOrganization' && decoded.args?.organization) {
            registeredOrgAddress = getAddress(decoded.args.organization);
          }
        } catch { }
      }
    }
  }

  return registeredOrgAddress || proxyAddress || null;
}


/* ── ContractRunner Bridges ──────────────────────────────────────── */

function createRunner(address): any {
  return {
    address,
    async sendTransaction(txs) {
      const hashes = await sendTransactions(txs.map(formatTxForHost));
      lastTxHashes = hashes;
      const receipts = await waitForReceipts(hashes);
      return receipts[receipts.length - 1];
    },
  };
}

function createSafeOwnerRunner(ownerAddress, safeAddress) {
  const safeAbi = safeSingletonDeployment?.abi;
  if (!safeAbi) throw new Error('Safe singleton ABI is unavailable.');
  const multiSendAbi = multiSendCallOnlyDeployment?.abi;
  if (!multiSendAbi) throw new Error('Safe MultiSendCallOnly ABI is unavailable.');
  const multiSendAddress = getMultiSendCallOnlyAddress();

  return {
    address: safeAddress,
    async sendTransaction(txs) {
      if (!Array.isArray(txs) || txs.length === 0) {
        throw new Error('No transactions supplied.');
      }

      const signature = buildPrevalidatedSignature(ownerAddress);
      const execArgs =
        txs.length === 1
          ? [
            txs[0].to,
            txs[0].value ? BigInt(txs[0].value) : 0n,
            txs[0].data || '0x',
            SAFE_OPERATION_CALL,
            0n,
            0n,
            0n,
            zeroAddress,
            zeroAddress,
            signature,
          ]
          : [
            multiSendAddress,
            0n,
            encodeFunctionData({
              abi: multiSendAbi,
              functionName: 'multiSend',
              args: [encodeMultiSendTransactions(txs)],
            }),
            SAFE_OPERATION_DELEGATE_CALL,
            0n,
            0n,
            0n,
            zeroAddress,
            zeroAddress,
            signature,
          ];

      const safeExecTx = {
        to: safeAddress,
        value: 0n,
        data: encodeFunctionData({
          abi: safeAbi,
          functionName: 'execTransaction',
          args: execArgs,
        }),
      };

      const hashes = await sendTransactions([formatTxForHost(safeExecTx)]);
      lastTxHashes = hashes;

      const receipts = await waitForReceipts(hashes);
      receipts.forEach((receipt) => assertSafeExecutionSuccess(receipt, safeAddress, safeAbi));

      return receipts[receipts.length - 1];
    },
  };
}

/* ── Register Organization ───────────────────────────────────────── */

async function updateOrganizationDetails() {
  const orgAddress = orgFormEditingAddress || activeOrgAddress;
  if (!orgAddress || !avatar) {
    showResult('error', 'Open an organization first.');
    return;
  }

  if (!connectedAddress) {
    showResult('error', 'Connect a wallet first.');
    return;
  }

  registerBtn.disabled = true;
  showResult('pending', 'Saving organization details…');

  try {
    lastTxHashes = [];
    const profile = buildOrgProfileInput(orgFormBaseProfile);
    await avatar.profile.update(profile);

    const links = lastTxHashes.length ? `<br>${txLinks(lastTxHashes)}` : '';
    const successHtml = `Organization details updated: <a href="https://explorer.aboutcircles.com/avatar/${orgAddress}/" target="_blank" rel="noopener">${orgAddress}</a>${links}`;

    const reopened = await openOwnedOrganization(orgAddress, { preserveResult: true });
    if (!reopened) return;

    showResult('success', successHtml);
    setOrgFormMode('create');
    resetOrgFormState();
  } catch (err) {
    showResult('error', `Could not update organization details: ${decodeError(err)}`);
  } finally {
    updateRegisterButtonState();
  }
}

async function registerOrganization() {
  const name = orgNameInput.value.trim();
  if (!name) {
    showResult('error', 'Organization name is required.');
    return;
  }

  if (!connectedAddress || !humanSdk) {
    showResult('error', 'Connect a wallet first.');
    return;
  }

  registerBtn.disabled = true;
  showResult('pending', 'Preparing Safe deployment and org registration…');

  try {
    lastTxHashes = [];

    const safeAbi = safeSingletonDeployment?.abi;
    if (!safeAbi) {
      throw new Error('Safe deployment metadata unavailable.');
    }
    const proxyFactoryAbi = proxyFactoryDeployment?.abi;
    if (!proxyFactoryAbi) {
      throw new Error('Safe proxy factory deployment metadata unavailable.');
    }

    const profile: any = { name };
    const desc = orgDescInput.value.trim();
    if (desc) profile.description = desc;
    if (selectedOrgImageDataUrl) {
      profile.previewImageUrl = selectedOrgImageDataUrl;
    }

    const profileCid = await humanSdk.profilesClient.create(profile);
    const metadataDigest = cidV0ToHex(profileCid);

    const saltNonce = randomSaltNonce();
    const safeSingletonAddress = getDeploymentAddress(safeSingletonDeployment);
    const proxyFactoryAddress = getDeploymentAddress(proxyFactoryDeployment);
    const fallbackHandlerAddress = getDeploymentAddress(compatibilityFallbackHandlerDeployment);

    const setupData = encodeFunctionData({
      abi: safeAbi,
      functionName: 'setup',
      args: [
        [connectedAddress],
        1n,
        zeroAddress,
        '0x',
        fallbackHandlerAddress,
        zeroAddress,
        0n,
        zeroAddress,
      ],
    });
    const deploySafeData = encodeFunctionData({
      abi: proxyFactoryAbi,
      functionName: 'createProxyWithNonce',
      args: [safeSingletonAddress, setupData, BigInt(saltNonce)],
    });

    const deploymentPreflight = await publicClient.call({
      to: proxyFactoryAddress,
      data: deploySafeData,
      account: connectedAddress,
    });
    const predictedOrgSafe = getAddress(
      decodeFunctionResult({
        abi: proxyFactoryAbi,
        functionName: 'createProxyWithNonce',
        data: deploymentPreflight.data as `0x${string}`,
      }) as string
    );

    const registerTx = humanSdk.core.hubV2.registerOrganization(name, metadataDigest);
    const safeExecData = encodeFunctionData({
      abi: safeAbi,
      functionName: 'execTransaction',
      args: [
        registerTx.to,
        registerTx.value || 0n,
        registerTx.data || '0x',
        0,
        0n,
        0n,
        0n,
        zeroAddress,
        zeroAddress,
        buildPrevalidatedSignature(connectedAddress),
      ],
    });

    showResult('pending', 'Running preflight eth_call checks…');
    await preflightEthCall({
      label: 'Organization registration',
      to: registerTx.to,
      data: registerTx.data || '0x',
      value: registerTx.value || 0n,
      account: predictedOrgSafe,
    });

    showResult('pending', 'Deploying dedicated Safe and registering organization (single batched approval)…');
    const txHashes = await sendTransactions([
      formatTxForHost({
        to: proxyFactoryAddress,
        data: deploySafeData,
        value: 0n,
      }),
      formatTxForHost({
        to: predictedOrgSafe,
        data: safeExecData,
        value: 0n,
      }),
    ]);

    lastTxHashes = txHashes;

    let receipts;
    try {
      receipts = await waitForReceipts(txHashes);
    } catch (err) {
      const maybeOrgInfo = await humanSdk.data.getAvatar(predictedOrgSafe).catch(() => null);
      if (!isOrganizationType(maybeOrgInfo)) throw err;

      addSessionOrgSafe(connectedAddress, predictedOrgSafe);

      const links = lastTxHashes.length ? `<br>${txLinks(lastTxHashes)}` : '';
      showResult(
        'success',
        `Organization registered via dedicated Safe: <a href="https://explorer.aboutcircles.com/avatar/${predictedOrgSafe}/" target="_blank" rel="noopener">${predictedOrgSafe}</a><br><span class="muted">Receipt polling timed out, but on-chain state confirms registration.</span>${links}`
      );

      clearOrgImageSelection();
      orgNameInput.value = '';
      orgDescInput.value = '';
      updateRegisterButtonState();
      await loadAvatarState(true);
      return;
    }

    const resolvedOrgSafe =
      deriveOrganizationAddressFromReceipts(receipts, proxyFactoryAddress, registerTx.to) ||
      predictedOrgSafe;

    const safeExecReceipts = receipts.filter((receipt) =>
      receipt.logs.some(
        (log) => log.address && log.address.toLowerCase() === resolvedOrgSafe.toLowerCase()
      )
    );

    if (safeExecReceipts.length === 0) {
      throw new Error('Safe execution transaction could not be verified.');
    }

    safeExecReceipts.forEach((receipt) =>
      assertSafeExecutionSuccess(receipt, resolvedOrgSafe, safeAbi)
    );

    const newOrgInfo = await humanSdk.data.getAvatar(resolvedOrgSafe);
    if (!isOrganizationType(newOrgInfo)) {
      throw new Error('Safe deployed, but org registration was not confirmed.');
    }

    addSessionOrgSafe(connectedAddress, resolvedOrgSafe);

    const links = lastTxHashes.length ? `<br>${txLinks(lastTxHashes)}` : '';
    showResult(
      'success',
      `Organization registered via dedicated Safe: <a href="https://explorer.aboutcircles.com/avatar/${resolvedOrgSafe}/" target="_blank" rel="noopener">${resolvedOrgSafe}</a>${links}`
    );

    clearOrgImageSelection();
    orgNameInput.value = '';
    orgDescInput.value = '';
    updateRegisterButtonState();
    await loadAvatarState(true);
  } catch (err) {
    if (isPasskeyAutoConnectError(err)) {
      showResult(
        'error',
        'Passkey auto-connect failed in the host app. Re-open wallet connect and choose the same wallet again, then retry organization creation.'
      );
    } else {
      showResult('error', `Registration failed: ${decodeError(err)}`);
    }
  } finally {
    updateRegisterButtonState();
  }
}

async function submitOrganizationForm() {
  if (orgFormMode === 'edit') {
    await updateOrganizationDetails();
    return;
  }

  await registerOrganization();
}

/* ── Safe Signers ────────────────────────────────────────────────── */

async function loadSafeSigners() {
  if (!activeOrgAddress) {
    activeSafeOwners = [];
    safeSignersListEl.innerHTML = '<p class="muted">No organization selected.</p>';
    renderFundRecipientActions();
    updateFundFaucetButtonState();
    return;
  }

  const safeAbi = safeSingletonDeployment?.abi;
  if (!safeAbi) {
    activeSafeOwners = [];
    safeSignersListEl.innerHTML = '<p class="muted">Safe ABI unavailable.</p>';
    renderFundRecipientActions();
    updateFundFaucetButtonState();
    return;
  }

  safeSignersListEl.innerHTML = '<div class="shimmer-block"></div>';

  try {
    const owners = (await publicClient.readContract({
      address: getAddress(activeOrgAddress),
      abi: safeAbi,
      functionName: 'getOwners',
    })) as string[];
    if (!owners || owners.length === 0) {
      activeSafeOwners = [];
      safeSignersListEl.innerHTML = '<p class="muted">No signers found.</p>';
      renderFundRecipientActions();
      updateFundFaucetButtonState();
      return;
    }

    activeSafeOwners = owners.map((owner) => getAddress(owner));
    const connectedLower = connectedAddress ? connectedAddress.toLowerCase() : null;
    const externalOwners = activeSafeOwners.filter(
      (owner) => !connectedLower || owner.toLowerCase() !== connectedLower
    );
    const canRemoveOwner = activeSafeOwners.length > 1;
    const rows = externalOwners
      .map((owner) => {
        const removeDisabledAttr = canRemoveOwner ? '' : 'disabled';
        return `
          <div class="trust-item">
            <span class="mono">${owner}</span>
            <div class="signer-actions">
              <button class="btn-sm btn-danger remove-signer-btn" data-owner="${owner}" ${removeDisabledAttr}>Remove</button>
            </div>
          </div>
        `;
      })
      .join('');

    safeSignersListEl.innerHTML = externalOwners.length > 0
      ? rows
      : '<p class="muted">No external signers added yet.</p>';
    safeSignersListEl.querySelectorAll('.remove-signer-btn').forEach((btn) => {
      btn.addEventListener('click', () => removeSafeSigner(btn.dataset.owner));
    });
    renderFundRecipientActions();
    updateFundFaucetButtonState();
  } catch (err) {
    activeSafeOwners = [];
    safeSignersListEl.innerHTML = `<p class="muted">Could not load signers: ${decodeError(err)}</p>`;
    renderFundRecipientActions();
    updateFundFaucetButtonState();
  }
}

async function addSafeSigner() {
  const rawAddress = safeSignerAddressInput.value.trim();
  if (!isAddress(rawAddress)) {
    showResult('error', 'Enter a valid signer address.');
    return;
  }

  if (!activeOrgAddress || !connectedAddress) {
    showResult('error', 'Organization wallet is not ready.');
    return;
  }

  const safeAbi = safeSingletonDeployment?.abi;
  if (!safeAbi) {
    showResult('error', 'Safe ABI unavailable.');
    return;
  }

  const signerToAdd = getAddress(rawAddress);
  addSafeSignerBtn.disabled = true;
  showResult('pending', 'Adding signer…');

  try {
    const owners = (await publicClient.readContract({
      address: getAddress(activeOrgAddress),
      abi: safeAbi,
      functionName: 'getOwners',
    })) as string[];
    const threshold = (await publicClient.readContract({
      address: getAddress(activeOrgAddress),
      abi: safeAbi,
      functionName: 'getThreshold',
    })) as bigint;

    if (owners.some((owner) => owner.toLowerCase() === signerToAdd.toLowerCase())) {
      showResult('error', 'Address is already a signer.');
      return;
    }

    if (!owners.some((owner) => owner.toLowerCase() === connectedAddress.toLowerCase())) {
      showResult('error', 'Connected wallet is not an owner of this Safe.');
      return;
    }

    const addSignerData = encodeFunctionData({
      abi: safeAbi,
      functionName: 'addOwnerWithThreshold',
      args: [signerToAdd, BigInt(threshold)],
    });

    const runner = createSafeOwnerRunner(connectedAddress, getAddress(activeOrgAddress));
    lastTxHashes = [];
    await runner.sendTransaction([
      {
        to: getAddress(activeOrgAddress),
        data: addSignerData,
        value: 0n,
      },
    ]);

    const links = lastTxHashes.length ? `<br>${txLinks(lastTxHashes)}` : '';
    showResult('success', `Added signer ${signerToAdd}.${links}`);
    safeSignerAddressInput.value = '';
    await loadSafeSigners();
  } catch (err) {
    showResult('error', `Add signer failed: ${decodeError(err)}`);
  } finally {
    addSafeSignerBtn.disabled = false;
  }
}

async function removeSafeSigner(rawOwnerAddress) {
  if (!isAddress(rawOwnerAddress)) {
    showResult('error', 'Signer address is invalid.');
    return;
  }

  if (!activeOrgAddress || !connectedAddress) {
    showResult('error', 'Organization wallet is not ready.');
    return;
  }

  const safeAbi = safeSingletonDeployment?.abi;
  if (!safeAbi) {
    showResult('error', 'Safe ABI unavailable.');
    return;
  }

  const ownerToRemove = getAddress(rawOwnerAddress);
  if (connectedAddress && ownerToRemove.toLowerCase() === connectedAddress.toLowerCase()) {
    showResult('error', 'Connected wallet cannot be removed as a signer.');
    return;
  }
  showResult('pending', `Removing signer ${ownerToRemove}…`);

  try {
    const owners = (await publicClient.readContract({
      address: getAddress(activeOrgAddress),
      abi: safeAbi,
      functionName: 'getOwners',
    })) as string[];
    const threshold = (await publicClient.readContract({
      address: getAddress(activeOrgAddress),
      abi: safeAbi,
      functionName: 'getThreshold',
    })) as bigint;

    if (!owners.some((owner) => owner.toLowerCase() === connectedAddress.toLowerCase())) {
      showResult('error', 'Connected wallet is not an owner of this Safe.');
      return;
    }

    const ownerIndex = owners.findIndex(
      (owner) => owner.toLowerCase() === ownerToRemove.toLowerCase()
    );
    if (ownerIndex === -1) {
      showResult('error', 'Signer not found on this Safe.');
      return;
    }

    if (owners.length <= 1) {
      showResult('error', 'Cannot remove the last Safe owner.');
      return;
    }

    const prevOwner =
      ownerIndex === 0 ? SAFE_SENTINEL_OWNERS : getAddress(owners[ownerIndex - 1]);
    const currentThreshold = BigInt(threshold);
    const remainingOwners = BigInt(owners.length - 1);
    const newThreshold = currentThreshold > remainingOwners ? remainingOwners : currentThreshold;

    if (newThreshold < 1n) {
      showResult('error', 'Invalid threshold after owner removal.');
      return;
    }

    const removeSignerData = encodeFunctionData({
      abi: safeAbi,
      functionName: 'removeOwner',
      args: [prevOwner, ownerToRemove, newThreshold],
    });

    const runner = createSafeOwnerRunner(connectedAddress, getAddress(activeOrgAddress));
    lastTxHashes = [];
    await runner.sendTransaction([
      {
        to: getAddress(activeOrgAddress),
        data: removeSignerData,
        value: 0n,
      },
    ]);

    const links = lastTxHashes.length ? `<br>${txLinks(lastTxHashes)}` : '';
    showResult('success', `Removed signer ${ownerToRemove}.${links}`);
    await loadSafeSigners();
  } catch (err) {
    showResult('error', `Remove signer failed: ${decodeError(err)}`);
  }
}

async function fundFaucetXdai(rawRecipientAddress) {
  if (!isAddress(rawRecipientAddress)) {
    showResult('error', 'Choose a valid recipient EOA address.');
    return;
  }

  const amountAttoCircles = parseCirclesInputToAtto(fundAmountXdaiInput.value);
  if (amountAttoCircles === null || amountAttoCircles <= 0n) {
    showResult('error', 'Enter a valid CRC amount.');
    return;
  }

  if (!humanSdk || !connectedAddress) {
    showResult('error', 'Connected account is not ready.');
    return;
  }

  if (!hasAdditionalSafeSigner()) {
    showResult('error', 'Add an additional EOA signer before funding.');
    return;
  }

  const faucetAddress = FAUCET_XDAI_ADDRESS;
  const groupTokenAddress = FAUCET_GROUP_TOKEN_ADDRESS;
  const recipientAddress = getAddress(rawRecipientAddress);
  const senderAddress = getAddress(connectedAddress);
  const groupTokenId = BigInt(groupTokenAddress);
  const payoutDataHex = encodeAbiParameters([{ type: 'address' }], [recipientAddress]);

  fundingInProgress = true;
  updateFundFaucetButtonState();
  showResult('pending', 'Preparing group CRC for faucet transfer…');

  try {
    const [isHuman, isTrusted, senderGroupCrcBalance, claimedXdai, faucetXdaiBalance] =
      await Promise.all([
        publicClient.readContract({
          address: getAddress(HUB_V2_ADDRESS),
          abi: HUB_FUNDING_CHECK_ABI,
          functionName: 'isHuman',
          args: [senderAddress],
        }),
        publicClient.readContract({
          address: getAddress(HUB_V2_ADDRESS),
          abi: HUB_FUNDING_CHECK_ABI,
          functionName: 'isTrusted',
          args: [faucetAddress, groupTokenAddress],
        }),
        publicClient.readContract({
          address: getAddress(HUB_V2_ADDRESS),
          abi: HUB_FUNDING_CHECK_ABI,
          functionName: 'balanceOf',
          args: [senderAddress, groupTokenId],
        }),
        publicClient.readContract({
          address: faucetAddress,
          abi: FAUCET_FUNDING_CHECK_ABI,
          functionName: 'accountXDAIClaimed',
          args: [senderAddress],
        }),
        publicClient.getBalance({ address: faucetAddress }),
      ]);
    const recipientCode = await publicClient.getCode({ address: recipientAddress });

    if (!isHuman) {
      throw new Error('Connected account must be a Human avatar to claim xDAI from faucet.');
    }
    if (recipientCode && recipientCode !== '0x') {
      throw new Error('Recipient must be an EOA address (no contract code).');
    }
    if (!isTrusted) {
      throw new Error(
        `Faucet does not trust required group token ${groupTokenAddress}.`
      );
    }

    const estimatedPayoutWei = estimateFaucetXdaiPayout(amountAttoCircles, claimedXdai);
    if (estimatedPayoutWei <= 0n) {
      throw new Error('Faucet cap reached for this human avatar.');
    }
    if (faucetXdaiBalance < estimatedPayoutWei) {
      throw new Error(
        `Faucet has insufficient xDAI liquidity for this claim. Needs ${attoToCirclesString(estimatedPayoutWei)} xDAI.`
      );
    }

    const senderAvatar = await humanSdk.getAvatar(senderAddress);
    const txHashes: any[] = [];
    const requiredMintAmount =
      amountAttoCircles > senderGroupCrcBalance ? amountAttoCircles - senderGroupCrcBalance : 0n;

    if (requiredMintAmount > 0n) {
      const maxMintable = await senderAvatar.groupToken.getMaxMintableAmount(groupTokenAddress);
      if (maxMintable < requiredMintAmount) {
        throw new Error(
          `Not enough mintable group CRC. Need ${attoToCirclesString(requiredMintAmount)} CRC, max mintable is ${attoToCirclesString(maxMintable)} CRC.`
        );
      }

      showResult(
        'pending',
        `Minting ${attoToCirclesString(requiredMintAmount)} CRC from group ${groupTokenAddress}…`
      );
      lastTxHashes = [];
      await senderAvatar.groupToken.mint(groupTokenAddress, requiredMintAmount);
      txHashes.push(...lastTxHashes);
    }

    const availableGroupCrc = await publicClient.readContract({
      address: getAddress(HUB_V2_ADDRESS),
      abi: HUB_FUNDING_CHECK_ABI,
      functionName: 'balanceOf',
      args: [senderAddress, groupTokenId],
    });
    if (availableGroupCrc < amountAttoCircles) {
      throw new Error(
        `Insufficient group CRC after mint. Available ${attoToCirclesString(availableGroupCrc)} CRC, required ${attoToCirclesString(amountAttoCircles)} CRC.`
      );
    }

    const preflightData = encodeFunctionData({
      abi: HUB_SAFE_TRANSFER_FROM_ABI,
      functionName: 'safeTransferFrom',
      args: [senderAddress, faucetAddress, groupTokenId, amountAttoCircles, payoutDataHex],
    });

    showResult('pending', 'Sending group CRC to faucet…');
    await preflightEthCall({
      label: 'CRC transfer to faucet',
      to: HUB_V2_ADDRESS,
      data: preflightData,
      value: 0n,
      account: senderAddress,
    });

    lastTxHashes = [];
    await senderAvatar.transfer.direct(
      faucetAddress,
      amountAttoCircles,
      groupTokenAddress,
      hexToBytes(payoutDataHex)
    );
    txHashes.push(...lastTxHashes);
    lastTxHashes = txHashes;

    const links = lastTxHashes.length ? `<br>${txLinks(lastTxHashes)}` : '';
    showResult(
      'success',
      `Sent ${attoToCirclesString(amountAttoCircles)} CRC (${groupTokenAddress}) to faucet ${faucetAddress}. Recipient EOA: ${recipientAddress}.${links}`
    );
  } catch (err) {
    showResult('error', `CRC-to-xDAI funding failed: ${decodeError(err)}`);
  } finally {
    fundingInProgress = false;
    updateFundFaucetButtonState();
  }
}

/* ── Trust Management ────────────────────────────────────────────── */

async function resolveTrustAddress(rawInput) {
  const query = rawInput.trim();
  if (!query) {
    throw new Error('Enter a human or group address, username, or name.');
  }
  if (isAddress(query)) {
    return await validateAcceptedCrcTrustAddress(getAddress(query));
  }
  if (!humanSdk) {
    throw new Error('Connected account is not ready.');
  }

  const response = await humanSdk.rpc.profile.searchByAddressOrName(query, 40, null);
  const searchResults = response?.results || [];
  const results = filterAcceptedCrcTrustResults(searchResults);
  renderTrustSearchResults(results);

  const normalizedQuery = query.toLowerCase();
  const exactByName = results.find((entry) => {
    const name = (entry?.name || '').trim().toLowerCase();
    const registeredName = (entry?.registeredName || '').trim().toLowerCase();
    return name === normalizedQuery || registeredName === normalizedQuery;
  });
  if (exactByName?.address && isAddress(exactByName.address)) {
    return await validateAcceptedCrcTrustAddress(getAddress(exactByName.address));
  }

  const groupResults = results.filter((entry) => {
    const avatarType = (entry?.avatarType || '').toLowerCase();
    return avatarType.includes('group');
  });
  const scopedResults = groupResults.length > 0 ? groupResults : results;
  const firstMatch = scopedResults.find((entry) => entry?.address && isAddress(entry.address));
  if (!firstMatch) {
    throw new Error('No matching human or group avatar found.');
  }
  return await validateAcceptedCrcTrustAddress(getAddress(firstMatch.address));
}

async function updateTrustSearchOptions() {
  const query = trustAddrInput.value.trim();
  if (trustSearchDebounceTimer) {
    clearTimeout(trustSearchDebounceTimer);
    trustSearchDebounceTimer = null;
  }

  if (!query || query.length < 2) {
    clearTrustSearchResults();
    return;
  }

  if (isAddress(query)) {
    clearTrustSearchResults('Address detected. Click "Allow CRC" to add directly.');
    return;
  }

  const requestId = ++trustSearchRequestId;
  if (trustSearchResultsEl) trustSearchResultsEl.innerHTML = '<p class="muted">Searching…</p>';
  trustSearchDebounceTimer = setTimeout(async () => {
    try {
      if (!humanSdk) return;
      const response = await humanSdk.rpc.profile.searchByAddressOrName(query, 40, null);
      const rawResults = response?.results || [];
      const results = filterAcceptedCrcTrustResults(rawResults);
      if (requestId !== trustSearchRequestId) return;
      renderTrustSearchResults(results);
    } catch {
      if (requestId !== trustSearchRequestId) return;
      clearTrustSearchResults('Search failed. Try again.');
    } finally {
      if (requestId === trustSearchRequestId) trustSearchDebounceTimer = null;
    }
  }, 200);
}

async function addTrust(preselectedAddress = null) {
  let addr;
  try {
    addr = preselectedAddress ? getAddress(preselectedAddress) : await resolveTrustAddress(trustAddrInput.value);
  } catch (err) {
    showResult('error', decodeError(err));
    return;
  }

  if (!avatar) {
    showResult('error', 'Organization wallet is not ready.');
    return;
  }

  addTrustBtn.disabled = true;
  showResult('pending', 'Requesting approval…');

  try {
    lastTxHashes = [];
    await avatar.trust.add(addr);

    const links = lastTxHashes.length ? `<br>${txLinks(lastTxHashes)}` : '';
    showResult('success', `Now trusting ${truncAddr(addr)}.${links}`);
    trustAddrInput.value = '';
    resetTrustSearchState();
    await loadTrustRelations();
  } catch (err) {
    showResult('error', `Trust failed: ${decodeError(err)}`);
  } finally {
    addTrustBtn.disabled = false;
  }
}

async function removeTrust(addr) {
  const btns = trustListEl.querySelectorAll(`[data-addr="${addr}"]`);
  btns.forEach((b) => (b.disabled = true));
  showResult('pending', 'Requesting approval…');

  try {
    lastTxHashes = [];
    await avatar.trust.remove(addr);

    const links = lastTxHashes.length ? `<br>${txLinks(lastTxHashes)}` : '';
    showResult('success', `Removed trust for ${truncAddr(addr)}.${links}`);
    await loadTrustRelations();
  } catch (err) {
    showResult('error', `Untrust failed: ${decodeError(err)}`);
    btns.forEach((b) => (b.disabled = false));
  }
}

async function withdrawAllHoldings() {
  if (!connectedAddress || !isAddress(connectedAddress)) {
    showResult('error', 'Connect your wallet first.');
    return;
  }

  if (!avatar) {
    showResult('error', 'Organization wallet is not ready.');
    return;
  }

  if (getSupportedWithdrawableHoldings().length === 0) {
    await loadBalances();
  }

  const holdings = getSupportedWithdrawableHoldings();
  if (holdings.length === 0) {
    showResult('error', 'No withdrawable CRC balance.');
    return;
  }

  const recipient = getWithdrawRecipientAddress();
  if (!recipient) {
    showResult('error', 'Enter a valid withdrawal address.');
    return;
  }
  const withdrawAmount = getWithdrawAmountAtto();
  if (withdrawAmount === null || withdrawAmount <= 0n) {
    showResult('error', 'Enter a valid CRC amount to withdraw.');
    return;
  }
  const totalAvailable = getSupportedWithdrawableTotal();
  if (withdrawAmount > totalAvailable) {
    showResult('error', `Amount exceeds available balance of ${attoToCirclesString(totalAvailable)} CRC.`);
    return;
  }

  const transactions: any[] = [];
  let remainingAmount = withdrawAmount;

  for (const holding of holdings) {
    if (!holding.tokenOwner || remainingAmount <= 0n) continue;
    const transferAmount = holding.amount < remainingAmount ? holding.amount : remainingAmount;
    if (transferAmount <= 0n) continue;

    if (holding.needsUnwrap && holding.tokenAddress) {
      const unwrapAmount =
        transferAmount === holding.amount
          ? holding.unwrapAmount
          : divideCeil(holding.unwrapAmount * transferAmount, holding.amount);
      transactions.push({
        to: holding.tokenAddress,
        data: encodeFunctionData({
          abi: ERC20_UNWRAP_ABI,
          functionName: 'unwrap',
          args: [unwrapAmount],
        }),
        value: 0n,
      });
    }

    const tokenId = await publicClient.readContract({
      address: getAddress(HUB_V2_ADDRESS),
      abi: HUB_SAFE_TRANSFER_FROM_ABI,
      functionName: 'toTokenId',
      args: [holding.tokenOwner],
    });

    transactions.push({
      to: HUB_V2_ADDRESS,
      data: encodeFunctionData({
        abi: HUB_SAFE_TRANSFER_FROM_ABI,
        functionName: 'safeTransferFrom',
        args: [getAddress(activeOrgAddress), recipient, tokenId, transferAmount, '0x'],
      }),
      value: 0n,
    });

    remainingAmount -= transferAmount;
  }

  if (transactions.length === 0 || remainingAmount > 0n) {
    showResult('error', 'No supported token balances could be prepared for transfer.');
    return;
  }

  withdrawInProgress = true;
  updateWithdrawButtonState();
  showResult('pending', 'Requesting approval to withdraw CRC…');

  try {
    lastTxHashes = [];
    if (!activeOrgRunner) {
      throw new Error('Organization wallet runner is not ready.');
    }

    await activeOrgRunner.sendTransaction(transactions);

    const links = lastTxHashes.length ? `<br>${txLinks(lastTxHashes)}` : '';
    showResult(
      'success',
      `Withdrew ${attoToCirclesString(withdrawAmount)} CRC to ${recipient}.${links}`
    );

    await loadBalances();
  } catch (err) {
    showResult('error', `Withdraw all failed: ${decodeError(err)}`);
  } finally {
    withdrawInProgress = false;
    updateWithdrawButtonState();
  }
}

/* ── Data Loading ────────────────────────────────────────────────── */

async function loadTrustRelations() {
  trustListEl.innerHTML = '<div class="shimmer-block"></div>';

  if (!orgSdk || !activeOrgAddress) {
    trustListEl.innerHTML = '<p class="muted">No organization selected.</p>';
    return;
  }

  try {
    const relations = await orgSdk.data.getTrustRelations(activeOrgAddress);
    const outgoingRelations = (relations || []).filter((relation) => {
      const relationType = (relation?.relation || '').toLowerCase();
      return relationType === 'trusts' || relationType === 'mutuallytrusts';
    });

    if (!outgoingRelations || outgoingRelations.length === 0) {
      trustListEl.innerHTML = '<p class="muted">No trust relations yet.</p>';
      return;
    }

    const normalizedTrustAddrs = outgoingRelations
      .map((r) => r.objectAvatar || r.trustee || r.address || (typeof r === 'string' ? r : ''))
      .filter((addr) => typeof addr === 'string' && isAddress(addr))
      .map((addr) => getAddress(addr));

    const uniqueTrustAddrs = [...new Set(normalizedTrustAddrs)];
    const trustNameByAddr = new Map<string, string>();
    await Promise.all(
      uniqueTrustAddrs.map(async (addr: any) => {
        try {
          const profile = await orgSdk.rpc.profile.getProfileByAddress(addr);
          const name = profile?.name?.trim() || profile?.registeredName?.trim() || null;
          if (name) trustNameByAddr.set(addr.toLowerCase(), name);
        } catch {
          // Ignore profile lookup failures and fall back to address.
        }
      })
    );

    trustListEl.innerHTML = outgoingRelations
      .map((r) => {
        const addr =
          r.objectAvatar || r.trustee || r.address || (typeof r === 'string' ? r : '');
        if (!isAddress(addr)) return '';
        const normalizedAddr = getAddress(addr);
        const displayLabel = trustNameByAddr.get(normalizedAddr.toLowerCase()) || normalizedAddr;
        const userGroupBadge = userGroupAddresses.has(normalizedAddr.toLowerCase())
          ? '<span class="badge badge-success trust-your-group">Your group</span>'
          : '';
        return `
          <div class="trust-item">
            <div class="trust-item-label">
              <a class="trust-addr" href="https://explorer.aboutcircles.com/avatar/${normalizedAddr}/" target="_blank" title="${escapeHtml(normalizedAddr)}">${escapeHtml(displayLabel)}</a>
              ${userGroupBadge}
            </div>
            <button class="btn-sm btn-danger" data-addr="${escapeHtml(normalizedAddr)}">Untrust</button>
          </div>`;
      })
      .join('');

    trustListEl.querySelectorAll('.btn-danger').forEach((btn) => {
      btn.addEventListener('click', () => removeTrust(btn.dataset.addr));
    });
  } catch (err) {
    trustListEl.innerHTML = `<p class="muted">Error loading trust: ${decodeError(err)}</p>`;
  }
}

async function loadBalances() {
  if (!avatar) {
    cachedWithdrawableHoldings = [];
    renderWithdrawHoldings();
    updateWithdrawAvailableText();
    updateWithdrawButtonState();
    return;
  }

  try {
    const balances = await avatar.balances.getTokenBalances();
    cachedWithdrawableHoldings = buildWithdrawableHoldings(balances);
    renderWithdrawHoldings();
    updateWithdrawAvailableText();
    updateWithdrawButtonState();
  } catch (err) {
    cachedWithdrawableHoldings = [];
    renderWithdrawHoldings();
    updateWithdrawAvailableText();
    updateWithdrawButtonState();
    showResult('error', `Could not load balances: ${decodeError(err)}`);
  }
}

async function loadOrganizationDashboard(orgAddress, runner, statusLabel) {
  activeOrgAddress = orgAddress;
  activeOrgRunner = runner;
  orgSdk = new Sdk(undefined, runner);
  avatar = await orgSdk.getAvatar(orgAddress);

  setStatus(statusLabel, 'success');
  dashboardSection.classList.remove('hidden');

  // Reset dashboard header to loading state
  orgNameDisplay.textContent = '—';
  orgAddrDisplay.textContent = orgAddress;
  if (orgDescriptionDisplay) {
    orgDescriptionDisplay.textContent = '';
    orgDescriptionDisplay.classList.add('hidden');
  }
  if (orgDashboardAvatarWrap) orgDashboardAvatarWrap.classList.add('hidden');
  if (editOrgBtn) editOrgBtn.disabled = true;
  backToOptionsBtn.classList.remove('hidden');

  try {
    const profile = await avatar.profile.get();
    orgNameDisplay.textContent = profile?.name || '—';
    if (orgDescriptionDisplay && profile?.description?.trim()) {
      orgDescriptionDisplay.textContent = profile.description.trim();
      orgDescriptionDisplay.classList.remove('hidden');
    }
    const imageUrl = profile?.previewImageUrl || profile?.imageUrl || null;
    if (imageUrl && orgDashboardAvatar && orgDashboardAvatarWrap) {
      orgDashboardAvatar.src = imageUrl;
      orgDashboardAvatarWrap.classList.remove('hidden');
    }
  } catch {
    orgNameDisplay.textContent = '—';
  } finally {
    if (editOrgBtn) editOrgBtn.disabled = false;
  }

  await Promise.allSettled([loadSafeSigners(), loadTrustRelations(), loadBalances()]);
}

async function openOwnedOrganization(orgSafeAddress, options: any = {}) {
  if (!connectedAddress || !humanSdk) return false;
  const preserveResult = !!options?.preserveResult;

  hideAllSections();

  // Show the dashboard section immediately with loading placeholders
  dashboardSection.classList.remove('hidden');
  activeOrgAddress = null;
  activeOrgRunner = null;
  cachedWithdrawableHoldings = [];
  orgNameDisplay.textContent = '—';
  orgAddrDisplay.textContent = truncAddr(orgSafeAddress);
  if (orgDescriptionDisplay) {
    orgDescriptionDisplay.textContent = '';
    orgDescriptionDisplay.classList.add('hidden');
  }
  orgBalanceDisplay.textContent = '…';
  if (orgDashboardAvatarWrap) orgDashboardAvatarWrap.classList.add('hidden');
  if (editOrgBtn) editOrgBtn.disabled = true;
  safeSignersListEl.innerHTML = '<div class="shimmer-block"></div>';
  trustListEl.innerHTML = '<div class="shimmer-block"></div>';
  if (withdrawHoldingsListEl) withdrawHoldingsListEl.innerHTML = '<div class="shimmer-block"></div>';
  updateWithdrawAvailableText();
  updateWithdrawButtonState();
  setStatus('Loading…', 'pending');

  try {
    const normalizedOrgAddress = getAddress(orgSafeAddress);
    const runner =
      connectedAddress.toLowerCase() === normalizedOrgAddress.toLowerCase()
        ? createRunner(normalizedOrgAddress)
        : createSafeOwnerRunner(connectedAddress, normalizedOrgAddress);

    await loadOrganizationDashboard(
      normalizedOrgAddress,
      runner,
      'Organization'
    );
    if (!preserveResult) hideResult();
    return true;
  } catch (err) {
    showResult('error', `Could not open organization: ${decodeError(err)}`);
    return false;
  }
}

/* ── Avatar State ────────────────────────────────────────────────── */

async function loadAvatarState(preserveResult = false) {
  if (!connectedAddress || !humanSdk) return;

  hideAllSections();
  if (!preserveResult) hideResult();

  // Show options section immediately with loading shimmer
  optionsOrgList.innerHTML = '<div class="shimmer-block"></div>';
  optionsSection.classList.remove('hidden');
  setStatus('Loading…', 'pending');

  avatar = null;
  orgSdk = null;
  activeOrgRunner = null;
  activeOrgAddress = null;
  activeSafeOwners = [];
  withdrawInProgress = false;
  cachedWithdrawableHoldings = [];
  if (withdrawAmountInput) withdrawAmountInput.value = '';
  trustAddrInput.value = '';
  resetTrustSearchState();
  renderWithdrawHoldings();
  renderFundRecipientActions();
  updateWithdrawAvailableText();
  updateWithdrawButtonState();
  updateFundFaucetButtonState();

  try {
    const [connectedInfo, ownerSafeCandidates] = await Promise.all([
      humanSdk.data.getAvatar(connectedAddress).catch(() => null),
      fetchOwnerOrgSafeCandidates(connectedAddress, humanSdk),
    ]);
    const sessionOrgSafes = getSessionOrgSafes(connectedAddress);
    const candidateOrgSafes = normalizeOrgSafes([
      ...(isOrganizationType(connectedInfo) ? [connectedAddress] : []),
      ...ownerSafeCandidates,
      ...sessionOrgSafes,
    ]);
    const validOwnedOrgSafes: any[] = [];

    for (const safe of candidateOrgSafes) {
      try {
        const info = await humanSdk.data.getAvatar(safe);
        if (isOrganizationType(info)) validOwnedOrgSafes.push(safe);
      } catch {
        // Skip entries that are not registered org avatars.
      }
    }

    setSessionOrgSafes(connectedAddress, validOwnedOrgSafes);
    const orgOptions = await enrichOrganizationOptions(validOwnedOrgSafes, humanSdk);
    showCreateOrgOptions(orgOptions);
  } catch {
    const fallbackSafes = connectedAddress ? getSessionOrgSafes(connectedAddress) : [];
    const fallbackOptions = fallbackSafes.map((address) => ({ address, name: null }));
    showCreateOrgOptions(fallbackOptions);
  }
}

/* ── Wallet Listener ─────────────────────────────────────────────── */

onWalletChange(async (address) => {
  try {
    connectedAddress = address ? getAddress(address) : null;
  } catch {
    connectedAddress = null;
  }

  avatar = null;
  orgSdk = null;
  activeOrgRunner = null;
  humanSdk = null;
  activeOrgAddress = null;
  activeSafeOwners = [];
  lastTxHashes = [];
  withdrawInProgress = false;
  cachedWithdrawableHoldings = [];
  userGroupAddresses = new Set();
  if (withdrawAmountInput) withdrawAmountInput.value = '';
  resetTrustSearchState('Connect a wallet to search.');
  renderWithdrawHoldings();
  renderFundRecipientActions();
  updateWithdrawAvailableText();
  updateWithdrawButtonState();
  updateFundFaucetButtonState();

  hideAllSections();
  hideResult();

  if (!connectedAddress) {
    showDisconnectedState();
    return;
  }

  setDefaultWithdrawRecipient();
  setStatus('Checking…', 'pending');

  try {
    humanSdk = new Sdk(undefined, createRunner(connectedAddress));
    await Promise.all([
      refreshUserGroupMemberships(humanSdk, connectedAddress),
      loadAvatarState(),
    ]);
  } catch (err) {
    if (isPasskeyAutoConnectError(err)) {
      setStatus('Wallet reconnect required', 'warning');
      showResult(
        'error',
        'Passkey auto-connect failed in the host app. Re-open wallet connect and choose your wallet again.'
      );
    } else {
      setStatus('Connection error', 'error');
      showResult('error', `Wallet initialization failed: ${decodeError(err)}`);
    }
  }
});

if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    if (!isPasskeyAutoConnectError(event.reason)) return;
    setStatus('Wallet reconnect required', 'warning');
    showResult(
      'error',
      'Passkey auto-connect failed in the host app. Re-open wallet connect and choose your wallet again.'
    );
  });

  window.addEventListener('error', (event) => {
    if (!isPasskeyAutoConnectError(event.error || event.message)) return;
    setStatus('Wallet reconnect required', 'warning');
    showResult(
      'error',
      'Passkey auto-connect failed in the host app. Re-open wallet connect and choose your wallet again.'
    );
  });
}

/* ── Event Listeners ─────────────────────────────────────────────── */

registerBtn.addEventListener('click', submitOrganizationForm);
addTrustBtn.addEventListener('click', () => addTrust());
addSafeSignerBtn.addEventListener('click', addSafeSigner);
withdrawAllBtn?.addEventListener('click', withdrawAllHoldings);
fundAmountXdaiInput.addEventListener('input', updateFundFaucetButtonState);
trustAddrInput.addEventListener('input', updateTrustSearchOptions);
withdrawRecipientAddressInput?.addEventListener('input', () => {
  renderWithdrawHoldings();
  updateWithdrawButtonState();
});
withdrawAmountInput?.addEventListener('input', () => {
  renderWithdrawHoldings();
  updateWithdrawButtonState();
});
withdrawMaxBtn?.addEventListener('click', fillWithdrawMaxAmount);
startCreateOrgBtn.addEventListener('click', openCreateOrgForm);
cancelRegisterBtn.addEventListener('click', closeOrgForm);
backToOptionsBtn.addEventListener('click', async () => {
  await loadAvatarState();
});
editOrgBtn?.addEventListener('click', openEditOrgForm);

orgNameInput.addEventListener('input', () => {
  updateRegisterButtonState();
});
orgImageInput?.addEventListener('change', handleOrgImageChange);
clearOrgImageBtn?.addEventListener('click', () => {
  clearOrgImageSelection();
  hideResult();
  updateRegisterButtonState();
});

/* ── Dropzone ─────────────────────────────────────────────────────── */

if (orgImageDropzone && orgImageInput) {
  orgImageDropzone.addEventListener('click', () => orgImageInput.click());

  orgImageDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    orgImageDropzone.classList.add('dragover');
  });

  orgImageDropzone.addEventListener('dragleave', () => {
    orgImageDropzone.classList.remove('dragover');
  });

  orgImageDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    orgImageDropzone.classList.remove('dragover');
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      const dt = new DataTransfer();
      dt.items.add(file);
      orgImageInput.files = dt.files;
      handleOrgImageChange();
    }
  });
}

/* ── Organization Explorer ───────────────────────────────────────── */
// Read-only: works with or without a connected wallet. Paste any org address
// and its Circles activity loads — direction (in/out), the proper amount per
// Circles token type (personal/group ERC1155, demurraged/inflationary ERC20
// wrappers — inflationary static amounts are converted to demurraged CRC at
// the transfer's timestamp), and the avatar behind each token, resolved to a
// profile name.

const explorerSection = byId('explorer-section');
const explorerAddressInput = byId('explorer-address');
const explorerLoadBtn = byId('explorer-load-btn');
const explorerOrgHeader = byId('explorer-org-header');
const explorerOrgAvatarWrap = byId('explorer-org-avatar-wrap');
const explorerOrgAvatar = byId('explorer-org-avatar');
const explorerOrgName = byId('explorer-org-name');
const explorerOrgAddressEl = byId('explorer-org-address');
const explorerOrgTypeEl = byId('explorer-org-type');
const explorerOrgDescription = byId('explorer-org-description');
const explorerActivityWrap = byId('explorer-activity');
const explorerActivityList = byId('explorer-activity-list');
const explorerLoadMoreBtn = byId('explorer-load-more-btn');
const explorerBackBtn = byId('explorer-back-btn');
const loginExploreBtn = byId('login-explore-btn');
const optionsExploreBtn = byId('options-explore-btn');
const viewOrgActivityBtn = byId('view-org-activity-btn');

const EXPLORER_PAGE_SIZE = 25;
let explorerOrg: string | null = null; // lowercased address currently shown
let explorerCursor: { blockNumber: number; logIndex: number } | null = null;
let explorerReturnTo: string | null = null; // 'dashboard' when opened from an open org
let explorerLoadSeq = 0;
const explorerProfileCache = new Map<string, { name: string; imageUrl: string | null } | null>();
const wrapperOwnerCache = new Map<string, string | null>();

type TransferRow = Record<string, any>;

async function circlesQuery(params: Record<string, unknown>): Promise<TransferRow[]> {
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'circles_query', params: [params] }),
  });
  const json = await response.json();
  if (json.error) throw new Error(json.error.message || 'Circles RPC error');
  const { columns, rows } = json.result || { columns: [], rows: [] };
  return (rows || []).map((row: unknown[]) =>
    Object.fromEntries(columns.map((c: string, i: number) => [c, row[i]]))
  );
}

async function fetchExplorerProfiles(addresses: string[]): Promise<void> {
  const missing = [...new Set(addresses.map((a) => a.toLowerCase()))].filter(
    (a) => isAddress(a) && a !== zeroAddress && !explorerProfileCache.has(a)
  );
  if (missing.length === 0) return;
  try {
    const response = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'circles_getProfileByAddressBatch',
        params: [missing],
      }),
    });
    const json = await response.json();
    (json.result || []).forEach((profile: any, i: number) => {
      explorerProfileCache.set(
        missing[i],
        profile?.name
          ? { name: profile.name, imageUrl: profile.previewImageUrl || profile.imageUrl || null }
          : null
      );
    });
  } catch {
    /* profiles are cosmetic — leave uncached and fall back to addresses */
  }
}

// The avatar behind a token: 1155 rows carry it directly (tokenAddress); for
// ERC20 wrapper rows resolve wrapper -> tokenOwner via the Tokens view.
async function resolveWrapperOwners(wrapperAddresses: string[]): Promise<void> {
  const missing = [...new Set(wrapperAddresses.map((a) => a.toLowerCase()))].filter(
    (a) => !wrapperOwnerCache.has(a)
  );
  await Promise.all(
    missing.map(async (wrapper) => {
      try {
        const rows = await circlesQuery({
          Namespace: 'V_Crc',
          Table: 'Tokens',
          Columns: [],
          Filter: [
            { Type: 'FilterPredicate', FilterType: 'Equals', Column: 'token', Value: wrapper },
          ],
          Limit: 1,
        });
        const owner = rows[0]?.tokenOwner;
        wrapperOwnerCache.set(wrapper, owner && isAddress(owner) ? getAddress(owner) : null);
      } catch {
        wrapperOwnerCache.set(wrapper, null);
      }
    })
  );
}

function describeTransferToken(row: TransferRow): {
  amount: bigint;
  kindLabel: string;
  avatarBehind: string | null;
} {
  const type = row.type || '';
  const tokenType = row.tokenType || '';
  const rawValue = BigInt(row.value || 0);

  if (type === 'CrcV2_Erc20WrapperTransfer') {
    const wrapper = (row.tokenAddress || '').toLowerCase();
    const avatarBehind = wrapperOwnerCache.get(wrapper) || null;
    if (tokenType === 'CrcV2_ERC20WrapperDeployed_Inflationary') {
      // Inflationary wrappers hold static units — convert to demurraged CRC at
      // the transfer's own timestamp, so the row shows what the transfer was
      // actually worth when it happened.
      let demurraged = rawValue;
      try {
        demurraged = CirclesConverter.attoStaticCirclesToAttoCircles(
          rawValue,
          BigInt(row.timestamp || Math.floor(Date.now() / 1000))
        );
      } catch {
        /* fall back to the raw static amount */
      }
      return { amount: demurraged, kindLabel: 'ERC20 · inflationary', avatarBehind };
    }
    return { amount: rawValue, kindLabel: 'ERC20 · demurraged', avatarBehind };
  }

  // ERC1155 hub transfers: tokenAddress IS the avatar behind the token.
  const avatarBehind =
    row.tokenAddress && isAddress(row.tokenAddress) ? getAddress(row.tokenAddress) : null;
  const kindLabel =
    tokenType === 'CrcV2_RegisterGroup'
      ? 'Group CRC'
      : tokenType === 'CrcV2_RegisterHuman'
        ? 'Personal CRC'
        : 'CRC';
  return { amount: rawValue, kindLabel, avatarBehind };
}

// Activity amounts round to the NEAREST 2 decimals (unlike the truncating
// balance formatter): demurrage-shaved values like 47.999952 read as the 48
// they represent, instead of a puzzling 47.999.
function formatActivityAmount(atto: bigint): string {
  const HUNDREDTH = 10n ** 16n;
  const rounded = (atto + HUNDREDTH / 2n) / HUNDREDTH; // half-up, in hundredths
  const whole = rounded / 100n;
  const cents = rounded % 100n;
  if (cents === 0n) return whole.toString();
  return `${whole}.${cents.toString().padStart(2, '0').replace(/0$/, '')}`;
}

function explorerNameFor(address: string | null): string | null {
  if (!address) return null;
  const cached = explorerProfileCache.get(address.toLowerCase());
  return cached?.name || null;
}

function shortenExplorerAddress(address: string): string {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '';
}

function explorerPartyHtml(address: string | null): string {
  if (!address || address === zeroAddress) return '<span class="muted">—</span>';
  const name = explorerNameFor(address);
  const label = name
    ? escapeHtml(name)
    : `<span class="mono">${escapeHtml(shortenExplorerAddress(address))}</span>`;
  return `<a class="org-link" href="https://explorer.aboutcircles.com/avatar/${escapeHtml(address)}/" target="_blank" rel="noopener" title="${escapeHtml(address)}">${label}</a>`;
}

function renderActivityRows(rows: TransferRow[], orgAddressLower: string, append: boolean): void {
  const html = rows
    .map((row) => {
      const from = (row.from || '').toLowerCase();
      const isMint = from === zeroAddress;
      const isBurn = (row.to || '').toLowerCase() === zeroAddress;
      const incoming = (row.to || '').toLowerCase() === orgAddressLower;
      const { amount, kindLabel, avatarBehind } = describeTransferToken(row);
      const counterparty = incoming ? row.from : row.to;
      const directionLabel = isMint ? 'Mint' : isBurn ? 'Burn' : incoming ? 'In' : 'Out';
      const directionClass = incoming && !isBurn ? 'activity-in' : 'activity-out';
      const sign = incoming ? '+' : '−';
      const when = row.timestamp
        ? new Date(Number(row.timestamp) * 1000).toLocaleString([], {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          })
        : '';
      const avatarBehindHtml = avatarBehind
        ? `<span class="muted">· token of ${explorerPartyHtml(avatarBehind)}</span>`
        : '';

      return `
        <div class="trust-item activity-item">
          <div class="activity-main">
            <div class="activity-top">
              <span class="activity-direction ${directionClass}">${directionLabel}</span>
              <span>${incoming ? 'from' : 'to'} ${explorerPartyHtml(counterparty)}</span>
            </div>
            <div class="activity-meta muted">
              ${escapeHtml(kindLabel)} ${avatarBehindHtml} · ${escapeHtml(when)}
              · <a class="org-link" href="https://gnosisscan.io/tx/${escapeHtml(row.transactionHash || '')}" target="_blank" rel="noopener">tx</a>
            </div>
          </div>
          <span class="activity-amount ${directionClass}">${sign}${escapeHtml(formatActivityAmount(amount))}</span>
        </div>
      `;
    })
    .join('');

  if (append) {
    explorerActivityList.insertAdjacentHTML('beforeend', html);
  } else {
    explorerActivityList.innerHTML =
      html || '<p class="muted">No transfers found for this address.</p>';
  }
}

async function fetchActivityPage(
  orgAddress: string,
  cursor: { blockNumber: number; logIndex: number } | null
): Promise<TransferRow[]> {
  // The indexer stores addresses lowercased and Equals filters are
  // case-sensitive — a checksummed value silently matches nothing.
  const addressValue = orgAddress.toLowerCase();
  const filter = {
    Type: 'Conjunction',
    ConjunctionType: 'Or',
    Predicates: [
      { Type: 'FilterPredicate', FilterType: 'Equals', Column: 'from', Value: addressValue },
      { Type: 'FilterPredicate', FilterType: 'Equals', Column: 'to', Value: addressValue },
    ],
  };
  const predicates = cursor
    ? [
        {
          Type: 'Conjunction',
          ConjunctionType: 'And',
          Predicates: [
            filter,
            {
              Type: 'FilterPredicate',
              FilterType: 'LessThan',
              Column: 'blockNumber',
              Value: cursor.blockNumber,
            },
          ],
        },
      ]
    : [filter];

  return circlesQuery({
    Namespace: 'V_CrcV2',
    Table: 'Transfers',
    Columns: [],
    Filter: predicates,
    Order: [
      { Column: 'blockNumber', SortOrder: 'DESC' },
      { Column: 'logIndex', SortOrder: 'DESC' },
    ],
    Limit: EXPLORER_PAGE_SIZE,
  });
}

async function loadExplorerActivity(
  orgAddress: string,
  { append = false }: { append?: boolean } = {}
): Promise<void> {
  const seq = ++explorerLoadSeq;
  const orgLower = orgAddress.toLowerCase();
  explorerLoadMoreBtn.classList.add('hidden');
  if (!append) {
    explorerActivityList.innerHTML = '<div class="shimmer-block"></div>';
    explorerActivityWrap.classList.remove('hidden');
  }

  try {
    const rows = await fetchActivityPage(orgAddress, append ? explorerCursor : null);
    if (seq !== explorerLoadSeq) return;

    // Resolve wrapper owners first so token avatars join the profile batch.
    const wrapperAddrs = rows
      .filter((r) => r.type === 'CrcV2_Erc20WrapperTransfer' && r.tokenAddress)
      .map((r) => r.tokenAddress);
    await resolveWrapperOwners(wrapperAddrs);

    const partyAddrs = rows.flatMap((r) => {
      const { avatarBehind } = describeTransferToken(r);
      return [r.from, r.to, avatarBehind].filter((a) => a && isAddress(a));
    });
    await fetchExplorerProfiles(partyAddrs);
    if (seq !== explorerLoadSeq) return;

    if (!append) explorerActivityList.innerHTML = '';
    renderActivityRows(rows, orgLower, append);

    if (rows.length === EXPLORER_PAGE_SIZE) {
      const last = rows[rows.length - 1];
      explorerCursor = { blockNumber: last.blockNumber, logIndex: last.logIndex };
      explorerLoadMoreBtn.classList.remove('hidden');
    } else {
      explorerCursor = null;
    }
  } catch (err) {
    if (seq !== explorerLoadSeq) return;
    if (!append) {
      explorerActivityList.innerHTML = `<p class="muted">Could not load activity: ${escapeHtml(decodeError(err))}</p>`;
    }
  }
}

async function exploreOrganization(rawAddress?: string): Promise<void> {
  const value = (rawAddress || explorerAddressInput?.value || '').trim();
  if (!isAddress(value)) {
    showResult('error', 'Enter a valid 0x… address to explore.');
    return;
  }
  hideResult();

  const orgAddress = getAddress(value);
  explorerOrg = orgAddress.toLowerCase();
  explorerCursor = null;

  explorerOrgHeader.classList.remove('hidden');
  explorerOrgName.textContent = '…';
  explorerOrgAddressEl.textContent = orgAddress;
  explorerOrgAddressEl.href = `https://explorer.aboutcircles.com/avatar/${orgAddress}/`;
  explorerOrgTypeEl.classList.add('hidden');
  explorerOrgDescription.classList.add('hidden');
  explorerOrgAvatarWrap.classList.add('hidden');

  // Avatar info + profile load in parallel with the first activity page.
  const headerLoad = (async () => {
    try {
      const rows = await circlesQuery({
        Namespace: 'V_Crc',
        Table: 'Avatars',
        Columns: [],
        Filter: [
          { Type: 'FilterPredicate', FilterType: 'Equals', Column: 'avatar', Value: explorerOrg },
        ],
        Limit: 1,
      });
      const info = rows[0] || null;
      const typeLower = (info?.type || '').toLowerCase();
      explorerOrgTypeEl.textContent = typeLower.includes('organization')
        ? 'Organization'
        : typeLower.includes('group')
          ? 'Group'
          : typeLower.includes('human')
            ? 'Human'
            : 'Unregistered';
      explorerOrgTypeEl.classList.remove('hidden');
    } catch {
      /* type badge is cosmetic */
    }

    try {
      await fetchExplorerProfiles([orgAddress]);
      const profile = explorerProfileCache.get(explorerOrg!);
      explorerOrgName.textContent = profile?.name || shortenExplorerAddress(orgAddress);
      if (profile?.imageUrl) {
        explorerOrgAvatar.src = profile.imageUrl;
        explorerOrgAvatarWrap.classList.remove('hidden');
      }
    } catch {
      explorerOrgName.textContent = shortenExplorerAddress(orgAddress);
    }
  })();

  await Promise.all([headerLoad, loadExplorerActivity(orgAddress)]);
}

function openExplorer(): void {
  explorerReturnTo = null;
  hideAllSections();
  hideResult();
  explorerSection.classList.remove('hidden');
  explorerAddressInput?.focus();
}

// From an open org's dashboard: jump straight to that org's activity.
function openExplorerForActiveOrg(): void {
  if (!activeOrgAddress) return;
  explorerReturnTo = 'dashboard';
  hideAllSections();
  hideResult();
  explorerSection.classList.remove('hidden');
  if (explorerAddressInput) explorerAddressInput.value = activeOrgAddress;
  exploreOrganization(activeOrgAddress);
}

function closeExplorer(): void {
  explorerSection.classList.add('hidden');
  hideResult();
  if (explorerReturnTo === 'dashboard' && activeOrgAddress) {
    explorerReturnTo = null;
    dashboardSection.classList.remove('hidden');
    return;
  }
  explorerReturnTo = null;
  if (connectedAddress) {
    optionsSection.classList.remove('hidden');
  } else {
    loginSection.classList.remove('hidden');
  }
}

loginExploreBtn?.addEventListener('click', openExplorer);
optionsExploreBtn?.addEventListener('click', openExplorer);
viewOrgActivityBtn?.addEventListener('click', openExplorerForActiveOrg);
explorerBackBtn?.addEventListener('click', closeExplorer);
explorerLoadBtn?.addEventListener('click', () => exploreOrganization());
explorerAddressInput?.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Enter') exploreOrganization();
});
explorerLoadMoreBtn?.addEventListener('click', () => {
  if (explorerOrg) loadExplorerActivity(getAddress(explorerOrg), { append: true });
});

/* ── Init ─────────────────────────────────────────────────────────── */

showDisconnectedState();
setOrgFormMode('create');
updateWithdrawButtonState();
updateFundFaucetButtonState();
updateRegisterButtonState();
}
