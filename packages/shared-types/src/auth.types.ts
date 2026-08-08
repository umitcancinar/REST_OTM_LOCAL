// ==========================================
// Auth & User Types
// ==========================================

export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  OWNER = 'OWNER',
  CHEF = 'CHEF',
  CASHIER = 'CASHIER',
  WAITER = 'WAITER',
}

export interface User {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: UserRole;
  pin?: string;
  isActive: boolean;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface LoginDTO {
  email: string;
  password: string;
}

export interface PinLoginDTO {
  tenantSlug: string;
  pin: string;
}

export interface RegisterDTO {
  tenantId: string;
  email: string;
  password: string;
  name: string;
  role: UserRole;
  pin?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface JWTPayload {
  userId: string;
  tenantId: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}

export interface AuthResponse {
  user: Omit<User, 'pin'>;
  tokens: AuthTokens;
  redirectTo: string; // Role-based redirect path
}
