'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.bulkDelete('Networks', {}, { transaction })

      await queryInterface.addColumn('Networks', 'balance', {
        type: Sequelize.STRING,
        allowNull: true
      }, { transaction });
      
      await queryInterface.bulkDelete('Tokens', {}, { transaction })
      await queryInterface.addColumn('Tokens', 'balance', {
        type: Sequelize.STRING,
        allowNull: false
      }, { transaction });
      await transaction.commit();
    } catch(e) {
      console.log(e);
      transaction.rollback();
      throw new Error('Migration failed!');
    }
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('Networks', 'balance');
    await queryInterface.removeColumn('Tokens', 'balance')
  }
};
