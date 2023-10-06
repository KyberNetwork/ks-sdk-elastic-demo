import { getQoute } from './operations/quote';
import { executeTrade } from './operations/trade';

/*
    The sections below are divided based on specific Elastic operations.
    Please comment/uncomment specific sections to run each individual operation on save.
*/

// Get a swap quote from the Quote contract
// getQoute();

// Execute the trade based on the above Quote
    executeTrade();