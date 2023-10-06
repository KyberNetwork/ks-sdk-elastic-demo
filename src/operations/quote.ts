import { ethers } from 'ethers';
import { getProvider } from '../libs/provider';
import PoolABI from '../abis/pool.json';
import { computePoolAddress, FeeAmount, SwapQuoter, Route, Pool } from '@kyberswap/ks-sdk-elastic';
import { Currency, CurrencyAmount, TradeType } from '@kyberswap/ks-sdk-core';
import { elasticContracts, token0, token1 } from '../libs/constants';

export async function getQoute(): Promise<
    {
        route: Route<Currency, Currency>, 
        inputAmount: CurrencyAmount<Currency>, 
        outputAmount: CurrencyAmount<Currency>,
        tradeType: TradeType
    }> {

    console.log(`\nQuerying on-chain pool data...`);
    const pool = await getPool();
    const route: Route<Currency, Currency> = new Route([pool], token0, token1);
    const token0RawAmountIn = 1*(10**token0.decimals); // USDC has 6 decimals hence 1*10^6
    const tradeType = TradeType.EXACT_INPUT;

    // Encode the call to send to the Quoter contract
    console.log(`\nEncode quote call parameters to send to Quoter contract...`);
    const quoteCallParameters = SwapQuoter.quoteCallParameters(
        route,
        CurrencyAmount.fromRawAmount(token0, token0RawAmountIn),
        tradeType
    );
    console.log(`calldata: ${quoteCallParameters.calldata}, \nvalue: ${quoteCallParameters.value}`);

    // Call the Quoter contract with the encoded data
    console.log(`\nCalling the Quoter contract...`);
    const returnedQuoteRaw = await getProvider().call({
        to: elasticContracts.QUOTER,
        data: quoteCallParameters.calldata
    });
    console.log(`returnedQuote: ${returnedQuoteRaw}`);

    // Translate the returned quote into human readable format
    console.log(`\nTranslating the quote results...`)
    const returnedQuote = SwapQuoter.INTERFACE.decodeFunctionResult('quoteExactInputSingle', returnedQuoteRaw);
    const usedAmount = returnedQuote.output['usedAmount'].toString();
    const returnedAmount = returnedQuote.output['returnedAmount'].toString();
    const afterSqrtP = returnedQuote.output['afterSqrtP'].toString();
    const initializedTicksCrossed = returnedQuote.output['initializedTicksCrossed'].toString();
    const gasEstimate = returnedQuote.output['gasEstimate'].toString();
    console.log(`
    Amount of token0 used from input: ${usedAmount} (with token decimals: ${CurrencyAmount.fromRawAmount(token0, usedAmount).toExact()})
    Amount of token1 received as output: ${returnedAmount} (with token decimals: ${CurrencyAmount.fromRawAmount(token1, returnedAmount).toExact()})
    Sqrt price of pool after swap: ${afterSqrtP} (1KNC:${((afterSqrtP/2**96)**2)*10**(token1.decimals-token0.decimals)}USDC)
    Number of initialized ticks crossed: ${initializedTicksCrossed}
    Estimated gas required for swap: ${gasEstimate}
    `);

    // Format the token amounts for use in trade
    const inputAmount: CurrencyAmount<Currency> = CurrencyAmount.fromRawAmount(token0, usedAmount);
    const outputAmount: CurrencyAmount<Currency> = CurrencyAmount.fromRawAmount(token1, returnedAmount);

    // Return the quote paramters required for executing a trade
    return {
        route,
        inputAmount,
        outputAmount,
        tradeType
    };

}

export async function getPool(): Promise<Pool> {

    // Get the address of the token pool. Each pool is uniquely identifiable by the token pair and fee
    console.log(`\nComputing pool address...`);
    const poolAddress = computePoolAddress({
        factoryAddress: elasticContracts.FACTORY,
        tokenA: token0,
        tokenB: token1,
        fee: FeeAmount.EXOTIC,
        initCodeHashManualOverride: '0x00e263aaa3a2c06a89b53217a9e7aad7e15613490a72e0f95f303c4de2dc7045'
    });
    console.log(`poolAddress: ${poolAddress}`);

    // Create a ethers Contract instance of the pool
    const poolContract = new ethers.Contract(
        poolAddress,
        PoolABI,
        getProvider()
    );

    // Query the pool token and fee information
    console.log(`\nGetting the pool token fee information...`);
    const poolFee = await Promise.all([
        poolContract.swapFeeUnits()
    ]);
    console.log(`poolFee: ${poolFee}`);

    // Get the pool liquidity data
    console.log(`\nGetting the pool liquidity data...`)
    const poolLiquidity = await poolContract.getLiquidityState();
    const baseL = poolLiquidity[0];
    const reinvestL = poolLiquidity[1];
    console.log(`baseL: ${baseL} \nreinvestL: ${reinvestL}`);

    // Get the pool price and tick data
    console.log(`\nGetting the pool state...`)
    const poolState = await poolContract.getPoolState();
    const sqrtP = poolState[0];
    const currentTick = poolState[1];
    console.log(`sqrtP: ${sqrtP} \ncurrentTick: ${currentTick}`);

    // Return a new Pool instance corresponding to the pool contract
    return new Pool(
        token0,
        token1,
        FeeAmount.EXOTIC,
        sqrtP.toString(),
        baseL.toString(),
        reinvestL.toString(),
        Number(currentTick)
    );
}