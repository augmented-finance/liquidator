import { SignerWithAddress } from '../../protocol/test-suites/test-augmented/helpers/make-suite'
import { networks, CreateNetwork } from '../../src/database/Network'
import { CreateUserAccount, IGetUserReserve } from '../../src/database/UserAccount'

export const inactivesNetworksSeeds: CreateNetwork[] = [
  {
    id: networks.BSC,
    provider: null,
    reserveProvider: null,
    balance: '0',
    isActive: false
  },
  {
    id: networks.AVAX,
    provider: null,
    reserveProvider: null,
    balance: '0',
    isActive: false
  }
]

export const createUserSeeds = (networks: networks[], users: SignerWithAddress[]): CreateUserAccount[] => {
  const createdUsers = []
  for (const network of networks) {
    for (const user of users) {
      createdUsers.push({
        address: user.address,
        totalCollateralETH: '8661077870268560',
        totalDebtETH: '0',
        availableBorrowsETH: '6928862296214848',
        currentLiquidationThreshold: '8500',
        ltv: '8000',
        healthFactor: -1,
        networkId: network
      })
    }
  }

  return createdUsers
}

export const oneDebtTwoCollaterals: IGetUserReserve = {
  collateral: {
    DAI: {
      symbol: 'DAI',
      contractAddress: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
      liquidationBonus: '10500',
      decimal: 18,
      amount: '1000000000000000000',
      amountETH: '1000000000000000',
      rate: '1000000000000000'
    },
    WETH: {
      symbol: 'WETH',
      contractAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      liquidationBonus: '10750',
      decimal: 18,
      amount: '1000000000000000000',
      amountETH: '1000000000000000000',
      rate: '1000000000000000000'
    }
  },
  debt: {
    USDC: {
      symbol: 'USDC',
      contractAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      liquidationBonus: '10500',
      decimal: 6,
      amount: '700000001',
      amountETH: '910000001300000000',
      rate: '1300000000000000'
    }
  }
}

export const oneDebtOneCollateral: IGetUserReserve = {
  collateral: {
    // 10 weth
    WETH: {
      symbol: 'WETH',
      contractAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      liquidationBonus: '10750',
      decimal: 18,
      amount: '10000000000000000000',
      amountETH: '10000000000000000000',
      rate: '1000000000000000000'
    }
  },
  debt: {
    DAI: {
      symbol: 'DAI',
      contractAddress: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
      liquidationBonus: '10500',
      decimal: 18,
      amount: '5000000000000000000000',
      amountETH: '5000000000000000000',
      rate: '1000000000000000'
    }
  }
}

export const noDebts: IGetUserReserve = {
  collateral: {
    USDC: {
      symbol: 'USDC',
      contractAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      liquidationBonus: '10500',
      decimal: 6,
      amount: '500000000',
      amountETH: '650000000000000000',
      rate: '1300000000000000'
    }
  },
  debt: {} // no debts
}

export const multiplesDebts: IGetUserReserve = {
  collateral: {
    WETH: {
      symbol: 'WETH',
      contractAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      liquidationBonus: '10750',
      decimal: 18,
      amount: '1000000000000000000',
      amountETH: '1000000000000000000',
      rate: '1000000000000000000'
    }
  },
  debt: {
    DAI: {
      symbol: 'DAI',
      contractAddress: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
      liquidationBonus: '10500',
      decimal: 18,
      amount: '1000000000000000000000',
      amountETH: '1000000000000000000',
      rate: '1000000000000000'
    },
    USDC: {
      symbol: 'USDC',
      contractAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      liquidationBonus: '10500',
      decimal: 6,
      amount: '500000000',
      amountETH: '650000000000000000',
      rate: '1300000000000000'
    }
  }
}

export const twoDebtsTwoCollateral: IGetUserReserve = {
  collateral: {
    DAI: {
      symbol: 'DAI',
      contractAddress: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
      liquidationBonus: '10500',
      decimal: 18,
      amount: '100000000000000000000',
      amountETH: '100000000000000000',
      rate: '1000000000000000'
    },
    WETH: {
      symbol: 'WETH',
      contractAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      liquidationBonus: '10750',
      decimal: 18,
      amount: '10000000000000000000',
      amountETH: '10000000000000000000',
      rate: '1000000000000000000'
    }
  },
  debt: {
    WBTC: {
      symbol: 'WBTC',
      contractAddress: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
      liquidationBonus: '10750',
      decimal: 8,
      amount: '100000000',
      amountETH: '13000000000000000000',
      rate: '13000000000000000000'
    },
    USDC: {
      symbol: 'USDC',
      contractAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      liquidationBonus: '10500',
      decimal: 6,
      amount: '500000000',
      amountETH: '650000000000000000',
      rate: '1300000000000000'
    }
  }
}
