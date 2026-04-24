/**
 * main.js — CRC Clearing miniapp controller.
 *
 * Orchestrates: wallet connection (via miniapp SDK) → scan → results → execute → success/error
 * Inside the Circles miniapp host: uses postMessage bridge (passkey wallet).
 * Standalone: user can paste an address manually.
 */

import {
  addressToTokenId, findPairwiseClearing, findCycleClearing,
  combineClearingResults, verifyZeroNet, buildFlowMatrix,
  encodeOperateFlowMatrix, formatCRC, formatCRCCompact, truncateAddress, checksumAddress,
} from './clearing.js';

import {
  getProfile, getHoldersOfToken, findCrossHoldings,
  refreshBalancesForEdges, estimateGas, waitForReceipt,
} from './circles-rpc.js';

import {
  onWalletChange, sendTransactions, isMiniappMode,
} from './miniapp-sdk.js';

// ─── Constants ──────────────────────────────────────────────────────────────
const HUB_ADDRESS = '0xc12C1E50ABB450d6205Ea2C3Fa861b3B834d13e8';

// ─── State ──────────────────────────────────────────────────────────────────
let userAddress = '';
let userProfile = null;
let clearingEdges = [];
let clearingMatrix = null;
let profileCache = {};

// ─── Screen Management ──────────────────────────────────────────────────────
const SCREENS = ['connect', 'scanning', 'results', 'confirming', 'executing', 'success', 'error'];

function showScreen(name) {
  for (const s of SCREENS) {
    const el = document.getElementById('screen-' + s);
    if (el) el.classList.toggle('hidden', s !== name);
  }
}

function updateStep(stepNum, state) {
  const steps = document.querySelectorAll('.scan-step');
  steps.forEach(el => {
    const n = parseInt(el.dataset.step);
    const icon = el.querySelector('.step-icon');
    if (n < stepNum) {
      el.className = 'scan-step done';
      icon.textContent = '✓';
    } else if (n === stepNum) {
      el.className = 'scan-step active';
      icon.textContent = '◉';
    } else {
      el.className = 'scan-step';
      icon.textContent = '○';
    }
  });
}

function updateWalletStatus(text, variant) {
  const el = document.getElementById('wallet-status');
  if (!el) return;
  el.textContent = text;
  el.style.background = variant === 'success'
    ? 'rgba(52,211,153,0.12)' : variant === 'warn'
    ? 'rgba(212,168,67,0.12)' : '';
  el.style.color = variant === 'success'
    ? 'var(--success)' : variant === 'warn'
    ? 'var(--accent)' : '';
}

// ─── Profile Helper ─────────────────────────────────────────────────────────
async function getCachedProfile(address) {
  const key = address.toLowerCase();
  if (!profileCache[key]) {
    profileCache[key] = await getProfile(address);
  }
  return profileCache[key];
}

function setAvatar(el, profile, address) {
  if (profile?.avatarUrl) {
    el.style.backgroundImage = 'url(' + profile.avatarUrl + ')';
  } else {
    // No avatar URL — show initial letter
    el.textContent = (profile?.name?.[0] || address?.[2] || '?').toUpperCase();
    el.style.backgroundImage = '';
    el.style.backgroundColor = 'var(--bg-3)';
    el.style.color = 'var(--text-2)';
    el.style.fontWeight = '700';
    el.style.display = 'flex';
    el.style.alignItems = 'center';
    el.style.justifyContent = 'center';
  }
}

// ─── Main Flow ──────────────────────────────────────────────────────────────
window.handleCheck = async function () {
  // Always read from the input field
  const input = document.getElementById('address-input')?.value?.trim() || '';
  if (/^0x[a-fA-F0-9]{40}$/.test(input)) {
    userAddress = input;
  }

  if (!userAddress || !/^0x[a-fA-F0-9]{40}$/.test(userAddress)) {
    alert('Please enter a valid address (0x...).');
    return;
  }

  updateWalletStatus(truncateAddress(checksumAddress(userAddress)), 'success');
  showScreen('scanning');

  try {
    await runScan();
  } catch (err) {
    console.error('Scan failed:', err);
    document.getElementById('error-message').textContent = err.message || 'Scan failed.';
    showScreen('error');
  }
};

