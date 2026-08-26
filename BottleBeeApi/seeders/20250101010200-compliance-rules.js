'use strict';

/**
 * Default regional compliance rules.
 *
 * These encode the shape of Indian state liquor regulation — legal drinking
 * age, permitted sale window, dry days and per-order caps — for the launch
 * regions. They are starting values for development, not legal advice: verify
 * each figure against the current state excise policy before going live, and
 * update the rows through the Compliance admin screen.
 *
 * `rule_metadata.states` lets an address with no explicit region code be mapped
 * to the right region by its state name.
 */
const RULES = [
  {
    region_code: 'IN-TS',
    region_name: 'Telangana',
    minimum_age: 21,
    alcohol_sale_start_time: '10:00:00',
    alcohol_sale_end_time: '23:00:00',
    dry_day: false,
    max_order_amount: 25000.00,
    max_quantity_per_order: 12,
    rule_metadata: { states: ['Telangana'], dryDates: [], blockedTypes: [] },
  },
  {
    region_code: 'IN-KA',
    region_name: 'Karnataka',
    minimum_age: 21,
    alcohol_sale_start_time: '10:00:00',
    alcohol_sale_end_time: '23:00:00',
    dry_day: false,
    max_order_amount: 25000.00,
    max_quantity_per_order: 12,
    rule_metadata: { states: ['Karnataka'], dryDates: [], blockedTypes: [] },
  },
  {
    region_code: 'IN-MH',
    region_name: 'Maharashtra',
    minimum_age: 25,
    alcohol_sale_start_time: '11:00:00',
    alcohol_sale_end_time: '22:30:00',
    dry_day: false,
    max_order_amount: 20000.00,
    max_quantity_per_order: 10,
    rule_metadata: { states: ['Maharashtra'], dryDates: [], blockedTypes: [] },
  },
  {
    region_code: 'IN-DL',
    region_name: 'Delhi',
    minimum_age: 25,
    alcohol_sale_start_time: '10:00:00',
    alcohol_sale_end_time: '22:00:00',
    dry_day: false,
    max_order_amount: 20000.00,
    max_quantity_per_order: 10,
    rule_metadata: { states: ['Delhi', 'New Delhi'], dryDates: [], blockedTypes: [] },
  },
  {
    region_code: 'IN-GA',
    region_name: 'Goa',
    minimum_age: 18,
    alcohol_sale_start_time: '09:00:00',
    alcohol_sale_end_time: '23:59:00',
    dry_day: false,
    max_order_amount: 30000.00,
    max_quantity_per_order: 24,
    rule_metadata: { states: ['Goa'], dryDates: [], blockedTypes: [] },
  },
  {
    // Prohibition states. Kept as explicit rows so an order to these addresses
    // is refused with a clear reason rather than falling back to a default.
    region_code: 'IN-GJ',
    region_name: 'Gujarat',
    minimum_age: 21,
    alcohol_sale_start_time: null,
    alcohol_sale_end_time: null,
    dry_day: true,
    max_order_amount: 0.00,
    max_quantity_per_order: 0,
    rule_metadata: { states: ['Gujarat'], prohibition: true, note: 'Alcohol sale is prohibited.' },
  },
  {
    region_code: 'IN-BR',
    region_name: 'Bihar',
    minimum_age: 21,
    alcohol_sale_start_time: null,
    alcohol_sale_end_time: null,
    dry_day: true,
    max_order_amount: 0.00,
    max_quantity_per_order: 0,
    rule_metadata: { states: ['Bihar'], prohibition: true, note: 'Alcohol sale is prohibited.' },
  },
];

module.exports = {
  async up(queryInterface) {
    const sequelize = queryInterface.sequelize;
    const now = new Date();

    const existing = await sequelize.query(
      'SELECT region_code FROM compliance_rules',
      { type: sequelize.QueryTypes.SELECT }
    );
    const known = new Set(existing.map((r) => r.region_code));

    const rows = RULES
      .filter((rule) => !known.has(rule.region_code))
      .map((rule) => ({
        ...rule,
        rule_metadata: JSON.stringify(rule.rule_metadata),
        created_at: now,
        is_active: true,
      }));

    if (rows.length) await queryInterface.bulkInsert('compliance_rules', rows);
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('compliance_rules', {
      region_code: RULES.map((r) => r.region_code),
    });
  },
};
