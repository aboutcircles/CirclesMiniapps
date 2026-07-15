import {
  createPublicClient,
  decodeEventLog,
  decodeFunctionResult,
  encodeFunctionData,
  formatEther,
  getAddress,
  http,
  isAddress,
  parseAbiItem,
  zeroAddress,
} from 'viem';
import { gnosis } from 'viem/chains';
import { onWalletChange, sendTransactions } from '@aboutcircles/miniapp-sdk';
import { cidV0ToHex } from '@aboutcircles/sdk-utils';
import { marked } from 'marked';
import {
  getCompatibilityFallbackHandlerDeployment,
  getProxyFactoryDeployment,
  getSafeSingletonDeployment,
} from '@safe-global/safe-deployments';
import { CirclesClient } from './circlesClient';
import {
  RPC_URL,
  SAFE_VERSION,
  SAFE_TX_SERVICE_URL,
  ENTRYPOINT_V07_ADDRESS,
} from '../../shared/config';
import {
  escapeHtml,
  decodeError,
  normalizeAddressList,
  txLinks,
  isPasskeyAutoConnectError,
} from '../../shared/format';
import {
  fetchOwnerSafeCandidates,
  getVerifiedOwnerSafes,
  buildPrevalidatedSignature,
  SAFE_MULTICALL_BATCH_SIZE,
} from '../../shared/safe';

// group keeps a 3-URL fallback list (shared config exports only 2); the extra
// 1rpc.io endpoint is preserved here to keep receipt-polling behavior identical.
const RPC_FALLBACK_URLS = [
  RPC_URL,
  'https://rpc.gnosischain.com',
  'https://1rpc.io/gnosis',
];
const TX_RECEIPT_TIMEOUT_MS = 12 * 60 * 1000;
const TX_RECEIPT_POLL_MS = 3000;
const USER_OP_LOOKBACK_BLOCKS = 5000n;
const ATTO_CIRCLES_DECIMALS = 18n;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const PREVIEW_IMAGE_DIMENSION = 256;
const MAX_PREVIEW_IMAGE_BYTES = 150 * 1024;
const PREVIEW_IMAGE_QUALITIES = [0.9, 0.82, 0.74, 0.66, 0.58, 0.5, 0.42, 0.34, 0.26];
const MAX_GROUP_NAME_LENGTH = 32;
const MAX_DESCRIPTION_LENGTH = 600;
const MAX_LINK_LABEL_LENGTH = 48;
const TICKER_PATTERN = /^[A-Z0-9]{2,8}$/;
const MEMBER_PAGE_LIMIT = 50;
const WISHLIST_PAGE_LIMIT = 50;
const WISHLIST_FALLBACK_RPC_URL = 'https://rpc.staging.aboutcircles.com/';
const GROUP_PAGE_LIMIT = 50;
const MEMBER_SEARCH_V2_AVATAR_TYPES = [
  'CrcV2_RegisterHuman',
  'CrcV2_RegisterGroup',
  'CrcV2_RegisterOrganization',
];
const MEMBER_SEARCH_V1_AND_V2_AVATAR_TYPES = [
  ...MEMBER_SEARCH_V2_AVATAR_TYPES,
  'CrcV1_Signup',
  'CrcV1_OrganizationSignup',
];
const USER_OPERATION_EVENT = parseAbiItem(
  'event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)'
);
const PROXY_CREATION_EVENT = parseAbiItem(
  'event ProxyCreation(address indexed proxy, address singleton)'
);
const BASE_GROUP_CREATED_EVENT = parseAbiItem(
  'event BaseGroupCreated(address indexed group, address indexed owner, address indexed mintHandler, address treasury)'
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

export function boot() {
let connectedAddress: any = null;
let humanSdk: any = null;
let activeGroupSdk: any = null;
let activeGroupAvatar: any = null;
let activeGroupMeta: any = null;
let activeOwnerSafe: any = null;
let activeMemberCount: any = null;
let lastTxHashes: any[] = [];
let activeGroups: any[] = [];
let cachedMembers: any[] = [];
let memberPages: any[] = [];
let memberNamesByAddress = new Map<string, string>();
let membersNextCursor: any = null;
let membersPagingActive = false;
let currentMembersPageIndex = 0;
let membersHasMorePages = false;
let loadedMembersGroupAddress: any = null;
let membersLoadRequestId = 0;
let selectedMembers = new Set<string>();
let wishlistPages: any[][] = [];
let wishlistNextCursor: string | null = null;
let wishlistHasMore = false;
let currentWishlistPageIndex = 0;
let selectedWishlistEntries = new Set<string>();
let loadedWishlistGroupAddress: string | null = null;
let wishlistLoadRequestId = 0;
let wishlistMemberStatusByAddress = new Map<string, boolean>();
let ownerSafeOwners: any[] = [];
let ownerSafeThreshold: any = null;
let activeMembershipConditions: any[] = [];
let ownerSafeDetailsLoadRequestId = 0;
let cachedFeeConvertibleAmount = 0n;
let cachedFeeSourceTokens: any[] = [];
let cachedFeeAddressGroupTokenAmount = 0n;
let currentView = 'login';
const groupPreviewImageByAddress = new Map<string, string | null>();
let createImageDataUrl = '';
let profileImageSourceUrl = '';
let profileImageSelectedDataUrl = '';
let imageProcessing = false;
let memberSearchRequestId = 0;
let memberSearchDebounceTimer: any = null;
let ownerSearchRequestId = 0;
let ownerSearchDebounceTimer: any = null;
let sendSearchRequestId = 0;
let sendSearchDebounceTimer: any = null;
let adminGroupsLoadRequestId = 0;
const sessionOwnerSafesByUser = new Map<string, any>();
const createExternalLink = { label: '', url: '' };
const profileExternalLink = { label: '', url: '' };

// DOM lookup helper typed as `any` so the (untyped) UI code can read `.value`,
// `.disabled`, `.checked`, etc. without per-element casts. tsconfig has
// noImplicitAny:false, so this keeps the UI wiring identical to the JS version.
const byId = (id: string): any => document.getElementById(id);

const badge = byId('badge');
const resultEl = byId('result');
const breadcrumbEl = byId('breadcrumb');

const loginSection = byId('login-section');
const groupsSection = byId('groups-section');
const createSection = byId('create-section');
const groupSection = byId('group-section');

const groupsListEl = byId('groups-list');
const startCreateGroupBtn = byId('start-create-group-btn');
const createGroupBtn = byId('create-group-btn');
const cancelCreateBtn = byId('cancel-create-btn');
const createGroupImageFilenameEl = byId('create-group-image-filename');
const createGroupNameInput = byId('create-group-name');
const createGroupSymbolInput = byId('create-group-symbol');
const createGroupDescriptionInput = byId('create-group-description');
const createGroupImageInput = byId('create-group-image');
const createImagePreviewWrap = byId('create-image-preview-wrap');
const createImagePreview = byId('create-image-preview');
const clearCreateImageBtn = byId('clear-create-image-btn');
const createLinkLabelInput = byId('create-link-label');
const createLinkUrlInput = byId('create-link-url');
const createWebsiteInput = byId('create-website');
const createGroupTypeSelect = byId('create-group-type');
const createMembershipFeeInput = byId('create-membership-fee');
const createMinRepScoreInput = byId('create-min-rep-score');
const createAdditionalCriteriaInput = byId('create-additional-criteria');
const createContactEmailInput = byId('create-contact-email');
const createContactWebsiteInput = byId('create-contact-website');

const editGroupBtn = byId('edit-group-btn');
const refreshGroupBtn = byId('refresh-group-btn');
const switchGroupsBtn = byId('switch-groups-btn');
const groupCoverEl = byId('group-cover');
const groupSymbolDisplay = byId('group-symbol-display');
const groupNameDisplay = byId('group-name-display');
const groupDescriptionDisplay = byId('group-description-display');
const groupMemberCountDisplay = byId('group-member-count-display');
const groupFeeBalanceDisplay = byId('group-fee-balance-display');
const groupAffiliateCountDisplay = byId('group-affiliate-count-display');
const groupAddressDisplay = byId('group-address-display');
const groupManagementMenuEl = byId('group-management-menu');
const groupOverviewPanelEl = byId('group-overview-panel');
const groupDetailsPanelEl = byId('group-details-panel');
const groupAdminsPanelEl = byId('group-admins-panel');
const groupMembersPanelEl = byId('group-members-panel');
const groupTokensPanelEl = byId('group-tokens-panel');
const overviewGroupAddressEl = byId('overview-group-address');
const overviewOwnerSafeEl = byId('overview-owner-safe');
const overviewTreasuryAddressEl = byId('overview-treasury-address');
const overviewMintHandlerEl = byId('overview-mint-handler');
const overviewServiceAddressEl = byId('overview-service-address');
const overviewFeeCollectionAddressEl = byId('overview-fee-collection-address');
const overviewGroupTypeEl = byId('overview-group-type');
const overviewTotalSupplyLabelEl = byId('overview-total-supply-label');
const overviewTotalSupplyEl = byId('overview-total-supply');

const profileDescriptionInput = byId('profile-description');
const profileImageInput = byId('profile-image');
const profileImagePreviewWrap = byId('profile-image-preview-wrap');
const profileImagePreview = byId('profile-image-preview');
const clearProfileImageBtn = byId('clear-profile-image-btn');
const profileLinkLabelInput = byId('profile-link-label');
const profileLinkUrlInput = byId('profile-link-url');
const profileWebsiteInput = byId('profile-website');
const profileGroupTypeSelect = byId('profile-group-type');
const profileMembershipFeeInput = byId('profile-membership-fee');
const profileMinRepScoreInput = byId('profile-min-rep-score');
const profileAdditionalCriteriaInput = byId('profile-additional-criteria');
const profileContactEmailInput = byId('profile-contact-email');
const profileContactWebsiteInput = byId('profile-contact-website');
const ownerSafeInput = byId('owner-safe-input');
const updateOwnerBtn = byId('update-owner-btn');
const ownerSafeOwnersListEl = byId('owner-safe-owners-list');
const addOwnerInput = byId('add-owner-input');
const addOwnerSafeBtn = byId('add-owner-safe-btn');
const ownerSafeSearchResultsEl = byId('owner-safe-search-results');
const serviceAddressInput = byId('service-address-input');
const updateServiceBtn = byId('update-service-btn');
const feeCollectionInput = byId('fee-collection-input');
const updateFeeCollectionBtn = byId('update-fee-collection-btn');
const membershipConditionsListEl = byId('membership-conditions-list');
const membershipConditionInput = byId('membership-condition-input');
const enableMembershipConditionBtn = byId('enable-membership-condition-btn');
const disableMembershipConditionBtn = byId('disable-membership-condition-btn');
const saveProfileBtn = byId('save-profile-btn');
const cancelProfileBtn = byId('cancel-profile-btn');
const profileImageFilenameEl = byId('profile-image-filename');

const feeCollectionBalanceDisplay = byId('fee-collection-balance-display');
const convertibleFeesDisplay = byId('convertible-fees-display');
const convertibleLabelEl = byId('convertible-label');
const feeAddressGroupTokenDisplay = byId('fee-address-group-token-display');
const collectFeesAmountInput = byId('collect-fees-amount');
const collectFeesAmountLabelEl = byId('collect-fees-amount-label');
const collectFeesMaxBtn = byId('collect-fees-max-btn');
const collectFeesBtn = byId('collect-fees-btn');

const memberQueryInput = byId('member-query');
const memberIncludeV1Input = byId('member-include-v1');
const addMemberBtn = byId('add-member-btn');
const memberSearchResultsEl = byId('member-search-results');
const membersListEl = byId('members-list');
const membersTotalCountEl = byId('members-total-count');
const membersPageLabelEl = byId('members-page-label');
const membersPrevBtn = byId('members-prev-btn');
const membersNextBtn = byId('members-next-btn');
const membersSelectionToolbarEl = byId('members-selection-toolbar');
const membersSelectAllInput = byId('members-select-all');
const membersSelectionCountEl = byId('members-selection-count');
const membersRemoveSelectedBtn = byId('members-remove-selected-btn');

const groupWishlistPanelEl = byId('group-wishlist-panel');
const wishlistListEl = byId('wishlist-list');
const wishlistTotalCountEl = byId('wishlist-total-count');
const wishlistPageLabelEl = byId('wishlist-page-label');
const wishlistPrevBtn = byId('wishlist-prev-btn');
const wishlistNextBtn = byId('wishlist-next-btn');
const wishlistSelectionToolbarEl = byId('wishlist-selection-toolbar');
const wishlistSelectAllInput = byId('wishlist-select-all');
const wishlistSelectionCountEl = byId('wishlist-selection-count');
const wishlistTrustSelectedBtn = byId('wishlist-trust-selected-btn');

const groupTokenCardTitleEl = byId('group-token-card-title');
const groupTokenCardCopyEl = byId('group-token-card-copy');
const groupTokenPanelTitleEl = byId('group-token-panel-title');
const groupTokenSendTitleEl = byId('group-token-send-title');
const sendRecipientInput = byId('send-recipient');
const sendSearchResultsEl = byId('send-search-results');
const sendAmountLabelEl = byId('send-amount-label');
const sendAmountInput = byId('send-amount');
const sendMaxBtn = byId('send-max-btn');
const sendGroupBtn = byId('send-group-btn');
const confirmModalEl = byId('confirm-modal');
const confirmModalTitleEl = byId('confirm-modal-title');
const confirmModalMessageEl = byId('confirm-modal-message');
const confirmModalCancelBtn = byId('confirm-modal-cancel');
const confirmModalConfirmBtn = byId('confirm-modal-confirm');

let confirmModalResolver: any = null;
let confirmModalKeyHandler: any = null;

function showResult(type, html) {
  resultEl.className = `result result-${type}`;
  const closeButtonHtml =
    type === 'pending'
      ? ''
      : '<button type="button" class="result-close" aria-label="Close notice">Close</button>';
  resultEl.innerHTML = `
    <div class="result-content">${html}</div>
    ${closeButtonHtml}
  `;
  resultEl.classList.remove('hidden');
  resultEl.querySelector('.result-close')?.addEventListener('click', hideResult);
}

function hideResult() {
  resultEl.classList.add('hidden');
}

// Swap a button's inner HTML to show a loading state, returning a restorer.
// Use as: const restore = setButtonLoading(btn, 'Saving…'); ... restore();
function setButtonLoading(btn, loadingLabel) {
  if (!btn) return () => {};
  const original = btn.innerHTML;
  btn.innerHTML = `<span class="btn-spinner" aria-hidden="true"></span>${loadingLabel}`;
  return () => {
    btn.innerHTML = original;
  };
}

function closeConfirmModal(confirmed) {
  if (confirmModalKeyHandler) {
    window.removeEventListener('keydown', confirmModalKeyHandler);
    confirmModalKeyHandler = null;
  }

  confirmModalEl.classList.add('hidden');
  confirmModalEl.setAttribute('aria-hidden', 'true');

  const resolver = confirmModalResolver;
  confirmModalResolver = null;
  if (resolver) resolver(Boolean(confirmed));
}

function showConfirmModal({
  title,
  message,
  confirmLabel = 'Continue',
  cancelLabel = 'Cancel',
}) {
  if (confirmModalResolver) {
    closeConfirmModal(false);
  }

  confirmModalTitleEl.textContent = title;
  confirmModalMessageEl.textContent = message;
  confirmModalConfirmBtn.textContent = confirmLabel;
  confirmModalCancelBtn.textContent = cancelLabel;
  confirmModalEl.classList.remove('hidden');
  confirmModalEl.setAttribute('aria-hidden', 'false');

  return new Promise((resolve) => {
    confirmModalResolver = resolve;
    confirmModalKeyHandler = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeConfirmModal(false);
      }
    };
    window.addEventListener('keydown', confirmModalKeyHandler);
    confirmModalConfirmBtn.focus();
  });
}

function setStatus(text, type) {
  badge.textContent = text;
  badge.className = `badge badge-${type}`;
}

function hideAllSections() {
  loginSection.classList.add('hidden');
  groupsSection.classList.add('hidden');
  createSection.classList.add('hidden');
  groupSection.classList.add('hidden');
}

function setBreadcrumb(crumbs) {
  if (!crumbs || crumbs.length === 0) {
    breadcrumbEl.classList.add('hidden');
    return;
  }

  breadcrumbEl.innerHTML = '';
  crumbs.forEach((crumb, index) => {
    if (index > 0) {
      const sep = document.createElement('span');
      sep.className = 'breadcrumb-sep';
      sep.textContent = '/';
      breadcrumbEl.appendChild(sep);
    }

    if (crumb.action) {
      const link = document.createElement('button');
      link.className = 'breadcrumb-link';
      link.textContent = crumb.label;
      link.addEventListener('click', crumb.action);
      breadcrumbEl.appendChild(link);
    } else {
      const current = document.createElement('span');
      current.className = 'breadcrumb-current';
      current.textContent = crumb.label;
      breadcrumbEl.appendChild(current);
    }
  });
  breadcrumbEl.classList.remove('hidden');
}

function navigateToGroups() {
  activeGroupSdk = null;
  activeGroupAvatar = null;
  activeGroupMeta = null;
  activeOwnerSafe = null;
  activeMemberCount = null;
  resetOwnerSafeState();
  showGroupManagementMenu();
  clearMemberSearchResults();
  loadAdminGroups(true);
}

