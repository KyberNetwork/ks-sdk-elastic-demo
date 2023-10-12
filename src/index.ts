import { createPosition } from './operations/createPosition';
import { increaseLiquidity } from './operations/increaseLiquidity';
import { getQoute } from './operations/quote';
import { removeLiquidity } from './operations/removeLiquidity';
import { executeTrade } from './operations/trade';

/*
    The sections below are divided based on specific Elastic operations.
    Please comment/uncomment specific sections to run each individual operation on save.
*/

    // Get a swap quote from the Quote contract
    // getQoute();

    // Execute the trade based on the above Quote
    // executeTrade();

    // Create a new Elastic position
    // createPosition();

    // Increase position liquidity
    // increaseLiquidity();

    // Remove position liquidity
    // removeLiquidity();