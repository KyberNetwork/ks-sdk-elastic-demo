import { ethers } from "ethers";
import { getSigner } from "../libs/signer";
import { getQoute } from "./quote";
import { SwapOptions, SwapRouter, Trade } from "@kyberswap/ks-sdk-elastic";
import ERC20ABI from "../abis/erc20.json";
import { elasticContracts } from "../libs/constants";
import { Currency, CurrencyAmount, Percent, Token } from "@kyberswap/ks-sdk-core";

export async function executeTrade() {
    const {route, inputAmount, outputAmount, tradeType} = await getQoute();
    const signerAddress = await getSigner().getAddress();

    // Check if Elastic router contract has permission to spend tokens
    console.log(`\nChecking contract spending allowance...`);
    const token0 = route.input as Token;

    const token0Contract = new ethers.Contract(
        token0.address,
        ERC20ABI,
        getSigner()
    );

    const contractAllowance = await token0Contract.allowance(signerAddress, elasticContracts.ROUTER);
    console.log(`Current allowance: ${contractAllowance}`);

    if (contractAllowance < BigInt(inputAmount.quotient.toString())) {
        await getTokenApproval(token0Contract, inputAmount, signerAddress);
    };

    // Create the unchecked trade instance
    console.log(`\nConstructing the unchecked trade from quote results...`)
    const tradeConstructorArgs = {
        route,
        inputAmount,
        outputAmount,
        tradeType
    };
    const uncheckedTrade = Trade.createUncheckedTrade(tradeConstructorArgs);

    // Configure the swap options
    console.log(`\nConfiguring the swap options...`)
    const swapOptions: SwapOptions = {
        slippageTolerance: new Percent(50, 10000), // 50bips or 0.50%
        deadline: Math.floor(Date.now() / 1000) + 60 * 10, //10 mins
        recipient: signerAddress
    };
    console.log(`slippageTolerance (%): ${Number(swapOptions.slippageTolerance.numerator)/Number(swapOptions.slippageTolerance.denominator)},\ndeadline: ${swapOptions.deadline},\nrecipient: ${swapOptions.recipient}`)

    // Get the swap method parameters from the SwapRouter class
    console.log(`\nGetting the swap method parameters...`);
    const swapMethodParams = SwapRouter.swapCallParameters([uncheckedTrade], swapOptions);

    // Execute the swap using the signer wallet
    console.log(`\nExecuting the swap...`)
    try {
        // Use the  signer to send the unchecked trade to the network
        const swapTx = await getSigner().sendTransaction({
            data: swapMethodParams.calldata,
            to: elasticContracts.ROUTER,
            value: swapMethodParams.value,
            from: signerAddress,
            maxFeePerGas: 100000000000,
            maxPriorityFeePerGas: 100000000000
        });

        // Wait for the trade to be executed
        const swapTxReceipt = await swapTx.wait();
        console.log(`Swap tx executed with hash: ${swapTxReceipt?.hash}`);
    } catch (error) {
        console.log(error);
    }

};

async function getTokenApproval(token0Contract: ethers.Contract, inputAmount: CurrencyAmount<Currency>, signerAddress: string) {
    console.log(`Insufficient allowance, getting approval for input token amount...`)
    try {
        // Call the ERC20 approve method
        const approvalTx = await token0Contract.approve(
            elasticContracts.ROUTER, 
            BigInt(inputAmount.quotient.toString()), 
            {maxFeePerGas: 100000000000, maxPriorityFeePerGas: 100000000000}
            );

        // Wait for the approve tx to be executed
        const approvalTxReceipt = await approvalTx.wait();
        console.log(`Approve tx executed with hash: ${approvalTxReceipt?.hash}`);

        // Query the new allowance
        const newContractAllowance = await token0Contract.allowance(signerAddress, elasticContracts.ROUTER)
        console.log(`New Allowance: ${newContractAllowance}`);
    } catch(error) {
        console.log(error);
    }
}