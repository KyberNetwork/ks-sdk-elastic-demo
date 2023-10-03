import { ethers } from 'ethers';
import { ChainId } from '@kyberswap/ks-sdk-core';

export function getProvider(): ethers.Provider {
    // Replace this with a RPC of your choice
    const providerUrl = 'https://polygon.kyberengineering.io';
    const providerOptions = {
        // Testing on Polygon POS
        chainId: ChainId.MATIC,
        name: 'Polygon'
    }
    return new ethers.JsonRpcProvider(providerUrl, providerOptions);
}