import { onWalletChange, signMessage, onAppData } from '../miniapp-sdk.js';

const statusEl = document.getElementById('status');
const signBtn = document.getElementById('signBtn');
const resultEl = document.getElementById('result');
const messageInput = document.getElementById('messageInput');

let connectedAddress = null;

onAppData((data) => {
  messageInput.value = data;
});

onWalletChange((address) => {
  connectedAddress = address;
  if (address) {
    statusEl.className = 'status connected';
    statusEl.innerHTML = 'Connected: <span class="addr">' + address + '</span>';
    signBtn.disabled = false;
  } else {
    statusEl.className = 'status disconnected';
    statusEl.textContent = 'Wallet not connected';
    signBtn.disabled = true;
  }
});

signBtn.addEventListener('click', async () => {
  const message = messageInput.value.trim();

  if (!message) {
    resultEl.className = 'result error show';
    resultEl.textContent = 'Please enter a message to sign';
    return;
  }

  signBtn.disabled = true;
  resultEl.className = 'result pending show';
  resultEl.textContent = 'Requesting signature approval from host app...';

  try {
    const { signature, verified } = await signMessage(message);

    resultEl.className = 'result success show';
    resultEl.innerHTML = `
      Message signed successfully!
      <div class="sig-details">
        <strong>Verified:</strong>
        <code>${verified ? 'Yes' : 'No'}</code>
        <strong>Signature:</strong>
        <code>${signature}</code>
        <strong>Signer:</strong>
        <code>${connectedAddress}</code>
      </div>
    `;
  } catch (error) {
    resultEl.className = 'result error show';
    resultEl.textContent = 'Failed: ' + error.message;
  }

  signBtn.disabled = false;
});
