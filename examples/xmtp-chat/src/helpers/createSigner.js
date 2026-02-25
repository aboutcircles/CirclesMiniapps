/**
 * Creates an EOA (Externally Owned Account) signer for XMTP
 * Based on xmtp.chat implementation
 */
import { IdentifierKind } from "@xmtp/browser-sdk";

export const createEOASigner = (address, signMessage) => {
  return {
    type: "EOA",
    getIdentifier: () => {
      console.log("Signer.getIdentifier() called");
      return {
        identifier: address.toLowerCase(),
        identifierKind: IdentifierKind.Ethereum, // String literal, not numeric enum
      };
    },
    signMessage: async (message) => {
      console.log("Signer.signMessage() called with message:", message);
      try {
        const signature = await signMessage(message);
        console.log("Got signature:", signature);
        // Convert hex signature to Uint8Array
        const hex = signature.startsWith("0x") ? signature.slice(2) : signature;
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < hex.length; i += 2) {
          bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
        }
        console.log("Converted signature to bytes:", bytes);
        return bytes;
      } catch (error) {
        console.error("Error in signMessage:", error);
        throw error;
      }
    },
  };
};
