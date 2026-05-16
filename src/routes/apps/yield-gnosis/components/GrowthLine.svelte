<script lang="ts">
	interface Props { id: string; }
	let { id }: Props = $props();
	const gradId = $derived(`gl-${id}`);
</script>

<svg viewBox="0 0 200 30" preserveAspectRatio="none" style="width:100%;height:30px;display:block">
	<defs>
		<linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
			<stop offset="0%" stop-color="#16a34a" stop-opacity="0.3" />
			<stop offset="100%" stop-color="#16a34a" stop-opacity="1" />
		</linearGradient>
	</defs>
	<path d="M0,28 C40,26 80,18 120,12 S170,4 200,2"
		fill="none" stroke="url(#{gradId})" stroke-width="1.5"
		stroke-dasharray="300" stroke-dashoffset="300"
		style="animation: draw-line 2.6s ease-out forwards" />
	<circle cx="200" cy="2" r="2.5" fill="#16a34a"
		style="opacity:0;animation: pop-dot 0.3s ease-out 2.5s forwards" />
</svg>

<style>
	@keyframes draw-line { to { stroke-dashoffset: 0; } }
	@keyframes pop-dot   { to { opacity: 1; } }
</style>
