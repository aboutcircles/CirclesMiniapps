import { onWalletChange, signMessage, sendTransactions } from '@aboutcircles/miniapp-sdk';
import { Distributions, Referrals, InviteFarm } from '@aboutcircles/sdk-invitations';
import { CirclesRpc, PagedQuery } from '@aboutcircles/sdk-rpc';
import { privateKeyToAccount } from 'viem/accounts';
import { encodeFunctionData, keccak256, encodePacked, createPublicClient, http, getAddress, isAddress, zeroAddress, type Hex, type Address } from 'viem';
import { gnosis } from 'viem/chains';
import { getSafeSingletonDeployment } from '@safe-global/safe-deployments';

import {
  RPC_URL,
  GNOSIS_PUBLIC_RPC,
  SAFE_VERSION,
  SAFE_TX_SERVICE_URL,
  AUTH_BASE,
  REFERRALS_BASE,
  SESSION_BASE,
  REFERRALS_MODULE,
  HUB_V2_ADDRESS,
  HUB_V1_ADDRESS,
  NAME_REGISTRY_ADDRESS,
  ERC20_LIFT_ADDRESS,
  BASE_GROUP_FACTORY_ADDRESS,
  BASE_GROUP_MINT_POLICY,
  STANDARD_TREASURY,
  INVITATION_FARM,
  INVITATION_MODULE,
  PATHFINDER_URL,
  PROFILE_SERVICE_URL,
  MAX_UINT96,
} from '../../shared/config';
import {
  escapeHtml,
  escapeAttr,
  shortAddr,
  keyPreview,
  formatExpiry,
  parsePrivateKeys,
  decodeError,
  normalizeAddressList,
} from '../../shared/format';
import { wrapTxsForSafe, fetchOwnerSafeCandidates, getVerifiedOwnerSafes } from '../../shared/safe';
import type {
  Session,
  SessionStats,
  KeyEntry,
  Referral,
  GroupEntry,
  SessionGroupRecord,
  Challenge,
  ResultType,
} from '../../shared/types';

/**
 * Available = queued + dispatchedExpired (can still be claimed/redispatched)
 * In use    = dispatchedInFlight (committed but not yet claimed)
 * Claimed   = claimed
 * Total     = Available + In use + Claimed
 */
function computeAvailableUsed(data: SessionStats): {
  available: number | null;
  inUse: number | null;
  claimed: number | null;
  total: number | null;
} {
  const queued     = typeof data.queued             === 'number' ? data.queued             : null;
  const inFlight   = typeof data.dispatchedInFlight === 'number' ? data.dispatchedInFlight : null;
  const expired    = typeof data.dispatchedExpired  === 'number' ? data.dispatchedExpired  : null;
  const claimed    = typeof data.claimed            === 'number' ? data.claimed            : null;

  const available = queued != null && expired != null ? queued + expired : null;
  const inUse     = inFlight;
  const total     = available != null && inUse != null && claimed != null ? available + inUse + claimed : null;
  return { available, inUse, claimed, total };
}

// ── Safe singleton ──────────────────────────────────────────────────────────
// (Constants now imported from ../../shared/config and ../../shared/safe.)

const safeSingletonDeployment = getSafeSingletonDeployment({
  network: String(gnosis.id),
  version: SAFE_VERSION,
});

// ── State ─────────────────────────────────────────────────────────────────────

let connectedAddress: string | null = null;
let authToken:        string | null = null;
let currentSession:   Session | null = null;
let keysOffset        = 0;
const KEYS_PAGE       = 50;
let selectedExpiry    = 0;  // days; 0 = no expiry

// My Invites pagination
let myInvitesOffset  = 0;
const MY_INVITES_PAGE = 50;
let myInvitesClaimed: Referral[] = [];

let currentSessions:  Session[] = [];
let assignTargetKeys: Array<{ id: string }> = [];
const myInvitesKeyMap = new Map<string, string>();  // referral id → privateKey
const selectedRefIds  = new Set<string>();

// ── SDK clients ───────────────────────────────────────────────────────────────

const getToken = (): Promise<string> => Promise.resolve(authToken ?? '');
const distributions = new Distributions(REFERRALS_BASE, getToken);
// SDK 0.1.52: Referrals constructor takes (baseUrl, referralsModuleAddress, rpcUrl, getToken?).
const referrals     = new Referrals(REFERRALS_BASE, REFERRALS_MODULE, RPC_URL, getToken);
const rpc           = new CirclesRpc('https://rpc.aboutcircles.com');

// ── BaseGroup trustBatchWithConditions ABI (minimal) ─────────────────────────

const BASE_GROUP_ABI = [{
  type: 'function',
  name: 'trustBatchWithConditions',
  inputs: [
    { name: '_members', type: 'address[]' },
    { name: '_expiry',  type: 'uint96'    },
  ],
  outputs: [],
  stateMutability: 'nonpayable',
}] as const;

// ── Invitation contracts ──────────────────────────────────────────────────────
// (Addresses now imported from ../../shared/config.)

const INVITATION_FARM_ABI = [{
  type: 'function',
  name: 'inviterQuota',
  inputs: [{ name: '', type: 'address' }],
  outputs: [{ name: '', type: 'uint256' }],
  stateMutability: 'view',
}] as const;

const publicClient = createPublicClient({ chain: gnosis, transport: http(GNOSIS_PUBLIC_RPC) });

const inviteFarm = new InviteFarm({
  circlesRpcUrl:            'https://rpc.aboutcircles.com',
  pathfinderUrl:            PATHFINDER_URL,
  profileServiceUrl:        PROFILE_SERVICE_URL,
  referralsServiceUrl:      REFERRALS_BASE,
  v1HubAddress:             HUB_V1_ADDRESS,
  v2HubAddress:             HUB_V2_ADDRESS,
  nameRegistryAddress:      NAME_REGISTRY_ADDRESS,
  baseGroupMintPolicy:      BASE_GROUP_MINT_POLICY,
  standardTreasury:         STANDARD_TREASURY,
  coreMembersGroupDeployer: BASE_GROUP_FACTORY_ADDRESS,
  baseGroupFactoryAddress:  BASE_GROUP_FACTORY_ADDRESS,
  liftERC20Address:         ERC20_LIFT_ADDRESS,
  invitationFarmAddress:    INVITATION_FARM,
  referralsModuleAddress:   REFERRALS_MODULE,
  invitationModuleAddress:  INVITATION_MODULE,
});

