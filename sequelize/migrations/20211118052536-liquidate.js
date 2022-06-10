'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('Liquidations', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true
      },
      userId: {
        allowNull: false,
        type: Sequelize.UUID,
        references: {
           model: 'UserAccounts',
           key: 'id',
          }
      },
      status: {
        type: Sequelize.STRING,
        allowNull: false
      },
      estimatedProfitETH: {
        type: Sequelize.STRING,
        allowNull: false
      },
      factProfitETH: {
        type: Sequelize.STRING,
        allowNull: true
      },
      toUpdateDate: {
        type: Sequelize.DATE,
        allowNull: true
      },
      createdAt: {
        type: Sequelize.DATE,
      },
      updatedAt: {
        type: Sequelize.DATE,
      },
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('Liquidations');
  }
};
