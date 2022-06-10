/*eslint-disable*/
import BigNumber from 'bignumber.js'

import * as config from '../src/config'
import { createServer } from '../src/server'
import { CreateNetwork, initNetworks, networks } from '../src/database/Network'
import { fillTokens } from '../src/database/Token'
import { getEstimatedLiquidateDataWithMaxRevenue } from '../src/database/UserAccount'

import { oneDebtTwoCollaterals, oneDebtOneCollateral, noDebts, multiplesDebts, twoDebtsTwoCollateral } from './utils/seeds'

jest.setTimeout(3000000)

describe('Liquidation Data', () => {
  let server
  
  const networkSeed : CreateNetwork = {
    id: networks.ETH,
    provider: config.providers.eth,
    reserveProvider: '',
    balance: '0',
    isActive: true
  }


  beforeAll(async () => {
    server = await createServer()

    await server.start()
    await initNetworks([networkSeed])
    await fillTokens()
  })

  afterAll(async () => {
    await server.stop()
  })

    /*
      1 DAI = 0.001 ETH
      1 WETH = 1 ETH

      borrower depostis: 10 WETH
      borrower debts: 5000 DAI

      expected collateral: WETH
      expected cover debt: 2500 DAI

      expected liquidation bonus: 0,1875 WETH (liquidation bonus: 7.5%)
    */
  describe('one debt, one collateral', () => {
    let liquidationData;
    const { debt, collateral} = oneDebtOneCollateral
    
    beforeAll(async () => {
      liquidationData   = await  getEstimatedLiquidateDataWithMaxRevenue(oneDebtOneCollateral)
    })

    it('assets addresses ', async () => {
      expect(liquidationData.collateralAsset ).toEqual(collateral.WETH.contractAddress)
      expect(liquidationData.debtAsset).toEqual(debt.DAI.contractAddress)
    })

    it('calculate covered debt',async () => {
      const { debtToCover,  maxRevenueETH } = liquidationData 

      const toCover = new BigNumber(debt.DAI.amount).times(0.5).toFixed(0, 1)
      expect(toCover).toEqual(debtToCover)

      const revenue =  new BigNumber(debtToCover)
      .shiftedBy(-debt.DAI.decimal)
      .times(new BigNumber(debt.DAI.rate).shiftedBy(-18))
      .shiftedBy(18).toFixed(0)

      const liquidationBonus = new BigNumber(collateral.WETH.liquidationBonus).shiftedBy(-4).toFixed()
      const calculatedMaxRevenue = new BigNumber(revenue).times(liquidationBonus).minus(revenue).toFixed()

      expect(calculatedMaxRevenue).toEqual(maxRevenueETH)
    })
  })

    /*
      1 USDC = 0.0013 ETH
      1 DAI = 0.001 ETH
      1 WETH = 1 ETH

      borrower depostis: 1 DAI, 1 WETH
      borrower debts: 700 USDC

      expected collateral: WETH
      expected cover debt: 350 USDC

      expected liquidation bonus: 34,125 DAI (liquidation bonus: 7.5%)
  */
  describe('one debt and different collateral with same liquidations bonus',  () => {
    let liquidationData;
    const { debt, collateral} = oneDebtTwoCollaterals
    
    beforeAll(async () => {
      liquidationData = await getEstimatedLiquidateDataWithMaxRevenue(oneDebtTwoCollaterals)
    })

    it('assets addresses ', async () => {
      expect(liquidationData.collateralAsset ).toEqual(collateral.WETH.contractAddress)
      expect(liquidationData.debtAsset).toEqual(debt.USDC.contractAddress)
    })

    it('calculate covered debt',async () => {
      const { debtToCover,  maxRevenueETH } = liquidationData

      const toCover = new BigNumber(debt.USDC.amount).times(0.5).toFixed(0, 1)
      expect(toCover).toEqual(debtToCover)
   
      const revenue =  new BigNumber(debtToCover)
      .shiftedBy(-debt.USDC.decimal)
      .times(new BigNumber(debt.USDC.rate).shiftedBy(-18))
      .shiftedBy(18).toFixed(0)

      let maxLiquidationBonus = '0'
      
      // find higher liquidation bonus
      for (const symbol in collateral) {
        const { liquidationBonus } = collateral[symbol]

        if(new BigNumber(liquidationBonus).isGreaterThan(maxLiquidationBonus)) {
          maxLiquidationBonus = new BigNumber(liquidationBonus).shiftedBy(-4).toFixed()
        }
      }

      const calculatedMaxRevenue = new BigNumber(revenue).times(maxLiquidationBonus).minus(revenue).toFixed()
      const liquidationBonusWETH = new BigNumber(collateral.WETH.liquidationBonus).shiftedBy(-4).toFixed()

      expect(calculatedMaxRevenue).toEqual(maxRevenueETH)
      expect(maxLiquidationBonus).toEqual(liquidationBonusWETH)
    })
  })


    /*
      1 USDC = 0.0013 ETH
      1 DAI = 0.001 ETH
      1 WETH = 1 ETH
      1 WBTC = 13 ETH

     borrower depostis: 1000 DAI, 10 WETH
      borrower debts: 1 WBTC and  500 USDC

      expected collateral: WETH
      expected cover debt: 0.5 WBTC

      expected liquidation bonus: 0,0375 WBTC (liquidation bonus: 7.5%)
  */
  describe('two debt and two collaterals with differents liquidations bonus', () => {
    let liquidationData;
    const { debt, collateral} = twoDebtsTwoCollateral
    
    beforeAll(async () => {
      liquidationData   = await  getEstimatedLiquidateDataWithMaxRevenue(twoDebtsTwoCollateral)
    })

    it('assets addresses ', async () => {
      expect(liquidationData.collateralAsset ).toEqual(collateral.WETH.contractAddress)
      expect(liquidationData.debtAsset).toEqual(debt.WBTC.contractAddress)
    })

    it('calculate covered debt',async () => {
      const { debtToCover,  maxRevenueETH } = liquidationData

      const toCover = new BigNumber(debt.WBTC.amount).times(0.5).toFixed(0, 1)
      expect(toCover).toEqual(debtToCover)
   
      const revenue =  new BigNumber(debtToCover)
      .shiftedBy(-debt.WBTC.decimal)
      .times(new BigNumber(debt.WBTC.rate).shiftedBy(-18))
      .shiftedBy(18).toFixed(0)

      let maxLiquidationBonus = '0'
      
      // find higher liquidation bonus
      for (const symbol in collateral) {
        const { liquidationBonus } = collateral[symbol]

        if(new BigNumber(liquidationBonus).isGreaterThan(maxLiquidationBonus)) {
          maxLiquidationBonus = new BigNumber(liquidationBonus).shiftedBy(-4).toFixed()
        }
      }

      const calculatedMaxRevenue = new BigNumber(revenue).times(maxLiquidationBonus).minus(revenue).toFixed()
      const liquidationBonusWETH = new BigNumber(collateral.WETH.liquidationBonus).shiftedBy(-4).toFixed()

      expect(calculatedMaxRevenue).toEqual(maxRevenueETH)
      expect(maxLiquidationBonus).toEqual(liquidationBonusWETH)

  })


    /*
      1 USDC = 0.0013 ETH
      1 DAI = 0.001 ETH
      1 WETH = 1 ETH

      borrower depostis:  1 WETH
      borrower debts: 500 USDC and  1000 DAI


      expected collateral:  WETH
      expected cover debt: 500 DAI

      expected liquidation bonus: 0.0375 WETH (liquidation bonus: 7.5%)
  */
  describe('multiple debts, one collateral', () => {
    let liquidationData;
    const { debt, collateral} = multiplesDebts
    
    beforeAll(async () => {
      liquidationData = await getEstimatedLiquidateDataWithMaxRevenue(multiplesDebts)
    })

    it('assets addresses ', async () => {
      expect(liquidationData.collateralAsset ).toEqual(collateral.WETH.contractAddress)
      expect(liquidationData.debtAsset).toEqual(debt.DAI.contractAddress)
    })

    it('calculate covered debt', () => { 
      const { debtToCover,  maxRevenueETH } = liquidationData 

      const toCover = new BigNumber(debt.DAI.amount).times(0.5).toFixed(0, 1)
      expect(toCover).toEqual(debtToCover)

      const revenue =  new BigNumber(debtToCover)
      .shiftedBy(-debt.DAI.decimal)
      .times(new BigNumber(debt.DAI.rate).shiftedBy(-18))
      .shiftedBy(18).toFixed(0)

      const liquidationBonus = new BigNumber(collateral.WETH.liquidationBonus).shiftedBy(-4).toFixed()

      const calculatedMaxRevenue = new BigNumber(revenue).times(liquidationBonus).minus(revenue).toFixed()
      expect(calculatedMaxRevenue).toEqual(maxRevenueETH)
    })
  })

  /*
      borrower depostis: 500 USDC
      borrower debts: 0

      expected false
  */
    describe('No Debt', () => {
      it('liquidationData should be false', async () => {
        const liquidationData = await getEstimatedLiquidateDataWithMaxRevenue(noDebts)
        expect(liquidationData).toEqual(false)
      })
    })
  })
})