function showDisconnectedState() {
  hideAllSections();
  hideResult();
  currentView = 'login';
  setBreadcrumb(null);
  setStatus('Not connected', 'disconnected');
  loginSection.classList.remove('hidden');
  groupsListEl.innerHTML = `
    <div class="empty-state">
      <span class="empty-state-icon" aria-hidden="true">🔐</span>
      <span class="empty-state-title">Connect your wallet</span>
      <p class="empty-state-copy">Open this miniapp in Circles and connect your wallet to see groups you administer.</p>
    </div>
  `;
  resetMembersState();
  resetOwnerSafeState();
  ownerSafeInput.value = '';
  overviewGroupTypeEl.textContent = '—';
  feeCollectionBalanceDisplay.textContent = '—';
  convertibleFeesDisplay.textContent = '—';
  if (feeAddressGroupTokenDisplay) feeAddressGroupTokenDisplay.textContent = '—';
  collectFeesBtn.disabled = true;
  cachedFeeSourceTokens = [];
  cachedFeeAddressGroupTokenAmount = 0n;
  overviewTotalSupplyEl.textContent = '—';
  updateTokenUiCopy();
  clearSendSearchResults();
}

function showGroupsView(keepStatus = false) {
  hideAllSections();
  currentView = 'groups';
  if (!keepStatus) setStatus('Connected', 'success');
  setBreadcrumb([{ label: 'Your Groups' }]);
  groupsSection.classList.remove('hidden');
}

function showCreateView() {
  hideAllSections();
  currentView = 'create';
  setStatus('Create group', 'success');
  setBreadcrumb([
    { label: 'Your Groups', action: navigateToGroups },
    { label: 'Create Group' },
  ]);
  createSection.classList.remove('hidden');
  updateCreateButtonState();
}

function showGroupView() {
  hideAllSections();
  currentView = 'group';
  setStatus('Group ready', 'success');
  const groupName = activeGroupMeta?.name || activeGroupMeta?.symbol || 'Group';
  setBreadcrumb([
    { label: 'Your Groups', action: navigateToGroups },
    { label: groupName },
  ]);
  groupSection.classList.remove('hidden');
  showGroupManagementMenu();
}

function hideGroupManagementPanels() {
  groupOverviewPanelEl.classList.add('hidden');
  groupDetailsPanelEl.classList.add('hidden');
  groupAdminsPanelEl.classList.add('hidden');
  groupMembersPanelEl.classList.add('hidden');
  groupWishlistPanelEl.classList.add('hidden');
  groupTokensPanelEl.classList.add('hidden');
}

function resetMembersState() {
  cachedMembers = [];
  memberPages = [];
  memberNamesByAddress = new Map();
  membersHasMorePages = false;
  currentMembersPageIndex = 0;
  membersNextCursor = null;
  membersPagingActive = false;
  loadedMembersGroupAddress = null;
  selectedMembers = new Set();
  membersListEl.innerHTML = '<p class="muted">Open Manage Group Members to load members.</p>';
  membersTotalCountEl.textContent = '0 members';
  membersPageLabelEl.textContent = 'Page 1';
  membersPrevBtn.disabled = true;
  membersNextBtn.disabled = true;
  updateMembersSelectionUI();
}

function resetWishlistState() {
  wishlistPages = [];
  wishlistNextCursor = null;
  wishlistHasMore = false;
  currentWishlistPageIndex = 0;
  selectedWishlistEntries = new Set();
  loadedWishlistGroupAddress = null;
  wishlistMemberStatusByAddress = new Map();
  wishlistLoadRequestId += 1;
  wishlistListEl.innerHTML = '<p class="muted">Open Join Requests to load entries.</p>';
  wishlistTotalCountEl.textContent = '0 requests';
  wishlistPageLabelEl.textContent = 'Page 1';
  wishlistPrevBtn.disabled = true;
  wishlistNextBtn.disabled = true;
  updateWishlistSelectionUI();
}

function resetOwnerSafeState() {
  ownerSafeOwners = [];
  ownerSafeThreshold = null;
  ownerSafeDetailsLoadRequestId += 1;
  if (ownerSearchDebounceTimer) {
    clearTimeout(ownerSearchDebounceTimer);
    ownerSearchDebounceTimer = null;
  }
  addOwnerInput.value = '';
  ownerSafeOwnersListEl.innerHTML = '<p class="muted">Open a group to load Group Admins.</p>';
  clearOwnerSafeSearchResults();
}

function resetMembershipConditionsState() {
  activeMembershipConditions = [];
  if (membershipConditionInput) {
    membershipConditionInput.value = '';
  }
  if (membershipConditionsListEl) {
    membershipConditionsListEl.innerHTML =
      '<p class="muted">Open a group to load membership conditions.</p>';
  }
}

function showGroupManagementMenu() {
  hideGroupManagementPanels();
  groupManagementMenuEl.classList.remove('hidden');
}

function showGroupManagementPanel(panel) {
  groupManagementMenuEl.classList.add('hidden');
  hideGroupManagementPanels();

  if (panel === 'overview') {
    groupOverviewPanelEl.classList.remove('hidden');
    return;
  }

  if (panel === 'details') {
    groupDetailsPanelEl.classList.remove('hidden');
    return;
  }

  if (panel === 'admins') {
    groupAdminsPanelEl.classList.remove('hidden');
    if (activeOwnerSafe && !ownerSafeOwners.length) {
      void loadOwnerSafeDetails();
    }
    return;
  }

  if (panel === 'members') {
    groupMembersPanelEl.classList.remove('hidden');
    if (activeGroupMeta?.group && loadedMembersGroupAddress !== activeGroupMeta.group) {
      void loadMembers();
    }
    return;
  }

  if (panel === 'wishlist') {
    groupWishlistPanelEl.classList.remove('hidden');
    if (activeGroupMeta?.group && loadedWishlistGroupAddress !== activeGroupMeta.group) {
      void loadWishlist();
    }
    return;
  }

  if (panel === 'tokens') {
    groupTokensPanelEl.classList.remove('hidden');
    return;
  }

  showGroupManagementMenu();
}

function getActiveTokenSymbol() {
  const symbol = String(activeGroupMeta?.symbol || '').trim();
  return symbol || 'token';
}

function getActiveGroupLabel() {
  const name = String(activeGroupMeta?.name || activeGroupMeta?.symbol || '').trim();
  if (name) return name;
  if (activeGroupMeta?.group && isAddress(activeGroupMeta.group)) {
    return shortenAddress(activeGroupMeta.group);
  }
  return 'this group';
}

function formatActiveTokenAmount(amount) {
  return `${attoToCirclesString(amount)} ${getActiveTokenSymbol()}`;
}

function updateTokenUiCopy() {
  const symbol = getActiveTokenSymbol();
  const isGeneric = symbol === 'token';

  if (groupTokenCardTitleEl) {
    groupTokenCardTitleEl.textContent = 'Treasury Operations';
  }
  if (groupTokenCardCopyEl) {
    groupTokenCardCopyEl.textContent = isGeneric
      ? 'Convert fee balances and send the group token.'
      : `Convert fee balances, then send ${symbol}.`;
  }
  if (groupTokenPanelTitleEl) {
    groupTokenPanelTitleEl.textContent = 'Treasury Operations';
  }
  if (groupTokenSendTitleEl) {
    groupTokenSendTitleEl.textContent = isGeneric ? 'Send Token' : `Send ${symbol}`;
  }
  if (sendAmountLabelEl) {
    sendAmountLabelEl.textContent = isGeneric ? 'Amount' : `Amount (${symbol})`;
  }
  if (collectFeesAmountLabelEl) {
    collectFeesAmountLabelEl.textContent = isGeneric ? 'Amount to convert' : `Amount to convert (${symbol})`;
  }
  if (convertibleLabelEl) {
    convertibleLabelEl.textContent = isGeneric ? 'Convertible to Group CRC' : `Convertible to ${symbol}`;
  }
  if (sendGroupBtn) {
    sendGroupBtn.textContent = isGeneric ? 'Send Token' : `Send ${symbol}`;
  }
  if (overviewTotalSupplyLabelEl) {
    overviewTotalSupplyLabelEl.textContent = isGeneric ? 'Total Supply' : `${symbol} Total Supply`;
  }
}

function getGroupSendTransferOptions() {
  if (!activeGroupMeta?.group || !isAddress(activeGroupMeta.group)) return undefined;
  return {
    useWrappedBalances: false,
    fromTokens: [activeGroupMeta.group],
    toTokens: [activeGroupMeta.group],
  };
}

function renderMarkdown(element, markdown, emptyText = 'No description') {
  if (!element) return;

  const source = String(markdown || '').trim();
  if (!source) {
    element.textContent = emptyText;
    return;
  }

  element.innerHTML = marked.parse(escapeHtml(source), {
    breaks: true,
    gfm: true,
  });
  element.querySelectorAll('a').forEach((link) => {
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener');
  });
}

function explorerAvatarUrl(address) {
  return `https://explorer.aboutcircles.com/avatar/${address}/`;
}

function gnosisScanAddressUrl(address) {
  return `https://gnosisscan.io/address/${address}`;
}

function shortenAddress(address) {
  if (!address || !isAddress(address)) return address || '—';
  const normalized = getAddress(address);
  return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`;
}

function setAddressLink(element, address) {
  if (!element) return;

  if (address && isAddress(address)) {
    const normalized = getAddress(address);
    element.textContent = normalized;
    element.href = gnosisScanAddressUrl(normalized);
    element.title = normalized;
    return;
  }

  element.textContent = '—';
  element.href = '#';
  element.removeAttribute('title');
}

function attoToCirclesString(atto) {
  const amount = BigInt(atto || 0);
  const formatted = formatEther(amount);
  return formatted.includes('.') ? formatted.replace(/\.?0+$/, '') : formatted;
}

function parseCirclesInputToAtto(value) {
  const trimmed = String(value || '').trim();
  if (!/^\d+(\.\d{1,18})?$/.test(trimmed)) return null;
  const [wholeRaw, fractionRaw = ''] = trimmed.split('.');
  return (
    BigInt(wholeRaw) * 10n ** ATTO_CIRCLES_DECIMALS +
    BigInt(fractionRaw.padEnd(Number(ATTO_CIRCLES_DECIMALS), '0'))
  );
}

function sanitizeAddressInput(value) {
  return String(value || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
}

function parseAddressInput(value) {
  const trimmed = sanitizeAddressInput(value);
  if (!trimmed) throw new Error('Address required.');

  if (isAddress(trimmed)) {
    return getAddress(trimmed);
  }

  const condensed = trimmed.replace(/\s+/g, '');
  if (isAddress(condensed, { strict: false })) {
    return getAddress(condensed.toLowerCase());
  }

  throw new Error('Invalid address.');
}

function looksLikeAddressInput(value) {
  try {
    parseAddressInput(value);
    return true;
  } catch {
    return false;
  }
}

function getSessionOwnerSafes(ownerAddress) {
  const key = ownerAddress?.toLowerCase();
  return normalizeAddressList(key ? sessionOwnerSafesByUser.get(key) || [] : []);
}

function setSessionOwnerSafes(ownerAddress, safeAddresses) {
  if (!ownerAddress) return;
  sessionOwnerSafesByUser.set(ownerAddress.toLowerCase(), normalizeAddressList(safeAddresses));
}

function addSessionOwnerSafe(ownerAddress, safeAddress) {
  const current = getSessionOwnerSafes(ownerAddress);
  current.push(safeAddress);
  setSessionOwnerSafes(ownerAddress, current);
}


function getFeeBalanceAmount(balance) {
  if (!balance) return 0n;
  if (balance.attoCircles !== undefined && balance.attoCircles !== null) return BigInt(balance.attoCircles);
  if (balance.attoCrc !== undefined && balance.attoCrc !== null) return BigInt(balance.attoCrc);
  if (balance.balance !== undefined && balance.balance !== null) return BigInt(balance.balance);
  return 0n;
}

function getFallbackGroupType(type) {
  const raw = String(type || '').trim();
  if (!raw) return 'Unknown';
  if (raw === 'CrcV2_BaseGroupCreated') return 'Base Group';
  if (raw.startsWith('CrcV2_')) return raw.replace(/^CrcV2_/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
  return raw;
}

function sanitizeUrl(rawUrl) {
  const value = String(rawUrl || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

const MAX_ADDITIONAL_CRITERIA = 20;
const MAX_CRITERION_LENGTH = 256;
const GROUP_TYPE_LABELS = { open: 'Open', closed: 'Closed' };

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function groupAccessLabel(groupType) {
  return GROUP_TYPE_LABELS[String(groupType || '').toLowerCase()] ?? 'Other';
}

function parseAdditionalCriteriaText(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, MAX_ADDITIONAL_CRITERIA)
    .map((line) => line.slice(0, MAX_CRITERION_LENGTH));
}

// Defensive reader: the read API documents a flat shape, but the profiles SDK
// may return the original nested shape. Prefer flat keys, fall back to nested.
// Absent / null / undefined / '' all mean "unset".
function readGroupProfileFields(profile: any) {
  const p: any = profile || {};
  const pick = (...vals) => {
    for (const v of vals) {
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return undefined;
  };
  const criteria = p.additionalCriteria ?? p.membershipCriteria?.additionalCriteria;
  return {
    website: pick(p.externalWebsite, p.externalLinks?.website),
    groupType: pick(p.groupType),
    membershipFee: pick(p.membershipFee, p.membershipCriteria?.membershipFee),
    minRepScore: pick(p.minRepScore, p.membershipCriteria?.minRepScore),
    additionalCriteria:
      Array.isArray(criteria) && criteria.length ? criteria : undefined,
    contactEmail: pick(p.contactEmail, p.contactInfo?.email),
    contactWebsite: pick(p.contactWebsite, p.contactInfo?.website),
  };
}

function setGroupTypeSelectValue(groupType) {
  if (!profileGroupTypeSelect) return;
  const prevTransient = profileGroupTypeSelect.querySelector('option[data-transient="1"]');
  if (prevTransient) prevTransient.remove();
  const value = groupType == null ? '' : String(groupType);
  const known = Array.from(profileGroupTypeSelect.options).some((o: any) => o.value === value);
  if (value && !known) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = `${groupAccessLabel(value)} (${value})`;
    opt.dataset.transient = '1';
    profileGroupTypeSelect.appendChild(opt);
  }
  profileGroupTypeSelect.value = value;
}

// Validates the 7 group-profile extension inputs and builds the nested shape,
// dropping empty optionals entirely. `els` maps field name -> input element.
// Returns { error, extras }; on validation failure error is a user message and
// extras is null. Shared by saveProfile (Edit) and createGroup (Create).
function collectGroupProfileExtras(els) {
  const websiteRaw = (els.website?.value || '').trim();
  const website = websiteRaw ? sanitizeUrl(websiteRaw) : '';

  const contactWebsiteRaw = (els.contactWebsite?.value || '').trim();
  const contactWebsite = contactWebsiteRaw ? sanitizeUrl(contactWebsiteRaw) : '';

  const contactEmail = (els.contactEmail?.value || '').trim();
  if (contactEmail && !isValidEmail(contactEmail)) {
    return { error: 'Contact email is not a valid email address.', extras: null };
  }

  let membershipFee: number | null = null;
  const feeRaw = (els.membershipFee?.value || '').trim();
  if (feeRaw) {
    const fee = Number(feeRaw);
    if (!Number.isFinite(fee) || fee < 0 || fee > 100) {
      return { error: 'Membership fee must be a number between 0 and 100.', extras: null };
    }
    membershipFee = fee;
  }

  let minRepScore: number | null = null;
  const repRaw = (els.minRepScore?.value || '').trim();
  if (repRaw) {
    const rep = Number(repRaw);
    if (!Number.isFinite(rep) || rep < 0) {
      return { error: 'Minimum reputation score must be 0 or greater.', extras: null };
    }
    minRepScore = rep;
  }

  const additionalCriteria = parseAdditionalCriteriaText(els.additionalCriteria?.value);
  const groupType = (els.groupType?.value || '').trim();

  const extras: any = {};
  if (website) extras.externalLinks = { website };
  const membershipCriteria: any = {};
  if (minRepScore !== null) membershipCriteria.minRepScore = minRepScore;
  if (membershipFee !== null) membershipCriteria.membershipFee = membershipFee;
  if (additionalCriteria.length) membershipCriteria.additionalCriteria = additionalCriteria;
  if (Object.keys(membershipCriteria).length) extras.membershipCriteria = membershipCriteria;
  if (groupType) extras.groupType = groupType;
  const contactInfo: any = {};
  if (contactEmail) contactInfo.email = contactEmail;
  if (contactWebsite) contactInfo.website = contactWebsite;
  if (Object.keys(contactInfo).length) extras.contactInfo = contactInfo;

  return { error: null, extras };
}

// Sanitised URL must parse and have a host with a TLD.
// Prevents server-side strip-and-continue surprises (`https://foo` would be
// silently dropped on the server).
function isUrlWithHost(value) {
  const sanitized = sanitizeUrl(value);
  if (!sanitized) return false;
  try {
    const u = new URL(sanitized);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.includes('.');
  } catch {
    return false;
  }
}

// Input-id map for both forms. Drives the validator, the error renderer,
// and the blur/input listeners — single source of truth so the two forms
// stay symmetric.
const FORM_FIELDS = {
  create: {
    name: 'create-group-name',
    symbol: 'create-group-symbol',
    description: 'create-group-description',
    website: 'create-website',
    linkLabel: 'create-link-label',
    linkUrl: 'create-link-url',
    groupType: 'create-group-type',
    membershipFee: 'create-membership-fee',
    minRepScore: 'create-min-rep-score',
    additionalCriteria: 'create-additional-criteria',
    contactEmail: 'create-contact-email',
    contactWebsite: 'create-contact-website',
  },
  profile: {
    description: 'profile-description',
    website: 'profile-website',
    linkLabel: 'profile-link-label',
    linkUrl: 'profile-link-url',
    groupType: 'profile-group-type',
    membershipFee: 'profile-membership-fee',
    minRepScore: 'profile-min-rep-score',
    additionalCriteria: 'profile-additional-criteria',
    contactEmail: 'profile-contact-email',
    contactWebsite: 'profile-contact-website',
  },
};

// Pure validator: input ids -> { ok, errors: { <input-id>: 'message' } }.
// No DOM writes; renderFieldError does that.
function validateGroupForm(scope) {
  const ids = FORM_FIELDS[scope];
  const val = (key) => (byId(ids[key])?.value || '').trim();
  const errors = {};

  if (scope === 'create') {
    const name = val('name');
    if (!name) errors[ids.name] = 'Group name is required.';
    else if (name.length > MAX_GROUP_NAME_LENGTH) errors[ids.name] = `Max ${MAX_GROUP_NAME_LENGTH} characters.`;

    const symbol = val('symbol').toUpperCase();
    if (!symbol) errors[ids.symbol] = 'Ticker is required.';
    else if (!TICKER_PATTERN.test(symbol)) errors[ids.symbol] = '2–8 uppercase letters or numbers.';
  }

  const description = val('description');
  if (!description) errors[ids.description] = 'Description is required.';
  else if (description.length > MAX_DESCRIPTION_LENGTH) errors[ids.description] = `Max ${MAX_DESCRIPTION_LENGTH} characters.`;

  const website = val('website');
  if (website && !isUrlWithHost(website)) errors[ids.website] = 'Enter a URL like https://example.org.';

  const linkLabel = val('linkLabel');
  const linkUrl = val('linkUrl');
  if (linkLabel && linkLabel.length > MAX_LINK_LABEL_LENGTH) {
    errors[ids.linkLabel] = `Max ${MAX_LINK_LABEL_LENGTH} characters.`;
  }
  if (linkLabel && !linkUrl) errors[ids.linkUrl] = 'Add the URL too, or clear the label.';
  if (linkUrl && !linkLabel) errors[ids.linkLabel] = 'Add a label, or clear the URL.';
  if (linkUrl && !isUrlWithHost(linkUrl) && !errors[ids.linkUrl]) {
    errors[ids.linkUrl] = 'Enter a URL like https://example.org.';
  }

  const feeRaw = val('membershipFee');
  if (feeRaw) {
    const fee = Number(feeRaw);
    if (!Number.isFinite(fee) || fee < 0 || fee > 100) {
      errors[ids.membershipFee] = 'Must be a number 0–100.';
    } else if (Math.round(fee * 100) !== fee * 100) {
      errors[ids.membershipFee] = 'Up to 2 decimals.';
    }
  }

  const repRaw = val('minRepScore');
  if (repRaw) {
    const rep = Number(repRaw);
    if (!Number.isFinite(rep) || rep < 0) errors[ids.minRepScore] = '0 or greater.';
  }

  const criteriaText = val('additionalCriteria');
  if (criteriaText) {
    const lines = criteriaText.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length > MAX_ADDITIONAL_CRITERIA) {
      errors[ids.additionalCriteria] = `Max ${MAX_ADDITIONAL_CRITERIA} criteria (one per line).`;
    } else if (lines.some((l) => l.length > MAX_CRITERION_LENGTH)) {
      errors[ids.additionalCriteria] = `Each criterion must be ${MAX_CRITERION_LENGTH} characters or fewer.`;
    }
  }

  const email = val('contactEmail');
  if (email && !isValidEmail(email)) errors[ids.contactEmail] = 'Enter a valid email address.';

  const contactWebsite = val('contactWebsite');
  if (contactWebsite && !isUrlWithHost(contactWebsite)) {
    errors[ids.contactWebsite] = 'Enter a URL like https://example.org.';
  }

  return { ok: Object.keys(errors).length === 0, errors };
}

