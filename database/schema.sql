-- ===================================================================
-- Military Asset Management System - MySQL Schema
-- Database: mams
--
-- NOTE: this is a dedicated database for MAMS, separate from any other
--       project database on the same server.
--
-- Justification (relational / MySQL):
--   * ACID transactions guarantee that purchases, transfers, assignments
--     and expenditures are recorded atomically - critical for asset
--     accountability (balances must never be partially updated).
--   * Referential integrity (FK constraints) prevents orphaned records and
--     invalid references between bases, assets and users.
--   * The ledger-style tables (purchases, transfers, expenditures) plus
--     stock snapshots make opening/closing balance arithmetic deterministic.
--   * ENUMs + CHECK constraints enforce valid roles and categories at the
--     data layer, independent of application code.
-- ===================================================================

CREATE DATABASE IF NOT EXISTS mams
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE mams;

-- -------------------------------------------------------------------
-- Bases: the operational locations assets belong to.
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bases (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code          VARCHAR(20)  NOT NULL UNIQUE,
  name          VARCHAR(100) NOT NULL,
  location      VARCHAR(255) NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- -------------------------------------------------------------------
-- Users: authentication + RBAC.
--   role determines capability:
--     admin             -> full access to all bases + audit logs
--     base_commander    -> scoped to base_id (one base per commander)
--     logistics_officer -> purchases & transfers only (read + write)
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(50)  NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name     VARCHAR(100) NOT NULL,
  role          ENUM('admin','base_commander','logistics_officer') NOT NULL,
  base_id       INT UNSIGNED NULL,
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_base
    FOREIGN KEY (base_id) REFERENCES bases (id)
    ON DELETE SET NULL
) ENGINE=InnoDB;

