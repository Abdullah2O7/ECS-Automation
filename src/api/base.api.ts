import type { APIResponse, Page } from '@playwright/test';
import * as requests from '../utils/actions/api/requestActions';
import { requiredEnv } from '../utils/core/env';

/**
 * Shared base of the API helpers: the application's backend, called with the signed-in page's session - its
 * cookies go with every request (`page.request`) - for setup the screens would make slow and for reading back
 * what they saved.
 *
 * ADAPT TO YOUR PROJECT:
 * - `apiBaseUrlVariable`: the `.env` variable of the backend - `API_BASE_URL` by default. When the portals have
 *   backends of their own, an API class of the client portal sets e.g. `CLIENT_API_BASE_URL`.
 * - `headers()`: add what the backend needs on top of the session cookie - a bearer token, a CSRF/anti-forgery
 *   token, an API version header.
 * - `valueOf()`: unwrap your backend's response envelope (`{ value }`, `{ data }`, ...), or return the body as is.
 */
export abstract class BaseApi {
  /** The `.env` variable holding this API's base URL - override it in an API class whose backend is another one. */
  protected readonly apiBaseUrlVariable: string = 'API_BASE_URL';

  constructor(protected readonly page: Page) {}

  //=====================Requests=====================
  protected async get<T>(path: string, params?: Record<string, string>, timeout?: number): Promise<ApiRead<T>> {
    const response = await requests.get(this.page.request, this.url(path), { requestParams: params, requestHeaders: await this.headers(), timeout });
    return { response, body: await parsed<T>(response) };
  }

  protected async post<T>(path: string, body: unknown, timeout?: number): Promise<ApiRead<T>> {
    const response = await requests.post(this.page.request, this.url(path), { requestHeaders: await this.headers(), requestBody: body, timeout });
    return { response, body: await parsed<T>(response) };
  }

  protected async put<T>(path: string, body: unknown): Promise<ApiRead<T>> {
    const response = await requests.put(this.page.request, this.url(path), { requestHeaders: await this.headers(), requestBody: body });
    return { response, body: await parsed<T>(response) };
  }

  protected async delete<T>(path: string): Promise<ApiRead<T>> {
    const response = await requests.remove(this.page.request, this.url(path), { requestHeaders: await this.headers() });
    return { response, body: await parsed<T>(response) };
  }

  /**
   * The body of a successful read, or an error named `code` with the status and what the backend said - a read
   * that fails should stop the test there rather than hand it an empty result.
   */
  protected async valueOf<T>(read: ApiRead<T>, code: string, what: string): Promise<T> {
    if (!read.response.ok() || read.body === undefined) {
      throw new Error(`${code}: ${what} - ${await failureOf(read.response)}`);
    }
    return read.body;
  }

  //=====================Helpers======================
  protected apiBaseUrl(): string {
    return requiredEnv(this.apiBaseUrlVariable).replace(/\/+$/, '');
  }

  protected async headers(): Promise<Record<string, string>> {
    return { 'Content-Type': 'application/json' };
  }

  private url(path: string): string {
    return `${this.apiBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
  }
}

export type ApiRead<T> = { response: APIResponse; body: T | undefined };

/** The answer as JSON, or undefined when it has no JSON body. */
const parsed = async <T>(response: APIResponse): Promise<T | undefined> =>
  (await response.json().catch(() => undefined)) as T | undefined;

/** "400 <start of the body>" - what a failed request reports. */
export const failureOf = async (response: APIResponse): Promise<string> =>
  `${response.status()} ${(await response.text().catch(() => '')).slice(0, 300)}`;
