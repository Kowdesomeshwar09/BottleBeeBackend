'use strict';

/**
 * Shared column builders for migrations.
 *
 * Every business table gets the same primary key and the same audit block, so
 * they are defined once here. Migrations import this with a relative path;
 * sequelize-cli only executes files inside `migrations/`, so a helper living in
 * `utils/` is never run as a migration itself.
 */

/** BIGINT UNSIGNED AUTO_INCREMENT primary key. */
const primaryKey = (Sequelize) => ({
  type: Sequelize.DataTypes.BIGINT.UNSIGNED,
  allowNull: false,
  autoIncrement: true,
  primaryKey: true,
});

/** A BIGINT UNSIGNED foreign key column. */
const fk = (Sequelize, { table, field = 'id', allowNull = false, onDelete = 'RESTRICT', onUpdate = 'CASCADE' }) => ({
  type: Sequelize.DataTypes.BIGINT.UNSIGNED,
  allowNull,
  references: { model: table, key: field },
  onDelete,
  onUpdate,
});

/** Money column: DECIMAL(10,2). */
const money = (Sequelize, { allowNull = false, defaultValue = undefined } = {}) => {
  const col = { type: Sequelize.DataTypes.DECIMAL(10, 2), allowNull };
  if (defaultValue !== undefined) col.defaultValue = defaultValue;
  return col;
};

/** Geo coordinate column: DECIMAL(10,6). */
const coordinate = (Sequelize, { allowNull = true } = {}) => ({
  type: Sequelize.DataTypes.DECIMAL(10, 6),
  allowNull,
});

/**
 * The audit block required on every business table.
 * `created_at` / `updated_at` / `deleted_at` are managed by Sequelize
 * (timestamps + paranoid); the `*_by` columns are written by services.
 *
 * Note: `created_by` / `updated_by` / `deleted_by` deliberately carry no
 * foreign key to `users`. A user row can be soft-deleted while historical audit
 * attribution must survive, and adding the constraint would also make the very
 * first `users` insert (the seeded super admin, which references itself)
 * impossible to order.
 */
const auditColumns = (Sequelize) => ({
  created_at: {
    type: Sequelize.DataTypes.DATE,
    allowNull: false,
    defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
  },
  created_by: { type: Sequelize.DataTypes.BIGINT.UNSIGNED, allowNull: true },
  updated_at: { type: Sequelize.DataTypes.DATE, allowNull: true, defaultValue: null },
  updated_by: { type: Sequelize.DataTypes.BIGINT.UNSIGNED, allowNull: true },
  deleted_at: { type: Sequelize.DataTypes.DATE, allowNull: true, defaultValue: null },
  deleted_by: { type: Sequelize.DataTypes.BIGINT.UNSIGNED, allowNull: true },
  is_active: { type: Sequelize.DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
});

/** Options passed to every createTable call. */
const tableOptions = {
  charset: 'utf8mb4',
  collate: 'utf8mb4_unicode_ci',
  engine: 'InnoDB',
};

/**
 * Applies `ON UPDATE CURRENT_TIMESTAMP` to `updated_at`, plus an index on
 * `deleted_at` so soft-delete filtering stays cheap. Sequelize cannot express
 * the ON UPDATE clause in createTable, hence the raw ALTER.
 */
async function applyAuditBehaviour(queryInterface, tableName) {
  await queryInterface.sequelize.query(
    `ALTER TABLE \`${tableName}\` MODIFY \`updated_at\` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP`
  );
  await queryInterface.addIndex(tableName, ['deleted_at'], {
    name: `idx_${tableName}_deleted_at`,
  });
}

/** Adds a named CHECK constraint (MySQL 8 enforces these). */
async function addCheck(queryInterface, tableName, constraintName, expression) {
  await queryInterface.sequelize.query(
    `ALTER TABLE \`${tableName}\` ADD CONSTRAINT \`${constraintName}\` CHECK (${expression})`
  );
}

module.exports = {
  primaryKey,
  fk,
  money,
  coordinate,
  auditColumns,
  tableOptions,
  applyAuditBehaviour,
  addCheck,
};