function renderFieldError(inputEl, message) {
  if (!inputEl) return;
  inputEl.setAttribute('aria-invalid', 'true');
  inputEl.setAttribute('aria-describedby', `${inputEl.id}-error`);
  const errorEl = byId(`${inputEl.id}-error`);
  if (errorEl) {
    errorEl.textContent = message;
    errorEl.dataset.active = 'true';
  }
}

function clearFieldError(inputEl) {
  if (!inputEl) return;
  inputEl.removeAttribute('aria-invalid');
  inputEl.removeAttribute('aria-describedby');
  const errorEl = byId(`${inputEl.id}-error`);
  if (errorEl) {
    errorEl.textContent = '';
    delete errorEl.dataset.active;
  }
}

function clearAllFieldErrors(scope) {
  const ids = FORM_FIELDS[scope];
  if (!ids) return;
  Object.values(ids).forEach((id: any) => clearFieldError(byId(id)));
}

function applyFormErrors(scope, errors) {
  Object.entries(errors).forEach(([id, msg]) =>
    renderFieldError(byId(id), msg)
  );
  const firstId = Object.keys(errors)[0];
  if (firstId) byId(firstId)?.focus();
}

// Live character / item counter. formatFn defaults to "N / max" with N =
// value length; pass a custom formatter for item-counting (e.g. lines).
const formCounterRefreshers: { create: any[]; profile: any[] } = { create: [], profile: [] };

function attachCounter(inputEl, counterEl, max, scope, formatFn?) {
  if (!inputEl || !counterEl) return;
  const fmt = formatFn || ((v) => `${v.length} / ${max}`);
  const measure = formatFn
    ? (v) => {
        const n = parseInt(fmt(v), 10);
        return Number.isFinite(n) ? n : 0;
      }
    : (v) => v.length;
  const update = () => {
    const value = inputEl.value || '';
    counterEl.textContent = fmt(value);
    counterEl.classList.toggle('field-counter--over', measure(value) > max);
  };
  inputEl.addEventListener('input', update);
  if (scope && formCounterRefreshers[scope]) formCounterRefreshers[scope].push(update);
  update();
}

function refreshFormCounters(scope) {
  (formCounterRefreshers[scope] || []).forEach((fn) => fn());
}

// Blur/input wiring per form. Field becomes "touched" on first blur; once
// touched, the error redraws on every input so users see the fix land.
function attachFieldValidation(scope) {
  const ids = FORM_FIELDS[scope];
  if (!ids) return;
  Object.entries(ids).forEach(([, id]: [string, any]) => {
    const el = byId(id);
    if (!el) return;
    let touched = false;
    const revalidate = () => {
      const { errors } = validateGroupForm(scope);
      if (errors[id]) renderFieldError(el, errors[id]);
      else clearFieldError(el);
    };
    el.addEventListener('blur', () => {
      touched = true;
      revalidate();
    });
    el.addEventListener('input', () => {
      if (touched) revalidate();
    });
    if (el.tagName === 'SELECT') {
      el.addEventListener('change', () => {
        touched = true;
        revalidate();
      });
    }
  });
}

function readExternalLinkDraft(scope) {
  const source = scope === 'create' ? createExternalLink : profileExternalLink;
  return {
    label: String(source.label || '').trim(),
    url: sanitizeUrl(source.url),
  };
}

function extractExternalLinkFromDescription(markdown) {
  const source = String(markdown || '').trim();
  const match = source.match(
    /^(.*?)(?:\n{2,}|\n)?External link:\s*(?:\[(.*?)\]\((https?:\/\/[^\s)]+)\)|<(https?:\/\/[^>]+)>)\s*$/s
  );

  if (!match) {
    return {
      description: source,
      link: { label: '', url: '' },
    };
  }

  return {
    description: String(match[1] || '').trim(),
    link: {
      label: String(match[2] || '').trim(),
      url: String(match[3] || match[4] || '').trim(),
    },
  };
}

function formatExternalLinkMarkdown(link) {
  const { label, url } = link || {};
  const safeUrl = sanitizeUrl(url);
  if (!safeUrl) return '';
  const safeLabel = String(label || '').trim();
  const markdownLink = safeLabel ? `[${safeLabel}](${safeUrl})` : `<${safeUrl}>`;
  return `External link: ${markdownLink}`;
}

function buildDescriptionWithExternalLink(description, link) {
  const body = String(description || '').trim();
  const externalLinkMarkdown = formatExternalLinkMarkdown(link);
  if (!externalLinkMarkdown) return body;
  if (!body) return externalLinkMarkdown;
  return `${body}\n\n${externalLinkMarkdown}`;
}

function setExternalLinkDraft(scope, link) {
  const target = scope === 'create' ? createExternalLink : profileExternalLink;
  target.label = String(link?.label || '');
  target.url = String(link?.url || '');
}

function syncExternalLinkInputs(scope) {
  const link = scope === 'create' ? createExternalLink : profileExternalLink;
  const labelInput = scope === 'create' ? createLinkLabelInput : profileLinkLabelInput;
  const urlInput = scope === 'create' ? createLinkUrlInput : profileLinkUrlInput;
  if (labelInput) labelInput.value = link.label || '';
  if (urlInput) urlInput.value = link.url || '';
}

function handleExternalLinkInput(scope, field, value) {
  const target = scope === 'create' ? createExternalLink : profileExternalLink;
  target[field] = value;
}

function resetCreateForm() {
  createGroupNameInput.value = '';
  createGroupSymbolInput.value = '';
  createGroupDescriptionInput.value = '';
  setExternalLinkDraft('create', { label: '', url: '' });
  syncExternalLinkInputs('create');
  if (createWebsiteInput) createWebsiteInput.value = '';
  if (createGroupTypeSelect) createGroupTypeSelect.value = '';
  if (createMembershipFeeInput) createMembershipFeeInput.value = '';
  if (createMinRepScoreInput) createMinRepScoreInput.value = '';
  if (createAdditionalCriteriaInput) createAdditionalCriteriaInput.value = '';
  if (createContactEmailInput) createContactEmailInput.value = '';
  if (createContactWebsiteInput) createContactWebsiteInput.value = '';
  clearCreateImageSelection();
  clearAllFieldErrors('create');
  refreshFormCounters('create');
  updateCreateButtonState();
}

function updateCreateButtonState() {
  const hasName = createGroupNameInput.value.trim().length > 0;
  const hasSymbol = /^[A-Z0-9]{2,8}$/.test(createGroupSymbolInput.value.trim());
  const hasDescription = createGroupDescriptionInput.value.trim().length > 0;
  createGroupBtn.disabled =
    !connectedAddress || !hasName || !hasSymbol || !hasDescription || imageProcessing;
}

function renderImagePreview(wrap, imageEl, src) {
  if (!src) {
    imageEl.removeAttribute('src');
    wrap.classList.add('hidden');
    return;
  }

  imageEl.src = src;
  wrap.classList.remove('hidden');
}

function clearCreateImageSelection() {
  createImageDataUrl = '';
  if (createGroupImageInput) createGroupImageInput.value = '';
  if (createGroupImageFilenameEl) createGroupImageFilenameEl.textContent = 'No file chosen';
  renderImagePreview(createImagePreviewWrap, createImagePreview, '');
}

function getProfileImageSrc() {
  return profileImageSelectedDataUrl || profileImageSourceUrl || '';
}

function updateGroupCoverDisplay(src) {
  if (src) {
    groupCoverEl.style.backgroundImage = `url("${src}")`;
    groupCoverEl.classList.remove('hidden');
    return;
  }

  groupCoverEl.style.backgroundImage = '';
  groupCoverEl.classList.add('hidden');
}

