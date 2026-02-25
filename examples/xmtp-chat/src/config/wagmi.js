import { http, createConfig } from 'wagmi';
import { gnosis } from 'wagmi/chains';
import { metaMask, walletConnect } from 'wagmi/connectors';

// Replace with your WalletConnect project ID from https://cloud.walletconnect.com/
const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'YOUR_PROJECT_ID';

export const config = createConfig({
  chains: [gnosis],
  connectors: [
    metaMask(),
    walletConnect({
      projectId,
      metadata: {
        name: 'XMTP Chat',
        description: 'XMTP Chat on Gnosis Chain',
        url: 'https://circles-miniapps.example.com',
        icons: ['https://circles-miniapps.example.com/icon.png']
      }
    }),
  ],
  transports: {
    [gnosis.id]: http(),
  },
});
