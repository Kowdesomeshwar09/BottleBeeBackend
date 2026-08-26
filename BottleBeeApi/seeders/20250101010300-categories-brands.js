'use strict';

/** Product taxonomy and a starter brand list for the launch catalog. */

const CATEGORIES = [
  { name: 'Beer', slug: 'beer', description: 'Lagers, ales, stouts and wheat beers.', sort_order: 1 },
  { name: 'Whisky', slug: 'whisky', description: 'Scotch, bourbon, rye and Indian single malts.', sort_order: 2 },
  { name: 'Wine', slug: 'wine', description: 'Red, white, rose and sparkling wines.', sort_order: 3 },
  { name: 'Vodka', slug: 'vodka', description: 'Plain and flavoured vodka.', sort_order: 4 },
  { name: 'Rum', slug: 'rum', description: 'White, dark, spiced and aged rum.', sort_order: 5 },
  { name: 'Gin', slug: 'gin', description: 'London dry, contemporary and craft gin.', sort_order: 6 },
  { name: 'Tequila', slug: 'tequila', description: 'Blanco, reposado and anejo tequila.', sort_order: 7 },
  { name: 'Brandy', slug: 'brandy', description: 'Cognac, armagnac and Indian brandy.', sort_order: 8 },
  { name: 'Liqueur', slug: 'liqueur', description: 'Cream, herbal, coffee and fruit liqueurs.', sort_order: 9 },
  { name: 'Champagne', slug: 'champagne', description: 'Champagne and premium sparkling wine.', sort_order: 10 },
  { name: 'Mixers', slug: 'mixers', description: 'Tonics, sodas and non-alcoholic mixers.', sort_order: 11 },
];

/** Sub-categories, keyed by parent slug. */
const SUBCATEGORIES = {
  beer: [
    { name: 'Lager', slug: 'beer-lager', sort_order: 1 },
    { name: 'Craft & IPA', slug: 'beer-craft-ipa', sort_order: 2 },
    { name: 'Wheat Beer', slug: 'beer-wheat', sort_order: 3 },
    { name: 'Strong Beer', slug: 'beer-strong', sort_order: 4 },
  ],
  whisky: [
    { name: 'Single Malt', slug: 'whisky-single-malt', sort_order: 1 },
    { name: 'Blended Scotch', slug: 'whisky-blended-scotch', sort_order: 2 },
    { name: 'Bourbon', slug: 'whisky-bourbon', sort_order: 3 },
    { name: 'Indian Whisky', slug: 'whisky-indian', sort_order: 4 },
  ],
  wine: [
    { name: 'Red Wine', slug: 'wine-red', sort_order: 1 },
    { name: 'White Wine', slug: 'wine-white', sort_order: 2 },
    { name: 'Rose Wine', slug: 'wine-rose', sort_order: 3 },
    { name: 'Sparkling', slug: 'wine-sparkling', sort_order: 4 },
  ],
};

const BRANDS = [
  { name: 'Kingfisher', slug: 'kingfisher', country_of_origin: 'India' },
  { name: 'Bira 91', slug: 'bira-91', country_of_origin: 'India' },
  { name: 'Budweiser', slug: 'budweiser', country_of_origin: 'United States' },
  { name: 'Heineken', slug: 'heineken', country_of_origin: 'Netherlands' },
  { name: 'Corona', slug: 'corona', country_of_origin: 'Mexico' },
  { name: 'Amrut', slug: 'amrut', country_of_origin: 'India' },
  { name: 'Rampur', slug: 'rampur', country_of_origin: 'India' },
  { name: 'Glenfiddich', slug: 'glenfiddich', country_of_origin: 'Scotland' },
  { name: 'Johnnie Walker', slug: 'johnnie-walker', country_of_origin: 'Scotland' },
  { name: 'Jack Daniel’s', slug: 'jack-daniels', country_of_origin: 'United States' },
  { name: 'Jameson', slug: 'jameson', country_of_origin: 'Ireland' },
  { name: 'Absolut', slug: 'absolut', country_of_origin: 'Sweden' },
  { name: 'Smirnoff', slug: 'smirnoff', country_of_origin: 'Russia' },
  { name: 'Bacardi', slug: 'bacardi', country_of_origin: 'Cuba' },
  { name: 'Old Monk', slug: 'old-monk', country_of_origin: 'India' },
  { name: 'Bombay Sapphire', slug: 'bombay-sapphire', country_of_origin: 'United Kingdom' },
  { name: 'Greater Than', slug: 'greater-than', country_of_origin: 'India' },
  { name: 'Jose Cuervo', slug: 'jose-cuervo', country_of_origin: 'Mexico' },
  { name: 'Sula Vineyards', slug: 'sula-vineyards', country_of_origin: 'India' },
  { name: 'Jacob’s Creek', slug: 'jacobs-creek', country_of_origin: 'Australia' },
  { name: 'Moet & Chandon', slug: 'moet-chandon', country_of_origin: 'France' },
  { name: 'Baileys', slug: 'baileys', country_of_origin: 'Ireland' },
];

module.exports = {
  async up(queryInterface) {
    const sequelize = queryInterface.sequelize;
    const now = new Date();

    const existingCategories = await sequelize.query(
      'SELECT slug FROM categories',
      { type: sequelize.QueryTypes.SELECT }
    );
    const knownCategories = new Set(existingCategories.map((c) => c.slug));

    const topLevel = CATEGORIES
      .filter((c) => !knownCategories.has(c.slug))
      .map((c) => ({ ...c, parent_id: null, created_at: now, is_active: true }));

    if (topLevel.length) await queryInterface.bulkInsert('categories', topLevel);

    // Sub-categories need their parent id, so they are inserted afterwards.
    const parents = await sequelize.query(
      'SELECT id, slug FROM categories WHERE parent_id IS NULL',
      { type: sequelize.QueryTypes.SELECT }
    );
    const parentIdBySlug = new Map(parents.map((p) => [p.slug, p.id]));

    const refreshed = await sequelize.query(
      'SELECT slug FROM categories',
      { type: sequelize.QueryTypes.SELECT }
    );
    const allKnown = new Set(refreshed.map((c) => c.slug));

    const children = [];
    Object.entries(SUBCATEGORIES).forEach(([parentSlug, items]) => {
      const parentId = parentIdBySlug.get(parentSlug);
      if (!parentId) return;

      items.forEach((item) => {
        if (allKnown.has(item.slug)) return;
        children.push({
          ...item,
          parent_id: parentId,
          description: null,
          image_url: null,
          created_at: now,
          is_active: true,
        });
      });
    });

    if (children.length) await queryInterface.bulkInsert('categories', children);

    const existingBrands = await sequelize.query(
      'SELECT slug FROM brands',
      { type: sequelize.QueryTypes.SELECT }
    );
    const knownBrands = new Set(existingBrands.map((b) => b.slug));

    const brands = BRANDS
      .filter((b) => !knownBrands.has(b.slug))
      .map((b) => ({
        ...b, description: null, logo_url: null, created_at: now, is_active: true,
      }));

    if (brands.length) await queryInterface.bulkInsert('brands', brands);
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('brands', { slug: BRANDS.map((b) => b.slug) });
    const childSlugs = Object.values(SUBCATEGORIES).flat().map((c) => c.slug);
    await queryInterface.bulkDelete('categories', { slug: childSlugs });
    await queryInterface.bulkDelete('categories', { slug: CATEGORIES.map((c) => c.slug) });
  },
};
