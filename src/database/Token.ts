import {
  getAllReservesTokens,
  getReserveConfigurationData,
  getReserveTokensAddresses
} from '../contract/utils/data-provider'
import {
  AllowNull,
  BelongsTo,
  Column,
  CreatedAt,
  DataType,
  ForeignKey,
  Model,
  PrimaryKey,
  Scopes,
  Table,
  UpdatedAt
} from 'sequelize-typescript'
import { NetworkModel, getNetworks } from './Network'
import * as config from '../config'
import { balanceOf } from '../contract/utils/erc20'
import { IContractMethodWrite, IContractOptions } from '../contract/utils/web3'
import { SwapDirection, swapTokens } from '../contract/utils/uniswapRouter'
import BigNumber from 'bignumber.js'
import { getAssetPrice } from '../contract/utils/price-oracle'
import { Op } from 'sequelize'

export enum networks {
  ETH = 'eth',
  BSC = 'bsc',
  AVAX = 'avax',
  KOVAN = 'kovan',
  GNOSIS = 'gnosis'
}

export interface IReserveConfigurationData {
  decimals: number
  ltv: string
  liquidationThreshold: string
  liquidationBonus: string
  reserveFactor: string
  usageAsCollateralEnabled: boolean
  borrowingEnabled: boolean
  stableBorrowRateEnabled: boolean
  isActive: boolean
  isFrozen: boolean
}

/**
 * token data model
 */
export interface TokenDto {
  tokenAddress: string
  symbol: string
  decimals: number
  ltv: string
  liquidationThreshold: string
  liquidationBonus: string
  reserveFactor: string
  usageAsCollateralEnabled: boolean
  borrowingEnabled: boolean
  stableBorrowRateEnabled: boolean
  isActive: boolean
  isFrozen: boolean
  networkId: networks
  aTokenAddress: string
  stableDebtTokenAddress: string
  variableDebtTokenAddress: string
  balance: string
  createdAt: Date
  updatedAt: Date
}

/**
 * create token data model
 */
export type CreateToken = Omit<TokenDto, 'createdAt' | 'updatedAt'>

/**
 * update token data model
 */
export type UpdateToken = Partial<CreateToken>

@Scopes(() => ({
  defaultScope: {
    attributes: {
      exclude: ['createdAt', 'updatedAt']
    }
  }
}))
@Table({
  tableName: 'Tokens'
})
export class TokenModel extends Model<TokenDto, CreateToken> implements TokenDto {
  @PrimaryKey
  @Column(DataType.STRING)
  tokenAddress: string

  @AllowNull(false)
  @Column(DataType.STRING)
  symbol: string

  @AllowNull(false)
  @Column(DataType.INTEGER)
  decimals: number

  @AllowNull(false)
  @Column(DataType.STRING)
  ltv: string

  @AllowNull(false)
  @Column(DataType.STRING)
  liquidationThreshold: string

  @AllowNull(false)
  @Column(DataType.STRING)
  liquidationBonus: string

  @AllowNull(false)
  @Column(DataType.STRING)
  reserveFactor: string

  @AllowNull(false)
  @Column(DataType.BOOLEAN)
  usageAsCollateralEnabled: boolean

  @AllowNull(false)
  @Column(DataType.BOOLEAN)
  borrowingEnabled: boolean

  @AllowNull(false)
  @Column(DataType.BOOLEAN)
  stableBorrowRateEnabled: boolean

  @AllowNull(false)
  @Column(DataType.BOOLEAN)
  isActive: boolean

  @AllowNull(false)
  @Column(DataType.BOOLEAN)
  isFrozen: boolean

  @ForeignKey(() => NetworkModel)
  @AllowNull(false)
  @Column(DataType.STRING)
  networkId: networks

  @AllowNull(false)
  @Column(DataType.STRING)
  aTokenAddress: string

  @AllowNull(false)
  @Column(DataType.STRING)
  stableDebtTokenAddress: string

  @AllowNull(false)
  @Column(DataType.STRING)
  variableDebtTokenAddress: string

  @AllowNull(false)
  @Column(DataType.STRING)
  balance: string

  @CreatedAt
  createdAt: Date

  @UpdatedAt
  updatedAt: Date

  @BelongsTo(() => NetworkModel, {
    onDelete: 'cascade'
  })
  network: NetworkModel
}

interface IGeneralReserveToken extends TokenDto {
  balanceETH: string
}

interface IToken {
  symbol: string
  tokenAddress: string
}

