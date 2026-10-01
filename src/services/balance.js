import { query } from '../db.js';

const MIN_DATE = '1000-01-01';
const MAX_DATE = '9999-12-31';

/**
 * Balance methodology (per base, per asset type):
 *
 *   Opening Balance  = baseline stock (opening inventory snapshot)
 *                    + purchases (< from) + transfers-in (< from)
 *                    - transfers-out (< from) - expenditures (< from)
 *   Net Movement     = Purchases + Transfers-In - Transfers-Out
 *   Closing Balance  = Opening + Net Movement - Expended
 *   Assigned         = units allocated to personnel in the window
 *
 * stock_levels holds the opening-inventory snapshot for a base/asset, so it is
 * always the floor of the opening balance regardless of the reporting window.
 * Only COMPLETED transfers count, so PENDING/CANCELLED rows never
 * distort balances.
 */
function normalizeRange(from, to) {
  return { from: from || MIN_DATE, to: to || MAX_DATE };
}

const SUMMARY_SQL = `
SELECT
  b.id AS base_id, b.code AS base_code, b.name AS base_name,
  a.id AS asset_type_id, a.code AS asset_code, a.name AS asset_name,
  a.category, a.unit,
  COALESCE(s.qty, 0)    AS opening_stock,
  COALESCE(p_o.qty, 0)  AS opening_purchases,
  COALESCE(ti_o.qty, 0) AS opening_ti,
  COALESCE(to_o.qty, 0) AS opening_to,
  COALESCE(e_o.qty, 0)  AS opening_expended,
  COALESCE(p.qty, 0)    AS purchases,
  COALESCE(ti.qty, 0)   AS transfers_in,
  COALESCE(tt.qty, 0)   AS transfers_out,
  COALESCE(asg.qty, 0)  AS assigned,
  COALESCE(e.qty, 0)    AS expended
FROM bases b
CROSS JOIN (SELECT id, code, name, category, unit FROM asset_types WHERE is_active = 1) a
LEFT JOIN (SELECT base_id, asset_type_id, SUM(quantity) AS qty
             FROM stock_levels
             GROUP BY base_id, asset_type_id) s
  ON s.base_id = b.id AND s.asset_type_id = a.id
LEFT JOIN (SELECT base_id, asset_type_id, SUM(quantity) AS qty
             FROM purchases WHERE purchase_date < :from
             GROUP BY base_id, asset_type_id) p_o
  ON p_o.base_id = b.id AND p_o.asset_type_id = a.id
LEFT JOIN (SELECT to_base_id AS base_id, asset_type_id, SUM(quantity) AS qty
             FROM transfers
             WHERE status = 'COMPLETED' AND DATE(transferred_at) < :from
             GROUP BY to_base_id, asset_type_id) ti_o
  ON ti_o.base_id = b.id AND ti_o.asset_type_id = a.id
LEFT JOIN (SELECT from_base_id AS base_id, asset_type_id, SUM(quantity) AS qty
             FROM transfers
             WHERE status = 'COMPLETED' AND DATE(transferred_at) < :from
             GROUP BY from_base_id, asset_type_id) to_o
  ON to_o.base_id = b.id AND to_o.asset_type_id = a.id
LEFT JOIN (SELECT base_id, asset_type_id, SUM(quantity) AS qty
             FROM expenditures WHERE expenditure_date < :from
             GROUP BY base_id, asset_type_id) e_o
  ON e_o.base_id = b.id AND e_o.asset_type_id = a.id
LEFT JOIN (SELECT base_id, asset_type_id, SUM(quantity) AS qty
             FROM purchases WHERE purchase_date BETWEEN :from AND :to
             GROUP BY base_id, asset_type_id) p
  ON p.base_id = b.id AND p.asset_type_id = a.id
LEFT JOIN (SELECT to_base_id AS base_id, asset_type_id, SUM(quantity) AS qty
             FROM transfers
             WHERE status = 'COMPLETED' AND DATE(transferred_at) BETWEEN :from AND :to
             GROUP BY to_base_id, asset_type_id) ti
  ON ti.base_id = b.id AND ti.asset_type_id = a.id
LEFT JOIN (SELECT from_base_id AS base_id, asset_type_id, SUM(quantity) AS qty
             FROM transfers
             WHERE status = 'COMPLETED' AND DATE(transferred_at) BETWEEN :from AND :to
             GROUP BY from_base_id, asset_type_id) tt
  ON tt.base_id = b.id AND tt.asset_type_id = a.id
LEFT JOIN (SELECT base_id, asset_type_id, SUM(quantity) AS qty
             FROM assignments WHERE assignment_date BETWEEN :from AND :to
             GROUP BY base_id, asset_type_id) asg
  ON asg.base_id = b.id AND asg.asset_type_id = a.id
LEFT JOIN (SELECT base_id, asset_type_id, SUM(quantity) AS qty
             FROM expenditures WHERE expenditure_date BETWEEN :from AND :to
             GROUP BY base_id, asset_type_id) e
  ON e.base_id = b.id AND e.asset_type_id = a.id
`;

