/**
 * Test Account Flag — main.js
 *
 * Allows Circles users to flag their own account as a test account.
 * Stores the flag in the user's extensible Circles profile (IPFS + on-chain CID).
 */

import { onWalletChange, sendTransactions, signMessage, isMiniappMode } from './miniapp-sdk.js';
import { Sdk } from '@aboutcircles/sdk';
import { getAddress, encodeFunctionData, createPublicClient, http } from 'viem';
import { gnosis } from 'viem/chains';
import { cidV0ToHex } from '@aboutcircles/sdk-utils';

// ─── Constants ──────────────────────────────────────────────
const RPC_URL = 'https://rpc.aboutcircles.com/';
const NAME_REGISTRY_ADDRESS = '0x4c16bA1a3CA3E347D85e881EaaAB0663FF5E6bd9';
const TEST_FLAG_KEY = 'isTestAccount';

// ─── DOM refs ───────────────────────────────────────────────
const badge = document.getElementById('badge');
const disconnectedView = document.getElementById('disconnected-view');
const loadingView = document.getElementById('loading-view');
const noProfileView = document.getElementById('no-profile-view');
const flagView = document.getElementById('flag-view');
const profileAvatar = document.getElementById('profile-avatar');
const profileName = document.getElementById('profile-name');
const profileAddress = document.getElementById('profile-address');
const noProfileAddress = document.getElementById('no-profile-address');
const flagStatus = document.getElementById('flag-status');
const flagDescription = document.getElementById('flag-description');
const actionTitle = document.getElementById('action-title');
const actionDescription = document.getElementById('action-description');
const actionImplication = document.getElementById('action-implication');
const flagBtn = document.getElementById('flag-btn');
const btnText = flagBtn.querySelector('.btn-text');
const btnSpinner = flagBtn.querySelector('.btn-spinner');
const confirmModal = document.getElementById('confirm-modal');
const confirmTitle = document.getElementById('confirm-title');
const confirmMessage = document.getElementById('confirm-message');
const confirmCancel = document.getElementById('confirm-cancel');
const confirmProceed = document.getElementById('confirm-proceed');
const resultBox = document.getElementById('result-box');
const resultIcon = document.getElementById('result-icon');
const resultMessage = document.getElementById('result-message');

// ─── State ──────────────────────────────────────────────────
let connectedAddress = null;
let currentProfile = null;
let isCurrentlyFlagged = false;
let isBusy = false;
let pendingAction = null; // 'flag' | 'unflag'

// ─── SDK instances (lazy) ───────────────────────────────────
let _readSdk = null;
function getReadSdk() {
  if (!_readSdk) _readSdk = new Sdk(RPC_URL, null);
  return _readSdk;
}

// ─── Public client for receipts ─────────────────────────────
const RPC_FALLBACKS = [
  RPC_URL,
  'https://rpc.gnosischain.com',
  'https://1rpc.io/gnosis',
];
const receiptClients = RPC_FALLBACKS.map(url =>
  createPublicClient({ chain: gnosis, transport: http(url) })
);

// ─── NameRegistry ABI (updateMetadata) ──────────────────────
const NAME_REGISTRY_ABI = [{
  type: 'function',
  name: 'updateMetadata',
  inputs: [
    { name: 'avatar', type: 'address' },
    { name: 'metadataDigest', type: 'bytes32' },
  ],
  outputs: [],
  stateMutability: 'nonpayable',
}];

// ─── Helpers ────────────────────────────────────────────────
function decodeError(err) {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (err.shortMessage) return err.shortMessage;
  if (err.message) return err.message;
  return String(err);
}

function isPasskeyAutoConnectError(err) {
  const msg = decodeError(err).toLowerCase();
  return (
    msg.includes('passkey') ||
    msg.includes('auto connect') ||
    (msg.includes('wallet address') && msg.includes('retrieve'))
  );
}

function shortAddress(addr) {
  if (!addr) return '';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function showToast(message, type = 'info', durationMs = 4000) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), durationMs);
}

function showView(id) {
  [disconnectedView, loadingView, noProfileView, flagView].forEach(v => v.classList.add('hidden'));
  document.getElementById(id)?.classList.remove('hidden');
}

function setBusy(busy) {
  isBusy = busy;
  flagBtn.disabled = busy;
  btnText.textContent = busy ? 'Processing…' : (isCurrentlyFlagged ? 'Remove Test Flag' : 'Flag as Test Account');
  btnSpinner.classList.toggle('hidden', !busy);
}

// ─── Receipt polling ────────────────────────────────────────
async function waitForReceipt(hash) {
  const POLL_MS = 3000;
  const TIMEOUT_MS = 2 * 60 * 1000;
  const deadline = Date.now() + TIMEOUT_MS;

  while (Date.now() < deadline) {
    for (const client of receiptClients) {
      try {
        const r = await client.getTransactionReceipt({ hash });
        if (r) return r;
      } catch { /* next RPC */ }
    }
    await new Promise(r => setTimeout(r, POLL_MS));
  }
  throw new Error(`Timed out waiting for tx ${hash}`);
}

