import { describe, it, expect, vi } from 'vitest';
import { RepScoreClient } from './client';
import { resolveEnv } from './env';

describe('RepScoreClient — global fetch binding', () => {
	it('calls the global fetch without binding `this` to the client', async () => {
		// Regression: the default fetchImpl used to be a bare `fetch` reference
		// invoked as `this.fetchImpl(...)`, which passes the client instance as
		// `this`. Browsers reject that with "Failed to execute 'fetch' on
		// 'Window': Illegal invocation". The wrapper must call fetch unbound.
		let capturedThis: unknown = 'unset';
		const spy = vi.fn(function (this: unknown) {
			capturedThis = this;
			return Promise.resolve({ status: 200, ok: true, json: async () => ({}) } as Response);
		});
		vi.stubGlobal('fetch', spy);
		try {
			const client = new RepScoreClient({ env: resolveEnv() }); // default fetchImpl
			await client.getConfig();
		} finally {
			vi.unstubAllGlobals();
		}
		expect(spy).toHaveBeenCalledOnce();
		expect(capturedThis).not.toBe('unset'); // fetch was actually invoked
		// The crux: `this` must NOT be the client instance (that caused the crash).
		expect(capturedThis === undefined || capturedThis === globalThis).toBe(true);
	});

	it('uses an injected fetchImpl as-is', async () => {
		const fake = vi.fn(async () => ({ status: 200, ok: true, json: async () => ({ ok: 1 }) }) as unknown as Response);
		const client = new RepScoreClient({ env: resolveEnv(), fetchImpl: fake });
		await client.getConfig();
		expect(fake).toHaveBeenCalledOnce();
	});
});
