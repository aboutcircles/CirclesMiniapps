import React, { useState } from 'react';
import { useAccount, useConnect, useDisconnect } from 'wagmi';

function ConnectButton() {
  const { address, isConnected } = useAccount();
  const { connectors, connect } = useConnect();
  const { disconnect } = useDisconnect();
  const [showConnectors, setShowConnectors] = useState(false);

  // Format address for display
  const formatAddress = (addr) => {
    if (!addr) return '';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  // Filter connectors to only show MetaMask and WalletConnect
  const availableConnectors = connectors.filter(
    connector => connector.name === 'MetaMask' || connector.name === 'WalletConnect'
  );

  if (!isConnected) {
    return (
      <div className="connect-wallet-container">
        <button
          className="connect-btn"
          onClick={() => setShowConnectors(!showConnectors)}
        >
          Connect Wallet
        </button>

        {showConnectors && (
          <div className="connectors-dropdown">
            {availableConnectors.map((connector) => (
              <button
                key={connector.id}
                onClick={() => {
                  connect({ connector });
                  setShowConnectors(false);
                }}
                className="connector-btn"
              >
                {connector.name}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="wallet-info">
      <span className="wallet-address">{formatAddress(address)}</span>
      <button className="disconnect-btn" onClick={() => disconnect()}>
        Disconnect
      </button>
    </div>
  );
}

export default ConnectButton;