export const fillToken = async (
  token: IToken,
  network: networks,
  provider?: string
): Promise<void> => {
  const { address } = config.account

  const data = await getReserveConfigurationData(token.tokenAddress, { network, provider })
  const addresses = await getReserveTokensAddresses(token.tokenAddress, { network, provider })
  const balance = (await balanceOf(address, token.tokenAddress, { network, provider })) as string

  await TokenModel.upsert({
    tokenAddress: token.tokenAddress,
    symbol: token.symbol,
    networkId: network,
    aTokenAddress: addresses.depositTokenAddress,
    stableDebtTokenAddress: addresses.stableDebtTokenAddress,
    variableDebtTokenAddress: addresses.variableDebtTokenAddress,
    ...data,
    balance
  })
}

export const fillTokens = async (): Promise<boolean> => {
  const networks = await getNetworks()

  const promises = []
  for (const network of networks) {
    const tokens = (await getAllReservesTokens({ network: network.id, provider: network.provider }))
      .tokens

    for (const token of tokens) {
      if (
        token.underlying === '0x0000000000000000000000000000000000000000' &&
        token.token !== '0x0000000000000000000000000000000000000000'
      ) {
        promises.push(
          fillToken(
            { symbol: token.tokenSymbol, tokenAddress: token.token },
            network.id,
            network.provider
          )
        )
      }
    }
  }
  await Promise.all(promises)
  return true
}

export const getAvailableLiquidity = async (
  tokenAddress: string
): Promise<{
  tokenAddress: string
  value: unknown
}> => {
  const token = await TokenModel.findByPk(tokenAddress, {
    attributes: ['tokenAddress', 'aTokenAddress', 'networkId'],
    raw: true
  })

  return {
    tokenAddress,
    value: await balanceOf(token.aTokenAddress, token.tokenAddress, { network: token.networkId })
  }
}

export const updateTokenBalance = async (
  tokenAddress: string,
  network,
  provider
): Promise<string> => {
  const balance = (await balanceOf(config.account.address, tokenAddress, {
    network,
    provider
  })) as string

  await TokenModel.update(
    {
      balance
    },
    { where: { tokenAddress } }
  )

  return balance
}

export const swapFromReserveToken = async (
  tokenAddresss: string,
  amount: string,
  options: IContractOptions
): Promise<IContractMethodWrite> => {
  return await swapTokens(tokenAddresss, amount, options.network, SwapDirection.FORWARD)
}

export const swapToReserveToken = async (
  tokenAddresss: string,
  amount: string,
  options: IContractOptions
): Promise<IContractMethodWrite> => {
  return await swapTokens(tokenAddresss, amount, options.network, SwapDirection.BACK)
}

export const getGeneralReserveToken = async (
  options: IContractOptions
): Promise<IGeneralReserveToken> => {
  const token = await TokenModel.findByPk(config.generalReserve[options.network], {
    attributes: ['balance', 'decimals', 'tokenAddress'],
    raw: true
  })
  const price = (await getAssetPrice(token.tokenAddress, options)).value

  return {
    ...token,
    balanceETH: new BigNumber(token.balance)
      .shiftedBy(-token.decimals)
      .times(new BigNumber(price).shiftedBy(-18))
      .shiftedBy(18)
      .toFixed(0)
  }
}

export const convertToken = async (
  fromAddress: string,
  toAddress: string,
  amount: string
): Promise<string> => {
  const tokens = await TokenModel.findAll({
    where: {
      tokenAddress: {
        [Op.in]: [fromAddress, toAddress]
      }
    },
    attributes: ['balance', 'decimals', 'tokenAddress'],
    raw: true,
    nest: true,
    include: ['network']
  })

  if (tokens.length !== 2) {
    throw new Error('Invalid token pair!')
  }

  const fromToken = tokens.find((t) => t.tokenAddress === fromAddress)
  const toToken = tokens.find((t) => t.tokenAddress === toAddress)

  const options = { network: fromToken.network.id, provider: fromToken.network.provider }

  const priceFrom = (await getAssetPrice(fromAddress, options)).value
  const priceTo = (await getAssetPrice(toAddress, options)).value

  return new BigNumber(amount)
    .shiftedBy(-fromToken.decimals)
    .times(new BigNumber(priceFrom).shiftedBy(-18))
    .div(new BigNumber(priceTo).shiftedBy(-18))
    .shiftedBy(toToken.decimals)
    .toFixed(0)
}
