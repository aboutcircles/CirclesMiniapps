<script lang="ts">
	import { headlineScore, type AvatarScore, type DerivedScore } from '$lib/repscore';

	let { avatar, score }: { avatar: AvatarScore | null; score: DerivedScore | null } = $props();

	const isMember = $derived(avatar ? avatar.is_member !== false : true);
	const blacklisted = $derived(avatar?.blacklisted === true);
	const headline = $derived(score ? score.headline : avatar ? headlineScore(avatar) : null);
	const coldStart = $derived(headline === 0 && isMember && !blacklisted && !score?.isNegative);
</script>

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
