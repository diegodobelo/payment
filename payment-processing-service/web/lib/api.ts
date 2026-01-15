import type {
  Issue,
  IssueListItem,
  GetIssuesParams,
  PaginatedResponse,
  ReviewSubmission,
} from './types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function fetchApi<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new ApiError(response.status, error.error?.message || error.message || 'Request failed');
  }

  return response.json();
}

/**
 * Get paginated list of issues with optional filters.
 */
export async function getIssues(
  params: GetIssuesParams = {}
): Promise<PaginatedResponse<IssueListItem>> {
  const searchParams = new URLSearchParams();

  if (params.status) searchParams.set('status', params.status);
  if (params.type) searchParams.set('type', params.type);
  if (params.priority) searchParams.set('priority', params.priority);
  if (params.customer_id) searchParams.set('customer_id', params.customer_id);
  if (params.page) searchParams.set('page', params.page.toString());
  if (params.limit) searchParams.set('limit', params.limit.toString());
  if (params.sort_by) searchParams.set('sort_by', params.sort_by);
  if (params.sort_order) searchParams.set('sort_order', params.sort_order);

  const query = searchParams.toString();
  const endpoint = `/api/v1/issues${query ? `?${query}` : ''}`;

  return fetchApi<PaginatedResponse<IssueListItem>>(endpoint);
}

/**
 * Get full details for a single issue.
 */
export async function getIssue(id: string): Promise<Issue> {
  return fetchApi<Issue>(`/api/v1/issues/${id}`);
}

/**
 * Submit a human review for an issue.
 */
export async function submitReview(
  id: string,
  data: ReviewSubmission
): Promise<{ id: string; status: string; final_resolution: string }> {
  return fetchApi(`/api/v1/issues/${id}/review`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export { ApiError };