async function runScan() {
  // Step 1: Resolve profile
  updateStep(1, 'active');
  userProfile = await getCachedProfile(userAddress);

  // Step 2: Find holders
  updateStep(2, 'active');
  const holders = await getHoldersOfToken(userAddress);
  updateStep(1, 'done');

  if (holders.length === 0) {
    updateStep(2, 'done');
    updateStep(3, 'done');
    updateStep(4, 'done');
    showResultsEmpty();
    return;
  }

  // Step 3: Check cross-holdings
  updateStep(3, 'active');
  updateStep(2, 'done');
  const crossHoldings = await findCrossHoldings(userAddress, holders);

  if (crossHoldings.length === 0) {
    updateStep(3, 'done');
    updateStep(4, 'done');
    showResultsNoClearing(holders);
    return;
  }

  // Step 4: Compute clearing
  updateStep(4, 'active');
  updateStep(3, 'done');

  // Build holdings for clearing algorithms
  const holdings = crossHoldings.map(ch => [
    { tokenOwner: userAddress.toLowerCase(), holder: ch.holderAddress.toLowerCase(), amount: ch.theyHoldOfUser },
    { tokenOwner: ch.holderAddress.toLowerCase(), holder: userAddress.toLowerCase(), amount: ch.userHoldsOfTheirs },
  ]).flat();

  const pairwise = findPairwiseClearing(holdings);
  const cycles = findCycleClearing(holdings);
  clearingEdges = combineClearingResults(pairwise, cycles);

  updateStep(4, 'done');

  if (clearingEdges.length === 0) {
    showResultsNoClearing(holders);
    return;
  }

  clearingMatrix = buildFlowMatrix(clearingEdges);
  showResults(crossHoldings);
}

// ─── Results Rendering ──────────────────────────────────────────────────────
function showResults(crossHoldings) {
  // Profile header
  const nameEl = document.getElementById('user-name');
  const addrEl = document.getElementById('user-address');
  const avatarEl = document.getElementById('user-avatar');

  nameEl.textContent = userProfile?.name || 'Unknown';
  addrEl.textContent = truncateAddress(checksumAddress(userAddress));
  setAvatar(avatarEl, userProfile, userAddress);

  // Summary: show what's held by others (potential) vs what's clearable
  const totalHeldByOthers = crossHoldings.reduce((s, ch) => s + ch.theyHoldOfUser, 0n);
  const totalRecovered = clearingEdges
    .filter(e => e.to.toLowerCase() === userAddress.toLowerCase())
    .reduce((s, e) => s + e.amount, 0n);

  const summaryEl = document.getElementById('summary-content');
  summaryEl.innerHTML =
    '<div class="summary-total">' + formatCRC(totalRecovered) + '</div>' +
    '<div class="summary-label">clearable back to your wallet</div>' +
    '<div class="summary-detail" style="margin-top:8px">' +
      '<span style="color:var(--text-2)">' + formatCRC(totalHeldByOthers) + ' of your CRC held by others</span>' +
      '<br><span style="color:var(--text-2)">' + crossHoldings.length + ' reciprocal holding' + (crossHoldings.length !== 1 ? 's' : '') + ' found</span>' +
      (totalRecovered < totalHeldByOthers ? '<br><span style="color:var(--accent);font-size:0.85rem">⚠ Clearable amount is limited by how much of their CRC you hold in return</span>' : '') +
    '</div>';

  // Partner rows
  const listEl = document.getElementById('partners-list');
  listEl.innerHTML = '<div class="section-label">Reciprocal Holdings</div>';

  for (const ch of crossHoldings) {
    const profile = profileCache[ch.holderAddress.toLowerCase()];
    const row = document.createElement('div');
    row.className = 'partner-row';

    const clearAmount = clearingEdges.find(e =>
      e.tokenOwner.toLowerCase() === ch.holderAddress.toLowerCase() &&
      e.to.toLowerCase() === userAddress.toLowerCase()
    )?.amount || 0n;

    const displayAddr = checksumAddress(ch.holderAddress);

    row.innerHTML =
      '<div class="avatar-sm" style="' + avatarBgStyle(profile, ch.holderAddress) + '"></div>' +
      '<div class="partner-info">' +
        '<div class="partner-name">' + (profile?.name || truncateAddress(displayAddr)) + '</div>' +
        '<div class="partner-addr">' + truncateAddress(displayAddr) + '</div>' +
      '</div>' +
      '<div class="partner-amount">' +
        '<div class="amt" style="color:var(--text-2)">they hold: ' + formatCRC(ch.theyHoldOfUser) + '</div>' +
        '<div class="amt" style="color:var(--text-2)">you hold: ' + formatCRC(ch.userHoldsOfTheirs) + '</div>' +
        '<div class="amt-return">↩ clear ' + formatCRCCompact(clearAmount) + '</div>' +
      '</div>';

    listEl.appendChild(row);
  }

  document.getElementById('btn-clear-all').classList.remove('hidden');
  showScreen('results');
}

