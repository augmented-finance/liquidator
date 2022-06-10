import {
  AllowNull,
  BelongsTo,
  Column,
  CreatedAt,
  DataType,
  ForeignKey,
  HasOne,
  Model,
  Scopes,
  Table,
  UpdatedAt
} from 'sequelize-typescript'
import { v4 as uuidv4 } from 'uuid'

import { NetworkModel, networks } from './Network'

import { flashloanLiquidate, getReservesList, getUserAccountData, getUserConfiguration, liquidate } from '../contract/utils/lp'
import { getPriorityZoneByHF, ZONE } from '../utils/zone'
import chalk from 'chalk'
import BigNumber from 'bignumber.js'
import { Op } from 'sequelize'

import * as config from '../config'
import { balanceOf } from '../contract/utils/erc20'
import { getAvailableLiquidity, getGeneralReserveToken, swapFromReserveToken, swapToReserveToken, TokenModel, updateTokenBalance } from './Token'
import { getAssetPrice } from '../contract/utils/price-oracle'
import { addOrUpdateLiquidate, LiquidateModel, LiquidateModelStatus } from './Liquidate'
import { getGasPrice, getWeb3, IContractOptions, IEstimate, ISend, ISendRes, ISendSignedTransactionRes } from '../contract/utils/web3'
import { deleteJobUpdateLiquidationData } from '../jobs/utils'

import { IGetListeners, getListeners, ContractName } from './Listener'

/**
 * userAccount data model
 */
export interface UserAccountDto {
  id: string
  address: string
  totalCollateralETH: string
  totalDebtETH: string
  availableBorrowsETH: string
  currentLiquidationThreshold: string
  ltv: string
  healthFactor: number,
  networkId: networks,
  createdAt: Date
  updatedAt: Date
}

/**
 * userAccount network data model
 */
export type CreateUserAccount = Omit<UserAccountDto, 'createdAt' | 'updatedAt'>

/**
 * userAccount listener data model
 */
export type UpdateUserAccount = Partial<CreateUserAccount>

@Scopes(() => ({
  defaultScope: {
    attributes: {
      exclude: ['createdAt', 'updatedAt']
    }
  }
}))
@Table({
  tableName: 'UserAccounts'
})
export class UserAccountModel extends Model<UserAccountDto, CreateUserAccount> implements UserAccountDto {
  @Column({
    type: DataType.UUID,
    primaryKey: true,
    unique: true,
    defaultValue: () => uuidv4()
  })
  id!: string;

  @AllowNull(false)
  @Column(DataType.STRING)
  address: string

  @AllowNull(false)
  @Column(DataType.STRING)
  totalCollateralETH: string

  @AllowNull(false)
  @Column(DataType.STRING)
  totalDebtETH: string

  @AllowNull(false)
  @Column(DataType.STRING)
  availableBorrowsETH: string

  @AllowNull(false)
  @Column(DataType.STRING)
  currentLiquidationThreshold: string

  @AllowNull(false)
  @Column(DataType.STRING)
  ltv: string

  @AllowNull(false)
  @Column(DataType.DECIMAL)
  healthFactor: number

  @ForeignKey(() => NetworkModel)
  @AllowNull(false)
  @Column(DataType.STRING)
  networkId: networks

  @CreatedAt
  createdAt: Date

  @UpdatedAt
  updatedAt: Date

  @BelongsTo(() => NetworkModel, {
    onDelete: 'cascade'
  })
  network: NetworkModel

  @HasOne(() => LiquidateModel)
  liquidate: LiquidateModel
}

interface IGetUserReserveToken {
  symbol: string,
  contractAddress: string,
  decimal: number,
  liquidationBonus: string,
  amount: string
  amountETH: string
  rate: string
}

export interface IGetUserReserve {
  collateral: {
    [key: string] : IGetUserReserveToken
  },
  debt: {
    [key: string] : IGetUserReserveToken
  }
}
interface ICollateralProfit {
  symbol: string
  contractAddress: string
  returnAmountETH: string
  maxRepayETH: string
  revenueETH: string
}

interface IGetMaxCollateralProfit {
  calculations: ICollateralProfit[],
  maxRevenueDepositAddress: string,
  maxRevenueETH: string,
  repayETH: string
}

export interface IGetEstimatedLiquidateData {
  collateralAsset: string
  debtAsset: string
  debtToCover: string
  maxRevenueETH: string
}

interface ITryLiquidate {
isFlashloan: boolean;
liquidateData: IGetEstimatedLiquidateData;
gasPrice: string;
maxRevenueETH: string;
feeEstimated: string;
feeFact: string;
txs: ISendSignedTransactionRes[];
}

