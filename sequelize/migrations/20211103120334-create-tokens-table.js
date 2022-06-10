'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('Tokens', {
      tokenAddress: {
        type: Sequelize.STRING,
        primaryKey: true
      },
      symbol: {
        type: Sequelize.STRING,
        allowNull: false
      },
      decimals: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      ltv: {
        type: Sequelize.STRING,
        allowNull: false
      },
      liquidationThreshold: {
        type: Sequelize.STRING,
        allowNull: false
      },
      liquidationBonus: {
        type: Sequelize.STRING,
        allowNull: false
      },
      reserveFactor: {
        type: Sequelize.STRING,
        allowNull: false
      },
      usageAsCollateralEnabled: {
        type: Sequelize.BOOLEAN,
        allowNull: false
      },
      borrowingEnabled: {
        type: Sequelize.BOOLEAN,
        allowNull: false
      },
      stableBorrowRateEnabled: {
        type: Sequelize.BOOLEAN,
        allowNull: false
      },
      isActive: {
        type: Sequelize.BOOLEAN,
        allowNull: false
      },
      isFrozen: {
        type: Sequelize.BOOLEAN,
        allowNull: false
      },
      networkId: {
        type: Sequelize.STRING,
        allowNull: false,
        references: {
          model: 'Networks',
          key: 'id',
        },
        onDelete: 'cascade'
      },
      aTokenAddress: {
        type: Sequelize.STRING,
        allowNull: false
      },
      stableDebtTokenAddress: {
        type: Sequelize.STRING,
        allowNull: false
      },
      variableDebtTokenAddress: {
        type: Sequelize.STRING,
        allowNull: false
      },
      createdAt: {
        type: Sequelize.DATE,
      },
      updatedAt: {
        type: Sequelize.DATE,
      }
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('Tokens');
  }
};
