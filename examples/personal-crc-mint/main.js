import { onWalletChange, sendTransactions, isMiniappMode } from '@aboutcircles/miniapp-sdk';
import {
  createPublicClient,
  http,
  encodeFunctionData,
  parseAbiItem,
  formatUnits,
} from 'viem';
import { gnosis } from 'viem/chains';
import { Sdk } from '@aboutcircles/sdk';

// --- Constants -------------------------------------------------------------

const HUB_V2 = '0xc12C1E50ABB450d6205Ea2C3Fa861b3B834d13e8';
const ENTRYPOINT = '0x0000000071727de22e5e9d8baf0edac6f37da032';

const RPC_FALLBACK_URLS = [
  'https://rpc.aboutcircles.com/',
  'https://rpc.gnosischain.com',
  'https://1rpc.io/gnosis',
];

const POLL_MS = 3000;
const TIMEOUT_MS = 12 * 60 * 1000;
const LOOKBACK = 5000n;
const REFRESH_MS = 60 * 1000;

const HUB_ABI = [
  { type: 'function', name: 'personalMint', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  {
    type: 'function',
    name: 'calculateIssuance',
    stateMutability: 'view',
    inputs: [{ name: '_human', type: 'address' }],
    outputs: [
      { name: 'issuance', type: 'uint256' },
      { name: 'startPeriod', type: 'uint256' },
      { name: 'endPeriod', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'isHuman',
    stateMutability: 'view',
    inputs: [{ name: '_human', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'stopped',
    stateMutability: 'view',
    inputs: [{ name: '_human', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'id', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
];

// --- Lazy clients ----------------------------------------------------------

const receiptClients = RPC_FALLBACK_URLS.map((url) =>
  createPublicClient({ chain: gnosis, transport: http(url) })
);

const publicClient = receiptClients[0];

let _sdk = null;
function getSdk() {
  if (!_sdk) _sdk = new Sdk(RPC_FALLBACK_URLS[0], null);
  return _sdk;
}

// --- DOM helpers -----------------------------------------------------------

const $ = (id) => document.getElementById(id);

function showView(connected) {
  $('disconnected-view').classList.toggle('hidden', connected);
  $('connected-view').classList.toggle('hidden', !connected);
}

let toastTimer = null;
function showToast(message, kind = '') {
  const el = $('toast');
  el.textContent = message;
  el.className = `toast show ${kind}`.trim();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.className = 'toast';
  }, 4000);
}

function setResult(kind, html) {
  const el = $('result');
  if (!kind) {
    el.className = 'result';
    el.innerHTML = '';
    return;
  }
  el.className = `result show ${kind}`;
  el.innerHTML = html;
}

function normalizeError(err) {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (err.code === 4001 || /reject/i.test(err.message || '')) return 'Transaction rejected.';
  return err.shortMessage || err.message || String(err);
}

function formatCrc(atto) {
  const s = formatUnits(atto, 18);
  const [whole, frac = ''] = s.split('.');
  const trimmed = frac.slice(0, 4).replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : whole;
}

// --- State ----------------------------------------------------------------

let connectedAddress = null;
let reqId = 0;
let refreshTimer = null;

async function runLatest(task) {
  const id = ++reqId;
  const result = await task();
  return id === reqId ? result : null;
}

// --- Reads ----------------------------------------------------------------

async function loadProfileName(address) {
  try {
    const profile = await getSdk().rpc.profile.getProfileByAddress(address);
    return profile?.name || profile?.registeredName || null;
  } catch {
    return null;
  }
}

async function loadState(address) {
  const isHuman = await publicClient
    .readContract({ address: HUB_V2, abi: HUB_ABI, functionName: 'isHuman', args: [address] })
    .catch(() => false);

  if (!isHuman) {
    return { isHuman: false };
  }

  const [stopped, balance, issuanceResult] = await Promise.all([
    publicClient
      .readContract({ address: HUB_V2, abi: HUB_ABI, functionName: 'stopped', args: [address] })
      .catch(() => false),
    publicClient
      .readContract({
        address: HUB_V2,
        abi: HUB_ABI,
        functionName: 'balanceOf',
        args: [address, BigInt(address)],
      })
      .catch(() => 0n),
    publicClient
      .readContract({
        address: HUB_V2,
        abi: HUB_ABI,
        functionName: 'calculateIssuance',
        args: [address],
      })
      .catch(() => [0n, 0n, 0n]),
  ]);

  return {
    isHuman: true,
    stopped,
    balance,
    mintable: issuanceResult[0],
    endPeriod: issuanceResult[2],
  };
}

async function refresh() {
  if (!connectedAddress) return;
  const address = connectedAddress;

  const [name, state] = await Promise.all([
    loadProfileName(address),
    loadState(address),
  ]);

  if (address !== connectedAddress) return; // stale

  $('profile-name').textContent = name || 'Unnamed avatar';
  $('account-address').textContent = address;

  if (!state.isHuman) {
    $('not-human').classList.remove('hidden');
    $('balance').textContent = '—';
    $('mintable-amount').innerHTML = '0<span class="unit">CRC</span>';
    $('mint-meta').textContent = '';
    $('mint-btn').disabled = true;
    $('refresh-btn').disabled = false;
    return;
  }

  $('not-human').classList.add('hidden');
  $('balance').textContent = `${formatCrc(state.balance)} CRC`;
  $('mintable-amount').innerHTML =
    `${formatCrc(state.mintable)}<span class="unit">CRC</span>`;
  $('refresh-btn').disabled = false;

  if (state.stopped) {
    $('mint-meta').textContent = 'Personal minting has been permanently stopped for this avatar.';
    $('mint-btn').disabled = true;
    return;
  }

  if (state.mintable > 0n) {
    $('mint-meta').textContent = 'Personal Circles accrue at 1 CRC per hour.';
    $('mint-btn').disabled = false;
  } else {
    $('mint-meta').textContent = 'Nothing to mint yet — check back later.';
    $('mint-btn').disabled = true;
  }
}

// --- Receipt polling (UserOp-aware) ---------------------------------------

async function waitForReceipts(hashes) {
  return Promise.all(hashes.map(waitForReceiptFromAnyRpc));
}

async function waitForReceiptFromAnyRpc(hash) {
  const deadline = Date.now() + TIMEOUT_MS;
  let round = 0;
  while (Date.now() < deadline) {
    round++;
    for (const client of receiptClients) {
      try {
        const r = await client.getTransactionReceipt({ hash });
        if (r) return r;
      } catch {}
    }
    if (round % 2 === 0) {
      for (const client of receiptClients) {
        const r = await tryResolveUserOp(client, hash);
        if (r) return r;
      }
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error(`Timed out waiting for ${hash}`);
}

async function tryResolveUserOp(client, userOpHash) {
  try {
    const latest = await client.getBlockNumber();
    const fromBlock = latest > LOOKBACK ? latest - LOOKBACK : 0n;
    const logs = await client.getLogs({
      address: ENTRYPOINT,
      event: parseAbiItem(
        'event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)'
      ),
      args: { userOpHash },
      fromBlock,
      toBlock: latest,
    });
    if (logs.length > 0) {
      return await client.getTransactionReceipt({ hash: logs.at(-1).transactionHash });
    }
  } catch {}
  return null;
}

// --- Mint -----------------------------------------------------------------

async function mint() {
  if (!connectedAddress) return;

  $('mint-btn').disabled = true;
  $('refresh-btn').disabled = true;
  setResult('pending', 'Requesting approval from the wallet…');

  try {
    const data = encodeFunctionData({
      abi: HUB_ABI,
      functionName: 'personalMint',
      args: [],
    });

    const hashes = await sendTransactions([{ to: HUB_V2, data, value: '0x0' }]);
    setResult('pending', 'Transaction submitted. Waiting for confirmation…');

    const receipts = await waitForReceipts(hashes);
    const failed = receipts.find((r) => r.status !== 'success');
    if (failed) {
      throw new Error('The mint transaction reverted on-chain.');
    }

    const links = hashes
      .map(
        (h) =>
          `<a href="https://gnosisscan.io/tx/${h}" target="_blank" rel="noopener">${h.slice(0, 10)}…${h.slice(-8)}</a>`
      )
      .join('<br>');
    setResult('success', `Minted! Personal CRC claimed.<br>${links}`);
    showToast('Personal CRC minted', 'success');

    await refresh();
  } catch (err) {
    const msg = normalizeError(err);
    setResult('error', `Failed: ${msg}`);
    showToast(msg, 'error');
    $('mint-btn').disabled = false;
  } finally {
    $('refresh-btn').disabled = false;
  }
}

// --- Wallet lifecycle -----------------------------------------------------

function startAutoRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    if (connectedAddress) runLatest(refresh);
  }, REFRESH_MS);
}

onWalletChange(async (address) => {
  if (!address) {
    connectedAddress = null;
    clearInterval(refreshTimer);
    $('wallet-status').textContent = 'Not connected';
    $('wallet-status').className = 'wallet-status';
    showView(false);
    return;
  }

  connectedAddress = address;
  $('wallet-status').textContent = `${address.slice(0, 6)}…${address.slice(-4)}`;
  $('wallet-status').className = 'wallet-status connected';
  showView(true);
  setResult(null);
  $('mint-btn').disabled = true;
  $('refresh-btn').disabled = true;

  await runLatest(refresh);
  startAutoRefresh();
});

$('mint-btn').addEventListener('click', mint);
$('refresh-btn').addEventListener('click', () => {
  $('refresh-btn').disabled = true;
  runLatest(refresh);
});

// --- Standalone notice ----------------------------------------------------

if (!isMiniappMode()) {
  document.body.insertAdjacentHTML(
    'afterbegin',
    '<div class="standalone-banner">⚠ Running in standalone mode — wallet operations will not work. ' +
      'Load via the Circles wallet to mint.</div>'
  );
}
