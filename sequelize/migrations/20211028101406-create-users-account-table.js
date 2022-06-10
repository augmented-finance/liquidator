'use strict';

const networks = [
  'eth',
  'bsc',
  'avax',
  'gnosis',
]

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('UserAccounts', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.UUID,
      },

      address: {
        type: Sequelize.STRING,
        allowNull: false
      },

      totalCollateralETH: {
        type: Sequelize.STRING,
        allowNull: false
      },
      totalDebtETH: {
        type: Sequelize.STRING,
        allowNull: false
      },
      availableBorrowsETH: {
        type: Sequelize.STRING,
        allowNull: false
      },
      currentLiquidationThreshold: {
        type: Sequelize.STRING,
        allowNull: false
      },
      ltv: {
        type: Sequelize.STRING,
        allowNull: false
      },
      healthFactor: {
        type: Sequelize.DECIMAL,
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
      zone: {
        type: Sequelize.STRING,
        allowNull: false,
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
    await queryInterface.dropTable('UserAccounts');
  }
};
