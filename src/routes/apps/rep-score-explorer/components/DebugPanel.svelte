<script lang="ts">
	/**
	 * Developer verification panel (gated behind ?debug=1 / VITE_REP_SCORE_DEBUG).
	 * Cross-checks the app's recomputed values against the API's own fields, and
	 * exposes the raw responses + exact request URLs so the data can be verified
	 * against the source (dashboard / RPC).
	 */
	import type {
		Address,
		AvatarScore,
		DerivedScore,
		HistoryItem,
		NeighboursResponse,
		RepConfig,
		RepEnv,
		ResolvedProfile
	} from '$lib/repscore';

	let {
		env,
		address,
		cfg,
		avatar,
		history,
		neighbours,
		profile,
		score
	}: {
		env: RepEnv;
		address: Address;
		cfg: RepConfig | null;
		avatar: AvatarScore | null;
		history: HistoryItem[];
		neighbours: NeighboursResponse | null;
		profile: ResolvedProfile | null;
		score: DerivedScore | null;
	} = $props();

	const envLabel = $derived(env.repBase.includes('staging') ? 'staging' : 'production');
	const g = $derived(encodeURIComponent(env.groupId));
	const a = $derived(encodeURIComponent(address.toLowerCase()));

	interface Endpoint {
		key: string;
		method: 'GET' | 'POST';
		url: string;
		note?: string;
		data: unknown;
	}
	const endpoints = $derived<Endpoint[]>([
		{ key: 'config', method: 'GET', url: `${env.repBase}/config`, data: cfg },
		{ key: 'avatar', method: 'GET', url: `${env.repBase}/groups/${g}/avatars/${a}`, data: avatar },
		{
			key: 'history',
			method: 'GET',
			url: `${env.repBase}/groups/${g}/avatars/${a}/history?limit=500&offset=0`,
			note: `${history.length} item(s) loaded`,
			data: history
		},
		{
			key: 'neighbours',
			method: 'GET',
			url: `${env.repBase}/groups/${g}/avatars/${a}/neighbours?max_neighbours=80`,
			data: neighbours
		},
		{ key: 'profile', method: 'GET', url: `${env.profileBase}/${a}`, data: profile?.raw ?? null },
		{
			key: 'profile batch (RPC)',
			method: 'POST',
			url: env.rpcBase,
			note: 'method: circles_getProfileByAddressBatch · params: [[neighbour addresses]]',
			data: null
		}
	]);

	const c = $derived(avatar?.components ?? null);

	interface Check {
		label: string;
		app: number;
		api: number;
		int?: boolean;
	}
	const checks = $derived<Check[]>(
		score && c && avatar
			? [
					{ label: 'headline = max(0, round(live))', app: score.headline, api: Math.max(0, Math.round(avatar.reputation_score_live ?? 0)), int: true },
					{ label: 'reputation_score_live (round)', app: score.liveRounded, api: Math.round(avatar.reputation_score_live ?? 0), int: true },
					{ label: 's_b', app: score.sB, api: c.behaviour.s_b },
					{ label: 'base', app: score.base, api: c.composition.base },
					{ label: 'B_total', app: score.bTotal, api: c.boost.B_total },
					{ label: 's_user_raw', app: score.sUserRaw, api: c.composition.s_user_raw },
					{ label: 's_user_gated', app: score.sUserGated, api: c.gate.live.s_user_gated },
					{ label: 's_user (clipped)', app: score.clipped, api: c.gate.live.s_user }
				]
			: []
	);
	function ok(ch: Check): boolean {
		return ch.int ? Math.round(ch.app) === Math.round(ch.api) : Math.abs(ch.app - ch.api) < 1e-6;
	}
	const allOk = $derived(checks.length > 0 && checks.every(ok));
	function num(n: number): string {
		if (!Number.isFinite(n)) return String(n);
		return Math.abs(n) >= 1000 || Number.isInteger(n) ? String(n) : n.toPrecision(8);
	}

	let open = $state<Record<string, boolean>>({});
	function toggle(k: string) {
		open[k] = !open[k];
	}
	let copiedKey = $state<string | null>(null);
	async function copy(k: string, text: string) {
		try {
			await navigator.clipboard.writeText(text);
			copiedKey = k;
			setTimeout(() => (copiedKey = null), 1200);
		} catch {
			/* clipboard unavailable */
		}
	}
	function pretty(v: unknown): string {
		try {
			return JSON.stringify(v, null, 2);
		} catch {
			return String(v);
		}
	}
</script>

