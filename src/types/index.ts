/**
 * Common type definitions
 */

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface User {
  id: string;
  email: string;
  created_at?: string;
}

export interface AuthRequest extends Request {
  user?: User;
}