export enum erc20Type {
  ATOKEN = 'aTokenAddress',
  SDEBT_TOKEN = 'stableDebtTokenAddress',
  VDEBT_TOKEN = 'variableDebtTokenAddress'
}

interface IUpdateUserAccountData {
  userAddress: string,
  network?: string,
  blockNumber?,
  prevHF?: number,
  healthFactor?: number
}

export const _logUpdateUserAccountData = (data: IUpdateUserAccountData): void => {
  try {
    const getStyleByValue = (value: number) : string => {
      const zone = getPriorityZoneByHF(value)
      const _value = value === -1 ? '∞' : new BigNumber(value).toFixed(2, 1)
      switch (zone) {
        case ZONE.GREEN:
          return chalk.black.bgGreen(` ${_value} `)
        case ZONE.YELLOW:
          return chalk.black.bgYellow(` ${_value} `)
        case ZONE.ORANGE:
          return chalk.black.bgHex('#FF8800')(` ${_value} `)
        case ZONE.RED:
          return chalk.black.bgRedBright(` ${_value} `)
        case ZONE.URGENT:
          return chalk.black.bgRed(`[URGENT] ${_value} `)
      }
    }

    const hfStyle = getStyleByValue(data.healthFactor)
    const prevHFStyle = data.prevHF ? getStyleByValue(data.prevHF) : ''

    console.log(
      (data.network ? chalk.cyan(`[${data.network}] `) : '') +
    (data.blockNumber ? chalk.magenta(data.blockNumber + ' ') : '') +
    chalk.inverse(`USER: [${data.userAddress}]`),
      ' => ',
      'HEALTH FACTOR: ',
      hfStyle,
      data.prevHF ? `${data.prevHF !== data.healthFactor ? chalk.red('<= ') : '<= '}${prevHFStyle}` : ''
    )
  } catch (err) {
    console.log(err)
    console.log(chalk.red('Error from _logUpdateUserAccountData'))
  }
}

export const getUsers = async (zone?: ZONE, network?: networks) : Promise<UserAccountModel[]> => {
  const where : {[key: string]: unknown} = {
    healthFactor: {
      [Op.not]: -1
    }
  }

  if (network) {
    where.networkId = network
  }

  switch (zone) {
    case ZONE.GREEN:
      where.healthFactor = -1
      break
    case ZONE.YELLOW:
      where.healthFactor = {
        [Op.gt]: config.zones.orange
      }
      break
    case ZONE.ORANGE:
      where.healthFactor = {
        [Op.and]: {
          [Op.gt]: config.zones.red,
          [Op.lte]: config.zones.orange
        }
      }
      break
    case ZONE.RED:
      where.healthFactor = {
        [Op.and]: {
          [Op.gte]: 1,
          [Op.lte]: config.zones.red
        }
      }
      break
    case ZONE.URGENT:
      where.healthFactor = {
        [Op.and]: {
          [Op.gt]: 0,
          [Op.lt]: 1
        }
      }
      break
  }

  const userAccounts = await UserAccountModel.findAll({
    attributes: ['id', 'address', 'networkId', 'healthFactor'],
    where,
    raw: true,
    nest: true,
    order: [['healthFactor', 'ASC']]
  })

  return userAccounts
}

export const updateUserAccountData = async (data: IUpdateUserAccountData, listener?: IGetListeners) : Promise<Partial<UserAccountDto>> => {
  try {
    await deleteJobUpdateLiquidationData(data.userAddress)

    if (!listener) {
      listener = (await getListeners(ContractName.LENDING_POOL, data.network))[0]
    }

    const options: IContractOptions = { network: listener.network.id, provider: listener.network.provider }
    let result = null
    const userData = await getUserAccountData(data.userAddress, listener.contractAddress, options)

    data.healthFactor = userData.healthFactor === '115792089237316195423570985008687907853269984665640564039457584007913129639935'
      ? -1
      : Number(new BigNumber(userData.healthFactor).shiftedBy(-18).toFixed(2, 1))

    if (!data.network) data.network = listener.network.id

    result = {
      address: data.userAddress,
      ...userData,
      healthFactor: data.healthFactor,
      networkId: listener.network.id
    }

    let user = await UserAccountModel.findOne({
      where: {
        address: data.userAddress,
        networkId: listener.network.id
      }
    })

    if (user) {
      await user.update(result)
    } else {
      user = await UserAccountModel.create(result)
    }

    _logUpdateUserAccountData(data)

    const hfBN = new BigNumber(data.healthFactor)
    if (hfBN.gt(0) && hfBN.lt(1)) {
      await addOrUpdateLiquidate(data.userAddress, options)
    } else {
      const liquidateInQueue = await LiquidateModel.findOne({
        where: {
          userId: user.id,
          status: {
            [Op.in]: [LiquidateModelStatus.DEFERRED, LiquidateModelStatus.PENDING]
          }
        }
      })

      if (liquidateInQueue) {
      // something happened and the user of the position to be
      // liquidated is no longer the same but is in the queue to be liquidated
        await liquidateInQueue.update({
          status: LiquidateModelStatus.CANCELLED
        })
      }
    }
    return result
  } catch (err) {
    console.log(err)
    console.log(chalk.red('Error from updateUserAccountData'))
    console.log(data)
  }
}