-- -------------------------------------------------------------------
-- Asset types: the item master (what is being tracked).
--   category is also used by the dashboard "Equipment Type" filter.
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS asset_types (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code        VARCHAR(50) NOT NULL UNIQUE,
  name        VARCHAR(100) NOT NULL,
  category    ENUM('WEAPON','VEHICLE','AMMUNITION','EQUIPMENT') NOT NULL,
  unit        VARCHAR(20) NOT NULL DEFAULT 'unit',
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- -------------------------------------------------------------------
-- Stock levels: initial / baseline stock on hand at a base.
--   Used to compute the "Opening Balance" for a reporting window.
--   (Optional - a base can start with zero and rely purely on
--   purchases + transfers in.)
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_levels (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  base_id        INT UNSIGNED NOT NULL,
  asset_type_id  INT UNSIGNED NOT NULL,
  quantity       INT NOT NULL,
  effective_date DATE NOT NULL,
  reference      VARCHAR(100) NULL,
  created_by     INT UNSIGNED NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_stock_base FOREIGN KEY (base_id) REFERENCES bases (id),
  CONSTRAINT fk_stock_asset FOREIGN KEY (asset_type_id) REFERENCES asset_types (id),
  CONSTRAINT fk_stock_user FOREIGN KEY (created_by) REFERENCES users (id),
  INDEX idx_stock_base_asset_date (base_id, asset_type_id, effective_date)
) ENGINE=InnoDB;

-- -------------------------------------------------------------------
-- Purchases: assets acquired for a specific base.
--   +quantity inflow used in Net Movement = Purchases + Transfers In
--   - Transfers Out.
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS purchases (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  base_id        INT UNSIGNED NOT NULL,
  asset_type_id  INT UNSIGNED NOT NULL,
  quantity       INT NOT NULL,
  unit_cost      DECIMAL(12,2) NULL,
  total_cost     DECIMAL(12,2) NULL,
  vendor         VARCHAR(150) NULL,
  receipt_number VARCHAR(50) NULL,
  purchase_date  DATE NOT NULL,
  notes          VARCHAR(500) NULL,
  created_by     INT UNSIGNED NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_purchase_base FOREIGN KEY (base_id) REFERENCES bases (id),
  CONSTRAINT fk_purchase_asset FOREIGN KEY (asset_type_id) REFERENCES asset_types (id),
  CONSTRAINT fk_purchase_user FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT chk_purchase_qty CHECK (quantity > 0),
  INDEX idx_purchase_date (purchase_date),
  INDEX idx_purchase_base (base_id, asset_type_id, purchase_date)
) ENGINE=InnoDB;

-- -------------------------------------------------------------------
-- Transfers: inter-base movement of assets. Immutable audit trail.
--   A single row captures the from->to movement; balance logic reads it
--   twice (negative for source base, positive for destination base).
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transfers (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  asset_type_id INT UNSIGNED NOT NULL,
  quantity      INT NOT NULL,
  from_base_id  INT UNSIGNED NOT NULL,
  to_base_id    INT UNSIGNED NOT NULL,
  transferred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  initiated_by  INT UNSIGNED NULL,
  approved_by   INT UNSIGNED NULL,
  status        ENUM('PENDING','COMPLETED','CANCELLED') NOT NULL DEFAULT 'COMPLETED',
  notes         VARCHAR(500) NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_transfer_asset FOREIGN KEY (asset_type_id) REFERENCES asset_types (id),
  CONSTRAINT fk_transfer_from FOREIGN KEY (from_base_id) REFERENCES bases (id),
  CONSTRAINT fk_transfer_to FOREIGN KEY (to_base_id) REFERENCES bases (id),
  CONSTRAINT fk_transfer_init FOREIGN KEY (initiated_by) REFERENCES users (id),
  CONSTRAINT fk_transfer_approve FOREIGN KEY (approved_by) REFERENCES users (id),
  CONSTRAINT chk_transfer_qty CHECK (quantity > 0),
  CONSTRAINT chk_transfer_bases CHECK (from_base_id <> to_base_id),
  INDEX idx_transfer_date (transferred_at),
  INDEX idx_transfer_from (from_base_id, transferred_at),
  INDEX idx_transfer_to (to_base_id, transferred_at)
) ENGINE=InnoDB;

-- -------------------------------------------------------------------
-- Assignments: assets allocated to personnel (remain on base but are
--   "assigned out" of the operationally-available pool).
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assignments (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  base_id        INT UNSIGNED NOT NULL,
  asset_type_id  INT UNSIGNED NOT NULL,
  quantity       INT NOT NULL,
  assigned_to    VARCHAR(100) NOT NULL,
  personnel_rank VARCHAR(30) NULL,
  assignment_date DATE NOT NULL,
  notes          VARCHAR(500) NULL,
  created_by     INT UNSIGNED NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_assignment_base FOREIGN KEY (base_id) REFERENCES bases (id),
  CONSTRAINT fk_assignment_asset FOREIGN KEY (asset_type_id) REFERENCES asset_types (id),
  CONSTRAINT fk_assignment_user FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT chk_assignment_qty CHECK (quantity > 0),
  INDEX idx_assignment_date (assignment_date),
  INDEX idx_assignment_base (base_id, asset_type_id, assignment_date)
) ENGINE=InnoDB;

-- -------------------------------------------------------------------
-- Expenditures: assets consumed/expended (e.g., ammunition fired).
--   Reduces closing balance: Closing = Opening + NetMovement - Expended.
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expenditures (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  base_id         INT UNSIGNED NOT NULL,
  asset_type_id   INT UNSIGNED NOT NULL,
  quantity        INT NOT NULL,
  mission_ref     VARCHAR(50) NULL,
  reason          VARCHAR(200) NOT NULL,
  expenditure_date DATE NOT NULL,
  notes           VARCHAR(500) NULL,
  created_by      INT UNSIGNED NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_expend_base FOREIGN KEY (base_id) REFERENCES bases (id),
  CONSTRAINT fk_expend_asset FOREIGN KEY (asset_type_id) REFERENCES asset_types (id),
  CONSTRAINT fk_expend_user FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT chk_expend_qty CHECK (quantity > 0),
  INDEX idx_expend_date (expenditure_date),
  INDEX idx_expend_base (base_id, asset_type_id, expenditure_date)
) ENGINE=InnoDB;

-- -------------------------------------------------------------------
-- Audit log: append-only record of every request/transaction for
--   accountability. Never updated or deleted by the app.
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    INT UNSIGNED NULL,
  username   VARCHAR(50) NULL,
  action     VARCHAR(60) NOT NULL,
  entity     VARCHAR(60) NULL,
  entity_id  INT UNSIGNED NULL,
  details    JSON NULL,
  ip_address VARCHAR(45) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_created (created_at),
  INDEX idx_audit_user (user_id)
) ENGINE=InnoDB;
