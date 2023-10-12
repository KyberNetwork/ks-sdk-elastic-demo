import { ethers } from "ethers";
import axios from "axios";
import { getSigner } from "../libs/signer";
import { token0 as token0const, token1 as token1const, elasticContracts } from "../libs/constants";
import PoolABI from "../abis/pool.json";
import TicksFeesReaderABI from "../abis/ticksFeesReader.json";
import { CollectOptions, FeeAmount, NonfungiblePositionManager, Pool, Position, RemoveLiquidityOptions, computePoolAddress} from "@kyberswap/ks-sdk-elastic";
import { CurrencyAmount, Percent } from "@kyberswap/ks-sdk-core";

interface PosSubgraphData {
    positionId: string,
    liquidity: string,
    tickLower: string,
    tickUpper: string
}

export async function removeLiquidity() {
    const signer = getSigner();
    const signerAddress = await signer.getAddress();
    const targetPool = await getPool();
    const targetPoolAddress = getPoolAddress();

    // Get the signer's positions
    console.log(`\nGetting signer's positions in the target pool...`);
    const signerOpenPositions: PosSubgraphData[] = await getSignerPositions(signerAddress, targetPoolAddress);
    console.log(`Signer positions:`);
    console.debug(signerOpenPositions);

    // Remove liquidity from the oldest position
    const targetOpenPosition = signerOpenPositions[0];
    console.log(`Target position:`);
    console.debug(targetOpenPosition);

    // Configure the new position instance
    const targetPositionNew = new Position({
        pool: targetPool,
        liquidity: targetOpenPosition.liquidity,
        tickLower: Number(targetOpenPosition.tickLower),
        tickUpper: Number(targetOpenPosition.tickUpper)
    });

    // Calculate burn amounts with slippage
    console.log(`\nCalculating burn amounts with slippage...`);
    console.log(`Burn:`);
    console.debug(targetPositionNew.burnAmountsWithSlippage(new Percent(50, 10000)));

    // Get the position accrued fees
    console.log(`\nGetting fees accrued to the position...`)
    const tickReaderContract = new ethers.Contract(elasticContracts.TICKSFEEREADER, TicksFeesReaderABI, signer);
    const [token0Fees, token1Fees] = await tickReaderContract.getTotalFeesOwedToPosition(elasticContracts.POSITIONMANAGER, targetPoolAddress, targetOpenPosition.positionId);
    console.log(`token0 Fees: ${token0Fees},\ntoken1 Fees: ${token1Fees}`);

    // Configure the fee collection options
    const collectOptions: CollectOptions = {
        tokenId: targetOpenPosition.positionId,
        expectedCurrencyOwed0: CurrencyAmount.fromRawAmount(targetPool.token0, Number(token0Fees)),
        expectedCurrencyOwed1: CurrencyAmount.fromRawAmount(targetPool.token1, Number(token1Fees)),
        recipient: signerAddress,
        deadline: Math.floor(Date.now() / 1000) + 60 * 10, //10 mins
        havingFee: (token0Fees != 0) // Collect fees if any
    };

    // Configure remove liquidity options
    const removeLiquidityOptions: RemoveLiquidityOptions = {
        slippageTolerance: new Percent(50, 10000), // 0.5%
        deadline: Math.floor(Date.now() / 1000) + 60 * 10, //10 mins
        tokenId: targetOpenPosition.positionId, // Remove liquidity from the oldest position
        liquidityPercentage: new Percent(1000, 10000), // 10%
        collectOptions: collectOptions
    };
    
    // Get the calldata for the remove liquidity tx
    console.log(`\nGetting the remove liquidity call parameters...`)
    const removeLiquidityParams = NonfungiblePositionManager.removeCallParameters(
        targetPositionNew,
        removeLiquidityOptions
    );

    // Execute the remove liquidity transaction
    console.log(`\nExecuting the remove liquidity...`);
    try {
        const mintTx = await signer.sendTransaction({
            data: removeLiquidityParams.calldata,
            to: elasticContracts.POSITIONMANAGER,
            value: removeLiquidityParams.value,
            from: signerAddress,
            maxFeePerGas: 100000000000,
            maxPriorityFeePerGas: 100000000000
        });
    
        const mintTxReceipt = await mintTx.wait();
        console.log(`Remove liquidity tx executed with hash: ${mintTxReceipt?.hash}`);
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