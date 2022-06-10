# Augmented Finance Liquidator

This script could be used for automatic search and liquidation of unhealthy loans and earn liquidation penalties in Augmented Finance protocol.
You also could use this codebase in your ow liquidation services.

Functionality:

- search for wallets with unhealthy loans
- calculate profits
- output details of unhealthy loan if its profitable to liquidate
- execute liquidation of the loans

For executing liquidations you must provide seed phrases for account with enough amount of tokens for covering debts.


## Setup

Copy the `.env_example` file into a file named `.env` in the folder of the server
```
cp .env_example .env
```

Fill in the data for the database (PostgreSQL) in `.env`:
```
DB_NAME=dbname
DB_USER=dbuser
DB_PASSWORD=dbpassword
```

Fill in the data about the providers in `.env`:
```
WEB3PROVIDER_ETH=...
WEB3PROVIDER_BSC=...
WEB3PROVIDER_AVAX=...
WEB3PROVIDER_POLYGON=...
WEB3PROVIDER_PHANTOM=...
WEB3PROVIDER_KOVAN=https://kovan.infura.io/v3/{key}
```

Fill in the details of the liquidator's wallet. For example:
```
ACCOUNT_ADDRESS=0x0cB071d0b320FA3C3448b0687648433F78d69819
ACCOUNT_PRIVATE_KEY=279366582a0be629c9061dec7406b6b32ba0d49ee81a04151e8c9c4e5d9d19e7
```


## Run
Install packages and start the server
```
npm i
npm run build
npm run db:migrate
npm run start
```

Build image and run in docker container
```
./start.sh
```

## Testing
### Compile the protocol
```
npm run af:compile
```

### Testing of the liquidator's basic methods
```
npm run test-liquidator
```
### Testing of the liquidator's revenues estimations

Copy the `jest.setup.js` file into a file named `jest.setup.js` in the folder of the server

```
cp jest.setup.js jest.setup.js
```
Fill in the data about the provider (had to be for ethereum) and liquidator's wallet in `jest.setup.js`

```js
process.env = {
  PORT : 5000,
  HOST : '127.0.0.1',
  TEST: 'true',
  TEST_DB: 'sqlite',

  WEB3PROVIDER_ETH: 'https://mainnet.infura.io/v3/{key}',
  ACCOUNT_ADDRESS: '',
  ACCOUNT_PRIVATE_KEY: '',
}

```
Run the tests:
```
npm run test-liquidator-estimation
```

### Testing of workers
Testing user monitoring, filling profitable positions for liquidation, liquidation. Works via [graphite-worker](https://www.npmjs.com/package/graphile-worker) / [graphite-scheduler](https://www.npmjs.com/package/graphile-scheduler). (Youn need PostgreSQL database for testing)

Fill the `DB_NAME_TEST` in `.env` file (the rest of the data will be taken from `DB_USER`, `DB_PASSWORD`.. etc)
```
DB_NAME_TEST=dbname-test
```

Run the tests:
```
npm run test-liquidator-workers
```
