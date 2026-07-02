<script lang="ts">
	/**
	 * Rep Score Explorer — standalone (Vercel-hosted) root component.
	 *
	 * Mounted by main.ts. This is the hosted build: deployed to Vercel and surfaced
	 * in the Circles wallet at /admin/rep-score-explorer, which iframes the deployed
	 * URL. Read-only: it uses the miniapp-sdk bridge only to learn the connected
	 * wallet (Mode A); a search box looks up any address (Mode B). No transactions,
	 * no signing.
	 *
	 * Mirrors the embedded route src/routes/apps/rep-score-explorer/+page.svelte.
	 * All data access + maths live in the framework-agnostic $lib/repscore layer,
	 * copied verbatim from the embedded route; this file is orchestration + layout.
	 */
	import { onMount } from 'svelte';
	import { onWalletChange, isMiniappMode } from '@aboutcircles/miniapp-sdk';
	import {
		resolveEnv,
		getRepScoreClient,
		fetchFocalProfile,
		searchProfiles,
		fetchProfilesBatch,
		deriveScore,
		deriveStages,
		gateActiveForAvatar,
		toChartPoints,
		filterByTimeframe,
		downsample,
		summarize,
		deriveTimeline,
		normalizeAddress,
		fmtNumber,
		NotFoundError,
		type Address,
		type Async,
		type AvatarScore,
		type GroupInfo,
		type HistoryItem,
		type NeighboursResponse,
		type RepConfig,
		type ResolvedProfile,
		type Timeframe
	} from '$lib/repscore';

	import IdentityHeader from './components/IdentityHeader.svelte';
	import TabBar from './components/TabBar.svelte';
	import StatusBanner from './components/StatusBanner.svelte';
	import AddressSearch from './components/AddressSearch.svelte';
	import SectionCard from './components/SectionCard.svelte';
	import ScoreSparkChart from './components/ScoreSparkChart.svelte';
	import EventTimeline from './components/EventTimeline.svelte';
	import BreakdownPanel from './components/BreakdownPanel.svelte';
	import TrustNeighbourhood from './components/TrustNeighbourhood.svelte';
	import EconomicSnapshot from './components/EconomicSnapshot.svelte';
	import AdvancedDisclosure from './components/AdvancedDisclosure.svelte';
	import DebugPanel from './components/DebugPanel.svelte';

	const env = resolveEnv(import.meta.env);
	const client = getRepScoreClient(env);
	const envLabel = env.repBase.includes('staging') ? 'staging' : 'production';

	// ─── State ──────────────────────────────────────────────────
	let inHost = $state(false);
	let hostAddress = $state<Address | null>(null);
	let target = $state<Address | null>(null);

	let cfgCell = $state<Async<RepConfig>>({ kind: 'idle' });
	let avatarCell = $state<Async<AvatarScore>>({ kind: 'idle' });
	let profCell = $state<Async<ResolvedProfile>>({ kind: 'idle' });
	let historyCell = $state<Async<HistoryItem[]>>({ kind: 'idle' });
	let neighboursCell = $state<Async<{ data: NeighboursResponse; profiles: Map<string, ResolvedProfile> }>>({
		kind: 'idle'
	});
	let groupInfo = $state<GroupInfo | null>(null);
	let timeframe = $state<Timeframe>('7d');

	type TabKey = 'overview' | 'breakdown' | 'trust' | 'economic' | 'advanced' | 'debug';
	let tab = $state<TabKey>('overview');
	let urlDebug = $state(false);
	const debugEnabled = $derived(env.debug || urlDebug);
	const TABS = $derived([
		{ key: 'overview', label: 'Overview' },
		{ key: 'breakdown', label: 'Breakdown' },
		{ key: 'trust', label: 'Trust' },
		{ key: 'economic', label: 'Economic' },
		{ key: 'advanced', label: 'Advanced' },
		...(debugEnabled ? [{ key: 'debug', label: 'Debug' }] : [])
	]);

	// ─── Derived view-models ────────────────────────────────────
	const cfg = $derived(cfgCell.kind === 'ok' ? cfgCell.value : null);
	const stages = $derived(cfg ? deriveStages(cfg) : null);
	const avatar = $derived(avatarCell.kind === 'ok' ? avatarCell.value : null);
	const profile = $derived(profCell.kind === 'ok' ? profCell.value : null);
	const comp = $derived(avatar?.components ?? null);
	const derivedScore = $derived(avatar && cfg ? deriveScore(avatar, cfg) : null);
	const ready = $derived(!!(derivedScore && cfg && stages && comp));

	const historyItems = $derived(historyCell.kind === 'ok' ? historyCell.value : []);
	const chartAll = $derived(toChartPoints(historyItems));
	const chartView = $derived(downsample(filterByTimeframe(chartAll, timeframe, Date.now()), 120));
	const chartSummary = $derived(summarize(chartView));
	const timeline = $derived(cfg ? deriveTimeline(historyItems, cfg) : []);

	const gateActive = $derived(
		stages && comp?.gate?.live ? gateActiveForAvatar(stages.gate, comp.gate.live) : false
	);

	const notFound = $derived(avatarCell.kind === 'error' && avatarCell.error === 'not-found');
	const isMember = $derived(avatar ? avatar.is_member !== false : true);

	// ─── Loading ────────────────────────────────────────────────
	function errMsg(e: unknown): string {
		return e instanceof Error ? e.message : 'Something went wrong';
	}
	function isAbort(e: unknown): boolean {
		return e instanceof Error && e.name === 'AbortError';
	}

	async function loadConfig() {
		cfgCell = { kind: 'loading' };
		try {
			const c = await client.getConfig();
			cfgCell = { kind: 'ok', value: c };
		} catch (e) {
			cfgCell = { kind: 'error', error: errMsg(e) };
		}
		try {
			const groups = await client.getGroups();
			groupInfo = groups.find((g) => g.id === env.groupId) ?? groups[0] ?? null;
		} catch {
			/* non-fatal */
		}
	}

	let activeController: AbortController | null = null;

	async function loadForTarget(addr: Address) {
		target = addr;
		tab = 'overview';
		activeController?.abort();
		const controller = new AbortController();
		activeController = controller;
		const signal = controller.signal;

		avatarCell = { kind: 'loading' };
		profCell = { kind: 'loading' };
		historyCell = { kind: 'idle' };
		neighboursCell = { kind: 'idle' };

		// Phase 1 — header first
		fetchFocalProfile(env, addr).then((p) => {
			if (!signal.aborted) profCell = { kind: 'ok', value: p };
		});

		let a: AvatarScore | null = null;
		try {
			a = await client.getAvatar(addr, signal);
			if (signal.aborted) return;
			avatarCell = { kind: 'ok', value: a };
		} catch (e) {
			if (signal.aborted || isAbort(e)) return;
			avatarCell = { kind: 'error', error: e instanceof NotFoundError ? 'not-found' : errMsg(e) };
			return;
		}

		// Phase 2 — heavier sections, only meaningful for members with components
		if (a && a.is_member !== false) {
			loadHistory(addr, signal);
			loadNeighbours(addr, signal);
		} else {
			historyCell = { kind: 'ok', value: [] };
			neighboursCell = {
				kind: 'ok',
				value: { data: { total_neighbours: 0, neighbours: [] }, profiles: new Map() }
			};
		}
	}

	async function loadHistory(addr: Address, signal: AbortSignal) {
		historyCell = { kind: 'loading' };
		try {
			const items = await client.getHistory(addr, { signal });
			if (!signal.aborted) historyCell = { kind: 'ok', value: items };
		} catch (e) {
			if (!signal.aborted && !isAbort(e)) historyCell = { kind: 'error', error: errMsg(e) };
		}
	}

	async function loadNeighbours(addr: Address, signal: AbortSignal) {
		neighboursCell = { kind: 'loading' };
		try {
			const data = await client.getNeighbours(addr, 80, signal);
			if (signal.aborted) return;
			const profiles = await fetchProfilesBatch(
				env,
				data.neighbours.map((n) => n.address)
			);
			if (signal.aborted) return;
			neighboursCell = { kind: 'ok', value: { data, profiles } };
		} catch (e) {
			if (!signal.aborted && !isAbort(e)) neighboursCell = { kind: 'error', error: errMsg(e) };
		}
	}

	function onSearch(addr: Address) {
		loadForTarget(addr);
	}
	const doSearch = (q: string) => searchProfiles(env, q);
	function viewMine() {
		if (hostAddress) loadForTarget(hostAddress);
	}

	onMount(() => {
		inHost = isMiniappMode();
		const dbg = new URLSearchParams(window.location.search).get('debug');
		urlDebug = dbg === '1' || dbg === 'true';
		loadConfig();
		const unsub = onWalletChange((address) => {
			if (address) {
				const norm = normalizeAddress(address);
				// Mode A auto-follow: if the user was viewing their own score, refresh
				// to the new account when the host wallet switches.
				const wasMine = target !== null && target === hostAddress;
				hostAddress = norm;
				if (norm && (!target || wasMine)) loadForTarget(norm);
			} else {
				hostAddress = null;
			}
		});
		return () => {
			activeController?.abort();
			unsub();
		};
	});
