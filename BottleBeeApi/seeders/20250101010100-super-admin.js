'use strict';

const bcrypt = require('bcryptjs');

const config = require('../config');
const { ROLES, ACCOUNT_STATUS } = require('../config/constants');

/**
 * Bootstraps the first super administrator, so there is someone who can log in
 * and grant every other role.
 *
 * Credentials come from SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD in .env.
 * The default password is a placeholder and must be changed on first login —
 * the seeder prints a reminder rather than silently accepting it.
 */
module.exports = {
  async up(queryInterface) {
    const sequelize = queryInterface.sequelize;
    const now = new Date();
    const email = String(config.superAdmin.email).toLowerCase();

    const existing = await sequelize.query(
      'SELECT id FROM users WHERE email = :email',
      { type: sequelize.QueryTypes.SELECT, replacements: { email } }
    );

    let userId = existing[0]?.id;

    if (!userId) {
      const passwordHash = await bcrypt.hash(config.superAdmin.password, config.security.bcryptSaltRounds);

      await queryInterface.bulkInsert('users', [{
        first_name: 'Bottle Bee',
        last_name: 'Administrator',
        email,
        phone: config.superAdmin.phone,
        password_hash: passwordHash,
        account_status: ACCOUNT_STATUS.ACTIVE,
        email_verified_at: now,
        login_attempts: 0,
        preferred_language: 'en',
        timezone: 'Asia/Kolkata',
        created_at: now,
        is_active: true,
      }]);

      const created = await sequelize.query(
        'SELECT id FROM users WHERE email = :email',
        { type: sequelize.QueryTypes.SELECT, replacements: { email } }
      );
      userId = created[0].id;

      /* eslint-disable no-console */
      console.log('');
      console.log('  Super admin created');
      console.log(`    email:    ${email}`);
      console.log(`    password: ${config.superAdmin.password}`);
      console.log('    Change this password immediately after first sign-in.');
      console.log('');
      /* eslint-enable no-console */
    }

    const role = await sequelize.query(
      'SELECT id FROM roles WHERE code = :code',
      { type: sequelize.QueryTypes.SELECT, replacements: { code: ROLES.SUPER_ADMIN } }
    );

    if (!role[0]) {
      throw new Error('SUPER_ADMIN role is missing. Run the RBAC seeder first.');
    }

    const link = await sequelize.query(
      'SELECT id FROM user_roles WHERE user_id = :userId AND role_id = :roleId',
      { type: sequelize.QueryTypes.SELECT, replacements: { userId, roleId: role[0].id } }
    );

    if (!link[0]) {
      await queryInterface.bulkInsert('user_roles', [{
        user_id: userId,
        role_id: role[0].id,
        created_at: now,
        created_by: userId,
        is_active: true,
      }]);
    }
  },

  async down(queryInterface) {
    const sequelize = queryInterface.sequelize;
    const email = String(config.superAdmin.email).toLowerCase();

    await sequelize.query(
      'DELETE ur FROM user_roles ur JOIN users u ON u.id = ur.user_id WHERE u.email = :email',
      { replacements: { email } }
    );
    await queryInterface.bulkDelete('users', { email });
  },
};
