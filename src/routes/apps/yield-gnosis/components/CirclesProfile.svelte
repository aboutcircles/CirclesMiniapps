<script lang="ts">
	interface Props {
		address: string;
		name?: string;
		imageUrl?: string;
		trustCount: number;
		crcBalance: number;
	}

	let { address, name, imageUrl, trustCount, crcBalance }: Props = $props();

	let imgError = $state(false);

	const displayName = $derived(name || `${address.slice(0, 6)}…${address.slice(-4)}`);

	function fmtCrc(n: number): string {
		if (n === 0) return '0';
		if (n < 0.01) return '<0.01';
		return n.toLocaleString('en', { maximumFractionDigits: 2 });
	}
</script>

<div class="profile">
	<!-- Avatar -->
	{#if imageUrl && !imgError}
		<img src={imageUrl} alt={displayName} class="avatar" onerror={() => (imgError = true)} />
	{:else}
		<div class="avatar avatar--fallback">
			<span>{displayName.slice(0, 2).toUpperCase()}</span>
		</div>
	{/if}

	<!-- Info -->
	<div class="info">
		<p class="name">{displayName}</p>
		<div class="badges">
			{#if trustCount > 0}
				<span class="badge badge--trust">👥 {trustCount}</span>
			{/if}
			{#if crcBalance > 0}
				<span class="badge badge--crc">{fmtCrc(crcBalance)} CRC</span>
			{/if}
			<span class="badge badge--live">
				<span class="dot"></span>connected
			</span>
		</div>
	</div>
</div>

<style>
	.profile { display:flex; align-items:center; gap:10px; }

	.avatar {
		width:38px; height:38px; border-radius:50%; object-fit:cover; flex-shrink:0;
		border:2px solid var(--green);
	}
	.avatar--fallback {
		background:var(--blue); display:flex; align-items:center; justify-content:center;
	}
	.avatar--fallback span { color:#fff; font-size:13px; font-weight:800; }

	.info { min-width:0; }
	.name { font-size:13px; font-weight:700; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin:0 0 3px; }

	.badges { display:flex; align-items:center; gap:4px; flex-wrap:wrap; }
	.badge {
		font-size:10px; font-weight:600; padding:1px 6px; border-radius:999px;
		display:inline-flex; align-items:center; gap:3px;
	}
	.badge--trust { background:rgba(22,163,74,0.12); color:var(--green); }
	.badge--crc   { background:rgba(55,55,200,0.1);  color:var(--blue);  }
	.badge--live  { background:rgba(255,255,255,0.05); color:var(--text-dim); border:1px solid var(--border); }

	.dot {
		width:5px; height:5px; border-radius:50%; background:var(--green);
		animation:pulse 2s ease-in-out infinite;
	}
	@keyframes pulse {
		0%,100% { opacity:1; }
		50%      { opacity:0.4; }
	}
</style>
