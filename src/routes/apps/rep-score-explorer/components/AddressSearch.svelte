<script lang="ts">
	import { isValidAddress, normalizeAddress, type Address } from '$lib/repscore';

	let {
		onsubmit,
		busy = false,
		canUseMine = false,
		onmine
	}: {
		onsubmit: (addr: Address) => void;
		busy?: boolean;
		canUseMine?: boolean;
		onmine?: () => void;
	} = $props();

	let input = $state('');
	let touched = $state(false);

	const valid = $derived(isValidAddress(input));
	const showError = $derived(touched && input.trim().length > 0 && !valid);

	function submit() {
		touched = true;
		const addr = normalizeAddress(input);
		if (!addr) return;
		onsubmit(addr);
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') submit();
	}
</script>

<div class="search">
	<div class="field" class:error={showError}>
		<svg class="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
			<circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2" />
			<path d="m20 20-3-3" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
		</svg>
		<input
			type="text"
			inputmode="text"
			autocapitalize="off"
			autocomplete="off"
			spellcheck="false"
			placeholder="Look up any 0x address…"
			bind:value={input}
			oninput={() => (touched = true)}
			{onkeydown}
		/>
		{#if input}
			<button class="clear" type="button" title="Clear" onclick={() => (input = '')}>×</button>
		{/if}
	</div>
	<button class="go" type="button" onclick={submit} disabled={!valid || busy}>
		{busy ? '…' : 'Explore'}
	</button>
</div>

{#if showError}
	<p class="msg">Enter a valid address — 0x followed by 40 hex characters.</p>
{:else if canUseMine}
	<button class="mine" type="button" onclick={() => onmine?.()}>← View my score</button>
{/if}

<style>
	.search {
		display: flex;
		gap: 8px;
	}
	.field {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 8px;
		background: var(--card);
		border: 1px solid var(--line);
		border-radius: 14px;
		padding: 0 12px;
		min-width: 0;
		transition: border-color 0.15s;
	}
	.field:focus-within {
		border-color: var(--accent-mid);
	}
	.field.error {
		border-color: var(--error-ink);
	}
	.icon {
		width: 16px;
		height: 16px;
		color: var(--muted);
		flex-shrink: 0;
	}
	input {
		flex: 1;
		min-width: 0;
		border: none;
		outline: none;
		background: transparent;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 13px;
		color: var(--ink);
		padding: 13px 0;
	}
	.clear {
		border: none;
		background: transparent;
		color: var(--muted);
		font-size: 20px;
		line-height: 1;
		cursor: pointer;
		padding: 0 2px;
	}
	.go {
		flex-shrink: 0;
		background: linear-gradient(90deg, var(--accent), var(--accent-mid));
		color: #fff;
		border: none;
		border-radius: 14px;
		padding: 0 18px;
		font-family: inherit;
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
		transition: opacity 0.15s;
	}
	.go:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.msg {
		font-size: 12px;
		color: var(--error-ink);
		margin: 8px 2px 0;
	}
	.mine {
		margin: 8px 2px 0;
		background: transparent;
		border: none;
		color: var(--accent-mid);
		font-family: inherit;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		padding: 0;
	}
</style>
