export const isTest = process.env.TEST === 'true'
export const testDbDialect = String(process.env.TEST_DB) || 'sqlite'
export const isHardhatNetwork = process.env.HARDHAT === 'true'
export const Server = {
  host: String(process.env.HOST),
  port: Number(process.env.PORT),
  env: String(process.env.NODE_ENV)
}

const Database = {
  username: String(process.env.DB_USER),
  password: String(process.env.DB_PASSWORD),
  database: String(process.env.DB_NAME),
  databaseTest: String(process.env.DB_NAME_TEST),
  host: process.env.DB_HOST ? String(process.env.DB_HOST) : '127.0.0.1',
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
  dblink: ''
}
Database.dblink = `postgres://${Database.username}:${Database.password}@${Database.host}:${Database.port}/${isTest ? Database.databaseTest : Database.database}`
export { Database }

// The Blocks from where the protocol was deployed
export const deployBlocks = {
  eth: 13339692,
  bsc: 13528255,
  avax: 9768127,
  kovan: 28091471,
  gnosis: 21514084
}

export const providers = {
  eth: String(process.env.WEB3PROVIDER_ETH),
  bsc: String(process.env.WEB3PROVIDER_BSC),
  avax: String(process.env.WEB3PROVIDER_AVAX),
  kovan: String(process.env.WEB3PROVIDER_KOVAN),
  gnosis: String(process.env.WEB3PROVIDER_GNOSIS)
}

export const reserveProviders = {
  eth: String(process.env.WEB3PROVIDER_ETH),
  bsc: String(process.env.WEB3PROVIDER_BSC),
  avax: String(process.env.WEB3PROVIDER_AVAX_RESERVE),
  kovan: String(process.env.WEB3PROVIDER_KOVAN_RESERVE),
  gnosis: String(process.env.WEB3PROVIDER_GNOSIS_RESERVE)
}
export const lpAddressProvider = {
  eth: '0xc6f769A0c46cFFa57d91E87ED3Bc0cd338Ce6361',
  bsc: '0x871569aB5c1CD50Fcc4d2961Fe31BdABd3772917',
  avax: '0x50831160fea1e85bae328205a63e487E8B878a69',
  kovan: '0xde07c4281c0f72194427c83cafb0a6f9cf9d6884',
  gnosis: '0x632fD2479F15FbCBCd74EfEe9DD244B394Dbfda5'
}

export const dataProvider = {
  eth: '0x8F5273c5aa638e946BC5dD2171Ae9E9184C75228',
  bsc: '0xa450547F27F0947760C9C818d9fd2CD51DFA7441',
  avax: '0x483B76b13B14DB4fF49359aF9DF3A51F25FaB6a0',
  kovan: '0xf02f632eebc09c19a4de692d4041ec226635e448',
  gnosis: '0x75e5cF901f3A576F72AB6bCbcf7d81F1619C6a12'
}

export const uniswapAddresses = {
  eth: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
  bsc: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
  avax: '0x60aE616a2155Ee3d9A68541Ba4544862310933d4',
  kovan: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
  gnosis: ''
}

export const generalReserve = {
  eth: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH
  bsc: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', // BUSD
  avax: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7', // WAVAX
  kovan: '0xFf795577d9AC8bD7D90Ee22b6C1703490b6512FD', // DAI
  gnosis: '0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d' // WXDAI
}

export const flashloanLiqudationAdapter = {
  eth: '0x9F4D9A95383D9399dE6EF641009FEFa4b4524D3b',
  bsc: '0x86e8989d9e144d670BF24782800774832D1599f1',
  avax: '',
  kovan: '0xf27210a5f8a9f4184195f9e12df5dd452a1b8cd0',
  gnosis: ''
}

export const zones = {
  red: 1.1,
  orange: 1.5
}

export const account = {
  address: process.env.ACCOUNT_ADDRESS,
  privateKey: process.env.ACCOUNT_PRIVATE_KEY
}

export const utils = {
  expectProfit: '0.0001' // ETH
}
