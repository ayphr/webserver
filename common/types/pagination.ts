/** Shared offset-pagination shape used by paged list endpoints. */
export type PaginationQuery = {
  page?: number;
  pageSize?: number;
};

export type PaginationMeta = {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};
