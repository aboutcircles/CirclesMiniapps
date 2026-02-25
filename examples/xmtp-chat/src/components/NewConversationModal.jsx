import React, { useState } from 'react';

function NewConversationModal({ isOpen, onClose, onCreateConversation }) {
  const [recipientAddress, setRecipientAddress] = useState('');

  const handleSubmit = () => {
    if (recipientAddress.trim()) {
      onCreateConversation(recipientAddress.trim());
      setRecipientAddress('');
      onClose();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleSubmit();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>New Message</h3>
          <button className="modal-close-btn" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="modal-body">
          <label className="modal-label">Recipient</label>
          <input
            type="text"
            className="modal-input"
            placeholder="Enter wallet address or ENS name"
            value={recipientAddress}
            onChange={(e) => setRecipientAddress(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
          />
        </div>
        <div className="modal-footer">
          <button className="modal-create-btn" onClick={handleSubmit} disabled={!recipientAddress.trim()}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

export default NewConversationModal;
