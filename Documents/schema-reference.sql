-- Bottle Bee — reference schema (generated from migrations, do not execute directly).
-- Source of truth is BottleBeeApi/migrations/. Regenerate after any migration change.
-- Tables: 42

CREATE TABLE IF NOT EXISTS `users` (`id` BIGINT UNSIGNED NOT NULL auto_increment , `first_name` VARCHAR(100) NOT NULL, `last_name` VARCHAR(100), `email` VARCHAR(255) NOT NULL, `phone` VARCHAR(30), `password_hash` VARCHAR(255) NOT NULL, `profile_image_url` VARCHAR(500), `date_of_birth` DATE, `account_status` ENUM('PENDING', 'ACTIVE', 'SUSPENDED', 'BLOCKED', 'DELETED') NOT NULL DEFAULT 'PENDING', `email_verified_at` DATETIME, `phone_verified_at` DATETIME, `last_login_at` DATETIME, `login_attempts` INTEGER NOT NULL DEFAULT 0, `locked_until` DATETIME, `preferred_language` VARCHAR(20) DEFAULT 'en', `timezone` VARCHAR(100), `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `created_by` BIGINT UNSIGNED, `updated_at` DATETIME DEFAULT NULL, `updated_by` BIGINT UNSIGNED, `deleted_at` DATETIME DEFAULT NULL, `deleted_by` BIGINT UNSIGNED, `is_active` TINYINT(1) NOT NULL DEFAULT true, PRIMARY KEY (`id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `users` ADD UNIQUE INDEX `uq_users_email` (`email`);

ALTER TABLE `users` ADD UNIQUE INDEX `uq_users_phone` (`phone`);

ALTER TABLE `users` ADD INDEX `idx_users_status` (`account_status`);

ALTER TABLE `users` MODIFY `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE `users` ADD INDEX `idx_users_deleted_at` (`deleted_at`);

CREATE TABLE IF NOT EXISTS `roles` (`id` BIGINT UNSIGNED NOT NULL auto_increment , `code` VARCHAR(80) NOT NULL, `name` VARCHAR(120) NOT NULL, `description` VARCHAR(255), `is_system` TINYINT(1) NOT NULL DEFAULT false, `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `created_by` BIGINT UNSIGNED, `updated_at` DATETIME DEFAULT NULL, `updated_by` BIGINT UNSIGNED, `deleted_at` DATETIME DEFAULT NULL, `deleted_by` BIGINT UNSIGNED, `is_active` TINYINT(1) NOT NULL DEFAULT true, PRIMARY KEY (`id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `roles` ADD UNIQUE INDEX `uq_roles_code` (`code`);

ALTER TABLE `roles` MODIFY `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE `roles` ADD INDEX `idx_roles_deleted_at` (`deleted_at`);

CREATE TABLE IF NOT EXISTS `permissions` (`id` BIGINT UNSIGNED NOT NULL auto_increment , `code` VARCHAR(100) NOT NULL, `module` VARCHAR(100) NOT NULL, `description` VARCHAR(255), `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `created_by` BIGINT UNSIGNED, `updated_at` DATETIME DEFAULT NULL, `updated_by` BIGINT UNSIGNED, `deleted_at` DATETIME DEFAULT NULL, `deleted_by` BIGINT UNSIGNED, `is_active` TINYINT(1) NOT NULL DEFAULT true, PRIMARY KEY (`id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `permissions` ADD UNIQUE INDEX `uq_permissions_code` (`code`);

ALTER TABLE `permissions` ADD INDEX `idx_permissions_module` (`module`);

ALTER TABLE `permissions` MODIFY `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE `permissions` ADD INDEX `idx_permissions_deleted_at` (`deleted_at`);

CREATE TABLE IF NOT EXISTS `user_roles` (`id` BIGINT UNSIGNED NOT NULL auto_increment , `user_id` BIGINT UNSIGNED NOT NULL, `role_id` BIGINT UNSIGNED NOT NULL, `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `created_by` BIGINT UNSIGNED, `updated_at` DATETIME DEFAULT NULL, `updated_by` BIGINT UNSIGNED, `deleted_at` DATETIME DEFAULT NULL, `deleted_by` BIGINT UNSIGNED, `is_active` TINYINT(1) NOT NULL DEFAULT true, PRIMARY KEY (`id`), FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `user_roles` ADD UNIQUE INDEX `uq_user_roles` (`user_id`, `role_id`);

ALTER TABLE `user_roles` MODIFY `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE `user_roles` ADD INDEX `idx_user_roles_deleted_at` (`deleted_at`);

CREATE TABLE IF NOT EXISTS `role_permissions` (`id` BIGINT UNSIGNED NOT NULL auto_increment , `role_id` BIGINT UNSIGNED NOT NULL, `permission_id` BIGINT UNSIGNED NOT NULL, `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `created_by` BIGINT UNSIGNED, `updated_at` DATETIME DEFAULT NULL, `updated_by` BIGINT UNSIGNED, `deleted_at` DATETIME DEFAULT NULL, `deleted_by` BIGINT UNSIGNED, `is_active` TINYINT(1) NOT NULL DEFAULT true, PRIMARY KEY (`id`), FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`permission_id`) REFERENCES `permissions` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `role_permissions` ADD UNIQUE INDEX `uq_role_permissions` (`role_id`, `permission_id`);

ALTER TABLE `role_permissions` MODIFY `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE `role_permissions` ADD INDEX `idx_role_permissions_deleted_at` (`deleted_at`);

CREATE TABLE IF NOT EXISTS `refresh_tokens` (`id` BIGINT UNSIGNED NOT NULL auto_increment , `user_id` BIGINT UNSIGNED NOT NULL, `token_hash` VARCHAR(255) NOT NULL, `device_id` VARCHAR(255), `ip_address` VARCHAR(80), `user_agent` VARCHAR(500), `expires_at` DATETIME NOT NULL, `revoked_at` DATETIME, `replaced_by_token_id` BIGINT UNSIGNED, `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `created_by` BIGINT UNSIGNED, `updated_at` DATETIME DEFAULT NULL, `updated_by` BIGINT UNSIGNED, `deleted_at` DATETIME DEFAULT NULL, `deleted_by` BIGINT UNSIGNED, `is_active` TINYINT(1) NOT NULL DEFAULT true, PRIMARY KEY (`id`), FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `refresh_tokens` ADD UNIQUE INDEX `uq_refresh_token_hash` (`token_hash`);

ALTER TABLE `refresh_tokens` ADD INDEX `idx_refresh_user` (`user_id`);

ALTER TABLE `refresh_tokens` ADD INDEX `idx_refresh_expires` (`expires_at`);

ALTER TABLE `refresh_tokens` MODIFY `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE `refresh_tokens` ADD INDEX `idx_refresh_tokens_deleted_at` (`deleted_at`);

CREATE TABLE IF NOT EXISTS `password_reset_tokens` (`id` BIGINT UNSIGNED NOT NULL auto_increment , `user_id` BIGINT UNSIGNED NOT NULL, `token_hash` VARCHAR(255) NOT NULL, `expires_at` DATETIME NOT NULL, `used_at` DATETIME, `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `created_by` BIGINT UNSIGNED, `updated_at` DATETIME DEFAULT NULL, `updated_by` BIGINT UNSIGNED, `deleted_at` DATETIME DEFAULT NULL, `deleted_by` BIGINT UNSIGNED, `is_active` TINYINT(1) NOT NULL DEFAULT true, PRIMARY KEY (`id`), FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `password_reset_tokens` ADD UNIQUE INDEX `uq_password_reset_token` (`token_hash`);

ALTER TABLE `password_reset_tokens` ADD INDEX `idx_password_reset_user` (`user_id`);

ALTER TABLE `password_reset_tokens` MODIFY `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE `password_reset_tokens` ADD INDEX `idx_password_reset_tokens_deleted_at` (`deleted_at`);

CREATE TABLE IF NOT EXISTS `customer_profiles` (`id` BIGINT UNSIGNED NOT NULL auto_increment , `user_id` BIGINT UNSIGNED NOT NULL, `legal_first_name` VARCHAR(100) NOT NULL, `legal_last_name` VARCHAR(100) NOT NULL, `date_of_birth` DATE NOT NULL, `gender` ENUM('MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY'), `default_address_id` BIGINT UNSIGNED, `marketing_opt_in` TINYINT(1) NOT NULL DEFAULT false, `age_verified` TINYINT(1) NOT NULL DEFAULT false, `age_verified_at` DATETIME, `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `created_by` BIGINT UNSIGNED, `updated_at` DATETIME DEFAULT NULL, `updated_by` BIGINT UNSIGNED, `deleted_at` DATETIME DEFAULT NULL, `deleted_by` BIGINT UNSIGNED, `is_active` TINYINT(1) NOT NULL DEFAULT true, PRIMARY KEY (`id`), FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `customer_profiles` ADD UNIQUE INDEX `uq_customer_user` (`user_id`);

ALTER TABLE `customer_profiles` MODIFY `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE `customer_profiles` ADD INDEX `idx_customer_profiles_deleted_at` (`deleted_at`);

CREATE TABLE IF NOT EXISTS `customer_addresses` (`id` BIGINT UNSIGNED NOT NULL auto_increment , `customer_id` BIGINT UNSIGNED NOT NULL, `label` VARCHAR(80), `recipient_name` VARCHAR(150) NOT NULL, `phone` VARCHAR(30) NOT NULL, `address_line1` VARCHAR(255) NOT NULL, `address_line2` VARCHAR(255), `city` VARCHAR(100) NOT NULL, `state` VARCHAR(100) NOT NULL, `postal_code` VARCHAR(20) NOT NULL, `country` VARCHAR(100) NOT NULL DEFAULT 'India', `region_code` VARCHAR(50), `latitude` DECIMAL(10,6), `longitude` DECIMAL(10,6), `is_default` TINYINT(1) NOT NULL DEFAULT false, `delivery_instructions` VARCHAR(500), `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `created_by` BIGINT UNSIGNED, `updated_at` DATETIME DEFAULT NULL, `updated_by` BIGINT UNSIGNED, `deleted_at` DATETIME DEFAULT NULL, `deleted_by` BIGINT UNSIGNED, `is_active` TINYINT(1) NOT NULL DEFAULT true, PRIMARY KEY (`id`), FOREIGN KEY (`customer_id`) REFERENCES `customer_profiles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `customer_addresses` ADD INDEX `idx_customer_addresses_customer` (`customer_id`);

ALTER TABLE `customer_addresses` ADD INDEX `idx_customer_addresses_postal` (`postal_code`);

ALTER TABLE `customer_addresses` MODIFY `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE `customer_addresses` ADD INDEX `idx_customer_addresses_deleted_at` (`deleted_at`);

ALTER TABLE `customer_profiles` ADD CONSTRAINT `fk_customer_profiles_default_address` FOREIGN KEY (`default_address_id`) REFERENCES `customer_addresses` (`id`) ON UPDATE CASCADE ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS `age_verifications` (`id` BIGINT UNSIGNED NOT NULL auto_increment , `user_id` BIGINT UNSIGNED NOT NULL, `document_type` ENUM('AADHAAR', 'PASSPORT', 'DRIVING_LICENSE', 'VOTER_ID', 'OTHER') NOT NULL, `document_number_hash` VARCHAR(255), `document_front_url` VARCHAR(500), `document_back_url` VARCHAR(500), `selfie_url` VARCHAR(500), `date_of_birth` DATE NOT NULL, `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED') NOT NULL DEFAULT 'PENDING', `reviewed_by` BIGINT UNSIGNED, `reviewed_at` DATETIME, `rejection_reason` VARCHAR(500), `expires_at` DATETIME, `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `created_by` BIGINT UNSIGNED, `updated_at` DATETIME DEFAULT NULL, `updated_by` BIGINT UNSIGNED, `deleted_at` DATETIME DEFAULT NULL, `deleted_by` BIGINT UNSIGNED, `is_active` TINYINT(1) NOT NULL DEFAULT true, PRIMARY KEY (`id`), FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`reviewed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `age_verifications` ADD INDEX `idx_age_user_status` (`user_id`, `status`);

ALTER TABLE `age_verifications` MODIFY `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE `age_verifications` ADD INDEX `idx_age_verifications_deleted_at` (`deleted_at`);

CREATE TABLE IF NOT EXISTS `compliance_rules` (`id` BIGINT UNSIGNED NOT NULL auto_increment , `region_code` VARCHAR(50) NOT NULL, `region_name` VARCHAR(150), `minimum_age` INTEGER NOT NULL DEFAULT 21, `alcohol_sale_start_time` TIME, `alcohol_sale_end_time` TIME, `dry_day` TINYINT(1) NOT NULL DEFAULT false, `max_order_amount` DECIMAL(10,2), `max_quantity_per_order` INTEGER, `rule_metadata` JSON, `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `created_by` BIGINT UNSIGNED, `updated_at` DATETIME DEFAULT NULL, `updated_by` BIGINT UNSIGNED, `deleted_at` DATETIME DEFAULT NULL, `deleted_by` BIGINT UNSIGNED, `is_active` TINYINT(1) NOT NULL DEFAULT true, PRIMARY KEY (`id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `compliance_rules` ADD UNIQUE INDEX `uq_compliance_region` (`region_code`);

ALTER TABLE `compliance_rules` MODIFY `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE `compliance_rules` ADD INDEX `idx_compliance_rules_deleted_at` (`deleted_at`);

CREATE TABLE IF NOT EXISTS `vendors` (`id` BIGINT UNSIGNED NOT NULL auto_increment , `business_name` VARCHAR(255) NOT NULL, `legal_name` VARCHAR(255) NOT NULL, `owner_user_id` BIGINT UNSIGNED NOT NULL, `email` VARCHAR(255) NOT NULL, `phone` VARCHAR(30) NOT NULL, `description` TEXT, `logo_url` VARCHAR(500), `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED', 'CLOSED') NOT NULL DEFAULT 'PENDING', `rejection_reason` VARCHAR(500), `reviewed_by` BIGINT UNSIGNED, `reviewed_at` DATETIME, `rating_avg` DECIMAL(3,2) NOT NULL DEFAULT 0, `rating_count` INTEGER NOT NULL DEFAULT 0, `commission_percent` DECIMAL(5,2) NOT NULL DEFAULT 0, `delivery_radius_km` DECIMAL(6,2), `min_order_amount` DECIMAL(10,2), `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `created_by` BIGINT UNSIGNED, `updated_at` DATETIME DEFAULT NULL, `updated_by` BIGINT UNSIGNED, `deleted_at` DATETIME DEFAULT NULL, `deleted_by` BIGINT UNSIGNED, `is_active` TINYINT(1) NOT NULL DEFAULT true, PRIMARY KEY (`id`), FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE, FOREIGN KEY (`reviewed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `vendors` ADD INDEX `idx_vendors_status` (`status`);

ALTER TABLE `vendors` ADD INDEX `idx_vendors_owner` (`owner_user_id`);

ALTER TABLE `vendors` MODIFY `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE `vendors` ADD INDEX `idx_vendors_deleted_at` (`deleted_at`);

ALTER TABLE `vendors` ADD CONSTRAINT `chk_vendors_commission` CHECK (commission_percent BETWEEN 0 AND 100);

CREATE TABLE IF NOT EXISTS `vendor_users` (`id` BIGINT UNSIGNED NOT NULL auto_increment , `vendor_id` BIGINT UNSIGNED NOT NULL, `user_id` BIGINT UNSIGNED NOT NULL, `vendor_role` ENUM('OWNER', 'MANAGER', 'STAFF') NOT NULL, `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `created_by` BIGINT UNSIGNED, `updated_at` DATETIME DEFAULT NULL, `updated_by` BIGINT UNSIGNED, `deleted_at` DATETIME DEFAULT NULL, `deleted_by` BIGINT UNSIGNED, `is_active` TINYINT(1) NOT NULL DEFAULT true, PRIMARY KEY (`id`), FOREIGN KEY (`vendor_id`) REFERENCES `vendors` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `vendor_users` ADD UNIQUE INDEX `uq_vendor_user` (`vendor_id`, `user_id`);

ALTER TABLE `vendor_users` ADD INDEX `idx_vendor_users_user` (`user_id`);

ALTER TABLE `vendor_users` MODIFY `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE `vendor_users` ADD INDEX `idx_vendor_users_deleted_at` (`deleted_at`);

CREATE TABLE IF NOT EXISTS `vendor_licenses` (`id` BIGINT UNSIGNED NOT NULL auto_increment , `vendor_id` BIGINT UNSIGNED NOT NULL, `license_number` VARCHAR(120) NOT NULL, `license_type` VARCHAR(100) NOT NULL, `issuing_authority` VARCHAR(255) NOT NULL, `region_code` VARCHAR(50) NOT NULL, `valid_from` DATE NOT NULL, `valid_until` DATE NOT NULL, `document_url` VARCHAR(500), `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED') NOT NULL DEFAULT 'PENDING', `rejection_reason` VARCHAR(500), `reviewed_by` BIGINT UNSIGNED, `reviewed_at` DATETIME, `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `created_by` BIGINT UNSIGNED, `updated_at` DATETIME DEFAULT NULL, `updated_by` BIGINT UNSIGNED, `deleted_at` DATETIME DEFAULT NULL, `deleted_by` BIGINT UNSIGNED, `is_active` TINYINT(1) NOT NULL DEFAULT true, PRIMARY KEY (`id`), FOREIGN KEY (`vendor_id`) REFERENCES `vendors` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`reviewed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `vendor_licenses` ADD UNIQUE INDEX `uq_vendor_license_number` (`license_number`);

ALTER TABLE `vendor_licenses` ADD INDEX `idx_vendor_license_vendor` (`vendor_id`);

ALTER TABLE `vendor_licenses` ADD INDEX `idx_vendor_license_validity` (`status`, `valid_until`);

ALTER TABLE `vendor_licenses` MODIFY `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE `vendor_licenses` ADD INDEX `idx_vendor_licenses_deleted_at` (`deleted_at`);

ALTER TABLE `vendor_licenses` ADD CONSTRAINT `chk_vendor_license_dates` CHECK (valid_until >= valid_from);

CREATE TABLE IF NOT EXISTS `vendor_addresses` (`id` BIGINT UNSIGNED NOT NULL auto_increment , `vendor_id` BIGINT UNSIGNED NOT NULL, `address_line1` VARCHAR(255) NOT NULL, `address_line2` VARCHAR(255), `city` VARCHAR(100) NOT NULL, `state` VARCHAR(100) NOT NULL, `postal_code` VARCHAR(20) NOT NULL, `country` VARCHAR(100) NOT NULL DEFAULT 'India', `region_code` VARCHAR(50), `latitude` DECIMAL(10,6), `longitude` DECIMAL(10,6), `is_primary` TINYINT(1) NOT NULL DEFAULT false, `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `created_by` BIGINT UNSIGNED, `updated_at` DATETIME DEFAULT NULL, `updated_by` BIGINT UNSIGNED, `deleted_at` DATETIME DEFAULT NULL, `deleted_by` BIGINT UNSIGNED, `is_active` TINYINT(1) NOT NULL DEFAULT true, PRIMARY KEY (`id`), FOREIGN KEY (`vendor_id`) REFERENCES `vendors` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `vendor_addresses` ADD INDEX `idx_vendor_addresses_vendor` (`vendor_id`);

ALTER TABLE `vendor_addresses` MODIFY `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE `vendor_addresses` ADD INDEX `idx_vendor_addresses_deleted_at` (`deleted_at`);

CREATE TABLE IF NOT EXISTS `categories` (`id` BIGINT UNSIGNED NOT NULL auto_increment , `parent_id` BIGINT UNSIGNED, `name` VARCHAR(150) NOT NULL, `slug` VARCHAR(180) NOT NULL, `description` TEXT, `image_url` VARCHAR(500), `sort_order` INTEGER NOT NULL DEFAULT 0, `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `created_by` BIGINT UNSIGNED, `updated_at` DATETIME DEFAULT NULL, `updated_by` BIGINT UNSIGNED, `deleted_at` DATETIME DEFAULT NULL, `deleted_by` BIGINT UNSIGNED, `is_active` TINYINT(1) NOT NULL DEFAULT true, PRIMARY KEY (`id`), FOREIGN KEY (`parent_id`) REFERENCES `categories` (`id`) ON DELETE SET NULL ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `categories` ADD UNIQUE INDEX `uq_categories_slug` (`slug`);

ALTER TABLE `categories` ADD INDEX `idx_categories_parent` (`parent_id`);

ALTER TABLE `categories` MODIFY `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE `categories` ADD INDEX `idx_categories_deleted_at` (`deleted_at`);

CREATE TABLE IF NOT EXISTS `brands` (`id` BIGINT UNSIGNED NOT NULL auto_increment , `name` VARCHAR(150) NOT NULL, `slug` VARCHAR(180) NOT NULL, `description` TEXT, `logo_url` VARCHAR(500), `country_of_origin` VARCHAR(100), `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `created_by` BIGINT UNSIGNED, `updated_at` DATETIME DEFAULT NULL, `updated_by` BIGINT UNSIGNED, `deleted_at` DATETIME DEFAULT NULL, `deleted_by` BIGINT UNSIGNED, `is_active` TINYINT(1) NOT NULL DEFAULT true, PRIMARY KEY (`id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `brands` ADD UNIQUE INDEX `uq_brands_slug` (`slug`);

ALTER TABLE `brands` MODIFY `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE `brands` ADD INDEX `idx_brands_deleted_at` (`deleted_at`);

CREATE TABLE IF NOT EXISTS `products` (`id` BIGINT UNSIGNED NOT NULL auto_increment , `vendor_id` BIGINT UNSIGNED NOT NULL, `category_id` BIGINT UNSIGNED NOT NULL, `brand_id` BIGINT UNSIGNED, `name` VARCHAR(255) NOT NULL, `slug` VARCHAR(280) NOT NULL, `description` TEXT, `alcohol_percentage` DECIMAL(5,2), `origin_country` VARCHAR(100), `product_type` ENUM('BEER', 'WINE', 'WHISKEY', 'VODKA', 'GIN', 'RUM', 'TEQUILA', 'BRANDY', 'LIQUEUR', 'CHAMPAGNE', 'OTHER') NOT NULL, `status` ENUM('DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'INACTIVE', 'REJECTED') NOT NULL DEFAULT 'DRAFT', `rejection_reason` VARCHAR(500), `reviewed_by` BIGINT UNSIGNED, `reviewed_at` DATETIME, `is_featured` TINYINT(1) NOT NULL DEFAULT false, `rating_avg` DECIMAL(3,2) NOT NULL DEFAULT 0, `rating_count` INTEGER NOT NULL DEFAULT 0, `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `created_by` BIGINT UNSIGNED, `updated_at` DATETIME DEFAULT NULL, `updated_by` BIGINT UNSIGNED, `deleted_at` DATETIME DEFAULT NULL, `deleted_by` BIGINT UNSIGNED, `is_active` TINYINT(1) NOT NULL DEFAULT true, PRIMARY KEY (`id`), FOREIGN KEY (`vendor_id`) REFERENCES `vendors` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE, FOREIGN KEY (`brand_id`) REFERENCES `brands` (`id`) ON DELETE SET NULL ON UPDATE CASCADE, FOREIGN KEY (`reviewed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `products` ADD UNIQUE INDEX `uq_product_vendor_slug` (`vendor_id`, `slug`);

ALTER TABLE `products` ADD INDEX `idx_products_vendor_status` (`vendor_id`, `status`);

ALTER TABLE `products` ADD INDEX `idx_products_category` (`category_id`);

ALTER TABLE `products` ADD INDEX `idx_products_brand` (`brand_id`);

ALTER TABLE `products` ADD INDEX `idx_products_type` (`product_type`);

ALTER TABLE `products` MODIFY `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE `products` ADD INDEX `idx_products_deleted_at` (`deleted_at`);

ALTER TABLE `products` ADD FULLTEXT INDEX `ft_products_search` (`name`, `description`);

ALTER TABLE `products` ADD CONSTRAINT `chk_products_alcohol_percentage` CHECK (alcohol_percentage IS NULL OR (alcohol_percentage >= 0 AND alcohol_percentage <= 100));

CREATE TABLE IF NOT EXISTS `product_variants` (`id` BIGINT UNSIGNED NOT NULL auto_increment , `product_id` BIGINT UNSIGNED NOT NULL, `sku` VARCHAR(120) NOT NULL, `size_ml` INTEGER NOT NULL, `pack_size` INTEGER NOT NULL DEFAULT 1, `mrp` DECIMAL(10,2) NOT NULL, `selling_price` DECIMAL(10,2) NOT NULL, `tax_percent` DECIMAL(5,2) NOT NULL DEFAULT 0, `currency` VARCHAR(10) NOT NULL DEFAULT 'INR', `barcode` VARCHAR(120), `weight_grams` INTEGER, `status` ENUM('ACTIVE', 'INACTIVE', 'OUT_OF_STOCK') NOT NULL DEFAULT 'ACTIVE', `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `created_by` BIGINT UNSIGNED, `updated_at` DATETIME DEFAULT NULL, `updated_by` BIGINT UNSIGNED, `deleted_at` DATETIME DEFAULT NULL, `deleted_by` BIGINT UNSIGNED, `is_active` TINYINT(1) NOT NULL DEFAULT true, PRIMARY KEY (`id`), FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `product_variants` ADD UNIQUE INDEX `uq_variant_sku` (`sku`);

ALTER TABLE `product_variants` ADD INDEX `idx_variants_product` (`product_id`);

ALTER TABLE `product_variants` MODIFY `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE `product_variants` ADD INDEX `idx_product_variants_deleted_at` (`deleted_at`);

ALTER TABLE `product_variants` ADD CONSTRAINT `chk_variant_price_positive` CHECK (selling_price >= 0);

ALTER TABLE `product_variants` ADD CONSTRAINT `chk_variant_mrp_gte_price` CHECK (mrp >= selling_price);

ALTER TABLE `product_variants` ADD CONSTRAINT `chk_variant_size_positive` CHECK (size_ml > 0);

ALTER TABLE `product_variants` ADD CONSTRAINT `chk_variant_pack_positive` CHECK (pack_size > 0);

CREATE TABLE IF NOT EXISTS `product_images` (`id` BIGINT UNSIGNED NOT NULL auto_increment , `product_id` BIGINT UNSIGNED NOT NULL, `image_url` VARCHAR(500) NOT NULL, `alt_text` VARCHAR(255), `sort_order` INTEGER NOT NULL DEFAULT 0, `is_primary` TINYINT(1) NOT NULL DEFAULT false, `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `created_by` BIGINT UNSIGNED, `updated_at` DATETIME DEFAULT NULL, `updated_by` BIGINT UNSIGNED, `deleted_at` DATETIME DEFAULT NULL, `deleted_by` BIGINT UNSIGNED, `is_active` TINYINT(1) NOT NULL DEFAULT true, PRIMARY KEY (`id`), FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `product_images` ADD INDEX `idx_product_images_product` (`product_id`);

ALTER TABLE `product_images` MODIFY `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE `product_images` ADD INDEX `idx_product_images_deleted_at` (`deleted_at`);

CREATE TABLE IF NOT EXISTS `inventory` (`id` BIGINT UNSIGNED NOT NULL auto_increment , `vendor_id` BIGINT UNSIGNED NOT NULL, `product_variant_id` BIGINT UNSIGNED NOT NULL, `quantity_available` INTEGER NOT NULL DEFAULT 0, `quantity_reserved` INTEGER NOT NULL DEFAULT 0, `reorder_level` INTEGER NOT NULL DEFAULT 0, `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `created_by` BIGINT UNSIGNED, `updated_at` DATETIME DEFAULT NULL, `updated_by` BIGINT UNSIGNED, `deleted_at` DATETIME DEFAULT NULL, `deleted_by` BIGINT UNSIGNED, `is_active` TINYINT(1) NOT NULL DEFAULT true, PRIMARY KEY (`id`), FOREIGN KEY (`vendor_id`) REFERENCES `vendors` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`product_variant_id`) REFERENCES `product_variants` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `inventory` ADD UNIQUE INDEX `uq_inventory_vendor_variant` (`vendor_id`, `product_variant_id`);

ALTER TABLE `inventory` ADD INDEX `idx_inventory_variant` (`product_variant_id`);

ALTER TABLE `inventory` MODIFY `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE `inventory` ADD INDEX `idx_inventory_deleted_at` (`deleted_at`);

ALTER TABLE `inventory` ADD CONSTRAINT `chk_inventory_available_non_negative` CHECK (quantity_available >= 0);

ALTER TABLE `inventory` ADD CONSTRAINT `chk_inventory_reserved_non_negative` CHECK (quantity_reserved >= 0);

CREATE TABLE IF NOT EXISTS `inventory_transactions` (`id` BIGINT UNSIGNED NOT NULL auto_increment , `inventory_id` BIGINT UNSIGNED NOT NULL, `transaction_type` ENUM('STOCK_IN', 'STOCK_OUT', 'RESERVE', 'RELEASE', 'ADJUSTMENT', 'SALE', 'RETURN') NOT NULL, `quantity` INTEGER NOT NULL, `quantity_after` INTEGER, `reserved_after` INTEGER, `reference_type` ENUM('ORDER', 'MANUAL', 'REFUND', 'SYSTEM') NOT NULL, `reference_id` BIGINT UNSIGNED, `notes` VARCHAR(500), `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `created_by` BIGINT UNSIGNED, `updated_at` DATETIME DEFAULT NULL, `updated_by` BIGINT UNSIGNED, `deleted_at` DATETIME DEFAULT NULL, `deleted_by` BIGINT UNSIGNED, `is_active` TINYINT(1) NOT NULL DEFAULT true, PRIMARY KEY (`id`), FOREIGN KEY (`inventory_id`) REFERENCES `inventory` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `inventory_transactions` ADD INDEX `idx_inventory_tx_inventory` (`inventory_id`);

ALTER TABLE `inventory_transactions` ADD INDEX `idx_inventory_tx_reference` (`reference_type`, `reference_id`);

ALTER TABLE `inventory_transactions` MODIFY `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE `inventory_transactions` ADD INDEX `idx_inventory_transactions_deleted_at` (`deleted_at`);

CREATE TABLE IF NOT EXISTS `carts` (`id` BIGINT UNSIGNED NOT NULL auto_increment , `customer_id` BIGINT UNSIGNED NOT NULL, `vendor_id` BIGINT UNSIGNED, `coupon_id` BIGINT UNSIGNED, `coupon_code` VARCHAR(80), `status` ENUM('ACTIVE', 'ORDERED', 'ABANDONED', 'EXPIRED') NOT NULL DEFAULT 'ACTIVE', `subtotal` DECIMAL(10,2) NOT NULL DEFAULT 0, `discount_total` DECIMAL(10,2) NOT NULL DEFAULT 0, `tax_total` DECIMAL(10,2) NOT NULL DEFAULT 0, `delivery_fee` DECIMAL(10,2) NOT NULL DEFAULT 0, `grand_total` DECIMAL(10,2) NOT NULL DEFAULT 0, `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `created_by` BIGINT UNSIGNED, `updated_at` DATETIME DEFAULT NULL, `updated_by` BIGINT UNSIGNED, `deleted_at` DATETIME DEFAULT NULL, `deleted_by` BIGINT UNSIGNED, `is_active` TINYINT(1) NOT NULL DEFAULT true, PRIMARY KEY (`id`), FOREIGN KEY (`customer_id`) REFERENCES `customer_profiles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`vendor_id`) REFERENCES `vendors` (`id`) ON DELETE SET NULL ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `carts` ADD INDEX `idx_carts_customer_status` (`customer_id`, `status`);

ALTER TABLE `carts` MODIFY `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE `carts` ADD INDEX `idx_carts_deleted_at` (`deleted_at`);

CREATE TABLE IF NOT EXISTS `cart_items` (`id` BIGINT UNSIGNED NOT NULL auto_increment , `cart_id` BIGINT UNSIGNED NOT NULL, `product_variant_id` BIGINT UNSIGNED NOT NULL, `quantity` INTEGER NOT NULL, `unit_price` DECIMAL(10,2) NOT NULL, `line_total` DECIMAL(10,2) NOT NULL, `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `created_by` BIGINT UNSIGNED, `updated_at` DATETIME DEFAULT NULL, `updated_by` BIGINT UNSIGNED, `deleted_at` DATETIME DEFAULT NULL, `deleted_by` BIGINT UNSIGNED, `is_active` TINYINT(1) NOT NULL DEFAULT true, PRIMARY KEY (`id`), FOREIGN KEY (`cart_id`) REFERENCES `carts` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`product_variant_id`) REFERENCES `product_variants` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `cart_items` ADD UNIQUE INDEX `uq_cart_variant` (`cart_id`, `product_variant_id`);

ALTER TABLE `cart_items` MODIFY `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE `cart_items` ADD INDEX `idx_cart_items_deleted_at` (`deleted_at`);

ALTER TABLE `cart_items` ADD CONSTRAINT `chk_cart_item_quantity_positive` CHECK (quantity > 0);

CREATE TABLE IF NOT EXISTS `orders` (`id` BIGINT UNSIGNED NOT NULL auto_increment , `order_number` VARCHAR(50) NOT NULL, `customer_id` BIGINT UNSIGNED NOT NULL, `vendor_id` BIGINT UNSIGNED NOT NULL, `delivery_address_id` BIGINT UNSIGNED NOT NULL, `cart_id` BIGINT UNSIGNED, `status` ENUM('PLACED', 'PAYMENT_PENDING', 'PAYMENT_FAILED', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'REFUNDED') NOT NULL DEFAULT 'PLACED', `subtotal` DECIMAL(10,2) NOT NULL, `discount_total` DECIMAL(10,2) NOT NULL DEFAULT 0, `tax_total` DECIMAL(10,2) NOT NULL DEFAULT 0, `delivery_fee` DECIMAL(10,2) NOT NULL DEFAULT 0, `grand_total` DECIMAL(10,2) NOT NULL, `payment_status` ENUM('PENDING', 'AUTHORIZED', 'PAID', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED') NOT NULL DEFAULT 'PENDING', `delivery_status` ENUM('PENDING', 'ASSIGNED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'PENDING', `delivery_address_snapshot` JSON, `region_code` VARCHAR(50), `customer_notes` VARCHAR(500), `cancellation_reason` VARCHAR(500), `cancelled_by` BIGINT UNSIGNED, `cancelled_at` DATETIME, `confirmed_at` DATETIME, `delivered_at` DATETIME, `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `created_by` BIGINT UNSIGNED, `updated_at` DATETIME DEFAULT NULL, `updated_by` BIGINT UNSIGNED, `deleted_at` DATETIME DEFAULT NULL, `deleted_by` BIGINT UNSIGNED, `is_active` TINYINT(1) NOT NULL DEFAULT true, PRIMARY KEY (`id`), FOREIGN KEY (`customer_id`) REFERENCES `customer_profiles` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE, FOREIGN KEY (`vendor_id`) REFERENCES `vendors` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE, FOREIGN KEY (`delivery_address_id`) REFERENCES `customer_addresses` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE, FOREIGN KEY (`cart_id`) REFERENCES `carts` (`id`) ON DELETE SET NULL ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `orders` ADD UNIQUE INDEX `uq_orders_order_number` (`order_number`);

ALTER TABLE `orders` ADD INDEX `idx_orders_customer` (`customer_id`);

ALTER TABLE `orders` ADD INDEX `idx_orders_vendor_status` (`vendor_id`, `status`);

ALTER TABLE `orders` ADD INDEX `idx_orders_created` (`created_at`);

ALTER TABLE `orders` ADD INDEX `idx_orders_payment_status` (`payment_status`);

ALTER TABLE `orders` ADD INDEX `idx_orders_delivery_status` (`delivery_status`);

ALTER TABLE `orders` MODIFY `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE `orders` ADD INDEX `idx_orders_deleted_at` (`deleted_at`);

ALTER TABLE `orders` ADD CONSTRAINT `chk_orders_totals_non_negative` CHECK (subtotal >= 0 AND discount_total >= 0 AND tax_total >= 0 AND delivery_fee >= 0 AND grand_total >= 0);

CREATE TABLE IF NOT EXISTS `order_items` (`id` BIGINT UNSIGNED NOT NULL auto_increment , `order_id` BIGINT UNSIGNED NOT NULL, `product_id` BIGINT UNSIGNED NOT NULL, `product_variant_id` BIGINT UNSIGNED NOT NULL, `product_name` VARCHAR(255) NOT NULL, `variant_label` VARCHAR(120), `sku` VARCHAR(120), `quantity` INTEGER NOT NULL, `unit_price` DECIMAL(10,2) NOT NULL, `tax_amount` DECIMAL(10,2) NOT NULL DEFAULT 0, `discount_amount` DECIMAL(10,2) NOT NULL DEFAULT 0, `line_total` DECIMAL(10,2) NOT NULL, `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `created_by` BIGINT UNSIGNED, `updated_at` DATETIME DEFAULT NULL, `updated_by` BIGINT UNSIGNED, `deleted_at` DATETIME DEFAULT NULL, `deleted_by` BIGINT UNSIGNED, `is_active` TINYINT(1) NOT NULL DEFAULT true, PRIMARY KEY (`id`), FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE, FOREIGN KEY (`product_variant_id`) REFERENCES `product_variants` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `order_items` ADD INDEX `idx_order_items_order` (`order_id`);

ALTER TABLE `order_items` ADD INDEX `idx_order_items_variant` (`product_variant_id`);

ALTER TABLE `order_items` MODIFY `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE `order_items` ADD INDEX `idx_order_items_deleted_at` (`deleted_at`);

ALTER TABLE `order_items` ADD CONSTRAINT `chk_order_item_quantity_positive` CHECK (quantity > 0);

CREATE TABLE IF NOT EXISTS `order_status_history` (`id` BIGINT UNSIGNED NOT NULL auto_increment , `order_id` BIGINT UNSIGNED NOT NULL, `from_status` VARCHAR(50), `to_status` VARCHAR(50) NOT NULL, `changed_by` BIGINT UNSIGNED, `note` VARCHAR(500), `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `created_by` BIGINT UNSIGNED, `updated_at` DATETIME DEFAULT NULL, `updated_by` BIGINT UNSIGNED, `deleted_at` DATETIME DEFAULT NULL, `deleted_by` BIGINT UNSIGNED, `is_active` TINYINT(1) NOT NULL DEFAULT true, PRIMARY KEY (`id`), FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`changed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `order_status_history` ADD INDEX `idx_order_history_order` (`order_id`);

ALTER TABLE `order_status_history` MODIFY `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE `order_status_history` ADD INDEX `idx_order_status_history_deleted_at` (`deleted_at`);

CREATE TABLE IF NOT EXISTS `payments` (`id` BIGINT UNSIGNED NOT NULL auto_increment , `order_id` BIGINT UNSIGNED NOT NULL, `payment_provider` ENUM('RAZORPAY', 'STRIPE', 'CASH', 'UPI', 'CARD', 'WALLET') NOT NULL, `provider_order_id` VARCHAR(255), `provider_payment_id` VARCHAR(255), `amount` DECIMAL(10,2) NOT NULL, `amount_refunded` DECIMAL(10,2) NOT NULL DEFAULT 0, `currency` VARCHAR(10) NOT NULL DEFAULT 'INR', `status` ENUM('PENDING', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED') NOT NULL DEFAULT 'PENDING', `paid_at` DATETIME, `failure_reason` VARCHAR(500), `raw_response` JSON, `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `created_by` BIGINT UNSIGNED, `updated_at` DATETIME DEFAULT NULL, `updated_by` BIGINT UNSIGNED, `deleted_at` DATETIME DEFAULT NULL, `deleted_by` BIGINT UNSIGNED, `is_active` TINYINT(1) NOT NULL DEFAULT true, PRIMARY KEY (`id`), FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `payments` ADD UNIQUE INDEX `uq_payment_provider_payment` (`provider_payment_id`);

ALTER TABLE `payments` ADD INDEX `idx_payments_order` (`order_id`);

ALTER TABLE `payments` ADD INDEX `idx_payments_provider_order` (`provider_order_id`);

ALTER TABLE `payments` ADD INDEX `idx_payments_status` (`status`);

ALTER TABLE `payments` MODIFY `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE `payments` ADD INDEX `idx_payments_deleted_at` (`deleted_at`);

ALTER TABLE `payments` ADD CONSTRAINT `chk_payments_amount_positive` CHECK (amount >= 0);

ALTER TABLE `payments` ADD CONSTRAINT `chk_payments_refund_within_amount` CHECK (amount_refunded >= 0 AND amount_refunded <= amount);

CREATE TABLE IF NOT EXISTS `payment_transactions` (`id` BIGINT UNSIGNED NOT NULL auto_increment , `payment_id` BIGINT UNSIGNED NOT NULL, `transaction_type` ENUM('AUTHORIZE', 'CAPTURE', 'FAILED', 'REFUND', 'WEBHOOK') NOT NULL, `provider_reference` VARCHAR(255), `amount` DECIMAL(10,2) NOT NULL, `status` VARCHAR(80) NOT NULL, `payload` JSON, `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `created_by` BIGINT UNSIGNED, `updated_at` DATETIME DEFAULT NULL, `updated_by` BIGINT UNSIGNED, `deleted_at` DATETIME DEFAULT NULL, `deleted_by` BIGINT UNSIGNED, `is_active` TINYINT(1) NOT NULL DEFAULT true, PRIMARY KEY (`id`), FOREIGN KEY (`payment_id`) REFERENCES `payments` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `payment_transactions` ADD INDEX `idx_payment_tx_payment` (`payment_id`);

ALTER TABLE `payment_transactions` ADD UNIQUE INDEX `uq_payment_tx_provider_reference` (`transaction_type`, `provider_reference`);

ALTER TABLE `payment_transactions` MODIFY `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE `payment_transactions` ADD INDEX `idx_payment_transactions_deleted_at` (`deleted_at`);

CREATE TABLE IF NOT EXISTS `refunds` (`id` BIGINT UNSIGNED NOT NULL auto_increment , `order_id` BIGINT UNSIGNED NOT NULL, `payment_id` BIGINT UNSIGNED NOT NULL, `amount` DECIMAL(10,2) NOT NULL, `reason` VARCHAR(500) NOT NULL, `status` ENUM('REQUESTED', 'APPROVED', 'REJECTED', 'PROCESSING', 'COMPLETED', 'FAILED') NOT NULL DEFAULT 'REQUESTED', `provider_refund_id` VARCHAR(255), `requested_by` BIGINT UNSIGNED, `reviewed_by` BIGINT UNSIGNED, `reviewed_at` DATETIME, `rejection_reason` VARCHAR(500), `processed_at` DATETIME, `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `created_by` BIGINT UNSIGNED, `updated_at` DATETIME DEFAULT NULL, `updated_by` BIGINT UNSIGNED, `deleted_at` DATETIME DEFAULT NULL, `deleted_by` BIGINT UNSIGNED, `is_active` TINYINT(1) NOT NULL DEFAULT true, PRIMARY KEY (`id`), FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`payment_id`) REFERENCES `payments` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`reviewed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `refunds` ADD INDEX `idx_refunds_order` (`order_id`);

ALTER TABLE `refunds` ADD INDEX `idx_refunds_payment` (`payment_id`);

ALTER TABLE `refunds` ADD INDEX `idx_refunds_status` (`status`);

ALTER TABLE `refunds` MODIFY `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE `refunds` ADD INDEX `idx_refunds_deleted_at` (`deleted_at`);

ALTER TABLE `refunds` ADD CONSTRAINT `chk_refunds_amount_positive` CHECK (amount > 0);

CREATE TABLE IF NOT EXISTS `delivery_partners` (`id` BIGINT UNSIGNED NOT NULL auto_increment , `user_id` BIGINT UNSIGNED NOT NULL, `vehicle_type` ENUM('BIKE', 'SCOOTER', 'CAR', 'VAN') NOT NULL, `vehicle_number` VARCHAR(50) NOT NULL, `license_number` VARCHAR(100) NOT NULL, `license_document_url` VARCHAR(500), `status` ENUM('PENDING', 'ACTIVE', 'SUSPENDED', 'OFFLINE') NOT NULL DEFAULT 'PENDING', `rejection_reason` VARCHAR(500), `reviewed_by` BIGINT UNSIGNED, `reviewed_at` DATETIME, `current_latitude` DECIMAL(10,6), `current_longitude` DECIMAL(10,6), `location_updated_at` DATETIME, `rating_avg` DECIMAL(3,2) NOT NULL DEFAULT 0, `rating_count` INTEGER NOT NULL DEFAULT 0, `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `created_by` BIGINT UNSIGNED, `updated_at` DATETIME DEFAULT NULL, `updated_by` BIGINT UNSIGNED, `deleted_at` DATETIME DEFAULT NULL, `deleted_by` BIGINT UNSIGNED, `is_active` TINYINT(1) NOT NULL DEFAULT true, PRIMARY KEY (`id`), FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`reviewed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `delivery_partners` ADD UNIQUE INDEX `uq_delivery_user` (`user_id`);

ALTER TABLE `delivery_partners` ADD INDEX `idx_delivery_partners_status` (`status`);

ALTER TABLE `delivery_partners` MODIFY `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE `delivery_partners` ADD INDEX `idx_delivery_partners_deleted_at` (`deleted_at`);

CREATE TABLE IF NOT EXISTS `delivery_assignments` (`id` BIGINT UNSIGNED NOT NULL auto_increment , `order_id` BIGINT UNSIGNED NOT NULL, `delivery_partner_id` BIGINT UNSIGNED NOT NULL, `assigned_at` DATETIME NOT NULL, `accepted_at` DATETIME, `rejected_at` DATETIME, `picked_up_at` DATETIME, `delivered_at` DATETIME, `status` ENUM('ASSIGNED', 'ACCEPTED', 'REJECTED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'ASSIGNED', `failure_reason` VARCHAR(500), `recipient_verified` TINYINT(1) NOT NULL DEFAULT false, `recipient_verification_notes` VARCHAR(500), `recipient_document_type` VARCHAR(50), `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `created_by` BIGINT UNSIGNED, `updated_at` DATETIME DEFAULT NULL, `updated_by` BIGINT UNSIGNED, `deleted_at` DATETIME DEFAULT NULL, `deleted_by` BIGINT UNSIGNED, `is_active` TINYINT(1) NOT NULL DEFAULT true, PRIMARY KEY (`id`), FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`delivery_partner_id`) REFERENCES `delivery_partners` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `delivery_assignments` ADD UNIQUE INDEX `uq_delivery_order` (`order_id`);

ALTER TABLE `delivery_assignments` ADD INDEX `idx_delivery_partner_status` (`delivery_partner_id`, `status`);

ALTER TABLE `delivery_assignments` MODIFY `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE `delivery_assignments` ADD INDEX `idx_delivery_assignments_deleted_at` (`deleted_at`);

CREATE TABLE IF NOT EXISTS `delivery_tracking` (`id` BIGINT UNSIGNED NOT NULL auto_increment , `delivery_assignment_id` BIGINT UNSIGNED NOT NULL, `latitude` DECIMAL(10,6) NOT NULL, `longitude` DECIMAL(10,6) NOT NULL, `recorded_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `created_by` BIGINT UNSIGNED, `updated_at` DATETIME DEFAULT NULL, `updated_by` BIGINT UNSIGNED, `deleted_at` DATETIME DEFAULT NULL, `deleted_by` BIGINT UNSIGNED, `is_active` TINYINT(1) NOT NULL DEFAULT true, PRIMARY KEY (`id`), FOREIGN KEY (`delivery_assignment_id`) REFERENCES `delivery_assignments` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `delivery_tracking` ADD INDEX `idx_tracking_assignment_time` (`delivery_assignment_id`, `recorded_at`);

ALTER TABLE `delivery_tracking` MODIFY `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE `delivery_tracking` ADD INDEX `idx_delivery_tracking_deleted_at` (`deleted_at`);

CREATE TABLE IF NOT EXISTS `delivery_status_history` (`id` BIGINT UNSIGNED NOT NULL auto_increment , `delivery_assignment_id` BIGINT UNSIGNED NOT NULL, `from_status` VARCHAR(50), `to_status` VARCHAR(50) NOT NULL, `changed_by` BIGINT UNSIGNED, `note` VARCHAR(500), `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `created_by` BIGINT UNSIGNED, `updated_at` DATETIME DEFAULT NULL, `updated_by` BIGINT UNSIGNED, `deleted_at` DATETIME DEFAULT NULL, `deleted_by` BIGINT UNSIGNED, `is_active` TINYINT(1) NOT NULL DEFAULT true, PRIMARY KEY (`id`), FOREIGN KEY (`delivery_assignment_id`) REFERENCES `delivery_assignments` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`changed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `delivery_status_history` ADD INDEX `idx_delivery_history_assignment` (`delivery_assignment_id`);

ALTER TABLE `delivery_status_history` MODIFY `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE `delivery_status_history` ADD INDEX `idx_delivery_status_history_deleted_at` (`deleted_at`);

CREATE TABLE IF NOT EXISTS `coupons` (`id` BIGINT UNSIGNED NOT NULL auto_increment , `code` VARCHAR(80) NOT NULL, `title` VARCHAR(150) NOT NULL, `description` TEXT, `discount_type` ENUM('PERCENTAGE', 'FIXED') NOT NULL, `discount_value` DECIMAL(10,2) NOT NULL, `max_discount_amount` DECIMAL(10,2), `min_order_amount` DECIMAL(10,2), `usage_limit` INTEGER, `usage_limit_per_user` INTEGER, `usage_count` INTEGER NOT NULL DEFAULT 0, `vendor_id` BIGINT UNSIGNED, `starts_at` DATETIME NOT NULL, `ends_at` DATETIME NOT NULL, `status` ENUM('ACTIVE', 'INACTIVE', 'EXPIRED') NOT NULL DEFAULT 'ACTIVE', `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `created_by` BIGINT UNSIGNED, `updated_at` DATETIME DEFAULT NULL, `updated_by` BIGINT UNSIGNED, `deleted_at` DATETIME DEFAULT NULL, `deleted_by` BIGINT UNSIGNED, `is_active` TINYINT(1) NOT NULL DEFAULT true, PRIMARY KEY (`id`), FOREIGN KEY (`vendor_id`) REFERENCES `vendors` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `coupons` ADD UNIQUE INDEX `uq_coupons_code` (`code`);

ALTER TABLE `coupons` ADD INDEX `idx_coupons_status_window` (`status`, `starts_at`, `ends_at`);

ALTER TABLE `coupons` MODIFY `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE `coupons` ADD INDEX `idx_coupons_deleted_at` (`deleted_at`);

ALTER TABLE `coupons` ADD CONSTRAINT `chk_coupons_window` CHECK (ends_at > starts_at);

ALTER TABLE `coupons` ADD CONSTRAINT `chk_coupons_value_positive` CHECK (discount_value > 0);

ALTER TABLE `coupons` ADD CONSTRAINT `chk_coupons_percentage_bound` CHECK (discount_type <> 'PERCENTAGE' OR discount_value <= 100);

CREATE TABLE IF NOT EXISTS `coupon_usage` (`id` BIGINT UNSIGNED NOT NULL auto_increment , `coupon_id` BIGINT UNSIGNED NOT NULL, `user_id` BIGINT UNSIGNED NOT NULL, `order_id` BIGINT UNSIGNED NOT NULL, `discount_amount` DECIMAL(10,2) NOT NULL, `used_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `created_by` BIGINT UNSIGNED, `updated_at` DATETIME DEFAULT NULL, `updated_by` BIGINT UNSIGNED, `deleted_at` DATETIME DEFAULT NULL, `deleted_by` BIGINT UNSIGNED, `is_active` TINYINT(1) NOT NULL DEFAULT true, PRIMARY KEY (`id`), FOREIGN KEY (`coupon_id`) REFERENCES `coupons` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `coupon_usage` ADD UNIQUE INDEX `uq_coupon_order` (`coupon_id`, `order_id`);

ALTER TABLE `coupon_usage` ADD INDEX `idx_coupon_user` (`coupon_id`, `user_id`);

ALTER TABLE `coupon_usage` MODIFY `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE `coupon_usage` ADD INDEX `idx_coupon_usage_deleted_at` (`deleted_at`);

CREATE TABLE IF NOT EXISTS `promotions` (`id` BIGINT UNSIGNED NOT NULL auto_increment , `title` VARCHAR(150) NOT NULL, `description` TEXT, `banner_url` VARCHAR(500), `target_type` ENUM('ALL', 'CATEGORY', 'PRODUCT', 'VENDOR') NOT NULL DEFAULT 'ALL', `target_id` BIGINT UNSIGNED, `sort_order` INTEGER NOT NULL DEFAULT 0, `starts_at` DATETIME NOT NULL, `ends_at` DATETIME NOT NULL, `status` ENUM('ACTIVE', 'INACTIVE', 'EXPIRED') NOT NULL DEFAULT 'ACTIVE', `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `created_by` BIGINT UNSIGNED, `updated_at` DATETIME DEFAULT NULL, `updated_by` BIGINT UNSIGNED, `deleted_at` DATETIME DEFAULT NULL, `deleted_by` BIGINT UNSIGNED, `is_active` TINYINT(1) NOT NULL DEFAULT true, PRIMARY KEY (`id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `promotions` ADD INDEX `idx_promotions_status_dates` (`status`, `starts_at`, `ends_at`);

ALTER TABLE `promotions` MODIFY `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE `promotions` ADD INDEX `idx_promotions_deleted_at` (`deleted_at`);

ALTER TABLE `promotions` ADD CONSTRAINT `chk_promotions_window` CHECK (ends_at > starts_at);

ALTER TABLE `carts` ADD CONSTRAINT `fk_carts_coupon` FOREIGN KEY (`coupon_id`) REFERENCES `coupons` (`id`) ON UPDATE CASCADE ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS `reviews` (`id` BIGINT UNSIGNED NOT NULL auto_increment , `user_id` BIGINT UNSIGNED NOT NULL, `order_id` BIGINT UNSIGNED NOT NULL, `product_id` BIGINT UNSIGNED, `vendor_id` BIGINT UNSIGNED, `delivery_partner_id` BIGINT UNSIGNED, `rating` INTEGER NOT NULL, `title` VARCHAR(150), `comment` TEXT, `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'HIDDEN') NOT NULL DEFAULT 'PENDING', `moderation_note` VARCHAR(500), `moderated_by` BIGINT UNSIGNED, `moderated_at` DATETIME, `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `created_by` BIGINT UNSIGNED, `updated_at` DATETIME DEFAULT NULL, `updated_by` BIGINT UNSIGNED, `deleted_at` DATETIME DEFAULT NULL, `deleted_by` BIGINT UNSIGNED, `is_active` TINYINT(1) NOT NULL DEFAULT true, PRIMARY KEY (`id`), FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE SET NULL ON UPDATE CASCADE, FOREIGN KEY (`vendor_id`) REFERENCES `vendors` (`id`) ON DELETE SET NULL ON UPDATE CASCADE, FOREIGN KEY (`delivery_partner_id`) REFERENCES `delivery_partners` (`id`) ON DELETE SET NULL ON UPDATE CASCADE, FOREIGN KEY (`moderated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `reviews` ADD INDEX `idx_reviews_product` (`product_id`);

ALTER TABLE `reviews` ADD INDEX `idx_reviews_vendor` (`vendor_id`);

ALTER TABLE `reviews` ADD INDEX `idx_reviews_delivery_partner` (`delivery_partner_id`);

ALTER TABLE `reviews` ADD INDEX `idx_reviews_order` (`order_id`);

ALTER TABLE `reviews` ADD INDEX `idx_reviews_status` (`status`);

ALTER TABLE `reviews` MODIFY `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE `reviews` ADD INDEX `idx_reviews_deleted_at` (`deleted_at`);

ALTER TABLE `reviews` ADD CONSTRAINT `chk_reviews_rating_range` CHECK (rating BETWEEN 1 AND 5);

ALTER TABLE `reviews` ADD CONSTRAINT `chk_reviews_single_subject` CHECK (((product_id IS NOT NULL) + (vendor_id IS NOT NULL) + (delivery_partner_id IS NOT NULL)) = 1);

CREATE TABLE IF NOT EXISTS `notification_templates` (`id` BIGINT UNSIGNED NOT NULL auto_increment , `code` VARCHAR(100) NOT NULL, `channel` ENUM('EMAIL', 'SMS', 'PUSH', 'IN_APP') NOT NULL, `subject` VARCHAR(255), `body` TEXT NOT NULL, `variables` JSON, `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `created_by` BIGINT UNSIGNED, `updated_at` DATETIME DEFAULT NULL, `updated_by` BIGINT UNSIGNED, `deleted_at` DATETIME DEFAULT NULL, `deleted_by` BIGINT UNSIGNED, `is_active` TINYINT(1) NOT NULL DEFAULT true, PRIMARY KEY (`id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `notification_templates` ADD UNIQUE INDEX `uq_notification_template` (`code`, `channel`);

ALTER TABLE `notification_templates` MODIFY `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE `notification_templates` ADD INDEX `idx_notification_templates_deleted_at` (`deleted_at`);

CREATE TABLE IF NOT EXISTS `notifications` (`id` BIGINT UNSIGNED NOT NULL auto_increment , `user_id` BIGINT UNSIGNED NOT NULL, `template_code` VARCHAR(100), `channel` ENUM('EMAIL', 'SMS', 'PUSH', 'IN_APP') NOT NULL, `title` VARCHAR(255), `message` TEXT NOT NULL, `status` ENUM('PENDING', 'SENT', 'FAILED', 'READ') NOT NULL DEFAULT 'PENDING', `sent_at` DATETIME, `read_at` DATETIME, `failure_reason` VARCHAR(500), `reference_type` VARCHAR(80), `reference_id` BIGINT UNSIGNED, `metadata` JSON, `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `created_by` BIGINT UNSIGNED, `updated_at` DATETIME DEFAULT NULL, `updated_by` BIGINT UNSIGNED, `deleted_at` DATETIME DEFAULT NULL, `deleted_by` BIGINT UNSIGNED, `is_active` TINYINT(1) NOT NULL DEFAULT true, PRIMARY KEY (`id`), FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `notifications` ADD INDEX `idx_notifications_user_status` (`user_id`, `status`);

ALTER TABLE `notifications` ADD INDEX `idx_notifications_reference` (`reference_type`, `reference_id`);

ALTER TABLE `notifications` MODIFY `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE `notifications` ADD INDEX `idx_notifications_deleted_at` (`deleted_at`);

CREATE TABLE IF NOT EXISTS `notification_actions` (`id` BIGINT UNSIGNED NOT NULL auto_increment , `notification_id` BIGINT UNSIGNED NOT NULL, `action_label` VARCHAR(100) NOT NULL, `action_url` VARCHAR(500) NOT NULL, `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `created_by` BIGINT UNSIGNED, `updated_at` DATETIME DEFAULT NULL, `updated_by` BIGINT UNSIGNED, `deleted_at` DATETIME DEFAULT NULL, `deleted_by` BIGINT UNSIGNED, `is_active` TINYINT(1) NOT NULL DEFAULT true, PRIMARY KEY (`id`), FOREIGN KEY (`notification_id`) REFERENCES `notifications` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `notification_actions` ADD INDEX `idx_notification_actions_notification` (`notification_id`);

ALTER TABLE `notification_actions` MODIFY `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE `notification_actions` ADD INDEX `idx_notification_actions_deleted_at` (`deleted_at`);

CREATE TABLE IF NOT EXISTS `audit_logs` (`id` BIGINT UNSIGNED NOT NULL auto_increment , `actor_user_id` BIGINT UNSIGNED, `action` VARCHAR(120) NOT NULL, `entity_type` VARCHAR(120) NOT NULL, `entity_id` BIGINT UNSIGNED, `old_values` JSON, `new_values` JSON, `ip_address` VARCHAR(80), `user_agent` VARCHAR(500), `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (`id`), FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `audit_logs` ADD INDEX `idx_audit_actor` (`actor_user_id`);

ALTER TABLE `audit_logs` ADD INDEX `idx_audit_entity` (`entity_type`, `entity_id`);

ALTER TABLE `audit_logs` ADD INDEX `idx_audit_action` (`action`);

ALTER TABLE `audit_logs` ADD INDEX `idx_audit_created` (`created_at`);