export const erc20BalanceOf = async (userId: string, tokenAddress: string, type: erc20Type): Promise<unknown> => {
  const user = await UserAccountModel.findByPk(userId, { attributes: ['id', 'address', 'networkId'] })
  const token = await TokenModel.findByPk(tokenAddress, { attributes: [type] })

  const balance = await balanceOf(
    user.address,
    token[type],
    { network: user.networkId }
  )

  return balance
}

export const getUserReserves = async (userAddress : string, network: networks): Promise<IGetUserReserve> => {
  let user
  try {
    user = await UserAccountModel.findOne({
      where: { address: userAddress, networkId: network },
      include: [
        {
          model: NetworkModel,
          as: 'network',
          include: ['listeners']
        }
      ]
    })
  } catch (err) {
    throw Error('User not found')
  }

  const tokens = await TokenModel.findAll({
    where: { networkId: user.networkId },
    attributes: ['tokenAddress', 'symbol', 'decimals', 'aTokenAddress', 'stableDebtTokenAddress', 'variableDebtTokenAddress', 'liquidationBonus'],
    raw: true
  })

  const reserves = (await getReservesList())[user.networkId]

  const configuration = (await getUserConfiguration(
    user.address,
    user.network.listeners[0].contractAddress,
    { network: user.networkId, provider: user.network.provider }
  )).data

  let configurationBin = Number(configuration).toString(2)

  if (configurationBin.length % 2 !== 0) {
    configurationBin = `0${configurationBin}`
  }

  const result : IGetUserReserve = {
    collateral: {},
    debt: {}
  }

  const promises = []
  const ratesPromises = []
  for (let i = configurationBin.length - 1, j = 0; i > 0; i -= 2, j++) {
    const hasCollateral = !!Number(configurationBin[i - 1])
    const hasDebt = !!Number(configurationBin[i])
    if (!hasCollateral && !hasDebt) {
      continue
    }

    ratesPromises.push(getAssetPrice(reserves[j], { network: user.networkId }))
    const token = tokens.find(t => t.tokenAddress === reserves[j])

    const tokenObj : IGetUserReserveToken = {
      symbol: token.symbol,
      contractAddress: token.tokenAddress,
      liquidationBonus: token.liquidationBonus,
      decimal: token.decimals,
      amount: null,
      amountETH: null,
      rate: null
    }

    if (hasCollateral) {
      promises.push(balanceOf(user.address, token.aTokenAddress, { network: user.networkId, provider: user.network.provider, payload: { ...tokenObj, type: 'collateral' } }))
    }

    if (hasDebt) {
      promises.push(balanceOf(user.address, token.stableDebtTokenAddress, { network: user.networkId, provider: user.network.provider, payload: { ...tokenObj, type: 'sDebt' } }))
      promises.push(balanceOf(user.address, token.variableDebtTokenAddress, { network: user.networkId, provider: user.network.provider, payload: { ...tokenObj, type: 'vDebt' } }))
    }
  }

  const balances = await Promise.all(promises)
  const rates = {};
  (await Promise.all(ratesPromises)).forEach((item) => (rates[item.assetAddress] = item.value))

  balances.forEach((item) => {
    const token = { ...item.payload }
    token.amount = item.data
    token.rate = rates[token.contractAddress]
    token.amountETH = new BigNumber(token.amount)
      .shiftedBy(-token.decimal)
      .times(new BigNumber(rates[token.contractAddress]).shiftedBy(-18))
      .shiftedBy(18).toFixed(0)
    delete token.type

    if (item.payload.type === 'collateral') {
      result.collateral[token.symbol] = token
    }

    if (item.payload.type === 'sDebt') {
      result.debt[token.symbol] = token
    }

    if (item.payload.type === 'vDebt') {
      if (!result.debt[token.symbol]) {
        result.debt[token.symbol] = token
      } else {
        result.debt[token.symbol].amount = new BigNumber(token.amount)
          .plus(result.debt[token.symbol].amount)
          .toFixed(0)

        result.debt[token.symbol].amountETH = new BigNumber(token.amountETH)
          .plus(result.debt[token.symbol].amountETH)
          .toFixed(0)
      }
    }
  })

  return result
}

