'use strict';

const fs = require('fs');
const path = require('path');
const { DataTypes } = require('sequelize');

const { sequelize, Sequelize } = require('../config/database');

const basename = path.basename(__filename);
const db = {};

/**
 * Loads every model definition in this directory, then wires associations in a
 * second pass so a model may reference one that is defined later.
 */
fs.readdirSync(__dirname)
  .filter((file) => file !== basename && file.endsWith('.js') && !file.startsWith('.'))
  .sort()
  .forEach((file) => {
    const define = require(path.join(__dirname, file));
    if (typeof define !== 'function') {
      throw new Error(`Model file ${file} must export a (sequelize, DataTypes) factory function`);
    }
    const model = define(sequelize, DataTypes);
    db[model.name] = model;
  });

Object.values(db).forEach((model) => {
  if (typeof model.associate === 'function') model.associate(db);
});

db.sequelize = sequelize;
db.Sequelize = Sequelize;

module.exports = db;
