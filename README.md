# KyberSwap Elastic SDK Demo

This repository serves as a guide for developers looking to interact with KyberSwap Elastic smart contracts via a typescript SDK. For simplicity, the examples are implemented purely in Node.js so that users can focus on the backend logic required to achieve the following Elastic Operations:

* Getting a quote (`getQoute()`)
* Executing a swap (`executeTrade()`)
* Create a new position (`createPosition()`)

## Getting Started

To run the examples:

* Clone this repository
* Install dependencies: `npm install`
* Run dev environment with Nodemon (auto-refresh on save): `npm run start:dev`
* Run dev environment: `npm run start`

## Detailed Guides And Technical Reference

For each of the operations listed above, a guide has been created on the [KyberSwap Docs](https://docs.kyberswap.com/liquidity-solutions/elastic-sdk) which goes through in detail each of the steps required to complete the specific operation. You can also find the full list of [Elastic SDK Classes](https://docs.kyberswap.com/liquidity-solutions/elastic-sdk/classes) on the Docs.

## Additional Notes

Note that the code samples in this repository are not production-ready and are meant as references to get you started on integrating Elastic functionality into your dApp.