export const getEstimatedLiquidateDataWithMaxRevenue = async (userReserves: IGetUserReserve): Promise<false | IGetEstimatedLiquidateData > => {
  const { collateral, debt } = userReserves

  // get tokens liquidity in protocol
  const protocolLiquidityPromises = []
  for (const type in userReserves) {
    for (const symbol in userReserves[type]) {
      const address = userReserves[type][symbol].contractAddress
      protocolLiquidityPromises.push(getAvailableLiquidity(address))
    }
  }
  const tokensLiquidity = {};
  (await Promise.all(protocolLiquidityPromises)).forEach(item => (tokensLiquidity[item.tokenAddress] = item.value))

  const _getMaxCollateralProfit = (liquidatorCanRepayETH: string) : IGetMaxCollateralProfit => {
    const calculations : ICollateralProfit[] = []
    let maxRevenueDepositAddress = '0'
    let maxRevenueETH = '0'
    let repayETH = liquidatorCanRepayETH

    for (const symbol in collateral) {
      const token = collateral[symbol]
      const depositAmount = token.amount
      const protocolReserve = tokensLiquidity[token.contractAddress]
      const contractAddress = token.contractAddress

      const availableToPay = BigNumber.min(depositAmount, protocolReserve).toFixed(0)
      const availableToPayETH = new BigNumber(availableToPay)
        .shiftedBy(-token.decimal)
        .times(new BigNumber(token.rate).shiftedBy(-18))
        .shiftedBy(18).toFixed(0)

      const bonusRatio = new BigNumber(token.liquidationBonus).shiftedBy(-4).toFixed()

      const want = new BigNumber(liquidatorCanRepayETH).times(bonusRatio).toFixed(0)

      let calculation : ICollateralProfit = null
      if (new BigNumber(want).lte(availableToPayETH)) {
        calculation = {
          symbol,
          contractAddress,
          returnAmountETH: want,
          maxRepayETH: liquidatorCanRepayETH,
          revenueETH: new BigNumber(want).minus(liquidatorCanRepayETH).toFixed(0)
        }
      } else {
        const returnAmountETH = token.amountETH
        const maxRepayETH = new BigNumber(returnAmountETH).div(bonusRatio).toFixed(0, 1)

        calculation = {
          symbol,
          contractAddress,
          returnAmountETH,
          maxRepayETH,
          revenueETH: new BigNumber(returnAmountETH).minus(maxRepayETH).toFixed(0)
        }
      }

      calculations.push(calculation)
      if (new BigNumber(maxRevenueETH).lt(calculation.returnAmountETH)) {
        maxRevenueDepositAddress = contractAddress
        maxRevenueETH = calculation.revenueETH
        repayETH = calculation.maxRepayETH
      }
    }

    return {
      calculations,
      maxRevenueDepositAddress,
      maxRevenueETH,
      repayETH
    }
  }

  let maxRevenueETH = '0'
  let debtAsset = '0x'
  let collateralAsset = '0x'
  let debtToCover = '0'

  for (const symbol in debt) {
    const { amount, decimal, rate, contractAddress } = debt[symbol]

    const maxCover = new BigNumber(amount).times(0.5).toFixed(0, 1) // ?? 50% от debt или totalDebt ??
    const debtToCoverStart = maxCover
    const debtToCoverETH = new BigNumber(debtToCoverStart)
      .shiftedBy(-decimal)
      .times(new BigNumber(rate).shiftedBy(-18))
      .shiftedBy(18).toFixed(0)

    const maxCollateralRevenue = _getMaxCollateralProfit(debtToCoverETH)

    if (new BigNumber(maxRevenueETH).lt(maxCollateralRevenue.maxRevenueETH)) {
      maxRevenueETH = maxCollateralRevenue.maxRevenueETH

      debtToCover = new BigNumber(maxCollateralRevenue.repayETH)
        .shiftedBy(-18)
        .div(new BigNumber(rate).shiftedBy(-18))
        .shiftedBy(decimal).toFixed(0)

      collateralAsset = maxCollateralRevenue.maxRevenueDepositAddress
      debtAsset = contractAddress
    }
  }

  if (maxRevenueETH === '0') {
    return false
  }

  return {
    collateralAsset,
    debtAsset,
    debtToCover,
    maxRevenueETH
  }
}

