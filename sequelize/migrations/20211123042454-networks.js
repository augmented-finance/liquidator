'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.bulkDelete('Networks', {}, { transaction })

      await queryInterface.addColumn('Networks', 'isActive', {
        type: Sequelize.BOOLEAN,
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
    await queryInterface.removeColumn('Networks', 'isActive');
  }
};