// ─── Core: Read profile ─────────────────────────────────────
async function loadProfile() {
  if (!connectedAddress) return;

  showView('loading-view');
  badge.textContent = 'Connected';
  badge.className = 'badge badge-connected';

  try {
    const sdk = getReadSdk();
    const profile = await sdk.rpc.profile.getProfileByAddress(connectedAddress);

    if (!profile) {
      noProfileAddress.textContent = connectedAddress;
      showView('no-profile-view');
      return;
    }

    currentProfile = profile;
    isCurrentlyFlagged = !!(profile.customFields && profile.customFields[TEST_FLAG_KEY] === true);

    renderFlagView();
    showView('flag-view');
  } catch (err) {
    console.error('Failed to load profile:', err);
    showToast(`Failed to load profile: ${decodeError(err)}`, 'error');
    showView('no-profile-view');
    noProfileAddress.textContent = connectedAddress;
  }
}

// ─── Render: Flag view ──────────────────────────────────────
function renderFlagView() {
  const name = currentProfile?.name || currentProfile?.registeredName || 'Unknown';
  const initial = name.charAt(0).toUpperCase();

  profileAvatar.textContent = initial;
  profileName.textContent = name;
  profileAddress.textContent = connectedAddress;

  // Status
  if (isCurrentlyFlagged) {
    flagStatus.textContent = '🧪 Flagged';
    flagStatus.className = 'badge badge-flagged';
    flagDescription.textContent =
      'This account is currently flagged as a test account. It will be excluded from growth analytics and group invitations.';
  } else {
    flagStatus.textContent = '✓ Not flagged';
    flagStatus.className = 'badge badge-clear';
    flagDescription.textContent =
      'This account is not flagged as a test account. It is treated as a regular user account.';
  }

  // Action card
  if (isCurrentlyFlagged) {
    actionTitle.textContent = 'Remove Test Account Flag';
    actionDescription.textContent =
      'Remove the test account flag from your profile. Your account will be treated as a regular user account again by all Circles services.';
    actionImplication.innerHTML = `
      <strong>What this means:</strong>
      <ul>
        <li>The test account flag will be removed from your profile</li>
        <li>Your account will be included in growth analytics again</li>
        <li>TMS services may add you to group invitations</li>
      </ul>`;
    btnText.textContent = 'Remove Test Flag';
    flagBtn.classList.add('btn-success');
    flagBtn.classList.remove('btn-danger');
  } else {
    actionTitle.textContent = 'Flag as Test Account';
    actionDescription.textContent =
      'Mark this account as a test account. This signals to the Circles ecosystem that this account is used for testing purposes and should be excluded from growth analytics, group invitations, and other user-facing features.';
    actionImplication.innerHTML = `
      <strong>What this means:</strong>
      <ul>
        <li>Your account will be flagged as a test account in your Circles profile</li>
        <li>TMS services will exclude you from group invitations</li>
        <li>Analytics dashboards will filter your account from growth metrics</li>
        <li>This can be reversed at any time by removing the flag</li>
      </ul>`;
    btnText.textContent = 'Flag as Test Account';
    flagBtn.classList.remove('btn-success');
    flagBtn.classList.remove('btn-danger');
  }

  flagBtn.disabled = false;
  resultBox.classList.add('hidden');
}

// ─── Core: Update profile on-chain ──────────────────────────
async function updateTestFlag(flagValue) {
  if (!connectedAddress || !currentProfile) {
    throw new Error('No connected address or profile');
  }

  const sdk = getReadSdk();

  // 1. Build updated profile data
  const existingFields = currentProfile.customFields || {};
  const updatedCustomFields = { ...existingFields, [TEST_FLAG_KEY]: flagValue };

  const profileData = {
    name: currentProfile.name || currentProfile.registerredName || '',
    description: currentProfile.description || '',
    imageUrl: currentProfile.imageUrl || '',
    customFields: updatedCustomFields,
  };

  console.log('[test-flag] Updated profile data:', profileData);

  // 2. Pin to IPFS via the Circles profiles client
  const profileCid = await sdk.profilesClient.create(profileData);
  console.log('[test-flag] Pinned to IPFS, CID:', profileCid);

  // 3. Convert CID to bytes32 hex digest
  const metadataDigest = cidV0ToHex(profileCid);
  console.log('[test-flag] Metadata digest:', metadataDigest);

  // 4. Build updateMetadata transaction
  const data = encodeFunctionData({
    abi: NAME_REGISTRY_ABI,
    functionName: 'updateMetadata',
    args: [connectedAddress, metadataDigest],
  });

  const tx = {
    to: NAME_REGISTRY_ADDRESS,
    data,
    value: '0x0',
  };

  console.log('[test-flag] Sending transaction:', tx);

  // 5. Send via host bridge
  const hashes = await sendTransactions([tx]);
  console.log('[test-flag] TX hashes:', hashes);

  // 6. Wait for confirmation
  const receipt = await waitForReceipt(hashes[0]);
  console.log('[test-flag] Receipt:', receipt.status);

  if (receipt.status === 'reverted') {
    throw new Error('Transaction reverted on-chain');
  }

  // 7. Wait a moment for indexer to pick up the change, then reload
  showToast('Transaction confirmed! Updating profile…', 'success');
  await new Promise(r => setTimeout(r, 3000));

  // 8. Reload profile from service to get updated state
  const updatedProfile = await sdk.rpc.profile.getProfileByAddress(connectedAddress);
  if (updatedProfile) {
    currentProfile = updatedProfile;
    isCurrentlyFlagged = !!(updatedProfile.customFields && updatedProfile.customFields[TEST_FLAG_KEY] === true);
  } else {
    // Fallback: optimistically update local state
    currentProfile.customFields = updatedCustomFields;
    isCurrentlyFlagged = flagValue;
  }

  return true;
}

