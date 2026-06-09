/**
 * Mixpanel analytics for the host shell.
 *
 * - Page views fire from +layout.svelte (afterNavigate).
 * - Miniapp click fires from the directory grid (launchApp).
 * - Miniapp session + iframe load events fire from /miniapps/[slug] via IframeHost.
 * - Wallet-protocol events flow through callbacks on iframeHost.ts factories.
 *
 * All events are no-ops unless VITE_ANALYTICS_ENABLED=true and a token is set.
 */

import mixpanel from 'mixpanel-browser';

const TOKEN = import.meta.env.VITE_MIXPANEL_TOKEN as string | undefined;
const ENABLED = import.meta.env.VITE_ANALYTICS_ENABLED === 'true' && !!TOKEN;

let started = false;

export function initAnalytics(): void {
	if (!ENABLED || started || typeof window === 'undefined') return;
	mixpanel.init(TOKEN as string, {
		api_host:
			(import.meta.env.VITE_MIXPANEL_API_HOST as string | undefined) ||
			'https://api-eu.mixpanel.com',
		debug: import.meta.env.VITE_MIXPANEL_DEBUG === 'true',
		persistence: 'localStorage',
		track_pageview: false
	});
	mixpanel.register({
		app_env: (import.meta.env.VITE_APP_ENV as string | undefined) || 'dev',
		pwa_display_mode: window.matchMedia('(display-mode: standalone)').matches
			? 'standalone'
			: 'browser'
	});
	started = true;
}

function track(event: string, props: Record<string, unknown>, opts?: { sendBeacon?: boolean }): void {
	if (!ENABLED) return;
	const transport = opts?.sendBeacon ? { transport: 'sendBeacon' as const } : undefined;
	mixpanel.track(event, props, transport as Parameters<typeof mixpanel.track>[2]);
}

// ---------------- Page views ----------------

export function trackPageView(path: string): void {
	track('page_viewed', { path });
}

// ---------------- Miniapp click ----------------

export type MiniappClickPayload = {
	slug: string;
	name: string;
	category?: string;
	tags?: string[];
	position?: number;
	total_visible?: number;
	entry_source: 'tile_popup' | 'playground';
};

export function trackMiniappClicked(payload: MiniappClickPayload): void {
	track('miniapp_clicked', payload as unknown as Record<string, unknown>);
}

// ---------------- Iframe load lifecycle ----------------

export function trackMiniappIframeLoaded(payload: {
	slug: string;
	name?: string;
	load_ms: number;
}): void {
	track('miniapp_iframe_loaded', payload);
}

export function trackMiniappIframeLoadFailed(payload: {
	slug: string;
	name?: string;
	time_to_timeout_ms: number;
	is_offline: boolean;
}): void {
	track('miniapp_iframe_load_failed', payload);
}

// ---------------- Wallet protocol ----------------

export function trackMiniappRequestedAddress(payload: {
	slug: string;
	name?: string;
	wallet_connected: boolean;
	seconds_since_load?: number;
}): void {
	track('miniapp_requested_address', payload);
}

export function trackMiniappRequestedTransaction(payload: {
	slug: string;
	name?: string;
	tx_count: number;
	had_wallet: boolean;
	seconds_since_load?: number;
}): void {
	track('miniapp_requested_transaction', payload);
}

export function trackMiniappRequestedSignature(payload: {
	slug: string;
	name?: string;
	signature_type: 'erc1271' | 'raw';
}): void {
	track('miniapp_requested_signature', payload);
}

export function trackMiniappTxApproved(payload: {
	slug: string;
	name?: string;
	tx_count: number;
	approve_latency_ms?: number;
}): void {
	track('miniapp_tx_approved', payload);
}

export function trackMiniappTxRejected(payload: {
	slug: string;
	name?: string;
	reject_reason: 'user_rejected' | 'no_wallet' | 'invalid_data';
}): void {
	track('miniapp_tx_rejected', payload);
}

export function trackMiniappTxPolicyBlocked(payload: {
	slug: string;
	name?: string;
	reason: string;
}): void {
	track('miniapp_tx_policy_blocked', payload);
}

export function trackMiniappSignApproved(payload: {
	slug: string;
	name?: string;
	signature_type: 'erc1271' | 'raw';
}): void {
	track('miniapp_sign_approved', payload);
}

export function trackMiniappSignRejected(payload: {
	slug: string;
	name?: string;
	reject_reason: 'user_rejected' | 'no_wallet' | 'invalid_data';
}): void {
	track('miniapp_sign_rejected', payload);
}

// ---------------- Session (time spent per miniapp) ----------------

type Session = {
	slug: string;
	name?: string;
	category?: string;
	activeMs: number;
	lastResumeAt: number; // 0 when paused
};

let session: Session | null = null;

export function startMiniappSession(slug: string, name?: string, category?: string): void {
	endMiniappSession();
	session = { slug, name, category, activeMs: 0, lastResumeAt: Date.now() };
}

export function enrichMiniappSession(name?: string, category?: string): void {
	if (!session) return;
	if (name) session.name = name;
	if (category) session.category = category;
}

export function pauseMiniappSession(): void {
	if (!session || session.lastResumeAt === 0) return;
	session.activeMs += Date.now() - session.lastResumeAt;
	session.lastResumeAt = 0;
}

export function resumeMiniappSession(): void {
	if (!session || session.lastResumeAt !== 0) return;
	session.lastResumeAt = Date.now();
}

export function endMiniappSession(): void {
	if (!session) return;
	if (session.lastResumeAt !== 0) {
		session.activeMs += Date.now() - session.lastResumeAt;
	}
	const { slug, name, category, activeMs } = session;
	session = null;
	if (activeMs < 1000) return;
	track(
		'miniapp_session_ended',
		{
			slug,
			name,
			category,
			duration_ms: activeMs,
			duration_seconds: Math.round(activeMs / 1000)
		},
		{ sendBeacon: true }
	);
}