function showResultsEmpty() {
  document.getElementById('summary-content').innerHTML =
    '<div class="summary-total" style="font-size:1.25rem;color:var(--text-2)">No one holds your CRC</div>' +
    '<div class="summary-label">There are no non-personal balances of your token. Nothing to clear!</div>';
  document.getElementById('btn-clear-all').classList.add('hidden');
  showScreen('results');
}

function showResultsNoClearing(holders) {
  document.getElementById('summary-content').innerHTML =
    '<div class="summary-total" style="font-size:1.25rem;color:var(--text-2)">No reciprocal holdings found</div>' +
    '<div class="summary-label">' + holders.length + ' address' + (holders.length !== 1 ? 'es' : '') + ' hold your CRC, but you don\'t hold theirs. Clearing requires mutual holdings.</div>';
  document.getElementById('btn-clear-all').classList.add('hidden');
  showScreen('results');
}

function avatarBgStyle(profile, address) {
  if (profile?.avatarUrl) return 'background-image:url(' + profile.avatarUrl + ')';
  // Fallback: coloured circle with initial letter
  return 'background-color:var(--bg-3);color:var(--text-2);font-weight:700;display:flex;align-items:center;justify-content:center;font-size:0.8rem';
}

// ─── Execute Clearing ───────────────────────────────────────────────────────
window.executeClearing = async function () {
  showScreen('confirming');

  try {
    // Re-query balances to ensure freshness
    const freshEdges = await refreshBalancesForEdges(clearingEdges);
    if (!freshEdges) {
      throw new Error('Balances have changed since scanning. Please re-scan.');
    }
    clearingEdges = freshEdges;

    // Rebuild matrix with fresh amounts
    clearingMatrix = buildFlowMatrix(clearingEdges);

    // Encode calldata
    const calldata = encodeOperateFlowMatrix(clearingMatrix);

    // Estimate gas (informational — host handles actual gas)
    try {
      await estimateGas(userAddress, HUB_ADDRESS, calldata);
    } catch (gasErr) {
      throw new Error('Gas estimation failed — balances may have changed. ' + gasErr.message);
    }

    // Send transaction through miniapp host SDK
    showScreen('executing');
    const hashes = await sendTransactions([{
      to: HUB_ADDRESS,
      data: calldata,
      value: '0',
    }]);

    const txHash = hashes?.[0];
    if (!txHash) throw new Error('Transaction rejected or no hash returned.');

    // Wait for receipt
    const receipt = await waitForReceipt(txHash);

    if (receipt.status === 'success') {
      const linkEl = document.getElementById('tx-link');
      linkEl.href = 'https://gnosisscan.io/tx/' + txHash;
      showScreen('success');
    } else {
      throw new Error('Transaction reverted on-chain. Gas used: ' + receipt.gasUsed);
    }
  } catch (err) {
    console.error('Execution failed:', err);
    document.getElementById('error-message').textContent = err.message || 'Unknown error';
    showScreen('error');
  }
};

// ─── Reset ──────────────────────────────────────────────────────────────────
window.reset = function () {
  userAddress = '';
  userProfile = null;
  clearingEdges = [];
  clearingMatrix = null;
  profileCache = {};
  document.getElementById('address-input').value = '';
  document.getElementById('btn-clear-all').classList.add('hidden');
  document.getElementById('partners-list').innerHTML = '';
  updateWalletStatus('Not connected', '');
  showScreen('connect');
};

// ─── Init ───────────────────────────────────────────────────────────────────
onWalletChange((address) => {
  if (address) {
    userAddress = address;
    document.getElementById('address-input').value = address;
    updateWalletStatus('Wallet: ' + truncateAddress(checksumAddress(address)), 'success');
    document.getElementById('field-hint').textContent = 'Your wallet address — click Scan or change it';
    // Don't auto-scan; user may want to check a different address
  } else if (isMiniappMode()) {
    // Inside host but not connected — show connect prompt
    updateWalletStatus('Waiting for wallet...', 'warn');
  } else {
    // Standalone mode — show paste input
    updateWalletStatus('Paste an address below', '');
  }
});