function clearProfileImageSelection() {
  profileImageSelectedDataUrl = '';
  profileImageSourceUrl = '';
  if (profileImageInput) profileImageInput.value = '';
  if (profileImageFilenameEl) profileImageFilenameEl.textContent = 'No file chosen';
  renderImagePreview(profileImagePreviewWrap, profileImagePreview, '');
  updateGroupCoverDisplay('');
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
  return new Promise<HTMLImageElement>((resolve, reject) => {
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
  if (file.size > MAX_IMAGE_BYTES) {
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
  canvas.width = PREVIEW_IMAGE_DIMENSION;
  canvas.height = PREVIEW_IMAGE_DIMENSION;

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
  context.fillRect(0, 0, PREVIEW_IMAGE_DIMENSION, PREVIEW_IMAGE_DIMENSION);
  context.drawImage(
    sourceImage,
    sourceX,
    sourceY,
    squareSide,
    squareSide,
    0,
    0,
    PREVIEW_IMAGE_DIMENSION,
    PREVIEW_IMAGE_DIMENSION
  );

  for (const quality of PREVIEW_IMAGE_QUALITIES) {
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    if (getDataUrlByteLength(dataUrl) <= MAX_PREVIEW_IMAGE_BYTES) {
      return dataUrl;
    }
  }

  throw new Error('Could not compress image to 256x256 under 150KB.');
}

async function handleCreateImageChange() {
  const file = createGroupImageInput?.files?.[0];
  if (!file) {
    clearCreateImageSelection();
    updateCreateButtonState();
    return;
  }

  if (createGroupImageFilenameEl) createGroupImageFilenameEl.textContent = file.name;
  imageProcessing = true;
  updateCreateButtonState();

  try {
    createImageDataUrl = await convertImageFileToProfileDataUrl(file);
    renderImagePreview(createImagePreviewWrap, createImagePreview, createImageDataUrl);
    hideResult();
  } catch (err) {
    clearCreateImageSelection();
    showResult('error', `Could not prepare image: ${decodeError(err)}`);
  } finally {
    imageProcessing = false;
    updateCreateButtonState();
  }
}

async function handleProfileImageChange() {
  const file = profileImageInput?.files?.[0];
  if (!file) {
    if (profileImageFilenameEl) profileImageFilenameEl.textContent = 'No file chosen';
    renderImagePreview(profileImagePreviewWrap, profileImagePreview, getProfileImageSrc());
    return;
  }

  if (profileImageFilenameEl) profileImageFilenameEl.textContent = file.name;
  imageProcessing = true;
  saveProfileBtn.disabled = true;

  try {
    profileImageSelectedDataUrl = await convertImageFileToProfileDataUrl(file);
    renderImagePreview(profileImagePreviewWrap, profileImagePreview, getProfileImageSrc());
    hideResult();
  } catch (err) {
    showResult('error', `Could not prepare image: ${decodeError(err)}`);
  } finally {
    imageProcessing = false;
    saveProfileBtn.disabled = false;
  }
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

function getDeploymentAddress(deployment) {
  if (!deployment) throw new Error('Safe deployment metadata is missing.');
  const networkAddress = deployment.networkAddresses?.[String(gnosis.id)] || deployment.defaultAddress;
  if (!networkAddress) throw new Error('Safe deployment for this network is missing.');
  return getAddress(networkAddress);
}

function randomSaltNonce() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let value = 0n;
  for (const b of bytes) value = (value << 8n) + BigInt(b);
  return value.toString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForReceiptFromAnyRpc(hash) {
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
  throw new Error(`Timed out while waiting for transaction "${hash}" to confirm.${detail}`);
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
    if (!logs.length) return null;
    const txHash = logs[logs.length - 1]?.transactionHash;
    return txHash ? await client.getTransactionReceipt({ hash: txHash }) : null;
  } catch {
    return null;
  }
}

function waitForReceipts(hashes) {
  return Promise.all(hashes.map(waitForReceiptFromAnyRpc));
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

function createRunner(address) {
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

  return {
    address: safeAddress,
    async sendTransaction(txs) {
      const safeExecTxs = txs.map((tx) => buildSafeExecTransaction(ownerAddress, safeAddress, tx));

      const hashes = await sendTransactions(safeExecTxs.map(formatTxForHost));
      lastTxHashes = hashes;
      const receipts = await waitForReceipts(hashes);
      return receipts[receipts.length - 1];
    },
  };
}

function buildSafeExecTransaction(ownerAddress, safeAddress, tx) {
  const safeAbi = safeSingletonDeployment?.abi;
  if (!safeAbi) throw new Error('Safe singleton ABI is unavailable.');

  const signature = buildPrevalidatedSignature(ownerAddress);
  return {
    to: safeAddress,
    value: 0n,
    data: encodeFunctionData({
      abi: safeAbi,
      functionName: 'execTransaction',
      args: [
        tx.to,
        tx.value ? BigInt(tx.value) : 0n,
        tx.data || '0x',
        0,
        0n,
        0n,
        0n,
        zeroAddress,
        zeroAddress,
        signature,
      ],
    }),
  };
}

async function readSafeOwnersAndThreshold(safeAddress) {
  const safeAbi = safeSingletonDeployment?.abi;
  if (!safeAbi) throw new Error('Safe singleton ABI is unavailable.');

  const [owners, threshold] = await Promise.all([
    publicClient.readContract({
      address: getAddress(safeAddress),
      abi: safeAbi,
      functionName: 'getOwners',
    }),
    publicClient.readContract({
      address: getAddress(safeAddress),
      abi: safeAbi,
      functionName: 'getThreshold',
    }),
  ]);

  return {
    owners: normalizeAddressList((owners as any[]) || []),
    threshold: Number(threshold),
  };
}

function renderOwnerSafeOwners() {
  if (!ownerSafeOwners.length) {
    ownerSafeOwnersListEl.innerHTML = '<p class="muted">No Group Admins found.</p>';
    return;
  }

  ownerSafeOwnersListEl.innerHTML = ownerSafeOwners
    .map((owner) => {
      const isConnectedOwner =
        connectedAddress && owner.toLowerCase() === connectedAddress.toLowerCase();
      return `
        <div class="list-row search-result-row">
          <div class="list-row-main">
            <div class="list-row-title mono">${escapeHtml(owner)}</div>
            <div class="list-row-meta">${isConnectedOwner ? 'Connected wallet' : 'Group admin'}</div>
          </div>
        </div>
      `;
    })
    .join('');
}

async function loadOwnerSafeDetails() {
  if (!activeOwnerSafe || !isAddress(activeOwnerSafe)) {
    resetOwnerSafeState();
    ownerSafeOwnersListEl.innerHTML = '<p class="muted">This group does not expose an owner Safe.</p>';
    return;
  }

  const requestId = ++ownerSafeDetailsLoadRequestId;
  ownerSafeOwnersListEl.innerHTML = '<p class="muted">Loading Group Admins…</p>';

  try {
    const { owners, threshold } = await readSafeOwnersAndThreshold(activeOwnerSafe);
    if (requestId !== ownerSafeDetailsLoadRequestId) return;

    ownerSafeOwners = owners;
    ownerSafeThreshold = threshold;
    renderOwnerSafeOwners();
  } catch (err) {
    if (requestId !== ownerSafeDetailsLoadRequestId) return;

    ownerSafeOwners = [];
    ownerSafeThreshold = null;
    ownerSafeOwnersListEl.innerHTML = `<p class="muted">Could not load Group Admins: ${escapeHtml(decodeError(err))}</p>`;
  }
}

function renderMembershipConditions() {
  if (!membershipConditionsListEl) return;

  if (!activeMembershipConditions.length) {
    membershipConditionsListEl.innerHTML = '<p class="muted">No active membership conditions.</p>';
    return;
  }

  membershipConditionsListEl.innerHTML = activeMembershipConditions
    .map(
      (condition) => `
        <div class="list-row search-result-row">
          <div class="list-row-main">
            <div class="list-row-title mono">${escapeHtml(condition)}</div>
            <div class="list-row-meta">Enabled membership condition</div>
          </div>
        </div>
      `
    )
    .join('');
}

async function loadMembershipConditions() {
  if (!activeGroupAvatar?.baseGroup || !membershipConditionsListEl) {
    resetMembershipConditionsState();
    return;
  }

  membershipConditionsListEl.innerHTML = '<p class="muted">Loading membership conditions…</p>';

  try {
    const conditions = await activeGroupAvatar.baseGroup.getMembershipConditions();
    activeMembershipConditions = normalizeAddressList(conditions || []);
    renderMembershipConditions();
  } catch (err) {
    activeMembershipConditions = [];
    membershipConditionsListEl.innerHTML =
      `<p class="muted">Could not load membership conditions: ${escapeHtml(decodeError(err))}</p>`;
  }
}

function normalizeGroupMeta(group) {
  return {
    ...group,
    group: getAddress(group.group),
    owner: isAddress(group.owner) ? getAddress(group.owner) : group.owner,
    treasury: group.treasury && isAddress(group.treasury) ? getAddress(group.treasury) : '',
    mintHandler: group.mintHandler && isAddress(group.mintHandler) ? getAddress(group.mintHandler) : '',
    service: group.service && isAddress(group.service) ? getAddress(group.service) : '',
    feeCollection:
      group.feeCollection && isAddress(group.feeCollection) ? getAddress(group.feeCollection) : '',
  };
}

function getResolvedGroupMeta(groupAddress) {
  return activeGroups.find((entry) => entry.group.toLowerCase() === groupAddress.toLowerCase()) || null;
}

function getNameOrAddress(item) {
  return item?.name || item?.group || 'Unknown';
}

function normalizeMemberCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? count : null;
}

function setActiveMemberCount(count) {
  activeMemberCount = normalizeMemberCount(count);
  if (activeGroupMeta && activeMemberCount !== null) {
    activeGroupMeta.memberCount = activeMemberCount;
  }

  groupMemberCountDisplay.textContent = activeMemberCount === null ? '—' : String(activeMemberCount);
}

function setAffiliateCountDisplay(count) {
  if (count === 'loading') {
    groupAffiliateCountDisplay.textContent = '…';
    return;
  }

  const normalized = normalizeMemberCount(count);
  groupAffiliateCountDisplay.textContent = normalized === null ? '—' : String(normalized);
}

function setGroupTreasuryBalanceDisplay(value) {
  groupFeeBalanceDisplay.textContent = String(value || '—');
}

function normalizeGroups(groups) {
  return (groups || [])
    .filter((group) => group?.group && isAddress(group.group))
    .map(normalizeGroupMeta)
    .sort((a, b) => getNameOrAddress(a).localeCompare(getNameOrAddress(b)));
}

function mergeGroups(...groupLists) {
  const merged = new Map();
  for (const list of groupLists) {
    for (const group of list || []) {
      if (!group?.group) continue;
      merged.set(group.group.toLowerCase(), group);
    }
  }

  return Array.from(merged.values()).sort((a, b) => getNameOrAddress(a).localeCompare(getNameOrAddress(b)));
}

async function fetchGroupsByOwners(ownerIn) {
  if (!humanSdk || !ownerIn.length) return [];
  const page = await humanSdk.rpc.group.findGroups(GROUP_PAGE_LIMIT, {
    ownerIn: normalizeAddressList(ownerIn),
  });
  return normalizeGroups(page?.results || []);
}

async function loadAllPages(query, maxPages = 6) {
  const rows: any[] = [];
  for (let page = 0; page < maxPages; page += 1) {
    const hasPage = await query.queryNextPage();
    if (!hasPage || !query.currentPage) break;
    rows.push(...query.currentPage.results);
    if (!query.currentPage.hasMore) break;
  }
  return rows;
}

function getMemberSearchAvatarTypes() {
  return memberIncludeV1Input?.checked
    ? MEMBER_SEARCH_V1_AND_V2_AVATAR_TYPES
    : MEMBER_SEARCH_V2_AVATAR_TYPES;
}

async function resolveAddress(rawInput, options: any = {}) {
  const { avatarTypes } = options;
  const query = String(rawInput || '').trim();
  if (!query) throw new Error('Enter a Circles address or searchable name.');
  try {
    return parseAddressInput(query);
  } catch { }
  if (!humanSdk) throw new Error('Connected account is not ready.');

  const response = await humanSdk.rpc.profile.searchByAddressOrName(query, 20, null, avatarTypes);
  const results = response?.results || [];
  const exactMatch = results.find((entry) => {
    const name = String(entry?.name || '').trim().toLowerCase();
    const registeredName = String(entry?.registeredName || '').trim().toLowerCase();
    return name === query.toLowerCase() || registeredName === query.toLowerCase();
  });
  const chosen = exactMatch || results.find((entry) => entry?.address && isAddress(entry.address));
  if (!chosen?.address) throw new Error('No matching Circles avatar found.');
  return getAddress(chosen.address);
}

async function loadAdminGroups(preserveResult = false) {
  if (!connectedAddress || !humanSdk) return;

  const loadRequestId = ++adminGroupsLoadRequestId;
  hideAllSections();
  if (!preserveResult) hideResult();
  setStatus('Loading groups…', 'pending');
  groupsListEl.innerHTML = `
    <div class="empty-state">
      <span class="empty-state-icon" aria-hidden="true">⏳</span>
      <p class="empty-state-copy">Loading groups…</p>
    </div>
  `;
  showGroupsView(true);

  let directGroups = [];
  try {
    directGroups = await fetchGroupsByOwners([connectedAddress]);
    if (loadRequestId !== adminGroupsLoadRequestId) return;

    activeGroups = directGroups;
    renderGroupsList();
    if (currentView === 'groups') {
      showGroupsView(true);
    }
  } catch (err) {
    if (loadRequestId !== adminGroupsLoadRequestId) return;

    activeGroups = [];
    renderGroupsList();
    if (currentView === 'groups') {
      showGroupsView(true);
      showResult('error', `Could not load directly owned groups: ${decodeError(err)}`);
    }
  }

  try {
    if (loadRequestId !== adminGroupsLoadRequestId) return;

    const sessionSafes = getSessionOwnerSafes(connectedAddress);
    const serviceSafes = await fetchOwnerSafeCandidates(SAFE_TX_SERVICE_URL, connectedAddress);
    if (loadRequestId !== adminGroupsLoadRequestId) return;

    const allSafes = normalizeAddressList([...serviceSafes, ...sessionSafes]);
    if (!allSafes.length) {
      if (currentView === 'groups') {
        setStatus('Connected', 'success');
      }
      return;
    }

    const verifiedSafes = await getVerifiedOwnerSafes(
      publicClient,
      safeSingletonDeployment?.abi,
      allSafes,
      connectedAddress
    );
    if (loadRequestId !== adminGroupsLoadRequestId) return;

    setSessionOwnerSafes(connectedAddress, verifiedSafes);
    if (!verifiedSafes.length) {
      if (currentView === 'groups') {
        setStatus('Connected', 'success');
      }
      return;
    }

    const safeGroups = await fetchGroupsByOwners(verifiedSafes);
    if (loadRequestId !== adminGroupsLoadRequestId) return;

    activeGroups = mergeGroups(directGroups, safeGroups);
    renderGroupsList();
    if (currentView === 'groups') {
      showGroupsView(true);
      setStatus('Connected', 'success');
    }
  } catch (err) {
    if (loadRequestId !== adminGroupsLoadRequestId) return;

    activeGroups = directGroups;
    renderGroupsList();
    if (currentView === 'groups') {
      showGroupsView(true);
      setStatus('Connected', 'success');
      showResult('error', `Could not load Safe-backed groups: ${decodeError(err)}`);
    }
  }
}

async function hydrateGroupListImages() {
  if (!humanSdk || !activeGroups.length) return;

  const missingGroups = activeGroups.filter((group) => !groupPreviewImageByAddress.has(group.group.toLowerCase()));
  if (!missingGroups.length) return;

  await Promise.all(
    missingGroups.map(async (group) => {
      try {
        const profile = await humanSdk.rpc.profile.getProfileByAddress(group.group);
        const imageUrl = String(profile?.previewImageUrl || profile?.imageUrl || '').trim();
        groupPreviewImageByAddress.set(group.group.toLowerCase(), imageUrl || null);
      } catch {
        groupPreviewImageByAddress.set(group.group.toLowerCase(), null);
      }
    })
  );

  renderGroupsList();
}

function renderGroupsList() {
  if (!activeGroups.length) {
    groupsListEl.innerHTML = `
      <div class="empty-state">
        <span class="empty-state-icon" aria-hidden="true">🌱</span>
        <span class="empty-state-title">No groups yet</span>
        <p class="empty-state-copy">You don't administer any groups on this wallet. Spin up your first one to get started.</p>
        <button type="button" class="btn-tonal" data-empty-create="1">+ Create your first group</button>
      </div>
    `;
    return;
  }

  groupsListEl.innerHTML = activeGroups
    .map((group) => {
      const subtitle = group.symbol || group.group;
      const previewImage = groupPreviewImageByAddress.get(group.group.toLowerCase()) || '';
      return `
        <div class="list-row group-list-row">
          <div class="group-list-info">
            <div class="group-list-avatar"${previewImage ? ` style="background-image: url('${escapeHtml(previewImage)}')"` : ''}></div>
            <div class="list-row-main group-list-main">
              <div class="list-row-title">${escapeHtml(group.name || group.group)}</div>
              <div class="list-row-meta">${escapeHtml(subtitle)}</div>
              <div class="list-row-meta mono group-list-address">${escapeHtml(group.group)}</div>
            </div>
          </div>
          <div class="list-row-action">
            <button class="open-group-btn btn-inline" data-group="${escapeHtml(group.group)}">Open</button>
          </div>
        </div>
      `;
    })
    .join('');

  void hydrateGroupListImages();
}

async function createGroup() {
  clearAllFieldErrors('create');
  const { ok, errors } = validateGroupForm('create');
  if (!ok) {
    applyFormErrors('create', errors);
    return;
  }
  if (!connectedAddress || !humanSdk) {
    showResult('error', 'Connect a wallet first.');
    return;
  }

  const rawName = createGroupNameInput.value.trim();
  const symbol = createGroupSymbolInput.value.trim().toUpperCase();
  const description = createGroupDescriptionInput.value.trim();

  const { extras } = collectGroupProfileExtras({
    website: createWebsiteInput,
    groupType: createGroupTypeSelect,
    membershipFee: createMembershipFeeInput,
    minRepScore: createMinRepScoreInput,
    additionalCriteria: createAdditionalCriteriaInput,
    contactEmail: createContactEmailInput,
    contactWebsite: createContactWebsiteInput,
  });

  const profile = {
    name: rawName,
    description: buildDescriptionWithExternalLink(description, readExternalLinkDraft('create')) || undefined,
    previewImageUrl: createImageDataUrl || undefined,
    ...extras,
  };

  createGroupBtn.disabled = true;
  const restoreCreateBtn = setButtonLoading(createGroupBtn, 'Creating…');
  showResult('pending', 'Preparing owner Safe, group Safe, and group deployment…');

  try {
    const safeAbi = safeSingletonDeployment?.abi;
    if (!safeAbi) throw new Error('Safe deployment metadata unavailable.');
    const proxyFactoryAbi = proxyFactoryDeployment?.abi;
    if (!proxyFactoryAbi) throw new Error('Safe proxy factory deployment metadata unavailable.');

    const profileCid = await humanSdk.profiles.create(profile);
    const metadataDigest = cidV0ToHex(profileCid);

    const ownerSaltNonce = randomSaltNonce();
    const safeSingletonAddress = getDeploymentAddress(safeSingletonDeployment);
    const proxyFactoryAddress = getDeploymentAddress(proxyFactoryDeployment);
    const fallbackHandlerAddress = getDeploymentAddress(compatibilityFallbackHandlerDeployment);

    const ownerSafeSetupData = encodeFunctionData({
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
    const deployOwnerSafeData = encodeFunctionData({
      abi: proxyFactoryAbi,
      functionName: 'createProxyWithNonce',
      args: [safeSingletonAddress, ownerSafeSetupData, BigInt(ownerSaltNonce)],
    });

    const ownerDeploymentPreflight = await publicClient.call({
      to: proxyFactoryAddress,
      data: deployOwnerSafeData,
      account: connectedAddress,
    });
    const predictedOwnerSafe = getAddress(
      decodeFunctionResult({
        abi: proxyFactoryAbi,
        functionName: 'createProxyWithNonce',
        data: ownerDeploymentPreflight.data as `0x${string}`,
      }) as string
    );

    const groupSafeSaltNonce = randomSaltNonce();
    const groupSafeSetupData = encodeFunctionData({
      abi: safeAbi,
      functionName: 'setup',
      args: [
        [predictedOwnerSafe],
        1n,
        zeroAddress,
        '0x',
        fallbackHandlerAddress,
        zeroAddress,
        0n,
        zeroAddress,
      ],
    });
    const deployGroupSafeData = encodeFunctionData({
      abi: proxyFactoryAbi,
      functionName: 'createProxyWithNonce',
      args: [safeSingletonAddress, groupSafeSetupData, BigInt(groupSafeSaltNonce)],
    });

    const groupSafeDeploymentPreflight = await publicClient.call({
      to: proxyFactoryAddress,
      data: deployGroupSafeData,
      account: predictedOwnerSafe,
    });
    const predictedGroupSafe = getAddress(
      decodeFunctionResult({
        abi: proxyFactoryAbi,
        functionName: 'createProxyWithNonce',
        data: groupSafeDeploymentPreflight.data as `0x${string}`,
      }) as string
    );

    const createGroupTx = humanSdk.core.baseGroupFactory.createBaseGroup(
      predictedOwnerSafe,
      predictedOwnerSafe,
      predictedOwnerSafe,
      [],
      rawName,
      symbol,
      metadataDigest
    );

    await preflightEthCall({
      label: 'Group creation',
      to: createGroupTx.to,
      data: createGroupTx.data,
      value: createGroupTx.value || 0n,
      account: predictedOwnerSafe,
    });

    const batchedTransactions = [
      formatTxForHost({
        to: proxyFactoryAddress,
        data: deployOwnerSafeData,
        value: 0n,
      }),
      formatTxForHost(
        buildSafeExecTransaction(connectedAddress, predictedOwnerSafe, {
          to: proxyFactoryAddress,
          data: deployGroupSafeData,
          value: 0n,
        })
      ),
      formatTxForHost(buildSafeExecTransaction(connectedAddress, predictedOwnerSafe, createGroupTx)),
    ];

    showResult('pending', 'Deploying both Safes and creating the group in one approval…');
    lastTxHashes = await sendTransactions(batchedTransactions);
    const receipts = await waitForReceipts(lastTxHashes);

    let resolvedOwnerSafe = predictedOwnerSafe;
    let resolvedGroupSafe = predictedGroupSafe;
    let resolvedGroupAddress: any = null;

    for (const receipt of receipts) {
      if (!receipt) continue;
      for (const log of receipt.logs || []) {
        try {
          const proxyDecoded = decodeEventLog({
            abi: [PROXY_CREATION_EVENT],
            data: log.data,
            topics: log.topics,
            strict: false,
          });
          if (proxyDecoded?.eventName === 'ProxyCreation' && proxyDecoded.args?.proxy) {
            const addr = getAddress(proxyDecoded.args.proxy);
            if (resolvedOwnerSafe === predictedOwnerSafe) {
              resolvedOwnerSafe = addr;
            } else if (resolvedGroupSafe === predictedGroupSafe) {
              resolvedGroupSafe = addr;
            }
          }
        } catch { }
        if (!resolvedGroupAddress) {
          try {
            const groupDecoded = decodeEventLog({
              abi: [BASE_GROUP_CREATED_EVENT],
              data: log.data,
              topics: log.topics,
              strict: false,
            });
            if (groupDecoded?.eventName === 'BaseGroupCreated' && groupDecoded.args?.group) {
              resolvedGroupAddress = getAddress(groupDecoded.args.group);
            }
          } catch { }
        }
      }
    }

    if (!resolvedGroupAddress) {
      throw new Error('Group creation was submitted but no BaseGroupCreated event was found.');
    }

    addSessionOwnerSafe(connectedAddress, resolvedOwnerSafe);
    const links = lastTxHashes.length ? `<br>${txLinks(lastTxHashes)}` : '';
    showResult(
      'success',
      `Group created: <a href="${explorerAvatarUrl(resolvedGroupAddress)}" target="_blank" rel="noopener">${resolvedGroupAddress}</a><br><span class="muted">Owner Safe:</span> ${resolvedOwnerSafe}<br><span class="muted">Group Safe:</span> ${resolvedGroupSafe}${links}`
    );

    resetCreateForm();
    await loadAdminGroups(true);
    await openGroup(resolvedGroupAddress, true);
  } catch (err) {
    if (isPasskeyAutoConnectError(err)) {
      showResult(
        'error',
        'Passkey auto-connect failed in the host app. Re-open wallet connect and choose the same wallet again, then retry group creation.'
      );
    } else {
      showResult('error', `Group creation failed: ${decodeError(err)}`);
    }
  } finally {
    restoreCreateBtn();
    updateCreateButtonState();
  }
}

async function populateProfileEditor() {
  if (!activeGroupAvatar) return;

  const profile = await activeGroupAvatar.profile.get().catch(() => undefined);
  const extracted = extractExternalLinkFromDescription(profile?.description);
  const fallbackLink = Array.isArray(profile?.extensions?.links) ? profile.extensions.links[0] : null;
  const resolvedLink = {
    label: extracted.link.label || String(fallbackLink?.label || ''),
    url: extracted.link.url || String(fallbackLink?.url || ''),
  };
  profileDescriptionInput.value = extracted.description;
  renderMarkdown(groupDescriptionDisplay, buildDescriptionWithExternalLink(extracted.description, resolvedLink));

  if (activeGroupMeta?.group) {
    const imageUrl = String(profile?.previewImageUrl || profile?.imageUrl || '').trim();
    groupPreviewImageByAddress.set(activeGroupMeta.group.toLowerCase(), imageUrl || null);
  }

  profileImageSourceUrl = String(profile?.previewImageUrl || '');
  profileImageSelectedDataUrl = '';
  renderImagePreview(profileImagePreviewWrap, profileImagePreview, getProfileImageSrc());
  updateGroupCoverDisplay(getProfileImageSrc());

  setExternalLinkDraft('profile', resolvedLink);
  syncExternalLinkInputs('profile');

  const groupFields = readGroupProfileFields(profile);
  if (profileWebsiteInput) profileWebsiteInput.value = groupFields.website || '';
  if (profileContactEmailInput) profileContactEmailInput.value = groupFields.contactEmail || '';
  if (profileContactWebsiteInput) {
    profileContactWebsiteInput.value = groupFields.contactWebsite || '';
  }
  if (profileMembershipFeeInput) {
    profileMembershipFeeInput.value =
      groupFields.membershipFee == null ? '' : String(groupFields.membershipFee);
  }
  if (profileMinRepScoreInput) {
    profileMinRepScoreInput.value =
      groupFields.minRepScore == null ? '' : String(groupFields.minRepScore);
  }
  if (profileAdditionalCriteriaInput) {
    profileAdditionalCriteriaInput.value = (groupFields.additionalCriteria || []).join('\n');
  }
  setGroupTypeSelectValue(groupFields.groupType);
  clearAllFieldErrors('profile');
  refreshFormCounters('profile');
}

async function loadAffiliateCount(groupAddress) {
  setAffiliateCountDisplay('loading');
  try {
    const res = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'circles_query',
        params: [{
          Namespace: 'V_CrcV2',
          Table: 'AffiliateMembersCount_1h',
          Columns: ['value'],
          Filter: [{
            Type: 'FilterPredicate',
            FilterType: 'Equals',
            Column: 'group',
            Value: groupAddress.toLowerCase(),
          }],
          Order: [{ Column: 'timestamp', SortOrder: 'DESC' }],
          Limit: 1,
        }],
      }),
    });
    const json = await res.json();
    const count = Number(json?.result?.rows?.[0]?.[0] || 0);
    setAffiliateCountDisplay(count);
  } catch {
    setAffiliateCountDisplay(null);
  }
}

function getMembersTotalCount() {
  if (!membersHasMorePages && memberPages.length > 0) {
    return cachedMembers.length;
  }

  return activeMemberCount ?? cachedMembers.length;
}

function updateMembersToolbar() {
  const totalCount = getMembersTotalCount();
  setActiveMemberCount(totalCount);
  membersTotalCountEl.textContent = `${totalCount} member${totalCount === 1 ? '' : 's'}`;
  membersPageLabelEl.textContent = `Page ${currentMembersPageIndex + 1}`;
  membersPrevBtn.disabled = currentMembersPageIndex === 0;
  membersNextBtn.disabled = !membersHasMorePages && currentMembersPageIndex >= memberPages.length - 1;
}

async function hydrateMemberNames(rows) {
  await Promise.all(
    rows.map(async (row) => {
      const key = row.member.toLowerCase();
      if (memberNamesByAddress.has(key)) return;

      try {
        const profile = await humanSdk.rpc.profile.getProfileByAddress(row.member);
        const name = String(profile?.name || profile?.registeredName || '').trim();
        memberNamesByAddress.set(key, name || row.member);
      } catch {
        memberNamesByAddress.set(key, row.member);
      }
    })
  );
}

function renderMembersPage() {
  updateMembersToolbar();

  const rows = memberPages[currentMembersPageIndex] || [];
  if (!rows.length) {
    membersListEl.innerHTML = '<p class="muted">No members yet.</p>';
    updateMembersSelectionUI();
    return;
  }

  membersListEl.innerHTML = rows
    .map((row) => {
      const memberLabel = memberNamesByAddress.get(row.member.toLowerCase()) || row.member;
      const key = row.member.toLowerCase();
      const checked = selectedMembers.has(key) ? 'checked' : '';
      return `
        <div class="list-row search-result-row member-row">
          <label class="member-row-select checkbox-inline">
            <input type="checkbox" class="member-select-checkbox" data-member="${escapeHtml(row.member)}" ${checked} />
          </label>
          <div class="list-row-main">
            <div class="list-row-title">${escapeHtml(memberLabel)}</div>
            <div class="list-row-meta mono">${escapeHtml(row.member)}</div>
          </div>
          <button class="remove-member-btn btn-tonal" data-member="${escapeHtml(row.member)}">Remove</button>
        </div>
      `;
    })
    .join('');

  membersListEl.querySelectorAll('.remove-member-btn').forEach((button) => {
    button.addEventListener('click', () => removeMembers([button.dataset.member]));
  });

  membersListEl.querySelectorAll('.member-select-checkbox').forEach((input) => {
    input.addEventListener('change', () => {
      const key = String(input.dataset.member || '').toLowerCase();
      if (!key) return;
      if (input.checked) selectedMembers.add(key);
      else selectedMembers.delete(key);
      updateMembersSelectionUI();
    });
  });

  updateMembersSelectionUI();
}

function getCurrentMemberPageAddresses() {
  const rows = memberPages[currentMembersPageIndex] || [];
  return rows.map((row) => row.member);
}

function updateMembersSelectionUI() {
  if (!membersSelectionToolbarEl) return;

  const pageAddresses = getCurrentMemberPageAddresses();
  const hasRows = pageAddresses.length > 0;

  if (!hasRows && selectedMembers.size === 0) {
    membersSelectionToolbarEl.classList.add('hidden');
  } else {
    membersSelectionToolbarEl.classList.remove('hidden');
  }

  const pageKeysSelected = pageAddresses.filter((addr) =>
    selectedMembers.has(addr.toLowerCase())
  ).length;

  if (membersSelectAllInput) {
    membersSelectAllInput.disabled = !hasRows;
    membersSelectAllInput.checked = hasRows && pageKeysSelected === pageAddresses.length;
    membersSelectAllInput.indeterminate =
      pageKeysSelected > 0 && pageKeysSelected < pageAddresses.length;
  }

  const totalSelected = selectedMembers.size;
  if (membersSelectionCountEl) {
    membersSelectionCountEl.textContent = `${totalSelected} selected`;
  }
  if (membersRemoveSelectedBtn) {
    membersRemoveSelectedBtn.disabled = totalSelected === 0;
    membersRemoveSelectedBtn.textContent =
      totalSelected > 1 ? `Remove ${totalSelected} selected` : 'Remove selected';
  }
}

async function fetchNextMembersPage(group) {
  const page = await humanSdk.groups.getMembers(group, MEMBER_PAGE_LIMIT, membersNextCursor);
  const pageRows = page?.results || [];
  memberPages.push(pageRows);
  cachedMembers.push(...pageRows);
  await hydrateMemberNames(pageRows);
  membersNextCursor = page?.nextCursor ?? null;
  membersHasMorePages = Boolean(page?.hasMore);
  return pageRows;
}

async function ensureMembersPage(pageIndex) {
  if (!membersPagingActive) return false;
  if (memberPages[pageIndex]) return true;

  const group = activeGroupMeta?.group;
  if (!group) return false;

  while (memberPages.length <= pageIndex) {
    const pageRows = await fetchNextMembersPage(group);

    if (!membersHasMorePages && memberPages.length <= pageIndex && pageRows.length === 0) {
      return false;
    }

    // No more pages to fetch from the server; stop looping so we don't re-fetch
    // page 0 with a null cursor.
    if (!membersHasMorePages) break;
  }

  return Boolean(memberPages[pageIndex]);
}

async function goToMembersPage(pageIndex) {
  if (pageIndex < 0) return;

  membersListEl.innerHTML = '<p class="muted">Loading members…</p>';
  const ready = await ensureMembersPage(pageIndex);
  if (!ready) {
    renderMembersPage();
    return;
  }

  currentMembersPageIndex = pageIndex;
  renderMembersPage();
}

async function loadMembers() {
  if (!humanSdk || !activeGroupMeta) return;

  const groupAddress = activeGroupMeta.group;
  const requestId = ++membersLoadRequestId;
  cachedMembers = [];
  memberPages = [];
  memberNamesByAddress = new Map();
  membersHasMorePages = false;
  currentMembersPageIndex = 0;
  selectedMembers = new Set();
  membersNextCursor = null;
  membersPagingActive = true;
  loadedMembersGroupAddress = null;
  membersListEl.innerHTML = '<p class="muted">Loading members…</p>';
  updateMembersToolbar();

  try {
    await goToMembersPage(0);
    if (requestId !== membersLoadRequestId || activeGroupMeta?.group !== groupAddress) return;
    loadedMembersGroupAddress = groupAddress;
    if (!membersHasMorePages) {
      setActiveMemberCount(cachedMembers.length);
      updateMembersToolbar();
    }
  } catch (err) {
    if (requestId !== membersLoadRequestId || activeGroupMeta?.group !== groupAddress) return;
    membersListEl.innerHTML = `<p class="muted">Could not load members: ${escapeHtml(decodeError(err))}</p>`;
  }
}

function clearOwnerSafeSearchResults(message = '') {
  ownerSafeSearchResultsEl.innerHTML = message ? `<p class="muted">${escapeHtml(message)}</p>` : '';
}

function renderOwnerSafeSearchResults(results) {
  if (!results || !results.length) {
    clearOwnerSafeSearchResults('No matches found.');
    return;
  }

  const entries = results
    .filter((entry) => entry?.address && isAddress(entry.address))
    .slice(0, 10);

  ownerSafeSearchResultsEl.innerHTML = entries
    .map((entry) => {
      const address = getAddress(entry.address);
      const isAlreadyOwner = ownerSafeOwners.some(
        (owner) => owner.toLowerCase() === address.toLowerCase()
      );
      return `
        <div class="list-row search-result-row">
          <div class="list-row-main">
            <div class="list-row-title">${escapeHtml(entry.name || entry.registeredName || address)}</div>
            <div class="list-row-meta mono">${escapeHtml(address)}</div>
          </div>
          <div class="list-row-action-stack">
            <span class="chip">${isAlreadyOwner ? 'Admin' : 'Not an admin'}</span>
            <button class="pick-owner-safe-btn btn-inline" data-owner="${escapeHtml(address)}" ${isAlreadyOwner ? 'disabled' : ''}>
              ${isAlreadyOwner ? 'Added' : 'Add'}
            </button>
          </div>
        </div>
      `;
    })
    .join('');

  ownerSafeSearchResultsEl.querySelectorAll('.pick-owner-safe-btn').forEach((button) => {
    button.addEventListener('click', () => {
      addOwnerInput.value = button.dataset.owner || '';
      void addOwnerToOwnerSafe(button.dataset.owner || '');
    });
  });
}

async function updateOwnerSafeSearchResults() {
  const query = addOwnerInput.value.trim();
  if (ownerSearchDebounceTimer) {
    clearTimeout(ownerSearchDebounceTimer);
    ownerSearchDebounceTimer = null;
  }

  if (!query || query.length < 2) {
    clearOwnerSafeSearchResults();
    return;
  }

  if (looksLikeAddressInput(query)) {
    clearOwnerSafeSearchResults('Address detected. Click to Add Admin.');
    return;
  }

  const requestId = ++ownerSearchRequestId;
  clearOwnerSafeSearchResults('Searching…');
  ownerSearchDebounceTimer = setTimeout(async () => {
    try {
      if (!humanSdk) return;
      const response = await humanSdk.rpc.profile.searchByAddressOrName(query, 20, null);
      if (requestId !== ownerSearchRequestId) return;
      renderOwnerSafeSearchResults(response?.results || []);
    } catch {
      if (requestId !== ownerSearchRequestId) return;
      clearOwnerSafeSearchResults('Search failed. Try again.');
    } finally {
      if (requestId === ownerSearchRequestId) ownerSearchDebounceTimer = null;
    }
  }, 180);
}

function clearMemberSearchResults(message = '') {
  memberSearchResultsEl.innerHTML = message ? `<p class="muted">${escapeHtml(message)}</p>` : '';
}

async function renderMemberSearchResults(results) {
  if (!results || !results.length) {
    clearMemberSearchResults('No matches found.');
    return;
  }

  const entries = results
    .filter((entry) => entry?.address && isAddress(entry.address))
    .slice(0, 10);

  const statuses = await Promise.all(
    entries.map(async (entry) => {
      const address = getAddress(entry.address);
      const cachedStatus = cachedMembers.some(
        (member) => member.member.toLowerCase() === address.toLowerCase()
      );
      if (cachedStatus || !activeGroupAvatar) {
        return { address, isAlreadyMember: cachedStatus };
      }

      try {
        return {
          address,
          isAlreadyMember: await activeGroupAvatar.trust.isTrusting(address),
        };
      } catch {
        return { address, isAlreadyMember: false };
      }
    })
  );

  const statusByAddress = new Map(
    statuses.map((entry) => [entry.address.toLowerCase(), entry.isAlreadyMember])
  );

  memberSearchResultsEl.innerHTML = entries
    .map((entry) => {
      const address = getAddress(entry.address);
      const isAlreadyMember = statusByAddress.get(address.toLowerCase()) || false;
      return `
        <div class="list-row search-result-row">
          <div class="list-row-main">
            <div class="list-row-title">${escapeHtml(entry.name || entry.registeredName || address)}</div>
            <div class="list-row-meta mono">${escapeHtml(address)}</div>
          </div>
          <div class="list-row-action-stack">
            <span class="chip">${isAlreadyMember ? 'Member' : 'Not a member'}</span>
            <button class="pick-member-btn btn-inline" data-member="${escapeHtml(address)}" ${isAlreadyMember ? 'disabled' : ''}>
              ${isAlreadyMember ? 'Added' : 'Add'}
            </button>
          </div>
        </div>
      `;
    })
    .join('');

  memberSearchResultsEl.querySelectorAll('.pick-member-btn').forEach((button) => {
    button.addEventListener('click', () => addMember(button.dataset.member));
  });
}

async function updateMemberSearchResults() {
  const query = memberQueryInput.value.trim();
  const avatarTypes = getMemberSearchAvatarTypes();
  if (memberSearchDebounceTimer) {
    clearTimeout(memberSearchDebounceTimer);
    memberSearchDebounceTimer = null;
  }

  if (!query || query.length < 2) {
    clearMemberSearchResults();
    return;
  }

  if (looksLikeAddressInput(query)) {
    clearMemberSearchResults('Address detected. Click Add to trust this member.');
    return;
  }

  const requestId = ++memberSearchRequestId;
  clearMemberSearchResults('Searching…');
  memberSearchDebounceTimer = setTimeout(async () => {
    try {
      if (!humanSdk) return;
      const response = await humanSdk.rpc.profile.searchByAddressOrName(query, 20, null, avatarTypes);
      if (requestId !== memberSearchRequestId) return;
      await renderMemberSearchResults(response?.results || []);
    } catch {
      if (requestId !== memberSearchRequestId) return;
      clearMemberSearchResults('Search failed. Try again.');
    } finally {
      if (requestId === memberSearchRequestId) memberSearchDebounceTimer = null;
    }
  }, 180);
}

function clearSendSearchResults(message = '') {
  sendSearchResultsEl.innerHTML = message ? `<p class="muted">${escapeHtml(message)}</p>` : '';
}

function renderSendSearchResults(results) {
  if (!results || !results.length) {
    clearSendSearchResults('No matches found.');
    return;
  }

  sendSearchResultsEl.innerHTML = results
    .filter((entry) => entry?.address && isAddress(entry.address))
    .slice(0, 10)
    .map((entry) => {
      const address = getAddress(entry.address);
      return `
        <div class="list-row">
          <div class="list-row-main">
            <div class="list-row-title">${escapeHtml(entry.name || entry.registeredName || address)}</div>
            <div class="list-row-meta mono">${escapeHtml(address)}</div>
          </div>
          <button class="pick-send-recipient-btn btn-inline" data-recipient="${escapeHtml(address)}">Use</button>
        </div>
      `;
    })
    .join('');

  sendSearchResultsEl.querySelectorAll('.pick-send-recipient-btn').forEach((button) => {
    button.addEventListener('click', () => {
      sendRecipientInput.value = button.dataset.recipient || '';
      clearSendSearchResults();
    });
  });
}

async function updateSendSearchResults() {
  const query = sendRecipientInput.value.trim();
  if (sendSearchDebounceTimer) {
    clearTimeout(sendSearchDebounceTimer);
    sendSearchDebounceTimer = null;
  }

  if (!query || query.length < 2) {
    clearSendSearchResults();
    return;
  }

  if (looksLikeAddressInput(query)) {
    clearSendSearchResults('Address detected. Enter an amount and send.');
    return;
  }

  const requestId = ++sendSearchRequestId;
  clearSendSearchResults('Searching…');
  sendSearchDebounceTimer = setTimeout(async () => {
    try {
      if (!humanSdk) return;
      const response = await humanSdk.rpc.profile.searchByAddressOrName(query, 20, null);
      if (requestId !== sendSearchRequestId) return;
      renderSendSearchResults(response?.results || []);
    } catch {
      if (requestId !== sendSearchRequestId) return;
      clearSendSearchResults('Search failed. Try again.');
    } finally {
      if (requestId === sendSearchRequestId) sendSearchDebounceTimer = null;
    }
  }, 180);
}

async function addMember(preselectedAddress = null) {
  if (!activeGroupAvatar) {
    showResult('error', 'Open a group first.');
    return;
  }

  let memberAddress;
  try {
    memberAddress = preselectedAddress
      ? getAddress(preselectedAddress)
      : await resolveAddress(memberQueryInput.value, { avatarTypes: getMemberSearchAvatarTypes() });
  } catch (err) {
    showResult('error', decodeError(err));
    return;
  }

  addMemberBtn.disabled = true;
  showResult('pending', 'Adding member…');

  try {
    lastTxHashes = [];
    await activeGroupAvatar.trust.add(memberAddress);
    const links = lastTxHashes.length ? `<br>${txLinks(lastTxHashes)}` : '';
    showResult('success', `Member added: ${memberAddress}.${links}`);
    memberQueryInput.value = '';
    clearMemberSearchResults();
    setActiveMemberCount(getMembersTotalCount() + 1);
    updateMembersToolbar();
    await loadMembers();
  } catch (err) {
    showResult('error', `Could not add member: ${decodeError(err)}`);
  } finally {
    addMemberBtn.disabled = false;
  }
}

async function removeMembers(rawAddresses) {
  if (!activeGroupAvatar) {
    showResult('error', 'Open a group first.');
    return;
  }

  const addresses: any[] = [];
  const seen = new Set<string>();
  for (const raw of rawAddresses || []) {
    if (!isAddress(raw)) continue;
    const checksummed = getAddress(raw);
    const key = checksummed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    addresses.push(checksummed);
  }

  if (!addresses.length) {
    showResult('error', 'No valid member addresses to remove.');
    return;
  }

  const isBatch = addresses.length > 1;
  const confirmed = await showConfirmModal({
    title: isBatch ? `Remove ${addresses.length} members?` : 'Remove member?',
    message: isBatch
      ? `This will untrust ${addresses.length} members in a single transaction.`
      : `This will untrust ${addresses[0]}.`,
    confirmLabel: 'Remove',
  });
  if (!confirmed) return;

  if (membersRemoveSelectedBtn) membersRemoveSelectedBtn.disabled = true;
  showResult(
    'pending',
    isBatch ? `Removing ${addresses.length} members…` : `Removing member ${addresses[0]}…`
  );

  try {
    lastTxHashes = [];
    await activeGroupAvatar.trust.remove(addresses);
    const links = lastTxHashes.length ? `<br>${txLinks(lastTxHashes)}` : '';
    showResult(
      'success',
      isBatch
        ? `Removed ${addresses.length} members.${links}`
        : `Member removed: ${addresses[0]}.${links}`
    );
    for (const addr of addresses) {
      selectedMembers.delete(addr.toLowerCase());
    }
    setActiveMemberCount(Math.max(0, getMembersTotalCount() - addresses.length));
    updateMembersToolbar();
    await loadMembers();
  } catch (err) {
    showResult('error', `Could not remove member${isBatch ? 's' : ''}: ${decodeError(err)}`);
  } finally {
    updateMembersSelectionUI();
  }
}

/* ── Join Requests (affiliate wishlist) ──────────────────────────── */
// The wishlist method isn't on the production RPC yet; fall back to staging on
// "method not found" and pin whichever URL answered for the rest of the session.
let wishlistRpcUrl: string | null = null;

async function fetchWishlistPage(groupAddress: string, cursor: string | null): Promise<any> {
  const params: any[] = [groupAddress, WISHLIST_PAGE_LIMIT];
  if (cursor) params.push(cursor);
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'circles_getAffiliateGroupMembersWishlist',
    params,
  });

  const candidateUrls = wishlistRpcUrl ? [wishlistRpcUrl] : [RPC_URL, WISHLIST_FALLBACK_RPC_URL];
  let lastError: any = null;

  for (const url of candidateUrls) {
    let json: any;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      json = await res.json();
    } catch (err) {
      lastError = err;
      continue;
    }

    if (json?.error) {
      lastError = new Error(json.error.message || 'Wishlist request failed');
      if (json.error.code === -32601) continue;
      throw lastError;
    }

    wishlistRpcUrl = url;
    return json?.result || { results: [], hasMore: false, nextCursor: null };
  }

  throw lastError || new Error('Wishlist request failed');
}

