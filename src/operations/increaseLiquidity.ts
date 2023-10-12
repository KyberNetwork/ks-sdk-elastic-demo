import { ethers } from "ethers";
import axios from "axios";
import { getSigner } from "../libs/signer";
import { token0 as token0const, token1 as token1const, elasticContracts } from "../libs/constants";
import PoolABI from "../abis/pool.json";
import ERC20ABI from "../abis/erc20.json";
import TicksFeesReaderABI from "../abis/ticksFeesReader.json";
import { FeeAmount, NonfungiblePositionManager, Pool, Position, computePoolAddress } from "@kyberswap/ks-sdk-elastic";
import { Currency, CurrencyAmount, Percent } from "@kyberswap/ks-sdk-core";

interface PosSubgraphData {
    positionId: string,
    liquidity: string,
    tickLower: string,
    tickUpper: string
}

export async function increaseLiquidity() {
    const signer = getSigner();
    const signerAddress = await signer.getAddress();
    const targetPool = await getPool();
    const targetPoolAddress = getPoolAddress();

    // Get the signer's positions
    console.log(`Getting signer's positions in the target pool...`);
    const signerOpenPositions: PosSubgraphData[] = await getSignerPositions(signerAddress, targetPoolAddress);
    console.log(`Signer positions:`);
    console.debug(signerOpenPositions);

    // Add liquidity to the oldest open position
    const targetOpenPosition = signerOpenPositions[0];
    console.log(`Target position:`);
    console.debug(targetOpenPosition);

    // Calculate the token amounts to be added
    console.log(`\nCreating the position instance based on token0 amount assuming unlimited token1...`);
    var target0IncrementAmount;
    // Check if the pool token0 is equivalent to the token0 we are maintaining locally
    if (targetPool.token0.address == token0const.address) {
        // Add 1 token0 worth of token0
        target0IncrementAmount =  1*(10**token0const.decimals);
    } else {
        // Add 1 token 0 worth of token1
        target0IncrementAmount = 1*(10**token1const.decimals)*Number(targetPool.token1Price.toSignificant(18)); //rough estimate based on current pool price
    };

    // Configure the new position with the increased liquidity
    const targetPositionNew = Position.fromAmount0({
        pool: targetPool,
        tickLower: Number(targetOpenPosition.tickLower),
        tickUpper: Number(targetOpenPosition.tickUpper),
        amount0: target0IncrementAmount,
        useFullPrecision: true
    });

    // Calculate the minAmount of tokens required for the mint
    console.log(`\nCalculating the token amounts required for the mint...`)
    const tokenMintAmounts = targetPositionNew.mintAmounts;
    const tokenMintAmountsSlippage = targetPositionNew.mintAmountsWithSlippage(new Percent(50,10000)); // 0.5%
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

    // Configure increase liquidity options
    const increaseLiquidityOptions = {
        slippageTolerance: new Percent(50,10000), // 0.5%
        deadline: Math.floor(Date.now() / 1000) + 60 * 10, //10 mins
        tokenId: targetOpenPosition.positionId // Add liquidity to the oldest position
    };
    
    // Get the calldata for the increase liquidity tx
    console.log(`\nGetting the increase liquidity call parameters...`)
    const tickReaderContract = new ethers.Contract(elasticContracts.TICKSFEEREADER, TicksFeesReaderABI, signer);
    const poolAddress = getPoolAddress();
    const nextInitializedTicksPosLower = await tickReaderContract.getNearestInitializedTicks(poolAddress, targetPositionNew.tickLower);
    const nextInitializedTicksPosUpper = await tickReaderContract.getNearestInitializedTicks(poolAddress, targetPositionNew.tickUpper);
    const addLiquidityParams = NonfungiblePositionManager.addCallParameters(
        targetPositionNew,
        [nextInitializedTicksPosLower[0], nextInitializedTicksPosUpper[0]],
        increaseLiquidityOptions
    );

    // Execute the add liquidity transaction
    console.log(`\nExecuting the add liquidity...`);
    try {
        const mintTx = await signer.sendTransaction({
            data: addLiquidityParams.calldata,
            to: elasticContracts.POSITIONMANAGER,
            value: addLiquidityParams.value,
            from: signerAddress,
            maxFeePerGas: 100000000000,
            maxPriorityFeePerGas: 100000000000
        });
    
        const mintTxReceipt = await mintTx.wait();
        console.log(`Add liquidity tx executed with hash: ${mintTxReceipt?.hash}`);
    } catch (error) {
        console.log(error);
    };    
}

export async function getPool(): Promise<Pool> {

    // Get the address of the token pool. Each pool is uniquely identifiable by the token pair and fee
    console.log(`\nComputing pool address...`);
    const poolAddress = getPoolAddress();
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

function getPoolAddress(): string {
    return computePoolAddress({
        factoryAddress: elasticContracts.FACTORY,
        tokenA: token0const,
        tokenB: token1const,
        fee: FeeAmount.EXOTIC,
        initCodeHashManualOverride: '0x00e263aaa3a2c06a89b53217a9e7aad7e15613490a72e0f95f303c4de2dc7045'
    });
}

async function getSignerPositions(signerAddress: string, poolAddress: string): Promise<PosSubgraphData[]> {
    const kyberswapSubgraphURL = `https://api.thegraph.com/subgraphs/name/kybernetwork/kyberswap-elastic-matic`
    try {
        const {data} = await axios.post(
            kyberswapSubgraphURL,
            {
                query: `
                    {
                        positions(
                            where: {
                                owner: "${signerAddress}",
                                pool: "${poolAddress.toLowerCase()}"
                            }
                        ) {
                            id
                            liquidity
                            tickLower {
                                tickIdx
                            }
                            tickUpper {
                                tickIdx
                            }                            
                        }
                    }  
                `
            },
          );

        const positions: PosSubgraphData[] = [];

        for (let i = 0; i < data.data.positions.length; i++) {
            if (data.data.positions[i].liquidity != "0") {
                positions.push({
                    positionId: data.data.positions[i].id,
                    liquidity: data.data.positions[i].liquidity,
                    tickLower: data.data.positions[i].tickLower.tickIdx,
                    tickUpper: data.data.positions[i].tickUpper.tickIdx,
                });
            };
        };

        return positions;
    } catch (error) {
        throw(error)
    }
};

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