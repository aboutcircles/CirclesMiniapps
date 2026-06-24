<script lang="ts">
	import {
		isValidAddress,
		normalizeAddress,
		shortAddress,
		type Address,
		type ResolvedProfile
	} from '$lib/repscore';

	let {
		onsubmit,
		onsearch,
		busy = false,
		canUseMine = false,
		onmine
	}: {
		onsubmit: (addr: Address) => void;
		/** Name lookup, supplied by the orchestrator (keeps I/O out of the component). */
		onsearch?: (query: string) => Promise<ResolvedProfile[]>;
		busy?: boolean;
		canUseMine?: boolean;
		onmine?: () => void;
	} = $props();

	let input = $state('');
	let touched = $state(false);
	let comboEl = $state<HTMLDivElement | null>(null);

	let results = $state<ResolvedProfile[]>([]);
	let searching = $state(false);
	let open = $state(false);
	let highlight = $state(-1);

	const trimmed = $derived(input.trim());
	const isAddr = $derived(trimmed.toLowerCase().startsWith('0x'));
	const valid = $derived(isValidAddress(input));
	// Only nag about a malformed address when they're clearly typing one.
	const showError = $derived(touched && isAddr && trimmed.length > 0 && !valid);
	const canExplore = $derived(valid || results.length > 0);

	let seq = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let suppress = false; // skip the search re-triggered by setting input on pick

	// Debounced name search; skips address-looking or too-short input.
	$effect(() => {
		const q = trimmed;
		clearTimeout(timer);
		if (suppress) {
			suppress = false;
			open = false;
			searching = false;
			return;
		}
		if (!onsearch || q.length < 2 || q.toLowerCase().startsWith('0x')) {
			results = [];
			searching = false;
			open = false;
			return;
		}
		const mine = ++seq;
		searching = true;
		open = true;
		timer = setTimeout(async () => {
			const r = await onsearch!(q);
			if (mine !== seq) return; // superseded by a newer keystroke
			results = r;
			searching = false;
			highlight = -1;
		}, 220);
		return () => clearTimeout(timer);
	});

	function pick(p: ResolvedProfile) {
		suppress = true;
		input = p.name;
		results = [];
		open = false;
		highlight = -1;
		seq++; // invalidate any in-flight search
		onsubmit(p.address);
	}

	function submit() {
		if (busy) return;
		touched = true;
		if (open && highlight >= 0 && highlight < results.length) {
			pick(results[highlight]);
			return;
		}
		const addr = normalizeAddress(input);
		if (addr) {
			open = false;
			onsubmit(addr);
			return;
		}
		if (results.length > 0) pick(results[0]);
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			submit();
			return;
		}
		if (e.key === 'Escape') {
			open = false;
			return;
		}
		if (!open || results.length === 0) return;
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			highlight = (highlight + 1) % results.length;
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			highlight = (highlight - 1 + results.length) % results.length;
		}
	}

	function clear() {
		input = '';
		results = [];
		open = false;
		touched = false;
	}

	function onFocusOut(e: FocusEvent) {
		// close once focus leaves the whole combo (input + dropdown)
		if (!comboEl?.contains(e.relatedTarget as Node | null)) open = false;
	}
</script>

<div class="search">
	<div class="combo" bind:this={comboEl} onfocusout={onFocusOut}>
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
				placeholder="Search by name or paste a 0x address…"
				aria-label="Search avatars by name or address"
				role="combobox"
				aria-expanded={open}
				aria-controls="rs-suggest"
				aria-autocomplete="list"
				bind:value={input}
				oninput={() => (touched = true)}
				onfocus={() => {
					if (results.length > 0) open = true;
				}}
				{onkeydown}
			/>
			{#if input}
				<button class="clear" type="button" title="Clear" onclick={clear}>×</button>
			{/if}
		</div>

		{#if open}
			<ul class="suggest" id="rs-suggest" role="listbox" aria-label="Avatar matches">
				{#if searching && results.length === 0}
					<li class="hint">Searching…</li>
				{:else if results.length === 0}
					<li class="hint">No avatars match “{trimmed}”.</li>
				{:else}
					{#each results as p, i (p.address)}
						<li>
							<button
								type="button"
								role="option"
								aria-selected={i === highlight}
								class="opt"
								class:active={i === highlight}
								onmousedown={(e) => e.preventDefault()}
								onmousemove={() => (highlight = i)}
								onclick={() => pick(p)}
							>
								<img class="av" src={p.imageUrl} alt="" loading="lazy" decoding="async" />
								<span class="meta">
									<span class="nm">{p.name}</span>
									<span class="ad">{shortAddress(p.address)}</span>
								</span>
								{#if p.avatarType}<span class="badge">{p.avatarType}</span>{/if}
							</button>
						</li>
					{/each}
				{/if}
			</ul>
		{/if}
	</div>

	<button class="go" type="button" onclick={submit} disabled={busy || !canExplore}>
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
	.combo {
		position: relative;
		flex: 1;
		min-width: 0;
	}
	.field {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
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

	/* ── Suggestion dropdown ── */
	.suggest {
		position: absolute;
		z-index: 20;
		top: calc(100% + 6px);
		left: 0;
		right: 0;
		margin: 0;
		padding: 6px;
		list-style: none;
		background: var(--card);
		border: 1px solid var(--line);
		border-radius: 14px;
		box-shadow: var(--shadow-popup);
		max-height: 320px;
		overflow-y: auto;
	}
	.hint {
		font-size: 12px;
		color: var(--muted);
		padding: 10px 8px;
		text-align: center;
	}
	.opt {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		border: none;
		background: transparent;
		border-radius: 10px;
		padding: 7px 8px;
		cursor: pointer;
		text-align: left;
		font-family: inherit;
	}
	.opt.active {
		background: var(--accent-soft);
	}
	.av {
		width: 30px;
		height: 30px;
		border-radius: 50%;
		object-fit: cover;
		flex-shrink: 0;
		background: var(--bg-b);
	}
	.meta {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1;
	}
	.nm {
		font-size: 13px;
		font-weight: 600;
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.ad {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 11px;
		color: var(--muted);
	}
	.badge {
		flex-shrink: 0;
		font-size: 10px;
		text-transform: capitalize;
		color: var(--accent);
		background: var(--accent-soft);
		border-radius: var(--radius-pill);
		padding: 2px 8px;
		font-weight: 600;
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
