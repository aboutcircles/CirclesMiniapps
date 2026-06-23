<script lang="ts">
	import {
		scoreBand,
		headlineScore,
		shortAddress,
		checksumAddress,
		type Address,
		type AvatarScore,
		type DerivedScore,
		type ResolvedProfile
	} from '$lib/repscore';
	import Skeleton from './Skeleton.svelte';

	let {
		address,
		avatar,
		profile,
		score,
		loading = false
	}: {
		address: Address;
		avatar: AvatarScore | null;
		profile: ResolvedProfile | null;
		score: DerivedScore | null;
		loading?: boolean;
	} = $props();

	// Headline still works if /config failed (score null) by reading the payload directly.
	const headline = $derived(score ? score.headline : avatar ? headlineScore(avatar) : null);
	const band = $derived(headline === null ? 'none' : scoreBand(headline));
	const bandWord = $derived(
		({ none: 'New', low: 'Building', medium: 'Established', high: 'Strong' } as const)[band]
	);
	const isMember = $derived(avatar ? avatar.is_member !== false : true);
	const blacklisted = $derived(avatar?.blacklisted === true);
	const coldStart = $derived(headline === 0 && isMember && !blacklisted);

	const typeLabel = $derived(
		profile?.avatarType
			? { human: 'Human', group: 'Group', organization: 'Organization' }[profile.avatarType]
			: null
	);

	let copied = $state(false);
	async function copyAddr() {
		try {
			await navigator.clipboard.writeText(address);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			/* clipboard unavailable — ignore */
		}
	}
</script>

<div class="header">
	<div class="identity">
		<div class="avatar">
			{#if profile}
				<img src={profile.imageUrl} alt="" />
			{:else}
				<Skeleton width="56px" height="56px" radius="50%" />
			{/if}
		</div>
		<div class="who">
			{#if profile}
				<div class="name-row">
					<span class="name" title={profile.name}>{profile.name}</span>
					{#if typeLabel}<span class="type">{typeLabel}</span>{/if}
				</div>
			{:else}
				<Skeleton width="120px" height="18px" />
			{/if}
			<button class="addr" type="button" onclick={copyAddr} title="Copy address">
				<span class="mono">{shortAddress(checksumAddress(address))}</span>
				<span class="copy">{copied ? 'Copied' : 'Copy'}</span>
			</button>
		</div>
	</div>

	<div class="score-block">
		<span class="score-label">Reputation score</span>
		{#if loading || headline === null}
			<Skeleton width="96px" height="56px" radius="14px" />
		{:else}
			<div class="score band-{band}">{headline}</div>
			<span class="band-word band-{band}">{bandWord}</span>
		{/if}
	</div>
</div>

{#if blacklisted}
	<div class="banner err">This avatar is blacklisted in this group.</div>
{:else if avatar && !isMember}
	<div class="banner warn">Not a member of this group yet — limited data available.</div>
{:else if coldStart}
	<div class="banner info">
		Just getting started. Reputation grows with trusted activity — a fresh avatar sits near zero,
		which is completely normal.
	</div>
{:else if score?.isNegative}
	<div class="banner info">
		The underlying signed score is below zero, so the headline is shown as 0. See Advanced for the
		raw value.
	</div>
{/if}

<style>
	.header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		background: var(--card);
		border: 1px solid var(--line);
		border-radius: var(--radius-card);
		box-shadow: var(--shadow-card);
		padding: 18px;
		margin-bottom: 14px;
	}
	.identity {
		display: flex;
		align-items: center;
		gap: 14px;
		min-width: 0;
	}
	.avatar {
		width: 56px;
		height: 56px;
		border-radius: 50%;
		overflow: hidden;
		flex-shrink: 0;
		background: var(--accent-soft);
		border: 1px solid var(--line);
	}
	.avatar img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.who {
		min-width: 0;
	}
	.name-row {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.name {
		font-size: 17px;
		font-weight: 700;
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 150px;
	}
	.type {
		flex-shrink: 0;
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--accent);
		background: var(--accent-soft);
		border-radius: var(--radius-pill);
		padding: 2px 7px;
	}
	.addr {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		margin-top: 5px;
		background: transparent;
		border: none;
		padding: 0;
		cursor: pointer;
		color: var(--muted);
	}
	.addr .mono {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 12px;
	}
	.addr .copy {
		font-size: 10px;
		font-weight: 600;
		color: var(--accent-mid);
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}
	.score-block {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		flex-shrink: 0;
	}
	.score-label {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--muted);
		margin-bottom: 2px;
	}
	.score {
		font-size: 46px;
		font-weight: 700;
		line-height: 1;
		letter-spacing: -0.02em;
		font-variant-numeric: tabular-nums;
	}
	.band-word {
		font-size: 11px;
		font-weight: 600;
		margin-top: 4px;
	}
	.band-none {
		color: var(--muted);
	}
	.band-low {
		color: var(--warn-ink);
	}
	.band-medium {
		color: var(--accent-mid);
	}
	.band-high {
		color: var(--accent);
	}
	.banner {
		border-radius: 14px;
		padding: 11px 14px;
		font-size: 13px;
		line-height: 1.45;
		margin-bottom: 14px;
	}
	.banner.err {
		background: var(--error-bg);
		color: var(--error-ink);
	}
	.banner.warn {
		background: var(--warn-bg);
		color: var(--warn-ink);
	}
	.banner.info {
		background: var(--accent-soft);
		color: var(--accent);
	}
</style>
