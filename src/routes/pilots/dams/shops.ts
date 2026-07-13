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

// The follow-up (returning-customer) offer, shown once the signup offer is used.
export const DEFAULT_OFFER: Offer = { amountDams: 100, discountEuro: 1, minPurchaseEuro: 0 };

// The bigger follow-up offer, shown alongside DEFAULT_OFFER after the first
// redemption: 2€ off for 200 dAMS.
export const SECOND_OFFER: Offer = { amountDams: 200, discountEuro: 2, minPurchaseEuro: 0 };

// The one-time signup offer: 2€ off for 48 dAMS. Shown until the account makes its
// first redemption, then it's replaced by the follow-up offers (1€ off for 100 dAMS
// and 2€ off for 200 dAMS).
export const SIGNUP_OFFER: Offer = { amountDams: 48, discountEuro: 2, minPurchaseEuro: 0 };

const SEED_SHOPS: Shop[] = [
	{
		address: getAddress('0xb4b558FA01FDB4dd5D2F43134fe5012EAE675401'),
		name: 'Sauvage Space Cafe',
		offer: { amountDams: 100, discountEuro: 1, minPurchaseEuro: 0 }
	}
];

// Which offers are active for a shop given whether the customer is a first-timer.
// First purchase → only the 48-dAMS signup offer; afterwards → the shop's
// follow-up plus the bigger 200-dAMS deal.
export function activeOffers(shop: Shop, isFirstPurchase: boolean): Offer[] {
	return isFirstPurchase ? [SIGNUP_OFFER] : [shop.offer, SECOND_OFFER];
}

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

// "1€ off for 100 dAMS on any purchase" (or "…when purchasing above 10€" if a
// minimum is set). The one-time signup offer reads "on your first purchase" so it's
// clear the bigger discount only applies once.
export function offerSentence(o: Offer): string {
	let tail: string;
	if (o === SIGNUP_OFFER) {
		tail = 'on your first purchase';
	} else if (o.minPurchaseEuro > 0) {
		tail = `when purchasing above ${o.minPurchaseEuro}€`;
	} else {
		tail = 'on any purchase';
	}
	return `${o.discountEuro}€ off for ${o.amountDams} dAMS ${tail}`;
}
