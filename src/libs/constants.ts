import { ChainId, Token } from '@kyberswap/ks-sdk-core';

export const elasticContracts = {
    // See Elastic Contract Addresses for chain-specific addresses (https://docs.kyberswap.com/liquidity-solutions/kyberswap-elastic/contracts/elastic-contract-addresses)
    FACTORY: '0xC7a590291e07B9fe9E64b86c58fD8fC764308C4A',
    QUOTER: '0x4d47fd5a29904Dae0Ef51b1c450C9750F15D7856',
    ROUTER: '0xF9c2b5746c946EF883ab2660BbbB1f10A5bdeAb4',
    POSITIONMANAGER: '0xe222fBE074A436145b255442D919E4E3A6c6a480',
    TICKSFEEREADER: '0x8Fd8Cb948965d9305999D767A02bf79833EADbB3'
};

export const token0 = new Token(
    ChainId.MATIC,
    '0x2791bca1f2de4661ed88a30c99a7a9449aa84174',
    6,
    'USDC.e',
    'USD Coin (PoS)'
);

export const token1 = new Token(
    ChainId.MATIC,
    '0x1c954e8fe737f99f68fa1ccda3e51ebdb291948c',
    18,
    'KNC',
    'KyberNetwork Crystal v2 (PoS)'
);