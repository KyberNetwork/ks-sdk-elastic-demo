import { ethers } from "ethers";
import { getSigner } from "../libs/signer";
import { token0 as token0const, token1 as token1const, elasticContracts } from "../libs/constants";
import ERC20ABI from "../abis/erc20.json";
import PoolABI from "../abis/pool.json";
import TicksFeesReaderABI from "../abis/ticksFeesReader.json";
import { CurrencyAmount, Currency, Percent } from "@kyberswap/ks-sdk-core";
import { FeeAmount, NonfungiblePositionManager, Pool, Position, computePoolAddress, nearestUsableTick } from "@kyberswap/ks-sdk-elastic";

export async function createPosition() {
    const signer = getSigner();
    const signerAddress = await signer.getAddress();
    const targetPool: Pool = await getPool();

    // Get the position range to be created
    console.log(`\nCalculating the position range to be created (± 3 tickSpacing)...`);
    const positionTickLower = nearestUsableTick(targetPool.tickCurrent, targetPool.tickSpacing) - (3*targetPool.tickSpacing);
    const positionTickUpper = nearestUsableTick(targetPool.tickCurrent, targetPool.tickSpacing) + (3*targetPool.tickSpacing);
    console.log(`tickLower: ${positionTickLower},\ntickUpper: ${positionTickUpper}`);

    // Create a Position instance which consists of the required tokens given an upper and lower position tick
    console.log(`\nCreating the position instance based on token0 amount assuming unlimited token1...`);
    var target0Amount;
    // Check if the pool token0 is equivalent to the token0 we are maintaining locally
    if (targetPool.token0.address == token0const.address) {
        // Add 1 token0 worth of token0
        target0Amount =  1*(10**token0const.decimals);
    } else {
        // Add 1 token 0 worth of token1
        target0Amount = 1*(10**token1const.decimals)*Number(targetPool.token1Price.toSignificant(18)); //rough estimate based on current pool price
    };
    console.log(`Target token0 (${targetPool.token0.symbol}) Amount: ${target0Amount}`);
    const targetPosition = Position.fromAmount0({
        pool: targetPool,
        tickLower: positionTickLower,
        tickUpper: positionTickUpper,
        amount0: target0Amount,
        useFullPrecision: true
    });

    // Calculate the minAmount of tokens required for the swap
    console.log(`\nCalculating the token amounts required for the mint...`)
    const tokenMintAmounts = targetPosition.mintAmounts;
    const tokenMintAmountsSlippage = targetPosition.mintAmountsWithSlippage(new Percent(50,10000)); // 0.5%
    console.log(`
    Mint amounts
        token0 (${targetPool.token0.symbol}): ${tokenMintAmounts.amount0}
        token1 (${targetPool.token1.symbol}): ${tokenMintAmounts.amount1}
    Mint amounts with slippage: 
        token0 (${targetPool.token0.symbol}): ${tokenMintAmountsSlippage.amount0}
        token1 (${targetPool.token1.symbol}): ${tokenMintAmountsSlippage.amount1}
    `);

    // Check if the contract has the necessary token0 and token1 allowance 
    const token0Contract = new ethers.Contract(targetPool.token0.address, ERC20ABI, signer);
    const token1Contract = new ethers.Contract(targetPool.token1.address, ERC20ABI, signer);
    const token0Allowance = await token0Contract.allowance(signerAddress, elasticContracts.POSITIONMANAGER);
    const token1Allowance = await token1Contract.allowance(signerAddress, elasticContracts.POSITIONMANAGER);
    console.log(`token0 (${await token0Contract.symbol()}) Allowance: ${token0Allowance},\ntoken1 (${await token1Contract.symbol()}) Allowance: ${token1Allowance}`);    

    if (token0Allowance < tokenMintAmounts.amount0) {
        const token0Amount: CurrencyAmount<Currency> = CurrencyAmount.fromRawAmount(token0const, tokenMintAmounts.amount0);
        await getTokenApproval(token0Contract, token0Amount, elasticContracts.POSITIONMANAGER);
    };

    if (token1Allowance < tokenMintAmounts.amount1) {
        const token1Amount: CurrencyAmount<Currency> = CurrencyAmount.fromRawAmount(token1const, tokenMintAmounts.amount1);
        await getTokenApproval(token1Contract, token1Amount, elasticContracts.POSITIONMANAGER);
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
        tokenA: token0const,
        tokenB: token1const,
        fee: FeeAmount.EXOTIC,
        initCodeHashManualOverride: '0x00e263aaa3a2c06a89b53217a9e7aad7e15613490a72e0f95f303c4de2dc7045'
    });

    const nextInitializedTicksPosLower = await tickReaderContract.getNearestInitializedTicks(poolAddress, targetPosition.tickLower);
    const nextInitializedTicksPosUpper = await tickReaderContract.getNearestInitializedTicks(poolAddress, targetPosition.tickUpper);

    const mintMethodParams = NonfungiblePositionManager.addCallParameters(
        targetPosition,
        [nextInitializedTicksPosLower[0], nextInitializedTicksPosUpper[0]],
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
            maxFeePerGas: 100000000000,
            maxPriorityFeePerGas: 100000000000
        });
    
        const mintTxReceipt = await mintTx.wait();
        console.log(`Mint tx executed with hash: ${mintTxReceipt?.hash}`);
    } catch (error) {
        console.log(error);
    };
}

async function getTokenApproval(tokenContract: ethers.Contract, approvalAmount: CurrencyAmount<Currency>, spenderAddress: string) {
    console.log(`Insufficient allowance, getting approval for ${await tokenContract.symbol()}...`);
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
        tokenA: token0const,
        tokenB: token1const,
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
        token0const,
        token1const,
        FeeAmount.EXOTIC,
        sqrtP.toString(),
        baseL.toString(),
        reinvestL.toString(),
        Number(currentTick)
    );
}