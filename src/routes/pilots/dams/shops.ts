import { getAddress, isAddress, type Address } from 'viem';

// A shop's discount offer. Different shops can run different deals.
export interface Offer {
	amountDams: number; // dAMS the customer pays
	discountEuro: number; // € taken off
	minPurchaseEuro: number; // minimum spend to qualify
}

export interface Shop {
	address: Address;
	name: string;
	offer: Offer;
}

export const DEFAULT_OFFER: Offer = { amountDams: 100, discountEuro: 1, minPurchaseEuro: 10 };

const SEED_SHOPS: Shop[] = [
	{
		address: getAddress('0xb4b558FA01FDB4dd5D2F43134fe5012EAE675401'),
		name: 'Sauvage Space Cafe',
		offer: { amountDams: 100, discountEuro: 1, minPurchaseEuro: 10 }
	}
];

// Optional override without a code change: VITE_DAMS_SHOPS = JSON array of
// { address, name, offer?: { amountDams, discountEuro, minPurchaseEuro } }.
function parseEnvShops(): Shop[] | null {
	const raw = import.meta.env.VITE_DAMS_SHOPS as string | undefined;
	if (!raw) return null;
	try {
		const arr = JSON.parse(raw) as Array<{ address: string; name?: string; offer?: Partial<Offer> }>;
		const shops = arr
			.filter((s) => s.address && isAddress(s.address))
			.map((s) => ({
				address: getAddress(s.address),
				name: s.name ?? 'Participating shop',
				offer: { ...DEFAULT_OFFER, ...(s.offer ?? {}) }
			}));
		return shops.length ? shops : null;
	} catch {
		return null;
	}
}

export const SHOPS: Shop[] = parseEnvShops() ?? SEED_SHOPS;

export function findShop(address: string): Shop | undefined {
	if (!isAddress(address)) return undefined;
	const target = getAddress(address);
	return SHOPS.find((s) => s.address === target);
}

// Configured shops keep their data; unknown (but scanned) ones get the default offer.
export function resolveShop(address: Address): Shop {
	return (
		findShop(address) ?? {
			address: getAddress(address),
			name: 'Participating shop',
			offer: DEFAULT_OFFER
		}
	);
}

// "Get €1 off over €10 by paying 100 dAMS"
export function offerSentence(o: Offer): string {
	return `Get €${o.discountEuro} off over €${o.minPurchaseEuro} by paying ${o.amountDams} dAMS`;
}