function formatRelativeTime(unixSeconds: number | string): string {
  const seconds = Number(unixSeconds || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const deltaSeconds = Math.max(0, Math.floor(Date.now() / 1000) - seconds);
  if (deltaSeconds < 60) return 'just now';
  const minutes = Math.floor(deltaSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days <= 30) return `${days}d ago`;
  return new Date(seconds * 1000).toLocaleDateString();
}

async function hydrateWishlistMemberStatus(rows: any[]): Promise<void> {
  await Promise.all(
    rows.map(async (row) => {
      const key = row.avatarAddress.toLowerCase();
      if (wishlistMemberStatusByAddress.has(key)) return;

      const cachedStatus = cachedMembers.some(
        (member: any) => member.member.toLowerCase() === key
      );
      if (cachedStatus || !activeGroupAvatar) {
        wishlistMemberStatusByAddress.set(key, cachedStatus);
        return;
      }

      try {
        wishlistMemberStatusByAddress.set(
          key,
          Boolean(await activeGroupAvatar.trust.isTrusting(row.avatarAddress))
        );
      } catch {
        wishlistMemberStatusByAddress.set(key, false);
      }
    })
  );
}

function updateWishlistToolbar(): void {
  const loadedCount = wishlistPages.reduce((sum, page) => sum + page.length, 0);
  const suffix = wishlistHasMore ? '+' : '';
  const plural = loadedCount === 1 && !wishlistHasMore ? '' : 's';
  wishlistTotalCountEl.textContent = `${loadedCount}${suffix} request${plural}`;
  wishlistPageLabelEl.textContent = `Page ${currentWishlistPageIndex + 1}`;
  wishlistPrevBtn.disabled = currentWishlistPageIndex === 0;
  wishlistNextBtn.disabled =
    !wishlistHasMore && currentWishlistPageIndex >= wishlistPages.length - 1;
}

function getCurrentWishlistPageSelectableAddresses(): string[] {
  const rows = wishlistPages[currentWishlistPageIndex] || [];
  return rows
    .map((row: any) => getAddress(row.avatarAddress))
    .filter((address: string) => !wishlistMemberStatusByAddress.get(address.toLowerCase()));
}

function updateWishlistSelectionUI(): void {
  if (!wishlistSelectionToolbarEl) return;

  const selectableAddresses = getCurrentWishlistPageSelectableAddresses();
  const hasRows = (wishlistPages[currentWishlistPageIndex] || []).length > 0;

  if (!hasRows && selectedWishlistEntries.size === 0) {
    wishlistSelectionToolbarEl.classList.add('hidden');
  } else {
    wishlistSelectionToolbarEl.classList.remove('hidden');
  }

  const pageKeysSelected = selectableAddresses.filter((addr) =>
    selectedWishlistEntries.has(addr.toLowerCase())
  ).length;

  if (wishlistSelectAllInput) {
    wishlistSelectAllInput.disabled = selectableAddresses.length === 0;
    wishlistSelectAllInput.checked =
      selectableAddresses.length > 0 && pageKeysSelected === selectableAddresses.length;
    wishlistSelectAllInput.indeterminate =
      pageKeysSelected > 0 && pageKeysSelected < selectableAddresses.length;
  }

  const totalSelected = selectedWishlistEntries.size;
  if (wishlistSelectionCountEl) {
    wishlistSelectionCountEl.textContent = `${totalSelected} selected`;
  }
  if (wishlistTrustSelectedBtn) {
    wishlistTrustSelectedBtn.disabled = totalSelected === 0;
    wishlistTrustSelectedBtn.textContent =
      totalSelected > 1 ? `Trust ${totalSelected} selected` : 'Trust selected';
  }
}

function renderWishlistPage(): void {
  updateWishlistToolbar();

  const rows = wishlistPages[currentWishlistPageIndex] || [];
  if (!rows.length) {
    wishlistListEl.innerHTML = '<p class="muted">No join requests yet.</p>';
    updateWishlistSelectionUI();
    return;
  }

  wishlistListEl.innerHTML = rows
    .map((row: any) => {
      const address = getAddress(row.avatarAddress);
      const key = address.toLowerCase();
      const isAlreadyMember = wishlistMemberStatusByAddress.get(key) || false;
      const checked = selectedWishlistEntries.has(key) ? 'checked' : '';
      const requestedAt = formatRelativeTime(row.timestamp);
      return `
        <div class="list-row search-result-row member-row">
          <label class="member-row-select checkbox-inline">
            <input type="checkbox" class="wishlist-select-checkbox" data-avatar="${escapeHtml(address)}" ${checked} ${isAlreadyMember ? 'disabled' : ''} />
          </label>
          <div class="list-row-main">
            <div class="list-row-title">${escapeHtml(String(row.avatarName || '').trim() || address)}</div>
            <div class="list-row-meta mono">${escapeHtml(address)}</div>
            ${requestedAt ? `<div class="list-row-meta">Interested ${escapeHtml(requestedAt)}</div>` : ''}
          </div>
          <div class="list-row-action-stack">
            ${isAlreadyMember ? '<span class="chip">Member</span>' : ''}
            <button class="wishlist-add-btn btn-inline" data-avatar="${escapeHtml(address)}" ${isAlreadyMember ? 'disabled' : ''}>
              ${isAlreadyMember ? 'Added' : 'Add'}
            </button>
          </div>
        </div>
      `;
    })
    .join('');

  wishlistListEl.querySelectorAll('.wishlist-add-btn').forEach((button: any) => {
    button.addEventListener('click', () => void trustWishlistEntries([button.dataset.avatar]));
  });

  wishlistListEl.querySelectorAll('.wishlist-select-checkbox').forEach((input: any) => {
    input.addEventListener('change', () => {
      const key = String(input.dataset.avatar || '').toLowerCase();
      if (!key) return;
      if (input.checked) selectedWishlistEntries.add(key);
      else selectedWishlistEntries.delete(key);
      updateWishlistSelectionUI();
    });
  });

  updateWishlistSelectionUI();
}

async function ensureWishlistPage(pageIndex: number): Promise<boolean> {
  if (wishlistPages[pageIndex]) return true;
  if (!activeGroupMeta?.group) return false;

  while (wishlistPages.length <= pageIndex) {
    if (wishlistPages.length > 0 && !wishlistHasMore) return false;
    const cursor = wishlistPages.length === 0 ? null : wishlistNextCursor;
    const page = await fetchWishlistPage(activeGroupMeta.group, cursor);
    const rows = (page.results || []).filter(
      (row: any) => row?.avatarAddress && isAddress(row.avatarAddress)
    );
    wishlistPages.push(rows);
    wishlistHasMore = Boolean(page.hasMore);
    wishlistNextCursor = page.nextCursor || null;
    await hydrateWishlistMemberStatus(rows);
  }

  return Boolean(wishlistPages[pageIndex]);
}

async function goToWishlistPage(pageIndex: number): Promise<void> {
  if (pageIndex < 0) return;

  const requestId = ++wishlistLoadRequestId;
  wishlistListEl.innerHTML = '<p class="muted">Loading join requests…</p>';

  try {
    const ready = await ensureWishlistPage(pageIndex);
    if (requestId !== wishlistLoadRequestId) return;
    if (ready) currentWishlistPageIndex = pageIndex;
    renderWishlistPage();
  } catch (err) {
    if (requestId !== wishlistLoadRequestId) return;
    wishlistListEl.innerHTML = `<p class="muted">Could not load join requests: ${escapeHtml(decodeError(err))}</p>`;
  }
}

async function loadWishlist(): Promise<void> {
  if (!activeGroupMeta?.group) return;

  const groupAddress = activeGroupMeta.group;
  wishlistPages = [];
  wishlistNextCursor = null;
  wishlistHasMore = false;
  currentWishlistPageIndex = 0;
  selectedWishlistEntries = new Set();
  wishlistMemberStatusByAddress = new Map();
  loadedWishlistGroupAddress = null;
  updateWishlistToolbar();

  await goToWishlistPage(0);
  if (activeGroupMeta?.group === groupAddress && wishlistPages.length > 0) {
    loadedWishlistGroupAddress = groupAddress;
  }
}

async function trustWishlistEntries(rawAddresses: Array<string | undefined>): Promise<void> {
  if (!activeGroupAvatar) {
    showResult('error', 'Open a group first.');
    return;
  }

  const addresses: string[] = [];
  const seen = new Set<string>();
  for (const raw of rawAddresses || []) {
    if (!raw || !isAddress(raw)) continue;
    const checksummed = getAddress(raw);
    const key = checksummed.toLowerCase();
    if (seen.has(key) || wishlistMemberStatusByAddress.get(key)) continue;
    seen.add(key);
    addresses.push(checksummed);
  }

  if (!addresses.length) {
    showResult('error', 'No valid addresses to trust.');
    return;
  }

  const isBatch = addresses.length > 1;
  if (isBatch) {
    const confirmed = await showConfirmModal({
      title: `Trust ${addresses.length} people?`,
      message: `This will add ${addresses.length} people as group members in a single transaction.`,
      confirmLabel: 'Trust',
    });
    if (!confirmed) return;
  }

  if (wishlistTrustSelectedBtn) wishlistTrustSelectedBtn.disabled = true;
  showResult(
    'pending',
    isBatch ? `Trusting ${addresses.length} people…` : `Trusting ${addresses[0]}…`
  );

  try {
    lastTxHashes = [];
    await activeGroupAvatar.trust.add(addresses);
    const links = lastTxHashes.length ? `<br>${txLinks(lastTxHashes)}` : '';
    showResult(
      'success',
      isBatch
        ? `Added ${addresses.length} members.${links}`
        : `Member added: ${addresses[0]}.${links}`
    );
    for (const addr of addresses) {
      const key = addr.toLowerCase();
      selectedWishlistEntries.delete(key);
      wishlistMemberStatusByAddress.set(key, true);
    }
    setActiveMemberCount(getMembersTotalCount() + addresses.length);
    loadedMembersGroupAddress = null;
    renderWishlistPage();
  } catch (err) {
    showResult(
      'error',
      `Could not trust ${isBatch ? 'selected people' : addresses[0]}: ${decodeError(err)}`
    );
  } finally {
    updateWishlistSelectionUI();
  }
}

async function loadTreasuryPanels() {
  if (!humanSdk || !activeGroupMeta || !activeGroupAvatar) return;

  overviewGroupTypeEl.textContent = 'Loading…';
  overviewTotalSupplyEl.textContent = 'Loading…';
  feeCollectionBalanceDisplay.textContent = 'Loading…';
  setGroupTreasuryBalanceDisplay('…');
  convertibleFeesDisplay.textContent = 'Loading…';
  if (feeAddressGroupTokenDisplay) feeAddressGroupTokenDisplay.textContent = 'Loading…';
  collectFeesBtn.disabled = true;

  const feeCollectionAddress = activeGroupMeta.feeCollection;
  const hasFeeCollection = feeCollectionAddress && isAddress(feeCollectionAddress) && feeCollectionAddress !== zeroAddress;

  const [totalSupplyResult, feeBalanceResult] = await Promise.allSettled([
    activeGroupAvatar.balances.getTotalSupply(),
    hasFeeCollection
      ? humanSdk.groups.getFeeCollectionBalances(feeCollectionAddress)
      : Promise.resolve([]),
  ]);

  overviewGroupTypeEl.textContent = getFallbackGroupType(activeGroupMeta.type);

  let totalSupplyAtto = 0n;
  if (totalSupplyResult.status === 'fulfilled') {
    totalSupplyAtto = BigInt(totalSupplyResult.value || 0n);
    overviewTotalSupplyEl.textContent = formatActiveTokenAmount(totalSupplyAtto);
  } else {
    overviewTotalSupplyEl.textContent = 'Unavailable';
  }


  // Convertible fee amount (max flow from fee collection to mint handler)
  cachedFeeSourceTokens = [];
  cachedFeeAddressGroupTokenAmount = 0n;
  if (!hasFeeCollection || !activeGroupMeta.mintHandler) {
    cachedFeeConvertibleAmount = 0n;
    convertibleFeesDisplay.textContent = formatActiveTokenAmount(0n);
    if (feeAddressGroupTokenDisplay) feeAddressGroupTokenDisplay.textContent = formatActiveTokenAmount(0n);
  } else {
    const feeSourceTokens =
      feeBalanceResult.status === 'fulfilled'
        ? normalizeAddressList((feeBalanceResult.value || []).map((balance) => balance?.tokenAddress))
        : [];
    cachedFeeSourceTokens = feeSourceTokens;

    if (!feeSourceTokens.length) {
      cachedFeeConvertibleAmount = 0n;
      convertibleFeesDisplay.textContent = formatActiveTokenAmount(0n);
      if (feeAddressGroupTokenDisplay) feeAddressGroupTokenDisplay.textContent = formatActiveTokenAmount(0n);
    } else {
      try {
        cachedFeeConvertibleAmount = BigInt(
          await humanSdk.groups.getConvertibleFeeAmount(feeCollectionAddress, activeGroupMeta.mintHandler, {
            fromTokens: feeSourceTokens,
            useWrappedBalances: true,
          })
        );
        convertibleFeesDisplay.textContent = formatActiveTokenAmount(cachedFeeConvertibleAmount);
      } catch {
        cachedFeeConvertibleAmount = 0n;
        convertibleFeesDisplay.textContent = formatActiveTokenAmount(0n);
      }
    }
  }
  collectFeesBtn.disabled = cachedFeeConvertibleAmount <= 0n;

  // Fee collection address balance
  if (!hasFeeCollection) {
    feeCollectionBalanceDisplay.textContent = 'No fee collection address set';
    setGroupTreasuryBalanceDisplay('N/A');
    if (feeAddressGroupTokenDisplay) feeAddressGroupTokenDisplay.textContent = formatActiveTokenAmount(0n);
  } else if (feeBalanceResult.status === 'fulfilled') {
    const feeBalances = feeBalanceResult.value || [];
    if (!feeBalances.length) {
      feeCollectionBalanceDisplay.textContent = '0 CRC';
      setGroupTreasuryBalanceDisplay('0 CRC');
      if (feeAddressGroupTokenDisplay) feeAddressGroupTokenDisplay.textContent = formatActiveTokenAmount(0n);
    } else {
      const feeTotal = feeBalances.reduce((sum, b) => sum + getFeeBalanceAmount(b), 0n);
      const formattedFeeTotal = `${Number(formatEther(feeTotal)).toFixed(2)} CRC`;
      feeCollectionBalanceDisplay.textContent = `${formattedFeeTotal} across ${feeBalances.length} token${feeBalances.length === 1 ? '' : 's'}`;
      setGroupTreasuryBalanceDisplay(formattedFeeTotal);
      const feeAddressGroupToken = feeBalances.find(
        (balance) => String(balance?.tokenAddress || '').toLowerCase() === activeGroupMeta.group.toLowerCase()
      );
      cachedFeeAddressGroupTokenAmount = feeAddressGroupToken ? getFeeBalanceAmount(feeAddressGroupToken) : 0n;
      if (feeAddressGroupTokenDisplay) {
        feeAddressGroupTokenDisplay.textContent = formatActiveTokenAmount(cachedFeeAddressGroupTokenAmount);
      }
    }
  } else {
    feeCollectionBalanceDisplay.textContent = 'Could not load';
    setGroupTreasuryBalanceDisplay('—');
    if (feeAddressGroupTokenDisplay) feeAddressGroupTokenDisplay.textContent = 'Could not load';
  }

}

async function saveProfile() {
  if (!activeGroupAvatar || !activeGroupMeta) {
    showResult('error', 'Open a group first.');
    return;
  }

  clearAllFieldErrors('profile');
  const { ok, errors } = validateGroupForm('profile');
  if (!ok) {
    applyFormErrors('profile', errors);
    return;
  }

  saveProfileBtn.disabled = true;
  const restoreSaveBtn = setButtonLoading(saveProfileBtn, 'Saving…');
  showResult('pending', 'Saving profile metadata…');

  try {
    const existingProfile = (await activeGroupAvatar.profile.get().catch(() => undefined)) || {};
    const nextExtensions = { ...(existingProfile.extensions || {}) };
    delete nextExtensions.links;
    const nextProfile = {
      name: existingProfile.name || activeGroupMeta.name || activeGroupMeta.symbol || 'Group',
      description:
        buildDescriptionWithExternalLink(
          profileDescriptionInput.value,
          readExternalLinkDraft('profile')
        ) || undefined,
      previewImageUrl: getProfileImageSrc() || undefined,
      imageUrl: existingProfile.imageUrl || undefined,
      location: existingProfile.location || undefined,
      geoLocation: existingProfile.geoLocation || undefined,
      extensions: Object.keys(nextExtensions).length ? nextExtensions : undefined,
    };

    const { extras } = collectGroupProfileExtras({
      website: profileWebsiteInput,
      groupType: profileGroupTypeSelect,
      membershipFee: profileMembershipFeeInput,
      minRepScore: profileMinRepScoreInput,
      additionalCriteria: profileAdditionalCriteriaInput,
      contactEmail: profileContactEmailInput,
      contactWebsite: profileContactWebsiteInput,
    });
    Object.assign(nextProfile, extras);

    lastTxHashes = [];
    await activeGroupAvatar.profile.update(nextProfile);
    const links = lastTxHashes.length ? `<br>${txLinks(lastTxHashes)}` : '';
    showResult('success', `Profile updated.${links}`);

    await populateProfileEditor();
  } catch (err) {
    showResult('error', `Could not update profile: ${decodeError(err)}`);
  } finally {
    restoreSaveBtn();
    saveProfileBtn.disabled = false;
  }
}

async function updateGroupAddressSetting({
  inputEl,
  buttonEl,
  currentValue,
  emptyError,
  unchangedError,
  pendingMessage,
  successMessage,
  failureMessage,
  setter,
  confirmModal,
}: any) {
  if (!activeGroupAvatar || !activeGroupMeta) {
    showResult('error', 'Open a group first.');
    return;
  }

  let nextAddress;
  try {
    nextAddress = parseAddressInput(inputEl?.value);
  } catch {
    showResult('error', emptyError);
    return;
  }

  if (currentValue && nextAddress.toLowerCase() === currentValue.toLowerCase()) {
    showResult('error', unchangedError);
    return;
  }

  if (confirmModal) {
    const modalConfig =
      typeof confirmModal === 'function' ? confirmModal(nextAddress) : confirmModal;
    const confirmed = await showConfirmModal(modalConfig);
    if (!confirmed) return;
  }

  buttonEl.disabled = true;
  showResult('pending', pendingMessage);

  try {
    lastTxHashes = [];
    await setter(nextAddress);
    const links = lastTxHashes.length ? `<br>${txLinks(lastTxHashes)}` : '';
    showResult('success', `${successMessage(nextAddress)}${links}`);
    inputEl.value = nextAddress;
    await openGroup(activeGroupMeta.group, true);
  } catch (err) {
    showResult('error', `${failureMessage}${decodeError(err)}`);
  } finally {
    buttonEl.disabled = false;
  }
}

async function updateGroupOwner() {
  if (!activeGroupAvatar || !activeGroupMeta) {
    showResult('error', 'Open a group first.');
    return;
  }

  let nextOwner;
  try {
    nextOwner = parseAddressInput(ownerSafeInput.value);
  } catch {
    showResult('error', 'Enter a valid owner Safe address.');
    return;
  }

  if (activeOwnerSafe && nextOwner.toLowerCase() === activeOwnerSafe.toLowerCase()) {
    showResult('error', 'That Safe is already the owner.');
    return;
  }

  const confirmed = await showConfirmModal({
    title: 'Transfer Group Ownership?',
    message:
      `You are updating the owner Safe for ${getActiveGroupLabel()} to ${nextOwner}. ` +
      'The new Safe will control owner-level Circles group actions such as service and fee collection updates.',
    confirmLabel: 'Transfer Owner',
  });
  if (!confirmed) {
    return;
  }

  updateOwnerBtn.disabled = true;
  showResult('pending', 'Updating owner Safe…');

  try {
    lastTxHashes = [];
    await activeGroupAvatar.setProperties.owner(nextOwner);
    const links = lastTxHashes.length ? `<br>${txLinks(lastTxHashes)}` : '';
    showResult('success', `Owner Safe updated to ${nextOwner}.${links}`);
    ownerSafeInput.value = nextOwner;
    await openGroup(activeGroupMeta.group, true);
  } catch (err) {
    showResult('error', `Could not update owner Safe: ${decodeError(err)}`);
  } finally {
    updateOwnerBtn.disabled = false;
  }
}

async function updateGroupService() {
  return updateGroupAddressSetting({
    inputEl: serviceAddressInput,
    buttonEl: updateServiceBtn,
    currentValue: activeGroupMeta?.service || '',
    emptyError: 'Enter a valid service address.',
    unchangedError: 'That address is already the service.',
    pendingMessage: 'Updating service address…',
    successMessage: (nextAddress) => `Service updated to ${nextAddress}.`,
    failureMessage: 'Could not update service address: ',
    setter: (nextAddress) => activeGroupAvatar.setProperties.service(nextAddress),
    confirmModal: (nextAddress) => ({
      title: 'Update Group Service?',
      message:
        `You are updating the Circles service address for ${getActiveGroupLabel()} to ${nextAddress}. ` +
        'This changes which service contract the group points to.',
      confirmLabel: 'Update Service',
    }),
  });
}

async function updateGroupFeeCollection() {
  const rawInput = String(feeCollectionInput?.value || '').trim();

  try {
    const candidate = getAddress(rawInput);
    if (connectedAddress && candidate.toLowerCase() === connectedAddress.toLowerCase()) {
      const confirmed = await showConfirmModal({
        title: 'Use Connected Wallet?',
        message:
          'You are setting the fee collection address to the same wallet address currently connected in Circles. This is usually not recommended because fees may end up in a personal wallet.',
        confirmLabel: 'Use This Address',
      });
      if (!confirmed) {
        return;
      }
    }
  } catch { }

  return updateGroupAddressSetting({
    inputEl: feeCollectionInput,
    buttonEl: updateFeeCollectionBtn,
    currentValue: activeGroupMeta?.feeCollection || '',
    emptyError: 'Enter a valid fee collection address.',
    unchangedError: 'That address is already the fee collection address.',
    pendingMessage: 'Updating fee collection address…',
    successMessage: (nextAddress) => `Fee collection updated to ${nextAddress}.`,
    failureMessage: 'Could not update fee collection address: ',
    setter: (nextAddress) => activeGroupAvatar.setProperties.feeCollection(nextAddress),
  });
}

async function updateMembershipCondition(enabled) {
  if (!activeGroupAvatar || !activeGroupMeta) {
    showResult('error', 'Open a group first.');
    return;
  }

  let condition;
  try {
    condition = parseAddressInput(membershipConditionInput?.value);
  } catch {
    showResult('error', 'Enter a valid membership condition address.');
    return;
  }

  const isAlreadyActive = activeMembershipConditions.some(
    (entry) => entry.toLowerCase() === condition.toLowerCase()
  );

  if (enabled && isAlreadyActive) {
    showResult('error', 'That membership condition is already enabled.');
    return;
  }

  if (!enabled && !isAlreadyActive) {
    showResult('error', 'That membership condition is not currently enabled.');
    return;
  }

  const activeButton = enabled ? enableMembershipConditionBtn : disableMembershipConditionBtn;
  const idleButton = enabled ? disableMembershipConditionBtn : enableMembershipConditionBtn;
  activeButton.disabled = true;
  idleButton.disabled = true;
  showResult('pending', enabled ? 'Enabling membership condition…' : 'Disabling membership condition…');

  try {
    lastTxHashes = [];
    await activeGroupAvatar.setProperties.membershipCondition(condition, enabled);
    const links = lastTxHashes.length ? `<br>${txLinks(lastTxHashes)}` : '';
    showResult(
      'success',
      `${enabled ? 'Enabled' : 'Disabled'} membership condition ${condition}.${links}`
    );
    membershipConditionInput.value = '';
    await loadMembershipConditions();
  } catch (err) {
    showResult(
      'error',
      `Could not ${enabled ? 'update' : 'remove'} membership condition: ${decodeError(err)}`
    );
  } finally {
    activeButton.disabled = false;
    idleButton.disabled = false;
  }
}

async function addOwnerToOwnerSafe(rawOwner?: any) {
  if (!activeOwnerSafe || !isAddress(activeOwnerSafe)) {
    showResult('error', 'This group does not expose a manageable owner Safe.');
    return;
  }

  const ownerInput =
    rawOwner && typeof rawOwner === 'object' && 'type' in rawOwner ? addOwnerInput.value : rawOwner;

  let nextOwner;
  try {
    nextOwner = parseAddressInput(ownerInput ?? addOwnerInput.value);
  } catch {
    showResult('error', 'Enter a valid owner address.');
    return;
  }

  if (!ownerSafeOwners.length || ownerSafeThreshold === null) {
    await loadOwnerSafeDetails();
  }

  if (ownerSafeOwners.some((owner) => owner.toLowerCase() === nextOwner.toLowerCase())) {
    showResult('error', 'That address is already an owner of the owner Safe.');
    return;
  }

  if (ownerSafeThreshold !== null && ownerSafeThreshold > 1) {
    showResult(
      'error',
      `This owner Safe uses threshold ${ownerSafeThreshold}. The app currently supports owner changes only for threshold 1 Safes.`
    );
    return;
  }

  const safeAbi = safeSingletonDeployment?.abi;
  if (!safeAbi) {
    showResult('error', 'Safe deployment metadata unavailable.');
    return;
  }

  const confirmed = await showConfirmModal({
    title: 'Add Safe Owner?',
    message:
      `You are adding ${nextOwner} as an owner of the owner Safe for ${getActiveGroupLabel()}. ` +
      'On this threshold-1 Safe, each owner can approve admin actions for the Circles group.',
    confirmLabel: 'Add Safe Owner',
  });
  if (!confirmed) {
    return;
  }

  addOwnerSafeBtn.disabled = true;
  showResult('pending', 'Adding owner to the owner Safe…');

  try {
    const nextThreshold = BigInt(ownerSafeThreshold || 1);
    const data = encodeFunctionData({
      abi: safeAbi,
      functionName: 'addOwnerWithThreshold',
      args: [nextOwner, nextThreshold],
    });

    const ownerSafeRunner = createSafeOwnerRunner(connectedAddress, activeOwnerSafe);
    lastTxHashes = [];
    await ownerSafeRunner.sendTransaction([
      {
        to: activeOwnerSafe,
        data,
        value: 0n,
      },
    ]);
    const links = lastTxHashes.length ? `<br>${txLinks(lastTxHashes)}` : '';
    showResult('success', `Owner added to ${activeOwnerSafe}.${links}`);
    addOwnerInput.value = '';
    clearOwnerSafeSearchResults();
    await loadOwnerSafeDetails();
  } catch (err) {
    showResult('error', `Could not add owner to the owner Safe: ${decodeError(err)}`);
  } finally {
    addOwnerSafeBtn.disabled = false;
  }
}

async function sendGroupCrc() {
  if (!activeGroupAvatar || !activeGroupMeta || !activeGroupSdk) {
    showResult('error', 'Open a group first.');
    return;
  }

  if (!activeGroupMeta.feeCollection || !isAddress(activeGroupMeta.feeCollection)) {
    showResult('error', 'This group has no valid fee collection address.');
    return;
  }

  let recipient;
  try {
    recipient = await resolveAddress(sendRecipientInput.value);
  } catch (err) {
    showResult('error', decodeError(err));
    return;
  }

  const feeCollectionAvatar = await activeGroupSdk.getAvatar(activeGroupMeta.feeCollection);
  const transferOptions = getGroupSendTransferOptions();
  let maxTransferableAmount = 0n;
  try {
    maxTransferableAmount = await feeCollectionAvatar.transfer.getMaxAmountAdvanced(
      recipient,
      transferOptions
    );
  } catch (err) {
    showResult('error', `Could not calculate max transferable ${getActiveTokenSymbol()}: ${decodeError(err)}`);
    return;
  }

  if (maxTransferableAmount <= 0n) {
    showResult('error', `No routable ${getActiveTokenSymbol()} found for that recipient.`);
    return;
  }

  const requestedAmount = parseCirclesInputToAtto(sendAmountInput.value);
  const amount = requestedAmount === null || requestedAmount <= 0n ? maxTransferableAmount : requestedAmount;

  if (amount > maxTransferableAmount) {
    showResult(
      'error',
      `Amount exceeds the current max flow (${formatActiveTokenAmount(maxTransferableAmount)}).`
    );
    return;
  }

  sendGroupBtn.disabled = true;
  showResult('pending', `Routing ${getActiveTokenSymbol()} through the trust graph…`);

  try {
    lastTxHashes = [];
    await feeCollectionAvatar.transfer.advanced(recipient, amount, transferOptions);
    const links = lastTxHashes.length ? `<br>${txLinks(lastTxHashes)}` : '';
    showResult(
      'success',
      `Sent ${formatActiveTokenAmount(amount)} to ${recipient} via max-flow routing.${links}`
    );
    sendAmountInput.value = '';
    sendRecipientInput.value = '';
    clearSendSearchResults();
    await loadTreasuryPanels();
  } catch (err) {
    showResult('error', `Could not send ${getActiveTokenSymbol()}: ${decodeError(err)}`);
  } finally {
    sendGroupBtn.disabled = false;
  }
}

async function fillSendMax() {
  if (!activeGroupMeta || !activeGroupSdk) return;

  if (!sendRecipientInput.value.trim()) {
    sendAmountInput.value = attoToCirclesString(cachedFeeAddressGroupTokenAmount);
    return;
  }

  if (!activeGroupMeta.feeCollection || !isAddress(activeGroupMeta.feeCollection)) {
    showResult('error', 'This group has no valid fee collection address.');
    return;
  }

  let recipient;
  try {
    recipient = await resolveAddress(sendRecipientInput.value);
  } catch (err) {
    showResult('error', decodeError(err));
    return;
  }

  try {
    const feeCollectionAvatar = await activeGroupSdk.getAvatar(activeGroupMeta.feeCollection);
    const maxTransferableAmount = await feeCollectionAvatar.transfer.getMaxAmountAdvanced(
      recipient,
      getGroupSendTransferOptions()
    );
    sendAmountInput.value = attoToCirclesString(maxTransferableAmount);
  } catch (err) {
    showResult('error', `Could not calculate max transferable ${getActiveTokenSymbol()}: ${decodeError(err)}`);
  }
}

async function openGroup(groupAddress, preserveResult = false) {
  if (!connectedAddress || !humanSdk || !isAddress(groupAddress)) return;

  let groupMeta = getResolvedGroupMeta(groupAddress);
  if (!groupMeta) {
    const lookupPage = await humanSdk.rpc.group.findGroups(1, {
      groupAddressIn: [getAddress(groupAddress)],
    });
    groupMeta = lookupPage?.results?.[0] || null;
  }

  if (!groupMeta) {
    showResult('error', 'Could not find that group.');
    return;
  }

  hideAllSections();
  if (!preserveResult) showResult('pending', `Opening group ${groupAddress}…`);

  try {
    activeGroupMeta = normalizeGroupMeta(groupMeta);
    activeOwnerSafe =
      activeGroupMeta.owner && isAddress(activeGroupMeta.owner) ? getAddress(activeGroupMeta.owner) : null;

    const runner =
      activeOwnerSafe && activeOwnerSafe.toLowerCase() !== connectedAddress.toLowerCase()
        ? createSafeOwnerRunner(connectedAddress, activeOwnerSafe)
        : createRunner(activeOwnerSafe || connectedAddress);

    activeGroupSdk = new CirclesClient(undefined, runner);
    activeGroupAvatar = await activeGroupSdk.getBaseGroupAvatar(activeGroupMeta.group);

    groupSymbolDisplay.textContent = activeGroupMeta.symbol || 'GROUP';
    groupNameDisplay.textContent = activeGroupMeta.name || activeGroupMeta.group;
    setActiveMemberCount(activeGroupMeta.memberCount);
    updateTokenUiCopy();
    groupAddressDisplay.textContent = shortenAddress(activeGroupMeta.group);
    groupAddressDisplay.title = activeGroupMeta.group;
    groupAddressDisplay.href = explorerAvatarUrl(activeGroupMeta.group);
    setAddressLink(overviewGroupAddressEl, activeGroupMeta.group);
    setAddressLink(overviewOwnerSafeEl, activeOwnerSafe);
    setAddressLink(overviewTreasuryAddressEl, activeGroupMeta.treasury);
    setAddressLink(overviewMintHandlerEl, activeGroupMeta.mintHandler);
    setAddressLink(overviewServiceAddressEl, activeGroupMeta.service);
    setAddressLink(overviewFeeCollectionAddressEl, activeGroupMeta.feeCollection);
    ownerSafeInput.value = activeOwnerSafe || '';
    serviceAddressInput.value = activeGroupMeta.service || '';
    feeCollectionInput.value = activeGroupMeta.feeCollection || '';
    resetMembersState();
    resetWishlistState();
    resetOwnerSafeState();
    resetMembershipConditionsState();
    sendRecipientInput.value = '';
    sendAmountInput.value = '';
    collectFeesAmountInput.value = '';
    clearSendSearchResults();

    showGroupView();
    await Promise.all([populateProfileEditor(), loadTreasuryPanels(), loadMembershipConditions(), loadAffiliateCount(activeGroupMeta.group)]);
    if (!preserveResult) hideResult();
  } catch (err) {
    showResult('error', `Could not open group: ${decodeError(err)}`);
  }
}

async function collectFees() {
  if (!activeGroupAvatar || !activeGroupMeta) {
    showResult('error', 'Open a group first.');
    return;
  }

  if (!activeGroupMeta.mintHandler) {
    showResult('error', 'This group has no mint handler configured.');
    return;
  }

  const amount = parseCirclesInputToAtto(collectFeesAmountInput.value);
  if (amount === null || amount <= 0n) {
    showResult('error', 'Enter a valid amount to convert.');
    return;
  }

  if (cachedFeeConvertibleAmount <= 0n) {
    showResult('error', 'No convertible fee balance is available.');
    return;
  }

  if (amount > cachedFeeConvertibleAmount) {
    showResult(
      'error',
      `Amount exceeds the currently convertible balance (${formatActiveTokenAmount(cachedFeeConvertibleAmount)}).`
    );
    return;
  }

  if (!cachedFeeSourceTokens.length) {
    showResult('error', 'No received fee tokens are available to convert.');
    return;
  }

  collectFeesBtn.disabled = true;
  const symbol = getActiveTokenSymbol();
  showResult('pending', `Converting ${attoToCirclesString(amount)} ${symbol} from fee collection into group CRC…`);

  try {
    lastTxHashes = [];
    const feeCollectionAvatar = await activeGroupSdk.getAvatar(activeGroupMeta.feeCollection);
    await feeCollectionAvatar.transfer.advanced(activeGroupMeta.mintHandler, amount, {
      fromTokens: cachedFeeSourceTokens,
      useWrappedBalances: true,
    });
    const links = lastTxHashes.length ? `<br>${txLinks(lastTxHashes)}` : '';
    showResult(
      'success',
      `Converted ${attoToCirclesString(amount)} ${symbol} from fee collection into group CRC.${links}`
    );
    collectFeesAmountInput.value = '';
    await loadTreasuryPanels();
  } catch (err) {
    showResult('error', `Could not convert fees: ${decodeError(err)}`);
  } finally {
    collectFeesBtn.disabled = false;
  }
}

function fillFeesMax() {
  collectFeesAmountInput.value = attoToCirclesString(cachedFeeConvertibleAmount);
}

onWalletChange(async (address) => {
  try {
    connectedAddress = address ? getAddress(address) : null;
  } catch {
    connectedAddress = null;
  }

  humanSdk = null;
  activeGroupSdk = null;
  activeGroupAvatar = null;
  activeGroupMeta = null;
  activeOwnerSafe = null;
  activeGroups = [];
  cachedMembers = [];
  memberPages = [];
  memberNamesByAddress = new Map();
  membersNextCursor = null;
  membersPagingActive = false;
  currentMembersPageIndex = 0;
  membersHasMorePages = false;
  cachedFeeConvertibleAmount = 0n;
  cachedFeeSourceTokens = [];
  cachedFeeAddressGroupTokenAmount = 0n;
  lastTxHashes = [];
  resetOwnerSafeState();
  resetWishlistState();
  resetMembershipConditionsState();
  clearMemberSearchResults();
  clearSendSearchResults();
  showGroupManagementMenu();

  if (!connectedAddress) {
    showDisconnectedState();
    return;
  }

  setStatus('Checking wallet…', 'pending');

  try {
    humanSdk = new CirclesClient(undefined, createRunner(connectedAddress));
    await loadAdminGroups();
  } catch (err) {
    if (isPasskeyAutoConnectError(err)) {
      setStatus('Reconnect required', 'warning');
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
    setStatus('Reconnect required', 'warning');
    showResult(
      'error',
      'Passkey auto-connect failed in the host app. Re-open wallet connect and choose your wallet again.'
    );
  });

  window.addEventListener('error', (event) => {
    if (!isPasskeyAutoConnectError(event.error || event.message)) return;
    setStatus('Reconnect required', 'warning');
    showResult(
      'error',
      'Passkey auto-connect failed in the host app. Re-open wallet connect and choose your wallet again.'
    );
  });
}

startCreateGroupBtn.addEventListener('click', () => {
  hideResult();
  showCreateView();
});
groupsListEl.addEventListener('click', (event) => {
  const emptyCreate = event.target.closest('[data-empty-create]');
  if (emptyCreate && groupsListEl.contains(emptyCreate)) {
    hideResult();
    showCreateView();
    return;
  }
  const button = event.target.closest('.open-group-btn');
  if (!button || !groupsListEl.contains(button)) return;
  void openGroup(button.dataset.group);
});
createGroupBtn.addEventListener('click', createGroup);
cancelCreateBtn?.addEventListener('click', () => {
  resetCreateForm();
  navigateToGroups();
});
createGroupNameInput.addEventListener('input', updateCreateButtonState);
createGroupSymbolInput.addEventListener('input', () => {
  createGroupSymbolInput.value = createGroupSymbolInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  updateCreateButtonState();
});
createGroupDescriptionInput.addEventListener('input', updateCreateButtonState);
createGroupImageInput?.addEventListener('change', handleCreateImageChange);
clearCreateImageBtn?.addEventListener('click', () => {
  clearCreateImageSelection();
  updateCreateButtonState();
});
createLinkLabelInput?.addEventListener('input', (event) => {
  handleExternalLinkInput('create', 'label', event.target.value);
});
createLinkUrlInput?.addEventListener('input', (event) => {
  handleExternalLinkInput('create', 'url', event.target.value);
});

editGroupBtn.addEventListener('click', () => showGroupManagementPanel('details'));
refreshGroupBtn.addEventListener('click', async () => {
  if (!activeGroupMeta) return;
  await openGroup(activeGroupMeta.group, true);
});
switchGroupsBtn.addEventListener('click', navigateToGroups);
document.querySelectorAll('[data-management-view]').forEach((button: any) => {
  button.addEventListener('click', () => showGroupManagementPanel(button.dataset.managementView));
});
document.querySelectorAll('[data-management-back="1"]').forEach((button) => {
  button.addEventListener('click', showGroupManagementMenu);
});

profileImageInput?.addEventListener('change', handleProfileImageChange);
clearProfileImageBtn?.addEventListener('click', clearProfileImageSelection);
profileLinkLabelInput?.addEventListener('input', (event) => {
  handleExternalLinkInput('profile', 'label', event.target.value);
});
profileLinkUrlInput?.addEventListener('input', (event) => {
  handleExternalLinkInput('profile', 'url', event.target.value);
});
updateOwnerBtn.addEventListener('click', updateGroupOwner);
updateServiceBtn.addEventListener('click', updateGroupService);
updateFeeCollectionBtn.addEventListener('click', updateGroupFeeCollection);
collectFeesBtn.addEventListener('click', collectFees);
enableMembershipConditionBtn.addEventListener('click', () => updateMembershipCondition(true));
disableMembershipConditionBtn.addEventListener('click', () => updateMembershipCondition(false));
addOwnerInput.addEventListener('input', updateOwnerSafeSearchResults);
addOwnerSafeBtn.addEventListener('click', () => void addOwnerToOwnerSafe());
saveProfileBtn.addEventListener('click', saveProfile);
cancelProfileBtn?.addEventListener('click', showGroupManagementMenu);

// Form validation + counters (Round 4)
attachFieldValidation('create');
attachFieldValidation('profile');

const countLines = (text) =>
  String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean).length;

attachCounter(
  createGroupDescriptionInput,
  byId('create-group-description-counter'),
  MAX_DESCRIPTION_LENGTH,
  'create'
);
attachCounter(
  byId('create-link-label'),
  byId('create-link-label-counter'),
  MAX_LINK_LABEL_LENGTH,
  'create'
);
attachCounter(
  createAdditionalCriteriaInput,
  byId('create-additional-criteria-counter'),
  MAX_ADDITIONAL_CRITERIA,
  'create',
  (text) => `${countLines(text)} / ${MAX_ADDITIONAL_CRITERIA}`
);

attachCounter(
  profileDescriptionInput,
  byId('profile-description-counter'),
  MAX_DESCRIPTION_LENGTH,
  'profile'
);
attachCounter(
  byId('profile-link-label'),
  byId('profile-link-label-counter'),
  MAX_LINK_LABEL_LENGTH,
  'profile'
);
attachCounter(
  profileAdditionalCriteriaInput,
  byId('profile-additional-criteria-counter'),
  MAX_ADDITIONAL_CRITERIA,
  'profile',
  (text) => `${countLines(text)} / ${MAX_ADDITIONAL_CRITERIA}`
);

memberQueryInput.addEventListener('input', updateMemberSearchResults);
memberIncludeV1Input?.addEventListener('change', updateMemberSearchResults);
addMemberBtn.addEventListener('click', () => addMember());
membersPrevBtn.addEventListener('click', () => {
  if (currentMembersPageIndex === 0) return;
  goToMembersPage(currentMembersPageIndex - 1);
});
membersNextBtn.addEventListener('click', () => {
  goToMembersPage(currentMembersPageIndex + 1);
});

membersSelectAllInput?.addEventListener('change', () => {
  const pageAddresses = getCurrentMemberPageAddresses();
  if (membersSelectAllInput.checked) {
    for (const addr of pageAddresses) selectedMembers.add(addr.toLowerCase());
  } else {
    for (const addr of pageAddresses) selectedMembers.delete(addr.toLowerCase());
  }
  membersListEl.querySelectorAll('.member-select-checkbox').forEach((input) => {
    const key = String(input.dataset.member || '').toLowerCase();
    input.checked = selectedMembers.has(key);
  });
  updateMembersSelectionUI();
});

membersRemoveSelectedBtn?.addEventListener('click', () => {
  if (!selectedMembers.size) return;
  void removeMembers(Array.from(selectedMembers));
});

wishlistPrevBtn.addEventListener('click', () => {
  if (currentWishlistPageIndex === 0) return;
  void goToWishlistPage(currentWishlistPageIndex - 1);
});
wishlistNextBtn.addEventListener('click', () => {
  void goToWishlistPage(currentWishlistPageIndex + 1);
});

wishlistSelectAllInput?.addEventListener('change', () => {
  const selectableAddresses = getCurrentWishlistPageSelectableAddresses();
  if (wishlistSelectAllInput.checked) {
    for (const addr of selectableAddresses) selectedWishlistEntries.add(addr.toLowerCase());
  } else {
    for (const addr of selectableAddresses) selectedWishlistEntries.delete(addr.toLowerCase());
  }
  wishlistListEl.querySelectorAll('.wishlist-select-checkbox').forEach((input: any) => {
    if (input.disabled) return;
    const key = String(input.dataset.avatar || '').toLowerCase();
    input.checked = selectedWishlistEntries.has(key);
  });
  updateWishlistSelectionUI();
});

wishlistTrustSelectedBtn?.addEventListener('click', () => {
  if (!selectedWishlistEntries.size) return;
  void trustWishlistEntries(Array.from(selectedWishlistEntries));
});

sendRecipientInput.addEventListener('input', updateSendSearchResults);
sendMaxBtn.addEventListener('click', () => {
  void fillSendMax();
});
collectFeesMaxBtn.addEventListener('click', fillFeesMax);
sendGroupBtn.addEventListener('click', sendGroupCrc);

confirmModalCancelBtn.addEventListener('click', () => closeConfirmModal(false));
confirmModalConfirmBtn.addEventListener('click', () => closeConfirmModal(true));
confirmModalEl.addEventListener('click', (event) => {
  if (event.target === confirmModalEl) {
    closeConfirmModal(false);
  }
});

syncExternalLinkInputs('create');
syncExternalLinkInputs('profile');
updateCreateButtonState();
showDisconnectedState();
}
