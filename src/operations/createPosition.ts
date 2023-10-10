import { ethers } from "ethers";
import { getSigner } from "../libs/signer";
import { token0, token1, elasticContracts } from "../libs/constants";
import ERC20ABI from "../abis/erc20.json";
import PoolABI from "../abis/pool.json";
import TicksFeesReaderABI from "../abis/ticksFeesReader.json";
import { CurrencyAmount, Currency, Percent } from "@kyberswap/ks-sdk-core";
import { FeeAmount, NonfungiblePositionManager, Pool, Position, computePoolAddress, nearestUsableTick } from "@kyberswap/ks-sdk-elastic";

export async function createPosition() {
    const signer = getSigner();
    const signerAddress = await signer.getAddress();

    // Create the token contract instances
    const token0Contract = new ethers.Contract(token0.address, ERC20ABI, signer);
    const token1Contract = new ethers.Contract(token1.address, ERC20ABI, signer);

    // Create the target pool instance
    const targetPool: Pool = await getPool();

    // Get the position range to be created
    console.log(`\nCalculating the position range ± 3 tickSpacing...`);
    const positionTickLower = nearestUsableTick(targetPool.tickCurrent, targetPool.tickSpacing) - (3*targetPool.tickSpacing);
    const positionTickUpper = nearestUsableTick(targetPool.tickCurrent, targetPool.tickSpacing) + (3*targetPool.tickSpacing);
    console.log(`tickLower: ${positionTickLower},\ntickUpper: ${positionTickUpper}`);

    // Create a Position instance which consists of the required tokens given an upper and lower position tick
    console.log(`\nCreating the position instance based on token0 amount assuming unlimited token1...`);
    const targetPosition = Position.fromAmount0({
        pool: targetPool,
        tickLower: positionTickLower,
        tickUpper: positionTickUpper,
        amount0: 1*(10**token0.decimals), // USDC has 6 decimals hence 1*10^6,
        useFullPrecision: true
    });

    // Calculate the minAmount of tokens required for the swap
    console.log(`\nCalculating the token amounts required for the mint...`)
    const tokenMintAmounts = targetPosition.mintAmounts;
    const tokenMintAmountsSlippage = targetPosition.mintAmountsWithSlippage(new Percent(50,10000));
    console.log(`
    Mint amounts
        token0: ${tokenMintAmounts.amount0}
        token1: ${tokenMintAmounts.amount1}
    Mint amounts with slippage: 
        token0: ${tokenMintAmountsSlippage.amount0}
        token1: ${tokenMintAmountsSlippage.amount1}
    `);

    // Check if the contract has the necessary token0 and token1 allowance
    console.log(`\nChecking if contract has approval to spend token0 and token1...`)
    const token0Allowance = await token0Contract.allowance(signerAddress, elasticContracts.POSITIONMANAGER);
    const token1Allowance = await token1Contract.allowance(signerAddress, elasticContracts.POSITIONMANAGER);
    console.log(`token0 Allowance: ${token0Allowance},\ntoken1 Allowance: ${token1Allowance}`);

    // Check if the position's token0 is equivalent to token0
    if (await token0Contract.getAddress() == targetPosition.amount0.currency.address) {
        // Get allowance for both tokens
        if (token0Allowance < tokenMintAmounts.amount0) {
            const token0Amount: CurrencyAmount<Currency> = CurrencyAmount.fromRawAmount(token0, tokenMintAmounts.amount0);
            await getTokenApproval(token0Contract, token0Amount, elasticContracts.POSITIONMANAGER);
        };
        if (token1Allowance < tokenMintAmounts.amount1) {
            const token1Amount: CurrencyAmount<Currency> = CurrencyAmount.fromRawAmount(token1, tokenMintAmounts.amount1);
            await getTokenApproval(token1Contract, token1Amount, elasticContracts.POSITIONMANAGER);
        };
    } else {
        if (token0Allowance < tokenMintAmounts.amount1) {
            const token0Amount: CurrencyAmount<Currency> = CurrencyAmount.fromRawAmount(token0, tokenMintAmounts.amount1);
            await getTokenApproval(token0Contract, token0Amount, elasticContracts.POSITIONMANAGER);
        };
        if (token1Allowance < tokenMintAmounts.amount0) {
            const token1Amount: CurrencyAmount<Currency> = CurrencyAmount.fromRawAmount(token1, tokenMintAmounts.amount0);
            await getTokenApproval(token1Contract, token1Amount, elasticContracts.POSITIONMANAGER);
        };
    };

    // Configure minting options
    const mintOptions = {
        recipient: signerAddress,
        slippageTolerance: new Percent(50,10000), // 0.5%
        deadline: Math.floor(Date.now() / 1000) + 60 * 10, //10 mins
    };

    // Get the calldata for minting the position
    console.log(`\nGetting the mint call parameters...`)
    const tickReaderContract = new ethers.Contract(elasticContracts.TICKSFEEREADER, TicksFeesReaderABI, signer);
    const poolAddress = computePoolAddress({
        factoryAddress: elasticContracts.FACTORY,
        tokenA: token0,
        tokenB: token1,
        fee: FeeAmount.EXOTIC,
        initCodeHashManualOverride: '0x00e263aaa3a2c06a89b53217a9e7aad7e15613490a72e0f95f303c4de2dc7045'
    });

    const nextInitializedTicks = await tickReaderContract.getNearestInitializedTicks(poolAddress, targetPool.tickCurrent);
    const nextInitializedTicksPosLower = await tickReaderContract.getNearestInitializedTicks(poolAddress, targetPosition.tickLower);
    const nextInitializedTicksPosUpper = await tickReaderContract.getNearestInitializedTicks(poolAddress, targetPosition.tickUpper);
    console.debug(nextInitializedTicks);
    console.debug(nextInitializedTicksPosLower);
    console.debug(nextInitializedTicksPosUpper);

    const mintMethodParams = NonfungiblePositionManager.addCallParameters(
        targetPosition,
        nextInitializedTicks,
        mintOptions
    );
    
    // Execute the mint transaction
    console.log(`\nExecuting the mint...`);
    try {
        const mintTx = await signer.sendTransaction({
            data: mintMethodParams.calldata,
            to: elasticContracts.POSITIONMANAGER,
            value: mintMethodParams.value,
            from: signerAddress,
            maxFeePerGas: 150000000000,
            maxPriorityFeePerGas: 100000000000
        })
    
        const mintTxReceipt = await mintTx.wait();
        console.log(`Mint tx executed with hash: ${mintTxReceipt?.hash}`);
    } catch (error) {
        console.log(error);
    };


}

async function getTokenApproval(tokenContract: ethers.Contract, approvalAmount: CurrencyAmount<Currency>, spenderAddress: string) {
    console.log(`Insufficient allowance, getting approval for input token amount...`)
    try {
        // Call the ERC20 approve method
        const approvalTx = await tokenContract.approve(
            spenderAddress, 
            BigInt(approvalAmount.quotient.toString()), 
            {maxFeePerGas: 100000000000, maxPriorityFeePerGas: 100000000000}
            );

        // Wait for the approve tx to be executed
        const approvalTxReceipt = await approvalTx.wait();
        console.log(`Approve tx executed with hash: ${approvalTxReceipt?.hash}`);

    } catch(error) {
        console.log(error);
    }
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
        getSigner()
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