function computeRow(r) {
  const opening =
    Number(r.opening_stock) +
    Number(r.opening_purchases) +
    Number(r.opening_ti) -
    Number(r.opening_to) -
    Number(r.opening_expended);
  const purchases = Number(r.purchases);
  const transfersIn = Number(r.transfers_in);
  const transfersOut = Number(r.transfers_out);
  const netMovement = purchases + transfersIn - transfersOut;
  const assigned = Number(r.assigned);
  const expended = Number(r.expended);
  const closing = opening + netMovement - expended;
  return {
    baseId: r.base_id,
    baseCode: r.base_code,
    baseName: r.base_name,
    assetTypeId: r.asset_type_id,
    assetCode: r.asset_code,
    assetName: r.asset_name,
    category: r.category,
    unit: r.unit,
    openingBalance: opening,
    purchases,
    transfersIn,
    transfersOut,
    netMovement,
    assigned,
    expended,
    closingBalance: closing,
    available: closing - assigned,
  };
}

function applyFilters(rows, filters = {}) {
  let out = rows;
  if (filters.baseId) out = out.filter((r) => Number(r.baseId) === Number(filters.baseId));
  if (filters.assetTypeId) out = out.filter((r) => Number(r.assetTypeId) === Number(filters.assetTypeId));
  if (filters.category) out = out.filter((r) => r.category === filters.category);
  return out;
}

export async function getSummary(filters = {}) {
  const { from, to } = normalizeRange(filters.from, filters.to);
  const [rows] = await query(SUMMARY_SQL, { from, to });
  const computed = applyFilters(rows.map(computeRow), filters);

  const totals = computed.reduce(
    (acc, r) => {
      acc.openingBalance += r.openingBalance;
      acc.purchases += r.purchases;
      acc.transfersIn += r.transfersIn;
      acc.transfersOut += r.transfersOut;
      acc.netMovement += r.netMovement;
      acc.assigned += r.assigned;
      acc.expended += r.expended;
      acc.closingBalance += r.closingBalance;
      return acc;
    },
    {
      openingBalance: 0, purchases: 0, transfersIn: 0, transfersOut: 0,
      netMovement: 0, assigned: 0, expended: 0, closingBalance: 0,
    }
  );

  return { rows: computed, totals };
}

const NET_MOVEMENT_PURCHASES = `
SELECT p.id, p.quantity, p.unit_cost, p.total_cost, p.vendor, p.receipt_number,
       p.purchase_date AS date, b.code AS base_code, b.name AS base_name,
       a.code AS asset_code, a.name AS asset_name, a.category
FROM purchases p
JOIN bases b ON b.id = p.base_id
JOIN asset_types a ON a.id = p.asset_type_id
WHERE p.purchase_date BETWEEN :from AND :to
  AND (:baseId IS NULL OR p.base_id = :baseId)
  AND (:assetTypeId IS NULL OR p.asset_type_id = :assetTypeId)
  AND (:category IS NULL OR a.category = :category)
ORDER BY p.purchase_date DESC, p.id DESC`;

const NET_MOVEMENT_TRANSFERS = `
SELECT tr.id, tr.quantity, tr.transferred_at AS datetime,
       DATE(tr.transferred_at) AS date,
       tr.from_base_id, tr.to_base_id,
       fb.code AS from_base_code, fb.name AS from_base_name,
       tb.code AS to_base_code, tb.name AS to_base_name,
       a.code AS asset_code, a.name AS asset_name, a.category
FROM transfers tr
JOIN bases fb ON fb.id = tr.from_base_id
JOIN bases tb ON tb.id = tr.to_base_id
JOIN asset_types a ON a.id = tr.asset_type_id
WHERE tr.status = 'COMPLETED'
  AND DATE(tr.transferred_at) BETWEEN :from AND :to
  AND (:baseId IS NULL OR tr.from_base_id = :baseId OR tr.to_base_id = :baseId)
  AND (:assetTypeId IS NULL OR tr.asset_type_id = :assetTypeId)
  AND (:category IS NULL OR a.category = :category)
ORDER BY tr.transferred_at DESC, tr.id DESC`;

/**
 * Detailed breakdown behind the "Net Movement" metric:
 * purchases, transfers-in and transfers-out line items.
 */
export async function getNetMovementDetails(filters = {}) {
  const { from, to } = normalizeRange(filters.from, filters.to);
  const params = {
    from,
    to,
    baseId: filters.baseId || null,
    assetTypeId: filters.assetTypeId || null,
    category: filters.category || null,
  };
  const [[purchases], [transfers]] = await Promise.all([
    query(NET_MOVEMENT_PURCHASES, params),
    query(NET_MOVEMENT_TRANSFERS, params),
  ]);

  const hasBase = filters.baseId != null && filters.baseId !== '';
  return {
    from,
    to,
    purchases,
    transfers,
    transfersIn: hasBase ? transfers.filter((t) => Number(t.to_base_id) === Number(filters.baseId)) : [],
    transfersOut: hasBase ? transfers.filter((t) => Number(t.from_base_id) === Number(filters.baseId)) : [],
  };
}