export function boot(): void {
  // ── Helpers ───────────────────────────────────────────────────────────────────

  function show(id: string): void {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(id)!.classList.add('active');
  }

  function showResult(el: HTMLElement, type: ResultType, html: string): void {
    el.className = `result ${type} show`;
    el.innerHTML = html;
  }

  function clearResult(el: HTMLElement): void {
    el.className = 'result';
    el.innerHTML = '';
  }

  // shortAddr, keyPreview, formatExpiry, escapeHtml, escapeAttr, parsePrivateKeys
  // and normalizeAddressList are imported from ../../shared/format.

  async function refreshSessions(): Promise<void> {
    const data = await distributions.listSessions(connectedAddress!, { limit: 100 }) as { sessions?: Session[] };
    currentSessions = data.sessions || [];
  }

  // ── Session params (localStorage) ────────────────────────────────────────────

  const PARAMS_KEY = 'circles-session-params';  // { [sessionId]: "key=val&..." }

  function getSessionParams(sessionId: string): string {
    try {
      const all = JSON.parse(localStorage.getItem(PARAMS_KEY) || '{}') as Record<string, string>;
      return all[sessionId] || '';
    } catch { return ''; }
  }

  function setSessionParams(sessionId: string, params: string): void {
    try {
      const all = JSON.parse(localStorage.getItem(PARAMS_KEY) || '{}') as Record<string, string>;
      if (params) all[sessionId] = params;
      else delete all[sessionId];
      localStorage.setItem(PARAMS_KEY, JSON.stringify(all));
    } catch { /* ignore */ }
  }

  function buildSessionLink(sessionId: string, slug: string): string {
    const params = getSessionParams(sessionId);
    const base   = `${SESSION_BASE}/${slug}`;
    return params ? `${base}?${params}` : base;
  }

  function copySessionLink(sessionId: string, slug: string, btn: HTMLButtonElement): void {
    const link = buildSessionLink(sessionId, slug);
    const resetBtn = () => {
      btn.classList.remove('copied');
      btn.innerHTML = '🔗 Copy Link';
    };
    const markCopied = () => {
      btn.classList.add('copied');
      btn.innerHTML = '✓ Copied';
      setTimeout(resetBtn, 2000);
    };

    navigator.clipboard.writeText(link).then(markCopied).catch(() => {
      // Fallback for older browsers
      const ta = document.createElement('textarea');
      ta.value = link;
      ta.style.position = 'fixed';
      ta.style.opacity  = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      markCopied();
    });
  }

  // ── Safe owner helpers ────────────────────────────────────────────────────────

  const sessionOwnerSafesByUser = new Map<string, string[]>();

  function getSessionOwnerSafes(ownerAddress: string): string[] {
    return sessionOwnerSafesByUser.get(ownerAddress.toLowerCase()) ?? [];
  }

  function setSessionOwnerSafes(ownerAddress: string, safeAddresses: string[]): void {
    sessionOwnerSafesByUser.set(ownerAddress.toLowerCase(), safeAddresses);
  }

  // fetchOwnerSafeCandidates, getVerifiedOwnerSafes, buildPrevalidatedSignature
  // and wrapTxsForSafe are imported from ../../shared/safe.

  const safeAbi = safeSingletonDeployment?.abi;

  /**
   * Send group transactions, automatically routing through a Safe when the
   * group is owned by a Safe that the connected user is a signer on.
   *
   * @param ownerSafe  - the Safe that owns the group (undefined = direct ownership)
   * @param txs        - raw transactions targeting the group contract
   */
  async function sendGroupTxs(
    ownerSafe: string | undefined,
    txs: Array<{ to: string; data: string; value: string }>,
  ): Promise<void> {
    if (!txs.length) return;
    const finalTxs = ownerSafe
      ? wrapTxsForSafe(safeAbi, connectedAddress!, ownerSafe, txs)
      : txs;
    await sendTransactions(finalTxs);
  }

  // ── Group trust ───────────────────────────────────────────────────────────────

  async function fetchGroupsByOwners(ownerAddresses: string[]): Promise<GroupEntry[]> {
    if (!ownerAddresses.length) return [];
    // getGroups queries the V_CrcV2 Groups view directly — the server-side
    // circles_findGroups method returns an empty set for ownerIn filters.
    const query = rpc.group.getGroups(200, { ownerIn: normalizeAddressList(ownerAddresses) });
    await query.queryNextPage();
    return (query.currentPage?.results ?? []) as unknown as GroupEntry[];
  }

  async function fetchControlledGroups(address: string): Promise<GroupEntry[]> {
    const lower = address.toLowerCase();

    // 1. Direct ownership
    const byOwner = await fetchGroupsByOwners([address]);

    // 2. Service role (direct)
    const serviceQuery = new PagedQuery(rpc.client, {
      namespace: 'V_CrcV2',
      table: 'Groups',
      sortOrder: 'DESC',
      columns: ['blockNumber','timestamp','transactionIndex','logIndex','transactionHash',
                'group','type','owner','service','name','symbol'],
      filter: [{
        Type: 'FilterPredicate',
        FilterType: 'Equals',
        Column: 'service',
        Value: lower,
      }],
      limit: 200,
    });

    const byService: GroupEntry[] = [];
    while (await serviceQuery.queryNextPage()) {
      const rows = (serviceQuery.currentPage?.results ?? []) as GroupEntry[];
      if (!rows.length) break;
      byService.push(...rows);
    }

    // 3. Inherited ownership via Safe multisigs where user is a signer
    const cachedSafes  = getSessionOwnerSafes(address);
    const serviceSafes = await fetchOwnerSafeCandidates(SAFE_TX_SERVICE_URL, address);
    const allSafes     = normalizeAddressList([...serviceSafes, ...cachedSafes]);

    let safeGroups: GroupEntry[] = [];
    let verifiedSafes: string[]  = [];
    if (allSafes.length) {
      verifiedSafes = await getVerifiedOwnerSafes(publicClient as any, safeAbi, allSafes, address);
      setSessionOwnerSafes(address, verifiedSafes);
      if (verifiedSafes.length) {
        const rawSafeGroups = await fetchGroupsByOwners(verifiedSafes);
        // Tag each group with the Safe that owns it so we can route txs correctly
        safeGroups = rawSafeGroups.map(g => ({
          ...g,
          _role: 'owner' as const,
          _ownerSafe: verifiedSafes.find(s => s.toLowerCase() === (g.owner || '').toLowerCase()),
        }));
      }
    }

    // Merge: direct first, then service, then safe-backed (de-duplicate by group address)
    const seen = new Set<string>();
    const all: GroupEntry[] = [];
    for (const g of [...(byOwner as GroupEntry[]), ...byService]) {
      const addr = (g.group || '').toLowerCase();
      if (!seen.has(addr)) {
        seen.add(addr);
        const isOwner   = (g.owner   || '').toLowerCase() === lower;
        const isService = (g.service || '').toLowerCase() === lower;
        all.push({ ...g, _role: isOwner ? 'owner' : isService ? 'service' : 'owner' });
      }
    }
    for (const g of safeGroups) {
      const addr = (g.group || '').toLowerCase();
      if (!seen.has(addr)) {
        seen.add(addr);
        all.push(g);
      }
    }
    return all;
  }

  // ── Address derivation ────────────────────────────────────────────────────────

  const SAFE_PROXY_FACTORY         = '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67' as Address;
  const ACCOUNT_CREATION_CODE_HASH = '0xe298282cefe913ab5d282047161268a8222e4bd4ed106300c547894bbefd31ee' as Hex;
  const ACCOUNT_INITIALIZER_HASH   = '0x89867a67674bd4bf33165a653cde826b696ab7d050166b71066dfa0b9b6f90f4' as Hex;

  function deriveAccountAddress(privateKey: string): string {
    const signer = privateKeyToAccount(privateKey as Hex).address;

    const salt = keccak256(
      encodePacked(['bytes32', 'uint256'], [ACCOUNT_INITIALIZER_HASH, BigInt(signer)])
    );

    const create2Hash = keccak256(
      encodePacked(
        ['bytes1', 'address', 'bytes32', 'bytes32'],
        ['0xff', SAFE_PROXY_FACTORY, salt, ACCOUNT_CREATION_CODE_HASH]
      )
    );

    return ('0x' + create2Hash.slice(-40));
  }

  async function fetchGroupMembers(groupAddress: string): Promise<Set<string>> {
    // SDK 0.1.52: getGroupMembers is async cursor-based and returns
    // PagedResponse { results, hasMore, nextCursor }.
    const addrs = new Set<string>();
    let cursor: string | null = null;
    do {
      const page = await rpc.group.getGroupMembers(groupAddress as Address, 1000, cursor);
      const rows = (page?.results ?? []) as Array<{ member?: string }>;
      for (const r of rows) addrs.add((r.member || '').toLowerCase());
      cursor = page?.nextCursor ?? null;
      if (!page?.hasMore) break;
    } while (cursor);
    return addrs;
  }

  /**
   * Detect which controlled group a session's keys belong to, independent of localStorage.
   * Samples up to 3 unclaimed/dispatched keys, derives their account addresses,
   * then checks each controlled group for membership of all sampled addresses.
   * Returns the first matching GroupEntry, or null if none found.
   */
  async function detectSessionGroup(sessionId: string): Promise<GroupEntry | null> {
    // Ensure controlled groups are loaded
    if (!controlledGroups.length) {
      if (!connectedAddress) return null;
      try {
        controlledGroups = await fetchControlledGroups(connectedAddress);
      } catch { return null; }
    }
    if (!controlledGroups.length) return null;

    // Sample up to 3 queued/dispatched keys that have an accountAddress from the API
    const allKeys = await loadAllSessionKeys(sessionId).catch(() => [] as KeyEntry[]);
    const addresses = allKeys
      .filter(k => k.accountAddress && (k.status === 'queued' || k.status === 'dispatched'))
      .slice(0, 3)
      .map(k => k.accountAddress!);

    if (!addresses.length) return null;

    // Find first controlled group where all sampled addresses are members
    for (const group of controlledGroups) {
      try {
        const members = await fetchGroupMembers(group.group);
        if (addresses.every(a => members.has(a.toLowerCase()))) {
          return group;
        }
      } catch { /* skip this group */ }
    }

    return null;
  }

  // ── Session group assignment (localStorage) ───────────────────────────────────

  const SESSION_GROUP_KEY = 'circles-session-group';

  function getSessionGroup(sessionId: string): SessionGroupRecord | null {
    try {
      const all = JSON.parse(localStorage.getItem(SESSION_GROUP_KEY) || '{}') as Record<string, SessionGroupRecord>;
      return all[sessionId] || null;
    } catch { return null; }
  }

  function setSessionGroup(sessionId: string, groupEntry: SessionGroupRecord | null): void {
    try {
      const all = JSON.parse(localStorage.getItem(SESSION_GROUP_KEY) || '{}') as Record<string, SessionGroupRecord>;
      if (groupEntry) all[sessionId] = groupEntry;
      else delete all[sessionId];
      localStorage.setItem(SESSION_GROUP_KEY, JSON.stringify(all));
    } catch { /* ignore */ }
  }

  // ── Group assignment UI ───────────────────────────────────────────────────────

  let controlledGroups: GroupEntry[] = [];

  function renderGroupAssignRow(sessionId: string): void {
    const assigned = getSessionGroup(sessionId);
    const valueEl  = document.getElementById('groupAssignValue')!;
    if (assigned) {
      valueEl.textContent = assigned.name || assigned.group;
      valueEl.classList.remove('none');
      valueEl.onclick = openGroupPickModal;
    } else {
      valueEl.textContent = 'No group';
      valueEl.classList.add('none');
      valueEl.onclick = openGroupPickModal;
    }
    clearResult(document.getElementById('groupAssignResult')!);
  }

  // ── Core trust/untrust helpers ────────────────────────────────────────────────

  async function loadAllSessionKeys(sessionId: string): Promise<KeyEntry[]> {
    const keys: KeyEntry[] = [];
    let offset = 0;
    const PAGE = 200;
    while (true) {
      const data = await distributions.listKeys(sessionId, { limit: PAGE, offset }) as { keys?: KeyEntry[]; total: number };
      if (!data.keys?.length) break;
      keys.push(...data.keys);
      offset += data.keys.length;
      if (offset >= data.total) break;
    }
    return keys;
  }

  function deriveAddresses(keys: KeyEntry[]): string[] {
    return keys
      .filter(k => k.privateKey)
      .map(k => { try { return deriveAccountAddress(k.privateKey!); } catch { return null; } })
      .filter((a): a is string => a !== null);
  }

  const TRUST_BATCH_SIZE   = 30;
  const UNTRUST_BATCH_SIZE = 30;

  async function trustAddressesInGroup(groupAddress: string, addresses: string[], ownerSafe?: string): Promise<void> {
    if (!addresses.length) return;
    const existing = await fetchGroupMembers(groupAddress);
    const toTrust  = addresses.filter(a => !existing.has(a.toLowerCase()));
    if (!toTrust.length) return;

    for (let i = 0; i < toTrust.length; i += TRUST_BATCH_SIZE) {
      const chunk = toTrust.slice(i, i + TRUST_BATCH_SIZE) as Address[];
      await sendGroupTxs(ownerSafe, [{
        to:    groupAddress,
        data:  encodeFunctionData({ abi: BASE_GROUP_ABI, functionName: 'trustBatchWithConditions', args: [chunk, MAX_UINT96] }),
        value: '0',
      }]);
    }
  }

  async function untrustAddressesInGroup(groupAddress: string, addresses: string[], ownerSafe?: string): Promise<void> {
    if (!addresses.length) return;
    const existing  = await fetchGroupMembers(groupAddress);
    const toUntrust = addresses.filter(a => existing.has(a.toLowerCase()));
    if (!toUntrust.length) return;

    for (let i = 0; i < toUntrust.length; i += UNTRUST_BATCH_SIZE) {
      const chunk = toUntrust.slice(i, i + UNTRUST_BATCH_SIZE) as Address[];
      await sendGroupTxs(ownerSafe, [{
        to:    groupAddress,
        data:  encodeFunctionData({ abi: BASE_GROUP_ABI, functionName: 'trustBatchWithConditions', args: [chunk, 0n] }),
        value: '0',
      }]);
    }
  }

  // ── Group picker modal ────────────────────────────────────────────────────────

  document.getElementById('groupAssignValue')!.addEventListener('click', openGroupPickModal);
  document.getElementById('cancelGroupPickBtn')!.addEventListener('click', () => {
    document.getElementById('groupPickModal')!.classList.remove('show');
  });

  async function openGroupPickModal(): Promise<void> {
    const list   = document.getElementById('groupPickList')!;
    const result = document.getElementById('groupPickResult')!;
    clearResult(result);
    document.getElementById('groupPickModal')!.classList.add('show');

    if (!controlledGroups.length) {
      list.innerHTML = '<div class="empty-state">Loading groups…</div>';
      try {
        controlledGroups = await fetchControlledGroups(connectedAddress!);
      } catch (e) {
        list.innerHTML = `<div class="empty-state" style="color:#b91c1c;">Error: ${escapeHtml((e as Error).message)}</div>`;
        return;
      }
    }

    if (!controlledGroups.length) {
      list.innerHTML = '<div class="empty-state">No groups found where you are owner or service.</div>';
      return;
    }

    const assigned = getSessionGroup(currentSession?.id ?? '');

    list.innerHTML = controlledGroups.map((g, i) => {
      const isSelected = assigned && assigned.group.toLowerCase() === g.group.toLowerCase();
      return `
        <div class="group-pick-item${isSelected ? ' selected' : ''}" data-group-idx="${i}">
          <span class="group-pick-name">${escapeHtml(g.name || g.group)}</span>
          <span class="group-pick-role">${escapeHtml(g._role)}</span>
        </div>
      `;
    }).join('');

    list.querySelectorAll<HTMLDivElement>('.group-pick-item').forEach(item => {
      item.addEventListener('click', () => {
        const g = controlledGroups[parseInt(item.dataset.groupIdx ?? '0')];
        selectSessionGroup(currentSession?.id ?? '', g);
      });
    });

    const noneItem = document.getElementById('groupPickNone')!;
    noneItem.classList.toggle('selected', !assigned);
    noneItem.onclick = () => removeSessionGroup(currentSession?.id ?? '', true);
  }

  async function selectSessionGroup(sessionId: string, newGroup: GroupEntry): Promise<void> {
    if (!sessionId) return;
    const result   = document.getElementById('groupPickResult')!;
    const oldGroup = getSessionGroup(sessionId);

    if (oldGroup && oldGroup.group.toLowerCase() === newGroup.group.toLowerCase()) {
      document.getElementById('groupPickModal')!.classList.remove('show');
      return;
    }

    showResult(result, 'pending', 'Loading magic link keys…');
    const keys = await loadAllSessionKeys(sessionId).catch((e: Error) => { showResult(result, 'error', e.message); return null; });
    if (!keys) return;

    const addresses = deriveAddresses(keys);

    try {
      if (oldGroup && addresses.length) {
        showResult(result, 'pending', `Unassigning invitations from group ${escapeHtml(oldGroup.name || oldGroup.group)}…`);
        await untrustAddressesInGroup(oldGroup.group, addresses, oldGroup.ownerSafe);
      }

      if (addresses.length) {
        showResult(result, 'pending', `Adding to the ${escapeHtml(newGroup.name || newGroup.group)} group…`);
        await trustAddressesInGroup(newGroup.group, addresses, newGroup._ownerSafe);
      }

      setSessionGroup(sessionId, {
        group: newGroup.group,
        name: newGroup.name || newGroup.group,
        role: newGroup._role || 'owner',
        ownerSafe: newGroup._ownerSafe,
      });
      document.getElementById('groupPickModal')!.classList.remove('show');
      renderGroupAssignRow(sessionId);
    } catch (e) {
      showResult(result, 'error', 'Failed: ' + (e as Error).message);
    }
  }

  async function removeSessionGroup(sessionId: string, fromModal = false): Promise<void> {
    if (!sessionId) return;
    const oldGroup = getSessionGroup(sessionId);
    if (fromModal) document.getElementById('groupPickModal')!.classList.remove('show');
    if (!oldGroup) return;

    const result = document.getElementById('groupAssignResult')!;
    showResult(result, 'pending', 'Loading magic link keys…');

    try {
      const keys      = await loadAllSessionKeys(sessionId);
      const addresses = deriveAddresses(keys);

      if (addresses.length) {
        showResult(result, 'pending', `Unassigning invitations from group ${escapeHtml(oldGroup.name || oldGroup.group)}…`);
        await untrustAddressesInGroup(oldGroup.group, addresses, oldGroup.ownerSafe);
      }

      setSessionGroup(sessionId, null);
      renderGroupAssignRow(sessionId);
      clearResult(result);
    } catch (e) {
      showResult(result, 'error', 'Failed: ' + (e as Error).message);
    }
  }

  // ── My Invites ────────────────────────────────────────────────────────────────

  async function loadMyInvites(reset = false): Promise<void> {
    if (reset) { myInvitesOffset = 0; myInvitesClaimed = []; }
    const content = document.getElementById('myInvitesContent')!;
    if (reset) content.innerHTML = '<div class="empty-state">Loading…</div>';

    try {
      // Fetch all pages iteratively
      let total = Infinity;
      while (myInvitesOffset < total) {
        const data = await referrals.listMine({
          limit: MY_INVITES_PAGE,
          offset: myInvitesOffset,
        }) as unknown as { referrals: Referral[]; total: number };

        total = data.total;

        for (const ref of data.referrals) {
          if (ref.privateKey) myInvitesKeyMap.set(ref.id, ref.privateKey);
        }

        if (myInvitesOffset === 0) {
          if (reset) { content.innerHTML = ''; selectedRefIds.clear(); }

          if (!data.referrals.length) {
            content.innerHTML = '<div class="empty-state">No invitation codes yet.<br>Add keys above to get started.</div>';
            updateBulkAssignBar();
            return;
          }
        }

        content.querySelector('.claimed-toggle')?.remove();
        content.querySelector('.claimed-list')?.remove();

        const active  = data.referrals.filter(r => r.status !== 'claimed' && !r.sessions.length);
        const claimed = data.referrals.filter(r => r.status === 'claimed');
        myInvitesClaimed.push(...claimed);

        if (active.length && !document.getElementById('selectAllRow')) {
          const selectAllRow = document.createElement('div');
          selectAllRow.id = 'selectAllRow';
          selectAllRow.className = 'invite-row select-all-row';
          selectAllRow.innerHTML = `
            <input type="checkbox" id="selectAllChk" class="invite-checkbox">
            <label for="selectAllChk" style="font-size:12px;color:#6a6c8c;cursor:pointer;">Select all</label>
            <span id="bulkAssignCount" style="font-size:12px;font-weight:600;color:#3730a3;margin-left:8px;"></span>
            <button class="btn-sm" id="bulkAssignBtn" style="visibility:hidden;margin-left:auto;">Assign to magic link →</button>
          `;
          selectAllRow.querySelector('#selectAllChk')!.addEventListener('change', (e) => {
            const checked = (e.target as HTMLInputElement).checked;
            content.querySelectorAll<HTMLInputElement>('.invite-checkbox[data-ref-id]').forEach(chk => {
              chk.checked = checked;
              if (checked) selectedRefIds.add(chk.dataset.refId!);
              else selectedRefIds.delete(chk.dataset.refId!);
            });
            updateBulkAssignBar();
          });
          content.insertBefore(selectAllRow, content.firstChild);
        }

        for (const ref of active) {
          const row = document.createElement('div');
          row.className = 'invite-row';

          const pillHtml = ref.status === 'confirmed'
            ? '<span class="pill pill-active">Confirmed</span>'
            : '';

          row.innerHTML = `
            <input type="checkbox" class="invite-checkbox" data-ref-id="${escapeAttr(ref.id)}" ${selectedRefIds.has(ref.id) ? 'checked' : ''}>
            <span class="key-addr">${escapeHtml(keyPreview(ref.privateKey))}</span>
            ${pillHtml}
          `;

          row.querySelector('.invite-checkbox')!.addEventListener('change', (e) => {
            if ((e.target as HTMLInputElement).checked) selectedRefIds.add(ref.id);
            else selectedRefIds.delete(ref.id);
            syncSelectAll();
            updateBulkAssignBar();
          });

          content.appendChild(row);
        }

        myInvitesOffset += data.referrals.length;
        if (!data.referrals.length) break;  // guard against empty pages
      }

      if (myInvitesClaimed.length) {
        const toggle = document.createElement('button');
        toggle.className = 'claimed-toggle load-more-btn';
        toggle.textContent = `${myInvitesClaimed.length} claimed invite${myInvitesClaimed.length === 1 ? '' : 's'}`;

        const claimedList = document.createElement('div');
        claimedList.className = 'claimed-list';
        claimedList.style.display = 'none';

        for (const ref of myInvitesClaimed) {
          const row = document.createElement('div');
          row.className = 'invite-row';
          row.innerHTML = `
            <span style="width:16px;flex-shrink:0;"></span>
            <span class="key-addr">${escapeHtml(keyPreview(ref.privateKey))}</span>
            <span class="pill pill-claimed">Claimed</span>
            ${ref.accountAddress ? `<span style="font-size:10px;color:#9b9db3;">${shortAddr(ref.accountAddress)}</span>` : ''}
          `;
          claimedList.appendChild(row);
        }

        toggle.addEventListener('click', () => {
          const open = claimedList.style.display !== 'none';
          claimedList.style.display = open ? 'none' : '';
          toggle.textContent = open
            ? `${myInvitesClaimed.length} claimed invite${myInvitesClaimed.length === 1 ? '' : 's'}`
            : 'Hide claimed';
        });

        content.appendChild(toggle);
        content.appendChild(claimedList);
      }

      updateBulkAssignBar();

    } catch (e) {
      if (reset) content.innerHTML = `<div class="empty-state" style="color:#b91c1c;">Error: ${(e as Error).message}</div>`;
    }
  }

  // ── Selection helpers ─────────────────────────────────────────────────────────

  function syncSelectAll(): void {
    const all  = document.querySelectorAll('#myInvitesContent .invite-checkbox[data-ref-id]');
    const chkd = document.querySelectorAll('#myInvitesContent .invite-checkbox[data-ref-id]:checked');
    const selectAll = document.getElementById('selectAllChk') as HTMLInputElement | null;
    if (!selectAll) return;
    selectAll.indeterminate = chkd.length > 0 && chkd.length < all.length;
    selectAll.checked = all.length > 0 && chkd.length === all.length;
  }

  function updateBulkAssignBar(): void {
    const count     = selectedRefIds.size;
    const countEl   = document.getElementById('bulkAssignCount');
    const assignBtn = document.getElementById('bulkAssignBtn') as HTMLButtonElement | null;
    if (!countEl) return;
    if (count === 0) {
      countEl.textContent = '';
      if (assignBtn) assignBtn.style.visibility = 'hidden';
    } else {
      countEl.textContent = `${count} selected`;
      if (assignBtn) assignBtn.style.visibility = 'visible';
    }
  }

  // ── Assign modal ──────────────────────────────────────────────────────────────

  async function openAssignModal(refEntry: { id: string } | null): Promise<void> {
    assignTargetKeys = refEntry
      ? [refEntry]
      : [...selectedRefIds].map(id => ({ id }));
    const list = document.getElementById('assignSessionList')!;
    clearResult(document.getElementById('assignResult')!);

    if (!currentSessions.length) {
      try {
        await refreshSessions();
      } catch { /* show empty state below */ }
    }

    const activeSessions = currentSessions.filter(s => !s.paused);

    if (!activeSessions.length) {
      list.innerHTML = '<div class="empty-state">No active magic links available.<br>Create a magic link first.</div>';
    } else {
      list.innerHTML = activeSessions.map(s => {
        const expiry    = formatExpiry(s.expiresAt);
        const expiryStr = expiry ? ` · ${expiry.label}` : '';
        return `
          <div class="assign-session-item" data-session-id="${escapeAttr(s.id)}" data-session-label="${escapeAttr(s.label || s.slug)}">
            <div>
              <div class="session-label">${escapeHtml(s.label || '(unnamed)')}</div>
              <div class="session-slug">${escapeHtml(expiryStr)}</div>
            </div>
            <span style="font-size:11px;color:#6a6c8c;">${(s.queuedCount ?? 0) + (s.dispatchedCount ?? 0) + (s.claimedCount ?? 0)} total</span>
          </div>
        `;
      }).join('');

      list.querySelectorAll<HTMLDivElement>('.assign-session-item').forEach(item => {
        item.addEventListener('click', () => doAssignToSession(item.dataset.sessionId!, item.dataset.sessionLabel!));
      });
    }

    document.getElementById('assignModal')!.classList.add('show');
  }

  async function doAssignToSession(sessionId: string, _sessionLabel: string): Promise<void> {
    const result = document.getElementById('assignResult')!;
    if (!assignTargetKeys.length || !sessionId) return;

    const keys = assignTargetKeys.map(t => myInvitesKeyMap.get(t.id)).filter((k): k is string => !!k);
    if (!keys.length) {
      showResult(result, 'error', 'Keys not found in cache. Please sign out and sign back in.');
      return;
    }

    showResult(result, 'pending', `Assigning ${keys.length} key${keys.length === 1 ? '' : 's'}…`);

    try {
      for (let i = 0; i < keys.length; i += 100) {
        await distributions.addKeys(sessionId, keys.slice(i, i + 100));
      }

      const targetGroup = getSessionGroup(sessionId);
      if (targetGroup) {
        showResult(result, 'pending', `Assigning invitations to group ${escapeHtml(targetGroup.name)}…`);
        const addresses = keys.map(pk => { try { return deriveAccountAddress(pk); } catch { return null; } }).filter((a): a is string => a !== null);
        if (addresses.length) await trustAddressesInGroup(targetGroup.group, addresses, targetGroup.ownerSafe);
      }

      assignTargetKeys = [];
      selectedRefIds.clear();
      document.getElementById('assignModal')!.classList.remove('show');

      await refreshSessions();
      loadMyInvites(true);
    } catch (e) {
      showResult(result, 'error', 'Failed: ' + (e as Error).message);
    }
  }

  document.getElementById('cancelAssignBtn')!.addEventListener('click', () => {
    assignTargetKeys = [];
    document.getElementById('assignModal')!.classList.remove('show');
  });

  document.getElementById('myInvitesContent')!.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id === 'bulkAssignBtn') {
      if (!selectedRefIds.size) return;
      openAssignModal(null);
    }
  });

  // ── Auth flow ─────────────────────────────────────────────────────────────────

  const statusEl  = document.getElementById('status')!;
  const authPanel = document.getElementById('auth-panel')!;

  onWalletChange((address: string | null) => {
    connectedAddress = address;
    authToken        = null;

    if (address) {
      statusEl.className = 'status connected';
      statusEl.innerHTML = 'Connected: <span class="addr">' + shortAddr(address) + '</span>';
      authPanel.style.display = '';
    } else {
      statusEl.className = 'status disconnected';
      statusEl.textContent = 'Waiting for wallet connection…';
      authPanel.style.display = 'none';
    }
  });

  document.getElementById('challengeBtn')!.addEventListener('click', async () => {
    if (!connectedAddress) return;
    const btn    = document.getElementById('challengeBtn') as HTMLButtonElement;
    const result = document.getElementById('challengeResult')!;

    btn.disabled = true;
    clearResult(result);
    showResult(result, 'pending', 'Fetching challenge…');

    try {
      const challengeRes = await fetch(`${AUTH_BASE}/challenge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: connectedAddress,
          chainId: 100,
          statement: 'Sign in to Circles Referrals',
          audience: 'referrals-api',
        }),
      });

      if (!challengeRes.ok) {
        const err = await challengeRes.json().catch(() => ({ error: challengeRes.statusText })) as { error?: string };
        throw new Error(err.error || `HTTP ${challengeRes.status}`);
      }

      const { challengeId, message } = await challengeRes.json() as Challenge;

      showResult(result, 'pending', 'Waiting for wallet signature…');
      const { signature } = await signMessage(message, 'raw') as { signature: string };

      showResult(result, 'pending', 'Verifying…');
      const verifyRes = await fetch(`${AUTH_BASE}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId, signature }),
      });

      if (!verifyRes.ok) {
        const err = await verifyRes.json().catch(() => ({ error: verifyRes.statusText })) as { error?: string };
        throw new Error(err.error || `HTTP ${verifyRes.status}`);
      }

      const data = await verifyRes.json() as { token: string };
      authToken  = data.token;
      clearResult(result);
      show('view-sessions');
      setSessionsTabActive();
      loadSessions();
      loadQuota();
    } catch (e) {
      showResult(result, 'error', 'Failed: ' + (e as Error).message);
      btn.disabled = false;
    }
  });

  function signOut(): void {
    authToken      = null;
    currentSession = null;
    show('view-auth');
  }

  document.getElementById('signOutBtn')!.addEventListener('click', signOut);
  document.getElementById('myInvitesSignOutBtn')!.addEventListener('click', signOut);

  // ── Nav tabs ──────────────────────────────────────────────────────────────────

  function setSessionsTabActive(): void {
    document.querySelectorAll('.nav-tab-sessions').forEach(t => t.classList.add('active'));
    document.querySelectorAll('.nav-tab-invites').forEach(t => t.classList.remove('active'));
  }

  function setMyInvitesTabActive(): void {
    document.querySelectorAll('.nav-tab-sessions').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.nav-tab-invites').forEach(t => t.classList.add('active'));
  }

  document.querySelectorAll('.nav-tab-sessions').forEach(btn => {
    btn.addEventListener('click', () => {
      setSessionsTabActive();
      show('view-sessions');
      loadSessions();
    });
  });

  document.querySelectorAll('.nav-tab-invites').forEach(btn => {
    btn.addEventListener('click', () => {
      setMyInvitesTabActive();
      show('view-myinvites');
      loadMyInvites(true);
    });
  });

  // ── Add keys to pool panel ────────────────────────────────────────────────────

  document.getElementById('addToPoolBtn')!.addEventListener('click', () => {
    const panel = document.getElementById('addToPoolPanel')!;
    panel.style.display = panel.style.display === 'none' ? '' : 'none';
  });

  document.getElementById('cancelAddToPoolBtn')!.addEventListener('click', () => {
    document.getElementById('addToPoolPanel')!.style.display = 'none';
    (document.getElementById('poolKeysInput') as HTMLTextAreaElement).value = '';
    clearResult(document.getElementById('addToPoolResult')!);
  });

  document.getElementById('submitPoolKeysBtn')!.addEventListener('click', async () => {
    const raw    = (document.getElementById('poolKeysInput') as HTMLTextAreaElement).value.trim();
    const result = document.getElementById('addToPoolResult')!;
    const btn    = document.getElementById('submitPoolKeysBtn') as HTMLButtonElement;

    if (!raw) return;

    const keys = parsePrivateKeys(raw);

    if (!keys.length) {
      showResult(result, 'error', 'No valid keys found. Keys must be 0x + 64 hex characters.');
      return;
    }

    btn.disabled = true;
    showResult(result, 'pending', `Storing ${keys.length} key(s)…`);

    try {
      for (let i = 0; i < keys.length; i += 200) {
        const chunk       = keys.slice(i, i + 200);
        const invitations = chunk.map(pk => ({ privateKey: pk, inviter: connectedAddress }));
        const res = await fetch(`${REFERRALS_BASE}/store-batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
          body: JSON.stringify({ invitations }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(err.error || `HTTP ${res.status}`);
        }
      }

      showResult(result, 'success', `Stored <strong>${keys.length}</strong> key(s).`);
      (document.getElementById('poolKeysInput') as HTMLTextAreaElement).value = '';
      loadMyInvites(true);
    } catch (e) {
      showResult(result, 'error', 'Failed: ' + (e as Error).message);
    }

    btn.disabled = false;
  });

  // ── Sessions list ─────────────────────────────────────────────────────────────

  async function loadSessions(): Promise<void> {
    const content = document.getElementById('sessionsContent')!;
    content.innerHTML = '<div class="empty-state">Loading…</div>';

    try {
      await refreshSessions();
      renderSessions(currentSessions);
    } catch (e) {
      content.innerHTML = `<div class="empty-state" style="color:#b91c1c;">Error: ${(e as Error).message}</div>`;
    }
  }

  function renderSessions(sessions: Session[]): void {
    const content = document.getElementById('sessionsContent')!;

    if (!sessions.length) {
      content.innerHTML = '<div class="empty-state">No magic links yet.<br>Create one to start distributing invites.</div>';
      return;
    }

    content.innerHTML = sessions.map(s => {
      const expiry = formatExpiry(s.expiresAt);
      const statusPill = s.paused
        ? '<span class="pill pill-paused">Paused</span>'
        : expiry?.soon
          ? '<span class="pill pill-expired">Expiring</span>'
          : '<span class="pill pill-active">Active</span>';

      const expiryTag = expiry
        ? `<span class="expiry-tag${expiry.soon ? ' soon' : ''}">${expiry.label}</span>`
        : '';

      const hasParams = !!getSessionParams(s.id);

      return `
        <div class="session-card" data-id="${s.id}">
          <div class="session-card-header">
            <span class="session-label">${escapeHtml(s.label || '(unnamed)')}</span>
            ${statusPill}
          </div>
          <div class="session-stats">
            <div class="stat-item">
              <span class="stat-num" id="total-stat-${s.id}">${(s.queuedCount ?? 0) + (s.dispatchedCount ?? 0) + (s.claimedCount ?? 0)}</span>
              <span>Total</span>
            </div>
            <div class="stat-item">
              <span class="stat-num green" id="available-stat-${s.id}">—</span>
              <span>Available</span>
            </div>
            <div class="stat-item">
              <span class="stat-num orange" id="inuse-stat-${s.id}">—</span>
              <span>In use</span>
            </div>
            <div class="stat-item">
              <span class="stat-num gray" id="claimed-stat-${s.id}">—</span>
              <span>Claimed</span>
            </div>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px;">
            <div style="display:flex;align-items:center;gap:4px;">
              ${expiryTag}
              <button class="btn-copy-link" data-copy-id="${escapeAttr(s.id)}" data-copy-slug="${escapeAttr(s.slug)}">🔗 Copy Link</button>
              <button class="btn-params${hasParams ? ' has-params' : ''}" data-params-id="${escapeAttr(s.id)}" title="Add parameters">＋ Add parameters</button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Fetch granular counts from stats endpoint (fire-and-forget)
    sessions.forEach(s => {
      fetch(`${REFERRALS_BASE}/d/${s.slug}/stats`)
        .then(r => r.ok ? r.json() : null)
        .then((data: SessionStats | null) => {
          if (!data) return;
          const { available, inUse, claimed, total } = computeAvailableUsed(data);
          const totalEl     = document.getElementById(`total-stat-${s.id}`);
          const availableEl = document.getElementById(`available-stat-${s.id}`);
          const inUseEl     = document.getElementById(`inuse-stat-${s.id}`);
          const claimedEl   = document.getElementById(`claimed-stat-${s.id}`);
          if (totalEl     && total     != null) totalEl.textContent     = String(total);
          if (availableEl && available != null) availableEl.textContent = String(available);
          if (inUseEl     && inUse     != null) inUseEl.textContent     = String(inUse);
          if (claimedEl   && claimed   != null) claimedEl.textContent   = String(claimed);
        })
        .catch(() => { /* non-fatal */ });
    });

    content.querySelectorAll<HTMLDivElement>('.session-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.btn-copy-link') || (e.target as HTMLElement).closest('.btn-params')) return;
        const session = sessions.find(s => s.id === card.dataset.id);
        if (session) openSession(session);
      });
    });

    content.querySelectorAll<HTMLButtonElement>('.btn-copy-link[data-copy-id]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        copySessionLink(btn.dataset.copyId!, btn.dataset.copySlug!, btn);
      });
    });

    content.querySelectorAll<HTMLButtonElement>('.btn-params[data-params-id]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openParamsModal(btn.dataset.paramsId!);
      });
    });
  }

  // ── Link lookup ───────────────────────────────────────────────────────────────

  function extractSlugFromLink(input: string): string | null {
    const trimmed = input.trim();
    // Match https://circles.gnosis.io/invitation/<slug> or just a bare slug
    const urlMatch = trimmed.match(/\/invitation\/([A-Za-z0-9_-]+)/);
    if (urlMatch) return urlMatch[1];
    // If it looks like a plain slug (no slashes, no spaces)
    if (/^[A-Za-z0-9_-]+$/.test(trimmed)) return trimmed;
    return null;
  }

  async function lookupDistributionLink(): Promise<void> {
    const input  = document.getElementById('lookupLinkInput') as HTMLInputElement;
    const result = document.getElementById('lookupResult')!;
    const btn    = document.getElementById('lookupLinkBtn') as HTMLButtonElement;

    const slug = extractSlugFromLink(input.value);
    if (!slug) {
      result.style.display = 'block';
      result.innerHTML = '<span style="color:#b91c1c;">Could not extract a slug from that URL.</span>';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Loading…';
    result.style.display = 'block';
    result.innerHTML = 'Fetching stats…';

    try {
      const res  = await fetch(`${REFERRALS_BASE}/d/${slug}/stats`);
      if (!res.ok) {
        result.innerHTML = `<span style="color:#b91c1c;">Error ${res.status}: could not fetch stats for <code>${escapeHtml(slug)}</code>.</span>`;
        return;
      }
      const data = await res.json() as SessionStats;
      const { available, inUse, claimed, total } = computeAvailableUsed(data);
      const fmt = (n: number | null): string => n != null ? String(n) : '—';

      const labelHtml = data.label
        ? `<span style="font-weight:600;color:#060a40;">${escapeHtml(String(data.label))}</span> &mdash; `
        : '';
      result.innerHTML = `
        <div style="margin-bottom:8px;">
          ${labelHtml}<code style="font-size:12px;color:#6a6c8c;">${escapeHtml(slug)}</code>
        </div>
        <div style="display:flex;gap:16px;font-size:12px;color:#6a6c8c;">
          <div class="stat-item"><span class="stat-num">${fmt(total)}</span><span>Total</span></div>
          <div class="stat-item"><span class="stat-num green">${fmt(available)}</span><span>Available</span></div>
          <div class="stat-item"><span class="stat-num orange">${fmt(inUse)}</span><span>In use</span></div>
          <div class="stat-item"><span class="stat-num gray">${fmt(claimed)}</span><span>Claimed</span></div>
        </div>
      `;
    } catch (e) {
      result.innerHTML = `<span style="color:#b91c1c;">Failed to fetch: ${escapeHtml((e as Error).message)}</span>`;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Look up';
    }
  }

  document.getElementById('lookupLinkBtn')!.addEventListener('click', lookupDistributionLink);
  document.getElementById('lookupLinkInput')!.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') lookupDistributionLink();
  });

  // ── Create session modal ──────────────────────────────────────────────────────

  document.getElementById('newSessionBtn')!.addEventListener('click', () => {
    clearResult(document.getElementById('createResult')!);
    (document.getElementById('newLabel') as HTMLInputElement).value = '';
    selectedExpiry = 0;
    document.querySelectorAll('.expiry-opt').forEach(o => {
      o.classList.toggle('selected', parseInt((o as HTMLElement).dataset.days ?? '0') === 0);
    });
    document.getElementById('createModal')!.classList.add('show');
  });

  document.querySelectorAll('.expiry-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('.expiry-opt').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      selectedExpiry = parseInt((opt as HTMLElement).dataset.days ?? '0');
    });
  });

  document.getElementById('cancelCreateBtn')!.addEventListener('click', () => {
    document.getElementById('createModal')!.classList.remove('show');
  });

  document.getElementById('confirmCreateBtn')!.addEventListener('click', async () => {
    const btn    = document.getElementById('confirmCreateBtn') as HTMLButtonElement;
    const result = document.getElementById('createResult')!;
    const label  = (document.getElementById('newLabel') as HTMLInputElement).value.trim();

    btn.disabled = true;
    showResult(result, 'pending', 'Creating magic link…');

    try {
      const body: Record<string, unknown> = { inviterAddress: connectedAddress };
      if (label) body.label = label;
      if (selectedExpiry > 0) {
        const exp = new Date();
        exp.setDate(exp.getDate() + selectedExpiry);
        body.expiresAt = exp.toISOString();
      }

      const session = await distributions.createSession(body as any) as unknown as Session;
      document.getElementById('createModal')!.classList.remove('show');
      btn.disabled = false;
      await refreshSessions();
      openSession(session);
    } catch (e) {
      showResult(result, 'error', 'Failed: ' + (e as Error).message);
      btn.disabled = false;
    }
  });

  // ── Session detail ────────────────────────────────────────────────────────────

  function openSession(session: Session): void {
    currentSession = session;
    keysOffset = 0;
    renderSessionDetail(session);
    clearAddKeysPanel();
    renderGroupAssignRow(session.id);
    clearResult(document.getElementById('generateResult')!);
    document.getElementById('deleteConfirmRow')!.style.display = 'none';
    document.getElementById('delegateRow')!.style.display = 'none';
    show('view-detail');
    loadKeys(true);
    loadQuota();

    // If no group in localStorage, try to detect it from on-chain membership
    if (!getSessionGroup(session.id)) {
      detectSessionGroup(session.id).then(detected => {
        // Only apply if still viewing the same session and still no localStorage entry
        if (currentSession?.id === session.id && !getSessionGroup(session.id) && detected) {
          setSessionGroup(session.id, {
            group:     detected.group,
            name:      detected.name || detected.group,
            role:      detected._role || 'owner',
            ownerSafe: detected._ownerSafe,
          });
          renderGroupAssignRow(session.id);
        }
      }).catch(() => { /* best-effort */ });
    }
  }

  function refreshStatsSummary(s: Session): void {
    const summaryEl = document.getElementById('statsSummary')!;
    const fallbackTotal = (s.queuedCount ?? 0) + (s.dispatchedCount ?? 0) + (s.claimedCount ?? 0);
    fetch(`${REFERRALS_BASE}/d/${s.slug}/stats`)
      .then(r => r.ok ? r.json() : null)
      .then((data: SessionStats | null) => {
        if (!data || currentSession?.id !== s.id) return;
        const { available, inUse, claimed, total } = computeAvailableUsed(data);
        const fmt = (n: number | null): string => n != null ? String(n) : '—';
        summaryEl.textContent = `${fmt(available)} available, ${fmt(inUse)} in use, ${fmt(claimed)} claimed, ${fmt(total ?? fallbackTotal)} total`;
      })
      .catch(() => { /* non-fatal */ });
  }

  function renderSessionDetail(s: Session): void {
    document.getElementById('detailLabel')!.textContent = s.label || '(unnamed)';

    const expiry    = formatExpiry(s.expiresAt);
    const expiryStr = expiry ? ` · ${expiry.label}` : '';
    document.getElementById('detailMeta')!.textContent =
      `${s.paused ? 'Paused' : 'Active'}${expiryStr}`;

    const fallbackTotal = (s.queuedCount ?? 0) + (s.dispatchedCount ?? 0) + (s.claimedCount ?? 0);
    const summaryEl     = document.getElementById('statsSummary')!;
    summaryEl.textContent = `— available, — in use, — claimed, ${fallbackTotal} total`;
    refreshStatsSummary(s);

    const pauseBtn = document.getElementById('pauseBtn') as HTMLButtonElement;
    pauseBtn.textContent = s.paused ? '▶' : '⏸';
    pauseBtn.title       = s.paused ? 'Resume' : 'Pause';

    const hasParams = !!getSessionParams(s.id);
    let detailActions = document.getElementById('detailLinkActions');
    if (!detailActions) {
      detailActions = document.createElement('div');
      detailActions.id = 'detailLinkActions';
      detailActions.style.cssText = 'display:flex;gap:6px;margin-top:8px;';
      document.getElementById('detailMeta')!.after(detailActions);
    }
    detailActions.innerHTML = `
      <button class="btn-copy-link" id="detailCopyBtn">🔗 Copy Link</button>
      <button class="btn-params${hasParams ? ' has-params' : ''}" id="detailParamsBtn">＋ Add parameters</button>
    `;
    document.getElementById('detailCopyBtn')!.addEventListener('click', () => {
      copySessionLink(s.id, s.slug, document.getElementById('detailCopyBtn') as HTMLButtonElement);
    });
    document.getElementById('detailParamsBtn')!.addEventListener('click', () => {
      openParamsModal(s.id);
    });
  }

  // ── Quota & generate invitations ──────────────────────────────────────────────

  async function loadQuota(): Promise<void> {
    const row        = document.getElementById('quotaRow')!;
    const valEl      = document.getElementById('quotaValue')!;
    const banner     = document.getElementById('quotaBanner')!;
    const bannerVal  = document.getElementById('quotaBannerValue')!;
    const countInput = document.getElementById('generateCount') as HTMLInputElement;
    const generateBtn = document.getElementById('generateInvitesBtn') as HTMLButtonElement;
    row.style.display    = 'none';
    banner.style.display = 'none';
    if (!connectedAddress) return;

    try {
      const quota = await publicClient.readContract({
        address: INVITATION_FARM,
        abi: INVITATION_FARM_ABI,
        functionName: 'inviterQuota',
        args: [connectedAddress as Address],
      });

      const quotaStr = quota.toString();
      const maxCount = Math.min(100, Number(quota));
      const hasQuota = quota > 0n;

      valEl.textContent = quotaStr;
      bannerVal.textContent = quotaStr;
      row.style.display = 'flex';
      banner.style.display = 'block';

      if (hasQuota) {
        countInput.max = maxCount.toString();
        if (parseInt(countInput.value, 10) > maxCount) countInput.value = maxCount.toString();
      } else {
        countInput.value = '1';
        countInput.max = '1';
      }

      countInput.disabled = !hasQuota;
      generateBtn.disabled = !hasQuota;
      generateBtn.title = hasQuota ? 'Create invites' : 'No quota available';
    } catch { /* non-fatal */ }
  }

  document.getElementById('generateInvitesBtn')!.addEventListener('click', generateInvitations);

  async function generateInvitations(): Promise<void> {
    const btn        = document.getElementById('generateInvitesBtn') as HTMLButtonElement;
    const result     = document.getElementById('generateResult')!;
    const countInput = document.getElementById('generateCount') as HTMLInputElement;
    const quotaValue = parseInt(document.getElementById('quotaValue')?.textContent || '0', 10);

    if (quotaValue <= 0) {
      showResult(result, 'error', 'No quota available to generate invitations.');
      return;
    }

    const COUNT      = Math.min(100, Math.max(1, parseInt(countInput.value, 10) || 100));

    btn.disabled = true;
    clearResult(result);
    showResult(result, 'pending', 'Generating keypairs…');

    try {
      showResult(result, 'pending', 'Building invitation transactions…');
      let referrals: { secret: string }[] = [];
      let transactions: Array<{ to: unknown; data: unknown; value?: unknown }> = [];
      try {
        const built = await inviteFarm.generateReferrals(connectedAddress as Address, COUNT);
        referrals = built.referrals;
        transactions = built.transactions;
      } catch (simErr) {
        // Simulation reverted (e.g. farm drained). Send a bare claim so the wallet
        // executes it on-chain and we see the real revert reason in the explorer.
        const claimData = COUNT === 1
          ? '0x81d42f52' as const  // claimInvite()
          : encodeFunctionData({
              abi: [{ type: 'function', name: 'claimInvites', inputs: [{ type: 'uint256' }], outputs: [{ type: 'uint256[]' }], stateMutability: 'nonpayable' }],
              functionName: 'claimInvites',
              args: [BigInt(COUNT)],
            });
        showResult(result, 'pending', `Simulation reverted (${(simErr as Error).message}). Sending claim on-chain anyway to surface the real revert…`);
        // Best-effort gas hint (host wallet may ignore it). 5M is well above the
        // ~1M ceiling a typical claimInvite touches across the bot ring walk.
        await sendTransactions([{ to: INVITATION_FARM, data: claimData, value: '0', gas: '5000000' } as unknown as { to: string; data: string; value: string }]);
        showResult(result, 'error', 'Claim sent on-chain — check the explorer for the revert reason. No invitations were generated.');
        btn.disabled = false;
        return;
      }

      showResult(result, 'pending', 'Waiting for wallet confirmation…');
      await sendTransactions(transactions.map(tx => ({
        to:    tx.to    as string,
        data:  tx.data  as string,
        value: tx.value ? String(tx.value) : '0',
      })));

      showResult(result, 'pending', 'Adding to session…');
      const privateKeys = referrals.map(r => r.secret);
      for (let i = 0; i < privateKeys.length; i += 200) {
        const chunk       = privateKeys.slice(i, i + 200);
        const invitations = chunk.map(pk => ({ privateKey: pk, inviter: connectedAddress }));
        await fetch(`${REFERRALS_BASE}/store-batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
          body: JSON.stringify({ invitations }),
        });
      }
      for (let i = 0; i < privateKeys.length; i += 100) {
        await distributions.addKeys(currentSession!.id, privateKeys.slice(i, i + 100));
      }

      const sessionGroup = getSessionGroup(currentSession!.id);
      if (sessionGroup) {
        showResult(result, 'pending', `Adding to the ${escapeHtml(sessionGroup.name)} group…`);
        const addresses = referrals.map(r => deriveAccountAddress(r.secret)).filter(Boolean);
        if (addresses.length) await trustAddressesInGroup(sessionGroup.group, addresses, sessionGroup.ownerSafe);
      }

      await loadQuota();
      await refreshDetail();
      showResult(result, 'success', `Generated and added <strong>${COUNT}</strong> invitations to this session.`);
    } catch (e) {
      showResult(result, 'error', 'Failed: ' + (e as Error).message);
    }

    btn.disabled = false;
  }

  document.getElementById('backBtn')!.addEventListener('click', () => {
    currentSession = null;
    show('view-sessions');
    setSessionsTabActive();
    loadSessions();
  });

  document.getElementById('refreshDetailBtn')!.addEventListener('click', refreshDetail);

  async function refreshDetail(): Promise<void> {
    if (!currentSession) return;
    const spinner = document.getElementById('refreshSpinner')!;
    spinner.style.display = '';
    try {
      const s = await distributions.getSession(currentSession.id) as Session;
      currentSession = s;
      renderSessionDetail(s);
      keysOffset = 0;
      await loadKeys(true);
    } catch { /* silent */ }
    spinner.style.display = 'none';
  }

  document.getElementById('pauseBtn')!.addEventListener('click', async () => {
    if (!currentSession) return;
    const btn = document.getElementById('pauseBtn') as HTMLButtonElement;
    btn.disabled = true;

    try {
      const s = await distributions.updateSession(currentSession.id, {
        paused: !currentSession.paused,
      }) as Session;
      currentSession = s;
      renderSessionDetail(s);
    } catch (e) {
      alert('Failed: ' + (e as Error).message);
    }

    btn.disabled = false;
  });

  document.getElementById('deleteSessionBtn')!.addEventListener('click', () => {
    document.getElementById('deleteConfirmRow')!.style.display = 'flex';
  });

  document.getElementById('cancelDeleteBtn')!.addEventListener('click', () => {
    document.getElementById('deleteConfirmRow')!.style.display = 'none';
  });

  document.getElementById('confirmDeleteBtn')!.addEventListener('click', async () => {
    if (!currentSession) return;
    const confirmBtn = document.getElementById('confirmDeleteBtn') as HTMLButtonElement;
    const cancelBtn  = document.getElementById('cancelDeleteBtn') as HTMLButtonElement;
    confirmBtn.disabled = true;
    cancelBtn.disabled  = true;

    const span = document.getElementById('deleteConfirmRow')!.querySelector('span')!;

    try {
      const sessionId = currentSession.id;

      // Fetch all unclaimed keys from this session before deleting
      span.textContent = 'Fetching unclaimed keys…';
      const allKeys = await loadAllSessionKeys(sessionId);
      const unclaimed = allKeys.filter(k => k.privateKey && k.status !== 'claimed');

      // Remove unclaimed keys from assigned group (if any)
      const sessionGroup = getSessionGroup(sessionId);
      if (sessionGroup && unclaimed.length > 0) {
        span.textContent = `Removing ${unclaimed.length} key(s) from group…`;
        const addresses = deriveAddresses(unclaimed);
        if (addresses.length > 0) {
          await untrustAddressesInGroup(sessionGroup.group, addresses, sessionGroup.ownerSafe);
        }
      }
      // Clear the group assignment from localStorage
      if (sessionGroup) {
        setSessionGroup(sessionId, null);
      }

      // Best-effort: migrate unclaimed keys back to personal pool (ignore failures)
      if (unclaimed.length > 0) {
        span.textContent = `Migrating ${unclaimed.length} key(s) to personal pool…`;
        const privateKeys = unclaimed.map(k => k.privateKey!);
        for (let i = 0; i < privateKeys.length; i += 200) {
          const chunkKeys   = privateKeys.slice(i, i + 200);
          const invitations = chunkKeys.map(pk => ({ privateKey: pk, inviter: connectedAddress }));
          try {
            await fetch(`${REFERRALS_BASE}/store-batch`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
              body: JSON.stringify({ invitations }),
            });
          } catch { /* best-effort, ignore */ }
        }
      }

      span.textContent = 'Deleting session…';
      await distributions.deleteSession(sessionId);
      confirmBtn.disabled = false;
      cancelBtn.disabled  = false;
      span.textContent = 'Delete this session? This cannot be undone.';
      document.getElementById('deleteConfirmRow')!.style.display = 'none';
      currentSession = null;
      await refreshSessions();
      renderSessions(currentSessions);
      show('view-sessions');
      setSessionsTabActive();
    } catch (e) {
      span.textContent = 'Failed: ' + (e as Error).message;
      confirmBtn.disabled = false;
      cancelBtn.disabled  = false;
    }
  });

  // ── Delegate session to another address ───────────────────────────────────────

  document.getElementById('reassignSessionBtn')!.addEventListener('click', () => {
    document.getElementById('deleteConfirmRow')!.style.display = 'none';
    const row = document.getElementById('delegateRow')!;
    row.style.display = row.style.display === 'flex' ? 'none' : 'flex';
    if (row.style.display === 'flex') {
      (document.getElementById('delegateAddressInput') as HTMLInputElement).value = '';
      (document.getElementById('delegateAddressInput') as HTMLInputElement).focus();
    }
  });

  document.getElementById('cancelDelegateBtn')!.addEventListener('click', () => {
    document.getElementById('delegateRow')!.style.display = 'none';
  });

  document.getElementById('confirmDelegateBtn')!.addEventListener('click', async () => {
    if (!currentSession) return;
    const input      = document.getElementById('delegateAddressInput') as HTMLInputElement;
    const confirmBtn = document.getElementById('confirmDelegateBtn') as HTMLButtonElement;
    const cancelBtn  = document.getElementById('cancelDelegateBtn') as HTMLButtonElement;

    const newAddress = input.value.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(newAddress)) {
      input.style.borderColor = '#fca5a5';
      input.focus();
      return;
    }
    input.style.borderColor = '';

    confirmBtn.disabled = true;
    cancelBtn.disabled  = true;
    confirmBtn.textContent = 'Reassigning…';

    try {
      const res = await fetch(`${REFERRALS_BASE}/distributions/sessions/${currentSession.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
        body: JSON.stringify({ inviterAddress: newAddress }),
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => String(res.status));
        throw new Error(msg || String(res.status));
      }

      document.getElementById('delegateRow')!.style.display = 'none';

      // Show success modal
      document.getElementById('delegateSuccessMsg')!.textContent =
        `This session has been transferred to ${newAddress}.`;
      document.getElementById('delegateSuccessModal')!.classList.add('show');

      // Refresh sessions in background so list is current when user goes back
      currentSession = null;
      await refreshSessions();
      renderSessions(currentSessions);
    } catch (e) {
      input.style.borderColor = '#fca5a5';
      alert('Failed to reassign: ' + (e as Error).message);
    } finally {
      confirmBtn.disabled = false;
      cancelBtn.disabled  = false;
      confirmBtn.textContent = 'Reassign';
    }
  });

  document.getElementById('closeDelegateSuccessBtn')!.addEventListener('click', () => {
    document.getElementById('delegateSuccessModal')!.classList.remove('show');
    show('view-sessions');
    setSessionsTabActive();
  });

  document.getElementById('addKeysBtn')!.addEventListener('click', () => {
    const panel   = document.getElementById('addKeysPanel')!;
    const btn     = document.getElementById('addKeysBtn')!;
    const showing = panel.style.display !== 'none';
    panel.style.display = showing ? 'none' : '';
    btn.style.display   = showing ? '' : 'none';
  });

  document.getElementById('cancelAddKeysBtn')!.addEventListener('click', clearAddKeysPanel);

  function clearAddKeysPanel(): void {
    document.getElementById('addKeysPanel')!.style.display = 'none';
    document.getElementById('addKeysBtn')!.style.display = '';
    (document.getElementById('keysInput') as HTMLTextAreaElement).value = '';
    clearResult(document.getElementById('addKeysResult')!);
  }

  document.getElementById('submitKeysBtn')!.addEventListener('click', async () => {
    const raw    = (document.getElementById('keysInput') as HTMLTextAreaElement).value.trim();
    const result = document.getElementById('addKeysResult')!;

    if (!raw) return;

    const keys = parsePrivateKeys(raw);

    if (!keys.length) {
      showResult(result, 'error', 'No valid keys found. Keys must be 0x + 64 hex characters.');
      return;
    }

    const btn = document.getElementById('submitKeysBtn') as HTMLButtonElement;
    btn.disabled = true;
    showResult(result, 'pending', `Adding ${keys.length} key(s)…`);

    try {
      let totalAdded = 0, totalSkipped = 0, totalClaimed = 0;
      const allErrors: string[] = [];

      for (let i = 0; i < keys.length; i += 100) {
        const chunk = keys.slice(i, i + 100);
        const data  = await distributions.addKeys(currentSession!.id, chunk) as unknown as { added?: number; skipped?: number; claimed?: number; errors?: string[] };
        totalAdded   += data.added   || 0;
        totalSkipped += data.skipped || 0;
        totalClaimed += data.claimed || 0;
        if (data.errors?.length) allErrors.push(...data.errors);
      }

      let msg = `Added <strong>${totalAdded}</strong> key(s).`;
      if (totalSkipped) msg += ` ${totalSkipped} skipped (duplicate).`;
      if (totalClaimed) msg += ` ${totalClaimed} already claimed.`;
      if (allErrors.length) msg += `<br>${allErrors.length} error(s).`;

      showResult(result, 'success', msg);
      clearAddKeysPanel();
      await refreshDetail();
    } catch (e) {
      showResult(result, 'error', 'Failed: ' + (e as Error).message);
    }

    btn.disabled = false;
  });


  // ── Keys list ─────────────────────────────────────────────────────────────────

  function makeKeyRow(k: KeyEntry): HTMLDivElement {
    const row     = document.createElement('div');
    row.className = 'key-row';
    if (k.accountAddress) row.dataset.account = k.accountAddress.toLowerCase();
    const preview = k.keyPreview ?? (k.privateKey ? keyPreview(k.privateKey) : '—');
    const acct    = k.accountAddress
      ? `<span style="font-size:10px;color:#9b9db3;">${shortAddr(k.accountAddress)}</span>`
      : '';

    let actionsHtml = '';
    if (k.status === 'queued') {
      actionsHtml = `
        <div class="key-actions">
          <button class="btn-xs" data-action="reassign" title="Move to another session">↔ Reassign</button>
          <button class="btn-xs danger" data-action="removekey" title="Remove from session">✕</button>
        </div>`;
    }

    row.innerHTML = `
      <span class="key-addr">${preview}</span>
      ${acct}
      <span class="key-status status-${k.status}">${k.status}</span>
      ${actionsHtml}
    `;

    if (k.status === 'queued') {
      row.querySelector('[data-action="reassign"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        openReassignModal(k, row);
      });
      row.querySelector('[data-action="removekey"]')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const btn = e.currentTarget as HTMLButtonElement;
        btn.disabled = true;
        try {
          await distributions.removeKey(currentSession!.id, k.id);

          const sessionGroup = getSessionGroup(currentSession!.id);
          if (sessionGroup && k.privateKey) {
            try {
              const addr = deriveAccountAddress(k.privateKey);
              await untrustAddressesInGroup(sessionGroup.group, [addr], sessionGroup.ownerSafe);
            } catch { /* non-fatal */ }
          }

          row.remove();
          if (currentSession) refreshStatsSummary(currentSession);
        } catch (err) {
          alert('Failed to remove: ' + (err as Error).message);
          btn.disabled = false;
        }
      });
    }

    return row;
  }

  async function loadKeys(reset = false): Promise<void> {
    if (reset) keysOffset = 0;
    const list = document.getElementById('keysList')!;
    if (reset) list.innerHTML = '<div style="font-size:12px;color:#9b9db3;padding:8px 0;">Loading invites…</div>';

    const allClaimed: KeyEntry[] = [];

    try {
      // Fetch all pages iteratively
      let total = Infinity;
      while (keysOffset < total) {
        const data = await distributions.listKeys(currentSession!.id, {
          limit: KEYS_PAGE,
          offset: keysOffset,
        }) as { keys?: KeyEntry[]; total: number };

        total = data.total;

        if (keysOffset === 0) {
          list.innerHTML = '';
          if (!data.keys?.length) {
            list.innerHTML = '<div class="empty-state" style="padding:16px 0;">No invites yet — add keys above.</div>';
            return;
          }
        }

        list.querySelector('.claimed-toggle')?.remove();
        list.querySelector('.claimed-list')?.remove();

        for (const k of (data.keys ?? [])) {
          if (k.status === 'claimed') {
            allClaimed.push(k);
          } else {
            list.appendChild(makeKeyRow(k));
          }
        }

        keysOffset += (data.keys ?? []).length;
        if (!data.keys?.length) break;  // guard against empty pages
      }

      if (allClaimed.length) {
        const toggle = document.createElement('button');
        toggle.className = 'claimed-toggle load-more-btn';
        toggle.textContent = `${allClaimed.length} claimed invite${allClaimed.length === 1 ? '' : 's'}`;

        const claimedList = document.createElement('div');
        claimedList.className = 'claimed-list';
        claimedList.style.display = 'none';
        for (const k of allClaimed) claimedList.appendChild(makeKeyRow(k));

        toggle.addEventListener('click', () => {
          const open = claimedList.style.display !== 'none';
          claimedList.style.display = open ? 'none' : '';
          toggle.textContent = open
            ? `${allClaimed.length} claimed invite${allClaimed.length === 1 ? '' : 's'}`
            : 'Hide claimed';
        });

        list.appendChild(toggle);
        list.appendChild(claimedList);
      }
    } catch (e) {
      if (reset) list.innerHTML = `<div class="empty-state" style="color:#b91c1c;">Error: ${(e as Error).message}</div>`;
    }
  }

  // ── Reassign key to another session ──────────────────────────────────────────

  let reassignKey: (KeyEntry & { row?: HTMLDivElement }) | null = null;

  function openReassignModal(keyEntry: KeyEntry, row: HTMLDivElement): void {
    reassignKey = { ...keyEntry, row };
    const list = document.getElementById('reassignSessionList')!;
    clearResult(document.getElementById('reassignResult')!);

    const otherSessions = currentSessions.filter(s => s.id !== currentSession?.id && !s.paused);

    if (!otherSessions.length) {
      list.innerHTML = '<div class="empty-state">No other active magic links available.</div>';
    } else {
      list.innerHTML = otherSessions.map(s => `
        <div class="assign-session-item" data-session-id="${escapeAttr(s.id)}" data-session-label="${escapeAttr(s.label || s.slug)}">
          <div>
            <div class="session-label">${escapeHtml(s.label || '(unnamed)')}</div>
          </div>
          <span style="font-size:11px;color:#6a6c8c;">${(s.queuedCount ?? 0) + (s.dispatchedCount ?? 0) + (s.claimedCount ?? 0)} total</span>
        </div>
      `).join('');

      list.querySelectorAll<HTMLDivElement>('.assign-session-item').forEach(item => {
        item.addEventListener('click', () => doReassign(item.dataset.sessionId!, item.dataset.sessionLabel!));
      });
    }

    document.getElementById('reassignModal')!.classList.add('show');
  }

  async function doReassign(targetSessionId: string, _targetSessionLabel: string): Promise<void> {
    const result = document.getElementById('reassignResult')!;
    if (!reassignKey || !targetSessionId) return;

    const btn = document.getElementById('cancelReassignBtn') as HTMLButtonElement;
    btn.disabled = true;
    showResult(result, 'pending', 'Moving key…');

    try {
      await distributions.addKeys(targetSessionId, [reassignKey.privateKey!]);
      await distributions.removeKey(currentSession!.id, reassignKey.id);

      const sourceGroup = getSessionGroup(currentSession!.id);
      const targetGroup = getSessionGroup(targetSessionId);
      let accountAddr: string | undefined;
      try { accountAddr = deriveAccountAddress(reassignKey.privateKey!); } catch { /* ignore */ }

      if (accountAddr) {
        if (sourceGroup) {
          const existing = await fetchGroupMembers(sourceGroup.group);
          if (existing.has(accountAddr.toLowerCase())) {
            showResult(result, 'pending', 'Removing from old group…');
            await sendGroupTxs(
              sourceGroup.ownerSafe,
              [{ to: sourceGroup.group, data: encodeFunctionData({ abi: BASE_GROUP_ABI, functionName: 'trustBatchWithConditions', args: [[accountAddr as Address], 0n] }), value: '0' }],
            );
          }
        }
        if (targetGroup) {
          const existing = await fetchGroupMembers(targetGroup.group);
          if (!existing.has(accountAddr.toLowerCase())) {
            showResult(result, 'pending', 'Adding to new group…');
            await sendGroupTxs(
              targetGroup.ownerSafe,
              [{ to: targetGroup.group, data: encodeFunctionData({ abi: BASE_GROUP_ABI, functionName: 'trustBatchWithConditions', args: [[accountAddr as Address], MAX_UINT96] }), value: '0' }],
            );
          }
        }
      }

      reassignKey.row?.remove();
      document.getElementById('reassignModal')!.classList.remove('show');
      reassignKey = null;

      await refreshSessions();
      if (currentSession) refreshStatsSummary(currentSession);
    } catch (e) {
      showResult(result, 'error', 'Failed: ' + (e as Error).message);
      btn.disabled = false;
    }
  }

  document.getElementById('cancelReassignBtn')!.addEventListener('click', () => {
    reassignKey = null;
    document.getElementById('reassignModal')!.classList.remove('show');
  });

  // ── Custom params modal ───────────────────────────────────────────────────────

  let paramsTargetSessionId: string | null = null;

  function openParamsModal(sessionId: string): void {
    paramsTargetSessionId = sessionId;
    (document.getElementById('paramsInput') as HTMLTextAreaElement).value = getSessionParams(sessionId);
    clearResult(document.getElementById('paramsResult')!);
    document.getElementById('paramsModal')!.classList.add('show');
  }

  document.getElementById('cancelParamsBtn')!.addEventListener('click', () => {
    paramsTargetSessionId = null;
    document.getElementById('paramsModal')!.classList.remove('show');
  });

  document.getElementById('saveParamsBtn')!.addEventListener('click', () => {
    if (!paramsTargetSessionId) return;
    const raw    = (document.getElementById('paramsInput') as HTMLTextAreaElement).value.trim();
    const result = document.getElementById('paramsResult')!;

    if (raw && !/^[^=&]+=/.test(raw)) {
      showResult(result, 'error', 'Invalid format. Use key=value pairs separated by &amp;');
      return;
    }

    setSessionParams(paramsTargetSessionId, raw);
    document.getElementById('paramsModal')!.classList.remove('show');

    document.querySelectorAll<HTMLButtonElement>(`.btn-params[data-params-id="${paramsTargetSessionId}"]`).forEach(btn => {
      btn.classList.toggle('has-params', !!raw);
    });
    const detailParamsBtn = document.getElementById('detailParamsBtn');
    if (detailParamsBtn && currentSession?.id === paramsTargetSessionId) {
      detailParamsBtn.classList.toggle('has-params', !!raw);
    }

    paramsTargetSessionId = null;
  });
}