// ─── Confirmation modal ─────────────────────────────────────
function showConfirm(action) {
  pendingAction = action;

  if (action === 'flag') {
    confirmTitle.textContent = 'Flag as Test Account';
    confirmMessage.textContent =
      'Are you sure you want to flag this account as a test account? This will update your on-chain Circles profile. You can remove this flag at any time.';
    confirmProceed.textContent = 'Yes, Flag Account';
    confirmProceed.className = 'btn-primary btn-danger';
  } else {
    confirmTitle.textContent = 'Remove Test Flag';
    confirmMessage.textContent =
      'Are you sure you want to remove the test account flag? Your account will be treated as a regular user account again.';
    confirmProceed.textContent = 'Yes, Remove Flag';
    confirmProceed.className = 'btn-primary btn-success';
  }

  confirmModal.classList.remove('hidden');
}

function hideConfirm() {
  confirmModal.classList.add('hidden');
  pendingAction = null;
}

// ─── Event handlers ─────────────────────────────────────────
flagBtn.addEventListener('click', () => {
  if (isBusy) return;
  showConfirm(isCurrentlyFlagged ? 'unflag' : 'flag');
});

confirmCancel.addEventListener('click', hideConfirm);

confirmModal.querySelector('.modal-backdrop').addEventListener('click', hideConfirm);

confirmProceed.addEventListener('click', async () => {
  const action = pendingAction;
  hideConfirm();
  if (!action) return;

  setBusy(true);
  resultBox.classList.add('hidden');

  try {
    const flagValue = action === 'flag';
    await updateTestFlag(flagValue);

    resultIcon.textContent = flagValue ? '🧪' : '✅';
    resultMessage.textContent = flagValue
      ? 'Your account has been flagged as a test account.'
      : 'The test account flag has been removed.';
    resultBox.className = 'result-box';
    resultBox.classList.remove('hidden');

    showToast(flagValue ? 'Account flagged as test account' : 'Test flag removed', 'success');
    renderFlagView();
  } catch (err) {
    console.error('[test-flag] Error:', err);

    resultIcon.textContent = '❌';
    resultMessage.textContent = `Failed: ${decodeError(err)}`;
    resultBox.className = 'result-box result-error';
    resultBox.classList.remove('hidden');

    if (isPasskeyAutoConnectError(err)) {
      showToast('Passkey error. Re-open wallet connect and try again.', 'error');
    } else {
      showToast(`Operation failed: ${decodeError(err)}`, 'error');
    }
  } finally {
    setBusy(false);
  }
});

// ─── Wallet connection ──────────────────────────────────────
onWalletChange(async (address) => {
  if (!address) {
    connectedAddress = null;
    currentProfile = null;
    isCurrentlyFlagged = false;
    badge.textContent = 'Not connected';
    badge.className = 'badge badge-disconnected';
    showView('disconnected-view');
    return;
  }

  connectedAddress = getAddress(address);
  console.log('[test-flag] Connected:', connectedAddress);
  await loadProfile();
});

// ─── Standalone mode warning ────────────────────────────────
if (!isMiniappMode()) {
  console.warn('[test-flag] Not running inside the Circles MiniApp host.');
  document.body.insertAdjacentHTML(
    'afterbegin',
    '<div style="background:#fff9ea;padding:8px 16px;font-size:12px;text-align:center;border-bottom:1px solid #eee7e2">' +
    '⚠️ Standalone mode — wallet operations require the Circles host. ' +
    'Load via <a href="https://circles.gnosis.io/miniapps" target="_blank">circles.gnosis.io/miniapps</a> to test fully.</div>'
  );
}