</script>

<svelte:head>
	<title>Rep Score Explorer</title>
	<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
</svelte:head>

<div class="app">
	<header class="app-head">
		<h1>Rep Score Explorer</h1>
		<p>See any Circles avatar's reputation — the score, how it moved, and what drives it.</p>
	</header>

	{#if env.searchEnabled}
		<div class="search-area">
			<AddressSearch
				onsubmit={onSearch}
					onsearch={doSearch}
				busy={avatarCell.kind === 'loading'}
				canUseMine={!!hostAddress && target !== hostAddress}
				onmine={viewMine}
			/>
		</div>
	{/if}

	{#if cfgCell.kind === 'error'}
		<div class="notice warn">
			Couldn't load the scoring configuration — some breakdowns are hidden.
			<button type="button" onclick={loadConfig}>Retry</button>
		</div>
	{/if}

	{#if target === null}
		<!-- Landing -->
		{#if !env.searchEnabled && !hostAddress}
			<div class="landing">
				<div class="landing-emoji">✨</div>
				<h2>Open from your Circles wallet</h2>
				<p>Launch this from the Circles app to see your reputation score.</p>
			</div>
		{:else if hostAddress}
			<div class="landing"><p>Loading your score…</p></div>
		{:else}
			<div class="landing">
				<div class="landing-emoji">🔍</div>
				<h2>Look up a reputation score</h2>
				<p>
					Paste any <code>0x</code> address above{inHost ? ', or open from your wallet to see your own.' : '.'}
				</p>
				{#if !inHost}
					<p class="aside">Running outside the Circles app — your own score needs the host.</p>
				{/if}
			</div>
		{/if}
	{:else}
		<!-- Avatar view -->
		<div class="sticky-zone">
			<IdentityHeader
				address={target}
				{avatar}
				{profile}
				score={derivedScore}
				loading={avatarCell.kind === 'loading'}
			/>
			{#if avatar && comp && isMember}
				<TabBar tabs={TABS} active={tab} onselect={(k) => (tab = k as TabKey)} />
			{/if}
		</div>

		<StatusBanner {avatar} score={derivedScore} />

		{#if avatarCell.kind === 'error' && !notFound}
			<div class="notice err">
				Couldn't load this avatar — {avatarCell.error}.
				<button type="button" onclick={() => target && loadForTarget(target)}>Try again</button>
			</div>
		{:else if notFound}
			<SectionCard title="No reputation record">
				<p class="plain">
					This address isn't scored in the {groupInfo?.id ?? env.groupId} group. It may be brand new,
					not a member, or have no activity yet.
				</p>
			</SectionCard>
		{:else if avatar && !isMember}
			<SectionCard title="Not a group member">
				<p class="plain">
					This avatar isn't a member of the {groupInfo?.id ?? env.groupId} group, so there's no score
					breakdown to show.
				</p>
			</SectionCard>
		{:else if avatar && comp}
			<div
				class="tab-panel"
				role="tabpanel"
				id="rs-tabpanel"
				aria-labelledby={`rs-tab-${tab}`}
				tabindex="0"
			>
				{#if tab === 'overview'}
					<SectionCard title="Reputation over time">
						<ScoreSparkChart
							points={chartView}
							{timeframe}
							ontimeframe={(tf) => (timeframe = tf)}
							summary={chartSummary}
							loading={historyCell.kind === 'loading' || historyCell.kind === 'idle'}
						/>
					</SectionCard>
					<SectionCard title="What changed" subtitle="Recent score movements and why">
						<EventTimeline
							events={timeline}
							loading={historyCell.kind === 'loading' || historyCell.kind === 'idle'}
						/>
					</SectionCard>
				{:else if tab === 'economic'}
					<div class="tab-narrow">
						<SectionCard title="Economic snapshot">
							<EconomicSnapshot
								gate={comp.gate.live}
								ema={comp.behaviour.ema_primitives}
								{gateActive}
							/>
						</SectionCard>
					</div>
				{:else if tab === 'breakdown'}
					{#if ready && derivedScore && cfg && stages}
						<SectionCard title="Why this score" subtitle="Behaviour, boosts and how they combine">
							<BreakdownPanel {avatar} score={derivedScore} {cfg} {stages} {gateActive} />
						</SectionCard>
					{:else}
						<SectionCard title="Why this score">
							<p class="plain">Scoring configuration is unavailable right now.</p>
						</SectionCard>
					{/if}
				{:else if tab === 'trust'}
					<SectionCard title="Trust neighbourhood">
						{#if neighboursCell.kind === 'ok'}
							<TrustNeighbourhood
								neighbours={neighboursCell.value.data.neighbours}
								profiles={neighboursCell.value.profiles}
								total={neighboursCell.value.data.total_neighbours}
							/>
						{:else if neighboursCell.kind === 'error'}
							<p class="plain">Couldn't load trust connections.</p>
						{:else}
							<TrustNeighbourhood neighbours={[]} profiles={new Map()} total={0} loading />
						{/if}
					</SectionCard>
				{:else if tab === 'advanced'}
					{#if ready && derivedScore && cfg}
						<AdvancedDisclosure {avatar} score={derivedScore} {cfg} inline />
					{:else}
						<SectionCard title="Advanced">
							<p class="plain">Scoring configuration is unavailable right now.</p>
						</SectionCard>
					{/if}
				{:else if tab === 'debug'}
					<DebugPanel
						{env}
						address={target}
						cfg={cfgCell.kind === 'ok' ? cfgCell.value : null}
						{avatar}
						history={historyItems}
						neighbours={neighboursCell.kind === 'ok' ? neighboursCell.value.data : null}
						{profile}
						score={derivedScore}
					/>
				{/if}
			</div>
		{/if}
	{/if}

	<footer class="app-foot">
		<span>
			Data: {envLabel} · group {groupInfo?.id ?? env.groupId}{#if groupInfo}
				· {fmtNumber(groupInfo.member_count, 0)} members{/if}
		</span>
		<span>Read-only · scores from the Circles reputation pipeline</span>
	</footer>
</div>

<style>
	/*
	 * The global reset sets `html, body { overflow-x: hidden }`, which forces
	 * overflow-y to `auto` and makes <body> a scroll container that isn't the one
	 * actually scrolling — that breaks `position: sticky`. `clip` prevents the
	 * horizontal overflow without creating a scroll container, so sticky works.
	 * This mini app renders in its own iframe document, so the override is local.
	 */
	:global(:root) {
		overflow-x: clip;
	}
	:global(html > body) {
		overflow-x: clip;
	}

	.app {
		max-width: 560px;
		margin: 0 auto;
		padding: 18px 16px 40px;
		min-height: 100vh;
	}
	/* Use the screen on desktop (mostly an internal desktop tool). */
	@media (min-width: 880px) {
		.app {
			max-width: 1080px;
			padding: 22px 24px 56px;
		}
	}
	/* Sticky identity + tabs so the who/score/nav never scroll away. */
	.sticky-zone {
		position: sticky;
		top: 0;
		z-index: 20;
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin: 0 -16px 14px;
		padding: 10px 16px;
		background: rgba(250, 245, 241, 0.86);
		backdrop-filter: blur(10px);
		-webkit-backdrop-filter: blur(10px);
	}
	@media (min-width: 880px) {
		.sticky-zone {
			margin: 0 -24px 16px;
			padding: 12px 24px;
		}
	}
	.tab-panel {
		min-height: 40vh;
	}
	.tab-narrow {
		max-width: 640px;
		margin: 0 auto;
	}
	.app-head {
		margin-bottom: 16px;
	}
	.app-head h1 {
		font-size: 22px;
		font-weight: 700;
		letter-spacing: -0.02em;
		color: var(--ink);
		margin: 0;
	}
	.app-head p {
		font-size: 13px;
		color: var(--muted);
		margin: 5px 0 0;
		line-height: 1.45;
	}
	.search-area {
		/* Own stacking context above the sticky identity/tabs zone (z-index: 20),
		   so the avatar-search dropdown overlays it instead of hiding behind. */
		position: relative;
		z-index: 30;
		margin-bottom: 16px;
	}
	.landing {
		text-align: center;
		padding: 48px 20px;
		background: var(--card);
		border: 1px solid var(--line);
		border-radius: var(--radius-card);
		box-shadow: var(--shadow-card);
	}
	.landing-emoji {
		font-size: 34px;
		margin-bottom: 10px;
	}
	.landing h2 {
		font-size: 17px;
		font-weight: 600;
		color: var(--ink);
		margin: 0 0 6px;
	}
	.landing p {
		font-size: 13px;
		color: var(--muted);
		margin: 0;
		line-height: 1.5;
	}
	.landing .aside {
		margin-top: 12px;
		font-size: 12px;
		opacity: 0.85;
	}
	code {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.92em;
		background: var(--bg-b);
		padding: 1px 5px;
		border-radius: 5px;
	}
	.notice {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
		border-radius: 14px;
		padding: 11px 14px;
		font-size: 13px;
		margin-bottom: 14px;
	}
	.notice.warn {
		background: var(--warn-bg);
		color: var(--warn-ink);
	}
	.notice.err {
		background: var(--error-bg);
		color: var(--error-ink);
	}
	.notice button {
		background: rgba(255, 255, 255, 0.5);
		border: 1px solid currentColor;
		border-radius: var(--radius-pill);
		padding: 4px 12px;
		font-family: inherit;
		font-size: 12px;
		font-weight: 600;
		color: inherit;
		cursor: pointer;
	}
	.plain {
		font-size: 13px;
		color: var(--muted);
		line-height: 1.5;
		margin: 0;
	}
	.app-foot {
		display: flex;
		flex-direction: column;
		gap: 3px;
		margin-top: 22px;
		text-align: center;
		font-size: 11px;
		color: var(--muted);
	}
</style>
