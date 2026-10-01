-- ===================================================================
-- Military Asset Management System - Seed Data
-- Database: mams (dedicated to MAMS; does not touch any other project DB)
--
-- Default password for every seeded user is:  Password@123
-- (bcrypt hash below; change in production).
-- ===================================================================

USE mams;

-- -------------------------------------------------------------------
-- Bases
-- -------------------------------------------------------------------
INSERT INTO bases (id, code, name, location) VALUES
  (1, 'FT-HOOD', 'Fort Hood', 'Killeen, TX'),
  (2, 'FT-BRAGG', 'Fort Bragg', 'Fayetteville, NC'),
  (3, 'NAV-BASE', 'Naval Base San Diego', 'San Diego, CA')
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- -------------------------------------------------------------------
-- Asset Types (item master)
-- -------------------------------------------------------------------
INSERT INTO asset_types (id, code, name, category, unit) VALUES
  (1, 'M4-CARBINE', 'M4 Carbine 5.56mm', 'WEAPON', 'unit'),
  (2, 'M9-PISTOL',  'Beretta M9 9mm',      'WEAPON', 'unit'),
  (3, 'HMMWV-M1151','HMMWV M1151',         'VEHICLE', 'unit'),
  (4, 'MRAP',       'MRAP Cougar 4x4',     'VEHICLE', 'unit'),
  (5, '556-STD',    '5.56mm Ball Ammo',    'AMMUNITION', 'round'),
  (6, '9MM-STD',    '9mm Ball Ammo',       'AMMUNITION', 'round'),
  (7, 'BCRC-RADIO', 'BNC-150 Radio Set',   'EQUIPMENT', 'unit')
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- -------------------------------------------------------------------
-- Users (RBAC) - password for ALL = Password@123
--   admin            -> Dr. A. Rashed (full access)
--   base_commander   -> scoped to single base
--   logistics_officer-> purchases & transfers only
-- -------------------------------------------------------------------
INSERT INTO users (id, username, password_hash, full_name, role, base_id) VALUES
  (1, 'admin',    '$2b$10$3Fp8/4DMU5qNwsk9q2J2jOfjbLXRodwF1TKqVAhFOfFZox8/zBRNm', 'Dr. A. Rashed',        'admin',            NULL),
  (2, 'cmdr.hood','$2b$10$3Fp8/4DMU5qNwsk9q2J2jOfjbLXRodwF1TKqVAhFOfFZox8/zBRNm', 'Maj. Sarah Jennings', 'base_commander',   1),
  (3, 'cmdr.bragg','$2b$10$3Fp8/4DMU5qNwsk9q2J2jOfjbLXRodwF1TKqVAhFOfFZox8/zBRNm','Lt. Col. Marcus Reed','base_commander',   2),
  (4, 'logistics','$2b$10$3Fp8/4DMU5qNwsk9q2J2jOfjbLXRodwF1TKqVAhFOfFZox8/zBRNm', 'SSgt. Dana Wallace', 'logistics_officer', NULL)
ON DUPLICATE KEY UPDATE username = VALUES(username);

-- -------------------------------------------------------------------
-- Stock levels (baseline for opening balance)
-- -------------------------------------------------------------------
INSERT INTO stock_levels (base_id, asset_type_id, quantity, effective_date, reference, created_by) VALUES
  (1, 1, 1200, '2026-01-01', 'Opening stock FY26', 1),
  (1, 3,  48,  '2026-01-01', 'Opening stock FY26', 1),
  (1, 5, 50000,'2026-01-01', 'Opening stock FY26', 1),
  (2, 1,  900, '2026-01-01', 'Opening stock FY26', 1),
  (2, 4,   14, '2026-01-01', 'Opening stock FY26', 1),
  (2, 6, 80000,'2026-01-01', 'Opening stock FY26', 1),
  (3, 2,  350, '2026-01-01', 'Opening stock FY26', 1),
  (3, 7,   90, '2026-01-01', 'Opening stock FY26', 1)
ON DUPLICATE KEY UPDATE quantity = VALUES(quantity);

-- -------------------------------------------------------------------
-- Purchases
-- -------------------------------------------------------------------
INSERT INTO purchases (id, base_id, asset_type_id, quantity, unit_cost, total_cost, vendor, receipt_number, purchase_date, notes, created_by) VALUES
  (1, 1, 1, 300,  1450.00, 435000.00,  'CNM Industries',   'PO-2026-0001', '2026-01-15', 'Annual carbine top-up',   1),
  (2, 1, 5, 20000, 0.75,    15000.00,  'Lake City AAP',     'PO-2026-0002', '2026-02-10', 'Range resupply',          1),
  (3, 2, 4, 6,    580000.00, 3480000.00, 'Oshkosh Defense','PO-2026-0003', '2026-03-05', 'MRAP fleet expansion',    1),
  (4, 3, 2, 100,  640.00,   64000.00,  'Sig Sauer',         'PO-2026-0004', '2026-04-20', 'Sidearm replacement',     1)
ON DUPLICATE KEY UPDATE receipt_number = VALUES(receipt_number);

-- -------------------------------------------------------------------
-- Transfers
-- -------------------------------------------------------------------
INSERT INTO transfers (id, asset_type_id, quantity, from_base_id, to_base_id, transferred_at, initiated_by, approved_by, status, notes) VALUES
  (1, 1, 150, 1, 2, '2026-05-12 09:30:00', 1, 1, 'COMPLETED', 'Reallocation to Bragg'),
  (2, 5, 5000, 1, 2, '2026-06-01 14:00:00', 1, 1, 'COMPLETED', 'Live-fire exercise support'),
  (3, 7, 20,  3, 2, '2026-07-08 10:15:00', 1, 1, 'COMPLETED', 'Comm gear loan')
ON DUPLICATE KEY UPDATE notes = VALUES(notes);

-- -------------------------------------------------------------------
-- Assignments
-- -------------------------------------------------------------------
INSERT INTO assignments (id, base_id, asset_type_id, quantity, assigned_to, personnel_rank, assignment_date, notes, created_by) VALUES
  (1, 1, 1, 200, 'Pvt. J. Anderson', 'E-1', '2026-02-01', 'Unit issue - 1st Bn', 1),
  (2, 2, 4, 6,   '1st Cav Squadron',  'N/A', '2026-05-15', 'Squadron organic kit', 1),
  (3, 1, 5, 8000,'2nd Bn Range Co', 'N/A', '2026-06-10', 'Training allotment', 1)
ON DUPLICATE KEY UPDATE notes = VALUES(notes);

-- -------------------------------------------------------------------
-- Expenditures
-- -------------------------------------------------------------------
INSERT INTO expenditures (id, base_id, asset_type_id, quantity, mission_ref, reason, expenditure_date, notes, created_by) VALUES
  (1, 1, 5, 12000, 'MISSION-ALT-07', 'Fired during live-fire exercise', '2026-03-20', 'Range 42', 1),
  (2, 2, 6, 15000, 'MISSION-DEF-11', 'Qualification firing',           '2026-04-25', 'Range Bravo', 1),
  (3, 2, 5,  2000, 'MISSION-CAP-02', 'Combative training expenditure', '2026-07-02', NULL, 1)
ON DUPLICATE KEY UPDATE notes = VALUES(notes);
