<script lang="ts">
	let {
		height = '16px',
		width = '100%',
		radius = '8px'
	}: { height?: string; width?: string; radius?: string } = $props();
</script>

<span class="sk" style="height:{height};width:{width};border-radius:{radius};"></span>

<style>
	.sk {
		display: block;
		background: linear-gradient(100deg, var(--line-soft) 30%, var(--bg-b) 50%, var(--line-soft) 70%);
		background-size: 200% 100%;
		animation: shimmer 1.3s ease-in-out infinite;
	}
	@keyframes shimmer {
		from {
			background-position: 200% 0;
		}
		to {
			background-position: -200% 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.sk {
			animation: none;
		}
	}
</style>
