/**
 * Shared list-pagination support.
 * Every list endpoint accepts ?page=1&pageSize=25 (max 200) and returns
 * { rows, page, pageSize, total, pages } so the UI can paginate.
 */
export function parsePagination(query = {}) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(Math.max(1, Number(query.pageSize) || 25), 200);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

/** Appends the LIMIT/OFFSET clause used by the list queries. */
export function limitClause(pagination) {
  return ' LIMIT :pageSize OFFSET :offset';
}