export const tryLiquidate = async (userAddress: string, send = false, options: IContractOptions): Promise<ITryLiquidate> => {
  let isFlashloan = false
  if (!options.gasPrice) {
    const web3 = await getWeb3(options.network, options.provider)
    options.gasPrice = await getGasPrice(web3)
  }
  const gasPriceBN = new BigNumber(options.gasPrice)

  const result = {
    feeEstimated: new BigNumber(0),
    feeFact: new BigNumber(0),
    txs: []
  }

  const sendWrap = async (send: ISend): Promise<void> => {
    const tx : ISendRes = await send()

    result.txs.push(tx.txs)
    result.feeFact = result.feeFact.plus(tx.fee)
  }
  const estimateWrap = (estimate: IEstimate): boolean => {
    result.feeEstimated = gasPriceBN.times(estimate()).plus(result.feeEstimated)
    return true
  }

  const userReserves = await getUserReserves(userAddress, options.network)
  const liquidateData = await getEstimatedLiquidateDataWithMaxRevenue(userReserves)
  if (!liquidateData) {
    return // TODO нормально описать
  }

  try {
    const tokenReserve = await getGeneralReserveToken(options)
    console.log('tryLiquidate: userAddress ', userAddress)
    console.log('tryLiquidate: tokenReserve ', tokenReserve)

    const contractLiquidationData = {
      collateralAsset: liquidateData.collateralAsset,
      debtAsset: liquidateData.debtAsset,
      user: userAddress,
      debtToCover: liquidateData.debtToCover,
      receiveAToken: false
    }

    if (new BigNumber(tokenReserve.balanceETH).gte(liquidateData.maxRevenueETH)) {
      if (liquidateData.debtAsset !== tokenReserve.tokenAddress) {
        console.log('tryLiquidate: before swapFromReserveToken ')
        const swapInstance = await swapFromReserveToken(liquidateData.debtAsset, liquidateData.debtToCover, options)
        console.log('tryLiquidate: after swapFromReserveToken ')
        estimateWrap(swapInstance.estimate) && send && await sendWrap(swapInstance.send)
      }

      console.log('tryLiquidate: before liquidate ', contractLiquidationData)
      const liquidateInstance = await liquidate(contractLiquidationData, options)
      console.log('tryLiquidate: after liquidate ')

      estimateWrap(liquidateInstance.estimate) && send && await sendWrap(liquidateInstance.send)
    } else {
      isFlashloan = true
      console.log('tryLiquidate: before flashloanLiquidate ', contractLiquidationData)
      const flashInstance = await flashloanLiquidate(contractLiquidationData, options)
      console.log('tryLiquidate: AFTER flashloanLiquidate ')
      estimateWrap(flashInstance.estimate) && send && await sendWrap(flashInstance.send)
    }

    if (liquidateData.collateralAsset !== tokenReserve.tokenAddress) {
      const tokenBalance = send
        ? await updateTokenBalance(liquidateData.collateralAsset, options.network, options.provider)
        : new BigNumber(1_000_000_000).shiftedBy(18).toFixed()
      const swapInstance = await swapToReserveToken(liquidateData.collateralAsset, tokenBalance, options)
      estimateWrap(swapInstance.estimate) && send && await sendWrap(swapInstance.send)
    }

    if (send) {
      await updateUserAccountData({ userAddress: userAddress, network: options.network })
    }

    const res = {
      isFlashloan,
      liquidateData,
      gasPrice: options.gasPrice,
      maxRevenueETH: liquidateData.maxRevenueETH,
      feeEstimated: result.feeEstimated.toFixed(),
      feeFact: result.feeFact.toFixed(),
      txs: result.txs.flat()
    }
    console.log('-======== ', res)
    return res
  } catch (err) {
    const userModel = await UserAccountModel.findOne({ where: { address: userAddress, networkId: options.network }, raw: true })

    // todo !!!!
    // console.error('ERRRR: ', {
    //   userId: userModel.id,
    //   status: LiquidateModelStatus.ERROR,
    //   estimatedProfitETH: '',
    //   toUpdateDate: null,
    //   error: err.message
    // })

    // await LiquidateModel.create({
    //   userId: userModel.id,
    //   status: LiquidateModelStatus.ERROR,
    //   estimatedProfitETH: '',
    //   toUpdateDate: null,
    //   error: err.message
    // })

    return {
      isFlashloan,
      liquidateData,
      gasPrice: options.gasPrice,
      maxRevenueETH: liquidateData.maxRevenueETH,
      feeEstimated: result.feeEstimated.toFixed(),
      feeFact: result.feeFact.toFixed(),
      txs: result.txs.flat()
    }
  }
}
