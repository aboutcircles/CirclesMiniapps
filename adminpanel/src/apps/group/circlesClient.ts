import { BaseGroupContract, Core, circlesConfig } from '@aboutcircles/sdk-core';
import { Profiles } from '@aboutcircles/sdk-profiles';
import { CirclesRpc } from '@aboutcircles/sdk-rpc';
import { TransferBuilder } from '@aboutcircles/sdk-transfers';
import { cidV0ToHex } from '@aboutcircles/sdk-utils';

class BaseGroupAvatarClient {
  address: any;
  avatarInfo: any;
  core: any;
  runner: any;
  profilesClient: any;
  rpc: any;
  transferBuilder: any;
  baseGroup: any;
  cachedProfile: any;
  cachedProfileCid: any;

  constructor(address, core, contractRunner, avatarInfo) {
    if (!contractRunner?.sendTransaction) {
      throw new Error('A contract runner with sendTransaction is required.');
    }

    this.address = address;
    this.avatarInfo = avatarInfo;
    this.core = core;
    this.runner = contractRunner;
    this.profilesClient = new Profiles(core.config.circlesRpcUrl, core.config.profileServiceUrl);
    this.rpc = new CirclesRpc(core.config.circlesRpcUrl);
    this.transferBuilder = new TransferBuilder(core.config);
    this.baseGroup = new BaseGroupContract({
      address,
      rpcUrl: core.rpcUrl,
    });
    this.cachedProfile = undefined;
    this.cachedProfileCid = undefined;
  }

  balances = {
    getTotalSupply: async () => {
      const tokenId = await this.core.hubV2.toTokenId(this.address);
      return this.core.hubV2.totalSupply(tokenId);
    },
  };

  trust = {
    add: async (avatar, expiry = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFF')) => {
      const avatars = Array.isArray(avatar) ? avatar : [avatar];
      const transactions = avatars.map((trustee) => this.baseGroup.trust(trustee, expiry));
      return this.runner.sendTransaction(transactions);
    },
    remove: async (avatar) => {
      const avatars = Array.isArray(avatar) ? avatar : [avatar];
      if (!avatars.length) return [];
      const tx =
        avatars.length === 1
          ? this.baseGroup.trust(avatars[0], 0n)
          : this.baseGroup.trustBatchWithConditions(avatars, 0n);
      return this.runner.sendTransaction([tx]);
    },
    isTrusting: async (otherAvatar) => {
      return this.core.hubV2.isTrusted(this.address, otherAvatar);
    },
  };

  profile = {
    get: async () => {
      const profileCid = this.avatarInfo?.cidV0;

      if (this.cachedProfile && this.cachedProfileCid === profileCid) {
        return this.cachedProfile;
      }

      if (!profileCid) return undefined;

      // Hit /raw/<cid> directly instead of the SDK's /get?cid= — the projected
      // /get endpoint drops fields its known-schema doesn't list (group access,
      // membership criteria, contact info, etc.) even when the raw pin has them.
      try {
        const baseUrl = this.core.config.profileServiceUrl.replace(/\/$/, '');
        const res = await fetch(`${baseUrl}/raw/${profileCid}`);
        if (!res.ok) {
          console.warn(`Couldn't load profile ${profileCid}: ${res.status} ${res.statusText}`);
          return undefined;
        }
        const profile = await res.json();
        if (profile) {
          this.cachedProfile = profile;
          this.cachedProfileCid = profileCid;
        }
        return profile;
      } catch (error) {
        console.warn(`Couldn't load profile for CID ${profileCid}`, error);
        return undefined;
      }
    },
    update: async (profile) => {
      const cid = await this.profilesClient.create(profile);
      const updateTx = this.baseGroup.updateMetadataDigest(cidV0ToHex(cid));
      await this.runner.sendTransaction([updateTx]);

      if (this.avatarInfo) {
        this.avatarInfo.cidV0 = cid;
      }
      this.cachedProfile = undefined;
      this.cachedProfileCid = undefined;
      return cid;
    },
  };

  setProperties = {
    owner: async (newOwner) => {
      return this.runner.sendTransaction([this.baseGroup.setOwner(newOwner)]);
    },
    service: async (newService) => {
      return this.runner.sendTransaction([this.baseGroup.setService(newService)]);
    },
    feeCollection: async (newFeeCollection) => {
      return this.runner.sendTransaction([this.baseGroup.setFeeCollection(newFeeCollection)]);
    },
    membershipCondition: async (condition, enabled) => {
      return this.runner.sendTransaction([this.baseGroup.setMembershipCondition(condition, enabled)]);
    },
  };

  transfer = {
    advanced: async (to, amount, options) => {
      const transactions = await this.transferBuilder.constructAdvancedTransfer(
        this.address,
        to,
        amount,
        options
      );
      return this.runner.sendTransaction(transactions);
    },
    getMaxAmount: async (to) => {
      return this.rpc.pathfinder.findMaxFlow({
        from: this.address.toLowerCase(),
        to: to.toLowerCase(),
      });
    },
    getMaxAmountAdvanced: async (to, options) => {
      return this.rpc.pathfinder.findMaxFlow({
        from: this.address.toLowerCase(),
        to: to.toLowerCase(),
        ...options,
      });
    },
  };
}

export class CirclesClient {
  circlesConfig: any;
  contractRunner: any;
  core: any;
  rpc: any;
  profilesClient: any;
  senderAddress: any;

  constructor(config = circlesConfig[100], contractRunner) {
    this.circlesConfig = config;
    this.contractRunner = contractRunner;
    this.core = new Core(config);
    this.rpc = new CirclesRpc(config.circlesRpcUrl);
    this.profilesClient = new Profiles(config.circlesRpcUrl, config.profileServiceUrl);
    this.senderAddress = contractRunner?.address;
  }

  profiles = {
    create: async (profile) => this.profilesClient.create(profile),
    get: async (cid) => this.profilesClient.get(cid),
  };

  groups = {
    getMembers: (groupAddress, limit = 100, cursor = null) => {
      return this.rpc.group.getGroupMembers(groupAddress, limit, cursor);
    },
    getCollateral: async (groupAddress) => {
      const groupContract = new BaseGroupContract({
        address: groupAddress,
        rpcUrl: this.core.rpcUrl,
      });
      const treasuryAddress = await groupContract.BASE_TREASURY();
      return this.rpc.balance.getTokenBalances(treasuryAddress);
    },
    getHolders: (groupAddress, limit = 100) => {
      return this.rpc.group.getGroupHolders(groupAddress, limit);
    },
    getFeeCollectionBalances: async (feeCollectionAddress) => {
      return this.rpc.balance.getTokenBalances(feeCollectionAddress);
    },
    getFeeCollectionTotalBalance: async (feeCollectionAddress) => {
      return this.rpc.balance.getTotalBalance(feeCollectionAddress);
    },
    getConvertibleFeeAmount: async (feeCollectionAddress, mintHandlerAddress, options = {}) => {
      return this.rpc.pathfinder.findMaxFlow({
        from: feeCollectionAddress.toLowerCase(),
        to: mintHandlerAddress.toLowerCase(),
        ...options,
      });
    },
  };

  async getAvatar(address) {
    const avatarInfo = await this.rpc.avatar.getAvatarInfo(address);
    return new BaseGroupAvatarClient(address, this.core, this.contractRunner, avatarInfo);
  }

  async getBaseGroupAvatar(address) {
    return this.getAvatar(address);
  }
}
