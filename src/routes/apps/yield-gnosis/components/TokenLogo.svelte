<script lang="ts">
	interface Props { symbol: string; logoUrl: string; size?: number; }
	let { symbol, logoUrl, size = 32 }: Props = $props();
	let imgError = $state(false);

	const COLOR_MAP: Record<string, string> = {
		EURe: '#3b56f0', 'USDC.e': '#2775ca', USDC: '#2775ca', ETH: '#627eea', WETH: '#627eea',
		WXDAI: '#e2a23b', xDAI: '#e2a23b'
	};
	const bg = $derived(COLOR_MAP[symbol] ?? '#6366f1');
</script>

{#if logoUrl && !imgError}
	<img src={logoUrl} alt={symbol} width={size} height={size}
		style="width:{size}px;height:{size}px;border-radius:50%;object-fit:cover;flex-shrink:0"
		onerror={() => (imgError = true)} />
{:else}
	<div style="width:{size}px;height:{size}px;border-radius:50%;background:{bg};display:flex;align-items:center;justify-content:center;flex-shrink:0">
		<span style="color:#fff;font-size:{Math.round(size*0.35)}px;font-weight:800;line-height:1">{symbol.slice(0,2)}</span>
	</div>
{/if}
