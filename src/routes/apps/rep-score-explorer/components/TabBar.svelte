<script lang="ts">
	let {
		tabs,
		active,
		onselect,
		panelId = 'rs-tabpanel'
	}: {
		tabs: { key: string; label: string }[];
		active: string;
		onselect: (key: string) => void;
		panelId?: string;
	} = $props();

	let listEl = $state<HTMLDivElement | null>(null);

	// Full ARIA tabs keyboard support: arrow keys / Home / End move selection,
	// with roving tabindex so only the active tab is in the tab order. The
	// handler lives on the focused tab button (which receives the keydown).
	function handleKeydown(e: KeyboardEvent) {
		const nav = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
		if (!nav.includes(e.key)) return;
		e.preventDefault();
		const i = Math.max(0, tabs.findIndex((t) => t.key === active));
		let n = i;
		if (e.key === 'ArrowRight') n = (i + 1) % tabs.length;
		else if (e.key === 'ArrowLeft') n = (i - 1 + tabs.length) % tabs.length;
		else if (e.key === 'Home') n = 0;
		else if (e.key === 'End') n = tabs.length - 1;
		onselect(tabs[n].key);
		listEl?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[n]?.focus();
	}
</script>

<div class="tabs" role="tablist" aria-label="Sections" bind:this={listEl}>
	{#each tabs as t (t.key)}
		<button
			type="button"
			role="tab"
			id={`rs-tab-${t.key}`}
			aria-controls={panelId}
			aria-selected={t.key === active}
			tabindex={t.key === active ? 0 : -1}
			class:active={t.key === active}
			onclick={() => onselect(t.key)}
			onkeydown={handleKeydown}
		>
			{t.label}
		</button>
	{/each}
</div>

<style>
	.tabs {
		display: flex;
		gap: 4px;
		overflow-x: auto;
		scrollbar-width: none;
		background: var(--card);
		border: 1px solid var(--line);
		border-radius: var(--radius-pill);
		padding: 4px;
		box-shadow: var(--shadow-card);
	}
	.tabs::-webkit-scrollbar {
		display: none;
	}
	button {
		flex: 0 0 auto;
		border: none;
		background: transparent;
		color: var(--muted);
		font-family: inherit;
		font-size: 13px;
		font-weight: 600;
		padding: 8px 16px;
		border-radius: var(--radius-pill);
		cursor: pointer;
		white-space: nowrap;
		transition: background 0.15s, color 0.15s;
	}
	button:hover {
		color: var(--ink);
	}
	button.active {
		background: var(--accent-soft);
		color: var(--accent);
	}
</style>
