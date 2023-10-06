import { ethers } from 'ethers';
import { ChainId } from '@kyberswap/ks-sdk-core';

export function getProvider(): ethers.Provider {
    // Replace this with a RPC of your choice
    const providerUrl = 'https://polygon.kyberengineering.io';
    // const providerUrl = 'https://polygon-mainnet.infura.io/v3/e0e258f75fea434fa6f8f07fc2ae8e60';
    const providerOptions = {
        // Testing on Polygon POS
        chainId: ChainId.MATIC,
        name: 'Polygon'
    }
    return new ethers.JsonRpcProvider(providerUrl, providerOptions);
}