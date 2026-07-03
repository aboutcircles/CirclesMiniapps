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

<div class="idh">
	<div class="who">
		<div class="avatar">
			{#if profile}
				<img src={profile.imageUrl} alt="" />
			{:else}
				<Skeleton width="44px" height="44px" radius="50%" />
			{/if}
		</div>
		<div class="meta">
			{#if profile}
				<div class="name-row">
					<span class="name" title={profile.name}>{profile.name}</span>
					{#if typeLabel}<span class="type">{typeLabel}</span>{/if}
				</div>
			{:else}
				<Skeleton width="120px" height="17px" />
			{/if}
			<button class="addr" type="button" onclick={copyAddr} title="Copy address">
				<span class="mono">{shortAddress(checksumAddress(address))}</span>
				<span class="copy">{copied ? 'Copied' : 'Copy'}</span>
			</button>
		</div>
	</div>

	<div class="score-block">
		<span class="score-label">Rep score</span>
		{#if loading}
			<Skeleton width="64px" height="34px" radius="10px" />
		{:else if headline === null}
			<div class="score-row">
				<span class="score band-none">—</span>
				<span class="band-word band-none">Unavailable</span>
			</div>
		{:else}
			<div class="score-row">
				<span class="score band-{band}">{headline}</span>
				<span class="band-word band-{band}">{bandWord}</span>
			</div>
		{/if}
	</div>
</div>

<style>
	.idh {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 14px;
		background: var(--card);
		border: 1px solid var(--line);
		border-radius: var(--radius-card);
		box-shadow: var(--shadow-card);
		padding: 12px 16px;
	}
	.who {
		display: flex;
		align-items: center;
		gap: 12px;
		min-width: 0;
	}
	.avatar {
		width: 44px;
		height: 44px;
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
	.meta {
		min-width: 0;
	}
	.name-row {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.name {
		font-size: 16px;
		font-weight: 700;
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 180px;
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
		margin-top: 3px;
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
	}
	.score-row {
		display: flex;
		align-items: baseline;
		gap: 8px;
	}
	.score {
		font-size: 32px;
		font-weight: 700;
		line-height: 1.05;
		letter-spacing: -0.02em;
		font-variant-numeric: tabular-nums;
	}
	.band-word {
		font-size: 11px;
		font-weight: 600;
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
</style>
