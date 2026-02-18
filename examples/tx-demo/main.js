import { onWalletChange, sendTransactions } from '../miniapp-sdk.js';

const statusEl = document.getElementById('status');
const sendBtn = document.getElementById('sendBtn');
const resultEl = document.getElementById('result');
const tokenAddrInput = document.getElementById('tokenAddr');
const recipientInput = document.getElementById('recipient');
const amountInput = document.getElementById('amount');

onWalletChange((address) => {
  if (address) {
    statusEl.className = 'status connected';
    statusEl.innerHTML = 'Connected: <span class="addr">' + address + '</span>';
    sendBtn.disabled = false;
  } else {
    statusEl.className = 'status disconnected';
    statusEl.textContent = 'Wallet not connected';
    sendBtn.disabled = true;
  }
});

// Encode ERC20 transfer(address,uint256) calldata — no library needed
function encodeTransferData(to, amount) {
  const selector = '0xa9059cbb';
  const paddedTo = to.toLowerCase().replace('0x', '').padStart(64, '0');
  const amountHex = BigInt(amount).toString(16).padStart(64, '0');
  return selector + paddedTo + amountHex;
}

sendBtn.addEventListener('click', async () => {
  const tokenAddr = tokenAddrInput.value.trim();
  const recipient = recipientInput.value.trim();
  const amount = amountInput.value.trim();

  if (!tokenAddr || !recipient || !amount) {
    resultEl.className = 'result error show';
    resultEl.textContent = 'Please fill in all fields';
    return;
  }

  sendBtn.disabled = true;
  resultEl.className = 'result pending show';
  resultEl.textContent = 'Requesting transaction approval from host app...';

  try {
    const calldata = encodeTransferData(recipient, amount);
    const hashes = await sendTransactions([
      { to: tokenAddr, data: calldata, value: '0' }
    ]);

    resultEl.className = 'result success show';
    resultEl.innerHTML =
      'Transfer sent!<br>' +
      hashes
        .map((h) => '<a href="https://gnosisscan.io/tx/' + h + '" target="_blank">' + h + '</a>')
        .join('<br>');
  } catch (error) {
    resultEl.className = 'result error show';
    resultEl.textContent = 'Failed: ' + error.message;
  }

  sendBtn.disabled = false;
});
