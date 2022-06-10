'use strict';


const { config } = require("dotenv");

config();

const currentDate = new Date();

module.exports = {
  up: async (queryInterface, Sequelize) => {

    await queryInterface.bulkInsert('Networks', [
      {
        id: 'eth',
        provider: process.env.WEB3PROVIDER_ETH,
        reserveProvider: process.env.WEB3PROVIDER_ETH_RESERVE || null,
        createdAt: currentDate,
        updatedAt: currentDate
      },
      {
        id: 'bsc',
        provider: process.env.WEB3PROVIDER_BSC,
        reserveProvider: process.env.WEB3PROVIDER_BSC_RESERVE || null,
        createdAt: currentDate,
        updatedAt: currentDate
      },
      // {
      //   id: 'avax',
      //   provider: process.env.WEB3PROVIDER_AVAX || 'none', // TODO remove this after get all providers
      //   reserveProvider: process.env.WEB3PROVIDER_AVAX_RESERVE || null,
      // },
      // {
      //   id: 'gnosis',
      //   provider: process.env.WEB3PROVIDER_GNOSIS || 'none', // TODO remove this after get all providers
      //   reserveProvider: process.env.WEB3PROVIDER_GNOSIS_RESERVE || null,
      // },
    ]);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('networks', null, {});
  }
};
