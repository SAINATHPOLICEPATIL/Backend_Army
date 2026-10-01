const BASE = 'http://localhost:4000/api';

async function req(path, { method = 'GET', body, token, params } = {}) {
  const qs = params ? '?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString() : '';
  const res = await fetch(BASE + path + qs, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}

const out = [];
const check = (name, cond, extra = '') =>
  out.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' :: ' + extra : ''}`);

const { data: login } = await req('/auth/login', {
  method: 'POST',
  body: { username: 'admin', password: 'Password@123' },
});
const admin = login.token;
check('admin login', !!admin);

// Dashboard: balances
const sum = await req('/dashboard/summary', { token: admin });
const t = sum.data.totals;
check('dashboard totals present', sum.status === 200 && typeof t.openingBalance === 'number', JSON.stringify(t));
check('net movement = purch + TI - TO', t.netMovement === t.purchases + t.transfersIn - t.transfersOut,
  `${t.netMovement} == ${t.purchases}+${t.transfersIn}-${t.transfersOut}`);
check('closing = opening + net - expended', t.closingBalance === t.openingBalance + t.netMovement - t.expended,
  `${t.closingBalance} == ${t.openingBalance}+${t.netMovement}-${t.expended}`);
check('assigned > 0', t.assigned > 0, `assigned=${t.assigned}`);

// Dashboard: net movement detail popup
const nm = await req('/dashboard/net-movement', { token: admin, params: { base_id: 1 } });
check('net-movement detail (purchases/TI/TO)', nm.status === 200 && nm.data.purchases.length > 0,
  `purchases=${nm.data.purchases.length} TI=${nm.data.transfersIn.length} TO=${nm.data.transfersOut.length}`);

// Create a purchase, transfer, assignment, expenditure as admin
const p = await req('/purchases', { method: 'POST', token: admin, body: {
  base_id: 1, asset_type_id: 2, quantity: 10, unit_cost: 500, total_cost: 5000,
  vendor: 'Test Vendor', receipt_number: 'PO-TEST-1', purchase_date: '2026-09-01' } });
check('POST purchase', p.status === 201, JSON.stringify(p.data));

const t2 = await req('/transfers', { method: 'POST', token: admin, body: {
  asset_type_id: 1, quantity: 25, from_base_id: 1, to_base_id: 2, notes: 'e2e test' } });
check('POST transfer (admin=COMPLETED)', t2.status === 201 && t2.data.status === 'COMPLETED', JSON.stringify(t2.data));

const a = await req('/assignments', { method: 'POST', token: admin, body: {
  base_id: 1, asset_type_id: 1, quantity: 5, assigned_to: 'Sgt. E2E', rank: 'E-5', assignment_date: '2026-09-02' } });
check('POST assignment', a.status === 201, JSON.stringify(a.data));

const e = await req('/expenditures', { method: 'POST', token: admin, body: {
  base_id: 1, asset_type_id: 5, quantity: 100, reason: 'e2e test', expenditure_date: '2026-09-03' } });
check('POST expenditure', e.status === 201, JSON.stringify(e.data));

// RBAC checks
const { data: l1 } = await req('/auth/login', { method: 'POST', body: { username: 'cmdr.hood', password: 'Password@123' } });
const cmdr = l1.token;
const { data: l2 } = await req('/auth/login', { method: 'POST', body: { username: 'logistics', password: 'Password@123' } });
const logi = l2.token;

const cmdrForbidden = await req('/purchases', { method: 'POST', token: cmdr, body: {
  base_id: 2, asset_type_id: 1, quantity: 5, purchase_date: '2026-09-01' } });
check('commander cannot write to other base', cmdrForbidden.status === 403, `HTTP ${cmdrForbidden.status}`);

const cmdrOtherBase = await req('/purchases', { token: cmdr, params: { base_id: 2 } });
check('commander list scoped to own base', cmdrOtherBase.status === 200 &&
  cmdrOtherBase.data.rows.every((r) => r.base_id === 1), `rows=${cmdrOtherBase.data.rows.length}`);

const logiAssign = await req('/assignments', { token: logi });
check('logistics blocked from assignments', logiAssign.status === 403, `HTTP ${logiAssign.status}`);

const logiPurch = await req('/purchases', { token: logi });
check('logistics can read purchases', logiPurch.status === 200, `HTTP ${logiPurch.status}`);

const cmdrAudit = await req('/audit', { token: cmdr });
check('commander blocked from audit', cmdrAudit.status === 403, `HTTP ${cmdrAudit.status}`);

const adminAudit = await req('/audit', { token: admin, params: { pageSize: 5 } });
check('admin can read audit log', adminAudit.status === 200 && adminAudit.data.rows.length > 0,
  `rows=${adminAudit.data.rows?.length}`);

const noToken = await req('/dashboard/summary');
check('unauthenticated blocked', noToken.status === 401, `HTTP ${noToken.status}`);

// Opening balances (stock levels) module
const sl = await req('/stock-levels', { token: admin });
check('GET stock-levels paginated', sl.status === 200 && typeof sl.data.total === 'number',
  `total=${sl.data.total} pages=${sl.data.pages}`);

const slPost = await req('/stock-levels', { method: 'POST', token: admin, body: {
  base_id: 1, asset_type_id: 7, quantity: 12, effective_date: '2026-01-01', reference: 'e2e test' } });
check('POST stock-level', slPost.status === 201, JSON.stringify(slPost.data));

const slLogistics = await req('/stock-levels', { token: logi });
check('logistics blocked from stock-levels', slLogistics.status === 403, `HTTP ${slLogistics.status}`);

const slCommanderOther = await req('/stock-levels', { method: 'POST', token: cmdr, body: {
  base_id: 3, asset_type_id: 1, quantity: 1, effective_date: '2026-01-01' } });
check('commander cannot set other base stock', slCommanderOther.status === 403, `HTTP ${slCommanderOther.status}`);

// Pagination contract
const page1 = await req('/purchases', { token: admin, params: { page: 1, pageSize: 2 } });
check('list pagination contract', page1.status === 200 && page1.data.rows.length <= 2 && page1.data.page === 1,
  `rows=${page1.data.rows.length} total=${page1.data.total} pages=${page1.data.pages}`);

// Scoping regressions: totals must respect base scoping, and commanders must
// see transfers touching their own base in either direction.
const allPurch = await req('/purchases', { token: admin, params: { pageSize: 200 } });
const cmdrPurch = await req('/purchases', { token: cmdr, params: { pageSize: 200 } });
check('commander total matches own-base rows', cmdrPurch.status === 200 &&
  cmdrPurch.data.total === cmdrPurch.data.rows.length &&
  cmdrPurch.data.total < allPurch.data.total,
  `commander=${cmdrPurch.data.total}/${cmdrPurch.data.rows.length} admin=${allPurch.data.total}`);

const cmdrTransfers = await req('/transfers', { token: cmdr, params: { pageSize: 200 } });
check('commander sees transfers touching own base', cmdrTransfers.status === 200 &&
  cmdrTransfers.data.rows.every((r) => Number(r.from_base_id) === 1 || Number(r.to_base_id) === 1) &&
  cmdrTransfers.data.total === cmdrTransfers.data.rows.length,
  `rows=${cmdrTransfers.data.rows.length} total=${cmdrTransfers.data.total}`);

const cmdrTransfersOutbound = await req('/transfers', { token: cmdr, params: { from_base_id: 1, pageSize: 200 } });
check('commander can filter own base as source', cmdrTransfersOutbound.status === 200 &&
  cmdrTransfersOutbound.data.rows.every((r) => Number(r.from_base_id) === 1),
  `rows=${cmdrTransfersOutbound.data.rows.length}`);

const cmdrTransfersDenied = await req('/transfers', { token: cmdr, params: { from_base_id: 2 } });
check('commander blocked filtering another base', cmdrTransfersDenied.status === 403,
  `HTTP ${cmdrTransfersDenied.status}`);

const adminBaseFilter = await req('/transfers', { token: admin, params: { base_id: 2, pageSize: 200 } });
check('admin base filter returns touching transfers', adminBaseFilter.status === 200 &&
  adminBaseFilter.data.rows.every((r) => Number(r.from_base_id) === 2 || Number(r.to_base_id) === 2) &&
  adminBaseFilter.data.rows.length > 0,
  `rows=${adminBaseFilter.data.rows.length} total=${adminBaseFilter.data.total}`);

const cmdrStock = await req('/stock-levels', { token: cmdr, params: { pageSize: 200 } });
check('commander stock-levels scoped', cmdrStock.status === 200 &&
  cmdrStock.data.rows.every((r) => Number(r.base_id) === 1) &&
  cmdrStock.data.total === cmdrStock.data.rows.length,
  `rows=${cmdrStock.data.rows.length} total=${cmdrStock.data.total}`);

// Security headers
const health = await fetch('http://localhost:4000/health');
const csp = health.headers.get('content-security-policy');
check('security headers (helmet/CSP)', !!csp && health.headers.get('x-content-type-options') === 'nosniff',
  `csp=${csp ? 'present' : 'missing'}`);

console.log(out.join('\n'));
const failed = out.filter((l) => l.startsWith('FAIL')).length;
console.log(`\n${out.length - failed}/${out.length} checks passed`);
process.exit(failed ? 1 : 0);