<div class="dbg">
	<div class="warn-row">⚠️ Developer panel — not shown in the consumer build (gate: <code>?debug=1</code>).</div>

	<section class="card">
		<h3>Environment</h3>
		<div class="kv"><span>environment</span><b>{envLabel}</b></div>
		<div class="kv"><span>group</span><b>{env.groupId}</b></div>
		<div class="kv"><span>address</span><b class="mono">{address}</b></div>
		<div class="kv"><span>rep base</span><b class="mono sm">{env.repBase}</b></div>
		<div class="kv"><span>rpc base</span><b class="mono sm">{env.rpcBase}</b></div>
		<div class="kv"><span>profile base</span><b class="mono sm">{env.profileBase}</b></div>
	</section>

	<section class="card">
		<h3>
			App ↔ API cross-check
			{#if checks.length}
				<span class="badge" class:good={allOk} class:bad={!allOk}>{allOk ? 'all match' : 'mismatch'}</span>
			{/if}
		</h3>
		<p class="lead">The app recomputes the pipeline from <code>components</code> using <code>/config</code>; these should equal the API's own fields.</p>
		{#if checks.length === 0}
			<p class="lead">No scored avatar loaded.</p>
		{:else}
			<div class="ck head"><span>field</span><span>app (computed)</span><span>api (raw)</span><span></span></div>
			{#each checks as ch (ch.label)}
				<div class="ck">
					<span class="mono sm">{ch.label}</span>
					<span class="mono num">{num(ch.app)}</span>
					<span class="mono num">{num(ch.api)}</span>
					<span class="mark">{ok(ch) ? '✓' : '✗'}</span>
				</div>
			{/each}
		{/if}
	</section>

	<section class="card">
		<h3>Endpoints &amp; raw responses</h3>
		{#each endpoints as ep (ep.key)}
			<div class="ep">
				<div class="ep-head">
					<span class="m">{ep.method}</span>
					<span class="ep-key">{ep.key}</span>
					{#if ep.data !== null && ep.data !== undefined}
						<button class="link" type="button" onclick={() => toggle(ep.key)}>{open[ep.key] ? 'hide' : 'raw'}</button>
						<button class="link" type="button" onclick={() => copy(ep.key, pretty(ep.data))}>{copiedKey === ep.key ? 'copied' : 'copy'}</button>
					{/if}
				</div>
				<div class="ep-url">
					{#if ep.method === 'GET'}
						<a href={ep.url} target="_blank" rel="noopener" class="mono sm">{ep.url}</a>
					{:else}
						<span class="mono sm">{ep.url}</span>
					{/if}
					<button class="link" type="button" onclick={() => copy(`url-${ep.key}`, ep.url)}>{copiedKey === `url-${ep.key}` ? 'copied' : 'copy url'}</button>
				</div>
				{#if ep.note}<div class="ep-note">{ep.note}</div>{/if}
				{#if open[ep.key]}
					<pre>{pretty(ep.data)}</pre>
				{/if}
			</div>
		{/each}
	</section>
</div>

<style>
	.dbg {
		font-size: 13px;
	}
	.warn-row {
		background: var(--warn-bg);
		color: var(--warn-ink);
		border-radius: 12px;
		padding: 9px 12px;
		font-size: 12px;
		margin-bottom: 14px;
	}
	.card {
		background: var(--card);
		border: 1px solid var(--line);
		border-radius: var(--radius-card);
		box-shadow: var(--shadow-card);
		padding: 16px 18px;
		margin-bottom: 14px;
	}
	h3 {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 14px;
		font-weight: 600;
		color: var(--ink);
		margin: 0 0 10px;
	}
	.lead {
		font-size: 12px;
		color: var(--muted);
		margin: 0 0 10px;
		line-height: 1.45;
	}
	.kv {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 6px 0;
		border-bottom: 1px solid var(--line-soft);
	}
	.kv:last-child {
		border-bottom: none;
	}
	.kv span {
		color: var(--muted);
	}
	.mono {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
	}
	.sm {
		font-size: 11px;
		word-break: break-all;
	}
	.num {
		text-align: right;
	}
	.badge {
		font-size: 11px;
		font-weight: 600;
		padding: 2px 9px;
		border-radius: var(--radius-pill);
	}
	.badge.good {
		background: var(--success-bg);
		color: var(--success-ink);
	}
	.badge.bad {
		background: var(--error-bg);
		color: var(--error-ink);
	}
	.ck {
		display: grid;
		grid-template-columns: 1.6fr 1fr 1fr 24px;
		gap: 8px;
		align-items: center;
		padding: 6px 0;
		border-bottom: 1px solid var(--line-soft);
	}
	.ck.head {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--muted);
		font-weight: 600;
	}
	.ck.head span {
		text-align: inherit;
	}
	.ck .mark {
		text-align: center;
		font-weight: 700;
	}
	.ep {
		padding: 10px 0;
		border-bottom: 1px solid var(--line-soft);
	}
	.ep:last-child {
		border-bottom: none;
	}
	.ep-head {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.m {
		font-size: 10px;
		font-weight: 700;
		color: var(--accent);
		background: var(--accent-soft);
		border-radius: 5px;
		padding: 1px 6px;
	}
	.ep-key {
		font-weight: 600;
		flex: 1;
	}
	.link {
		background: transparent;
		border: none;
		color: var(--accent-mid);
		font-family: inherit;
		font-size: 11px;
		font-weight: 600;
		cursor: pointer;
		padding: 2px 4px;
	}
	.ep-url {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 4px;
	}
	.ep-url a {
		color: var(--accent-mid);
		flex: 1;
	}
	.ep-note {
		font-size: 11px;
		color: var(--muted);
		margin-top: 4px;
	}
	pre {
		margin: 8px 0 0;
		padding: 12px;
		background: #0d0e24;
		color: #e6e6f0;
		border-radius: 10px;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 11px;
		line-height: 1.5;
		max-height: 460px;
		overflow: auto;
		white-space: pre;
	}
	code {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.92em;
		background: var(--bg-b);
		padding: 1px 5px;
		border-radius: 5px;
	}
</style>
