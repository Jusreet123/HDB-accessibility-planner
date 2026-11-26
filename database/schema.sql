-- Haven. MySQL Database Schema
-- Exported from Aiven MySQL
-- Structure only: no records included

SET FOREIGN_KEY_CHECKS = 0;

-- Table: block
CREATE TABLE "block" (
  "block_id" int NOT NULL,
  "blk_no" varchar(10) NOT NULL,
  "street_name" varchar(80) NOT NULL,
  "town_id" int NOT NULL,
  "town_code" varchar(5) DEFAULT NULL,
  "in_property_info" tinyint(1) NOT NULL,
  "latitude" decimal(15,12) DEFAULT NULL,
  "longitude" decimal(15,12) DEFAULT NULL,
  "coord_source" varchar(10) DEFAULT NULL,
  "max_floor_lvl" smallint DEFAULT NULL,
  "year_completed" smallint DEFAULT NULL,
  "residential" tinyint(1) DEFAULT NULL,
  "commercial" tinyint(1) DEFAULT NULL,
  "market_hawker" tinyint(1) DEFAULT NULL,
  "miscellaneous" tinyint(1) DEFAULT NULL,
  "multistorey_carpark" tinyint(1) DEFAULT NULL,
  "precinct_pavilion" tinyint(1) DEFAULT NULL,
  "total_dwelling_units" int DEFAULT NULL,
  "postal" char(6) DEFAULT NULL,
  PRIMARY KEY ("block_id"),
  KEY "idx_block_address" ("blk_no","street_name"),
  KEY "idx_block_town" ("town_id"),
  KEY "idx_block_postal" ("postal"),
  CONSTRAINT "fk_block_town" FOREIGN KEY ("town_id") REFERENCES "town" ("town_id")
);

-- Table: block_unit_count
CREATE TABLE "block_unit_count" (
  "block_id" int NOT NULL,
  "flat_type_id" tinyint unsigned NOT NULL,
  "tenure" varchar(10) NOT NULL,
  "unit_count" int NOT NULL,
  PRIMARY KEY ("block_id","flat_type_id","tenure"),
  KEY "fk_unit_flat_type" ("flat_type_id"),
  CONSTRAINT "fk_unit_block" FOREIGN KEY ("block_id") REFERENCES "block" ("block_id"),
  CONSTRAINT "fk_unit_flat_type" FOREIGN KEY ("flat_type_id") REFERENCES "flat_type" ("flat_type_id")
);

-- Table: flat_model
CREATE TABLE "flat_model" (
  "flat_model_id" tinyint unsigned NOT NULL,
  "model_name" varchar(40) NOT NULL,
  PRIMARY KEY ("flat_model_id"),
  UNIQUE KEY "uq_flat_model_name" ("model_name")
);

-- Table: flat_type
CREATE TABLE "flat_type" (
  "flat_type_id" tinyint unsigned NOT NULL,
  "flat_type_name" varchar(20) NOT NULL,
  PRIMARY KEY ("flat_type_id"),
  UNIQUE KEY "uq_flat_type_name" ("flat_type_name")
);

-- Table: resale_transaction
CREATE TABLE "resale_transaction" (
  "transaction_id" bigint NOT NULL,
  "block_id" int NOT NULL,
  "flat_type_id" tinyint unsigned NOT NULL,
  "flat_model_id" tinyint unsigned NOT NULL,
  "sale_date" date NOT NULL,
  "date_basis" varchar(20) NOT NULL,
  "storey_range" varchar(20) NOT NULL,
  "storey_min" smallint NOT NULL,
  "storey_max" smallint NOT NULL,
  "floor_area_sqm" decimal(10,2) NOT NULL,
  "lease_commence_year" smallint NOT NULL,
  "remaining_lease_months" smallint NOT NULL,
  "lease_is_estimated" tinyint(1) NOT NULL,
  "resale_price" decimal(15,2) NOT NULL,
  "dup_count" int NOT NULL,
  "is_duplicate" tinyint(1) NOT NULL,
  PRIMARY KEY ("transaction_id"),
  KEY "idx_resale_block" ("block_id"),
  KEY "idx_resale_flat_type" ("flat_type_id"),
  KEY "idx_resale_flat_model" ("flat_model_id"),
  KEY "idx_resale_date" ("sale_date"),
  KEY "idx_resale_price" ("resale_price"),
  CONSTRAINT "fk_resale_block" FOREIGN KEY ("block_id") REFERENCES "block" ("block_id"),
  CONSTRAINT "fk_resale_flat_model" FOREIGN KEY ("flat_model_id") REFERENCES "flat_model" ("flat_model_id"),
  CONSTRAINT "fk_resale_flat_type" FOREIGN KEY ("flat_type_id") REFERENCES "flat_type" ("flat_type_id"),
  CONSTRAINT "chk_resale_price_positive" CHECK ((`resale_price` > 0))
);

-- Table: sessions
CREATE TABLE "sessions" (
  "session_id" varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  "expires" int unsigned NOT NULL,
  "data" mediumtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  PRIMARY KEY ("session_id")
);

-- Table: town
CREATE TABLE "town" (
  "town_id" int NOT NULL,
  "town_name" varchar(30) NOT NULL,
  "town_code" varchar(5) DEFAULT NULL,
  PRIMARY KEY ("town_id"),
  UNIQUE KEY "uq_town_name" ("town_name")
);

-- Table: user_auth_methods
CREATE TABLE "user_auth_methods" (
  "auth_id" int NOT NULL AUTO_INCREMENT,
  "user_id" int NOT NULL,
  "provider" enum('local','google') NOT NULL,
  "provider_user_id" varchar(255) DEFAULT NULL,
  "password_hash" varchar(255) DEFAULT NULL,
  "created_at" timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("auth_id"),
  UNIQUE KEY "unique_user_provider" ("user_id","provider"),
  UNIQUE KEY "unique_provider_identity" ("provider","provider_user_id"),
  CONSTRAINT "fk_auth_user" FOREIGN KEY ("user_id") REFERENCES "users" ("user_id") ON DELETE CASCADE
);

-- Table: user_wishlist
CREATE TABLE "user_wishlist" (
  "wishlist_id" int NOT NULL AUTO_INCREMENT,
  "user_id" int NOT NULL,
  "block_id" int NOT NULL,
  "priority" enum('Low','Medium','High') NOT NULL DEFAULT 'Medium',
  "notes" text,
  "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY ("wishlist_id"),
  UNIQUE KEY "uq_user_wishlist_block" ("user_id","block_id"),
  KEY "idx_wishlist_user" ("user_id"),
  KEY "idx_wishlist_block" ("block_id"),
  CONSTRAINT "fk_wishlist_block" FOREIGN KEY ("block_id") REFERENCES "block" ("block_id") ON DELETE CASCADE,
  CONSTRAINT "fk_wishlist_user" FOREIGN KEY ("user_id") REFERENCES "users" ("user_id") ON DELETE CASCADE
);

-- Table: users
CREATE TABLE "users" (
  "user_id" int NOT NULL AUTO_INCREMENT,
  "username" varchar(100) NOT NULL,
  "email" varchar(255) NOT NULL,
  "created_at" timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY ("user_id"),
  UNIQUE KEY "email" ("email")
);

SET FOREIGN_KEY_CHECKS = 1;
