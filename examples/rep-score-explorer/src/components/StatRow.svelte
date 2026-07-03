<script lang="ts">
	let {
		label,
		value,
		hint,
		mono = false,
		tone = 'default'
	}: {
		label: string;
		value: string;
		hint?: string;
		mono?: boolean;
		tone?: 'default' | 'pos' | 'neg' | 'muted';
	} = $props();
</script>

<div class="row">
	<div class="label">
		<span>{label}</span>
		{#if hint}<span class="hint">{hint}</span>{/if}
	</div>
	<div class="value" class:mono class:pos={tone === 'pos'} class:neg={tone === 'neg'} class:muted={tone === 'muted'}>
		{value}
	</div>
</div>

<style>
	.row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
		padding: 9px 0;
		border-bottom: 1px solid var(--line-soft);
	}
	.row:last-child {
		border-bottom: none;
	}
	.label {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.label > span:first-child {
		font-size: 13px;
		color: var(--ink);
	}
	.hint {
		font-size: 11px;
		color: var(--muted);
		line-height: 1.35;
	}
	.value {
		flex-shrink: 0;
		font-size: 14px;
		font-weight: 600;
		color: var(--ink);
		text-align: right;
	}
	.value.mono {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-weight: 500;
		font-size: 13px;
	}
	.value.pos {
		color: var(--success-ink);
	}
	.value.neg {
		color: var(--error-ink);
	}
	.value.muted {
		color: var(--muted);
		font-weight: 500;
	}
</style>
