function parsePagination(query = {}, defaultLimit = 5) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || defaultLimit));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

function paginationMeta(page, limit, total) {
  return {
    page,
    limit,
    total,
    total_pages: total > 0 ? Math.ceil(total / limit) : 0,
  };
}

module.exports = { parsePagination, paginationMeta };
