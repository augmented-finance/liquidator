'use strict';

const networks = [
  'eth',
  'bsc',
  'avax',
  'gnosis'
]

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();

    try {

      await queryInterface.createTable('Networks', {
        id: {
          type: Sequelize.STRING,
          primaryKey: true
        },
        provider: {
          type: Sequelize.STRING,
          allowNull: true
        },
        reserveProvider: {
          type: Sequelize.STRING,
          allowNull: true
        },
        createdAt: {
          type: Sequelize.DATE,
        },
        updatedAt: {
          type: Sequelize.DATE,
        }
      }, { transaction });

      await queryInterface.createTable('Listeners', {
        contractAddress: {
          type: Sequelize.STRING,
          primaryKey: true,
        },
        name: {
          type: Sequelize.STRING,
          allowNull: false,
        },
        description: {
          type: Sequelize.STRING,
          allowNull: true
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
        lastBlock: {
          type: Sequelize.BIGINT,
          allowNull: true
        },
        createdAt: {
          type: Sequelize.DATE,
        },
        updatedAt: {
          type: Sequelize.DATE,
        }
      }, { transaction });

      transaction.commit();
    } catch(e) {
      console.log(e);
      transaction.rollback();
      throw new Error('Migration failed!');
    }
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('listeners');
    await queryInterface.dropTable('networks');
  }
};
