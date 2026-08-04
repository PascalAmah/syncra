import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { AuthResponse } from '@syncra/core';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

const ACCESS_TOKEN_TTL = '24h';
const ACCESS_TOKEN_TTL_SECONDS = 86400;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponse> {
    const { email, password } = dto;

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    try {
      const result = await this.db.query<{ id: string; email: string }>(
        `INSERT INTO users (email, password_hash)
         VALUES ($1, $2)
         RETURNING id, email`,
        [email, passwordHash]
      );

      const user = result.rows[0];

      const token = this.jwtService.sign(
        { sub: user.id, email: user.email },
        { expiresIn: ACCESS_TOKEN_TTL }
      );
      const refreshToken = await this.issueRefreshToken(user.id);

      return { id: user.id, email: user.email, token, refreshToken };
    } catch (err: unknown) {
      // PostgreSQL unique violation code
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: string }).code === '23505'
      ) {
        throw new ConflictException('Email already exists');
      }
      this.logger.error('Failed to register user', err);
      throw new InternalServerErrorException('Registration failed');
    }
  }

  async login(dto: LoginDto): Promise<{ token: string; expiresIn: number; refreshToken: string }> {
    const { email, password } = dto;

    const result = await this.db.query<{ id: string; password_hash: string }>(
      `SELECT id, password_hash FROM users WHERE email = $1`,
      [email]
    );

    const user = result.rows[0];

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const token = this.jwtService.sign({ sub: user.id }, { expiresIn: ACCESS_TOKEN_TTL });
    const refreshToken = await this.issueRefreshToken(user.id);

    return { token, expiresIn: ACCESS_TOKEN_TTL_SECONDS, refreshToken };
  }

  /**
   * Validates an opaque refresh token and issues a new access token (plus a
   * rotated refresh token). The supplied refresh token is consumed on use, so
   * a leaked/forwarded refresh token can't be reused — a replay is detected and
   * rejected.
   */
  async refresh(
    refreshToken: string
  ): Promise<{ token: string; expiresIn: number; refreshToken: string }> {
    const tokenHash = this.hashToken(refreshToken);
    const result = await this.db.query<{ id: string; user_id: string; expires_at: string }>(
      `SELECT id, user_id, expires_at
       FROM refresh_tokens
       WHERE token_hash = $1 AND revoked_at IS NULL`,
      [tokenHash]
    );

    const row = result.rows[0];
    if (!row) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const expiresAt = new Date(row.expires_at).getTime();
    if (Date.now() > expiresAt) {
      throw new UnauthorizedException('Refresh token expired');
    }

    // Consume (revoke) the presented token now that it's verified as valid, then
    // issue fresh credentials. Enforces single-use rotation.
    await this.db.query(`UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE id = $1`, [
      row.id,
    ]);

    const token = this.jwtService.sign({ sub: row.user_id }, { expiresIn: ACCESS_TOKEN_TTL });
    const newRefreshToken = await this.issueRefreshToken(row.user_id);

    return { token, expiresIn: ACCESS_TOKEN_TTL_SECONDS, refreshToken: newRefreshToken };
  }

  /**
   * Generates an opaque random refresh token, persists only its SHA-256 digest
   * (with an expiry), and returns the raw token to the caller exactly once.
   */
  private async issueRefreshToken(userId: string): Promise<string> {
    const raw = crypto.randomBytes(48).toString('hex');
    const tokenHash = this.hashToken(raw);
    const ttlSeconds = this.configService.get<number>('JWT_REFRESH_TTL') ?? 2592000;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    await this.db.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
      [userId, tokenHash, expiresAt]
    );

    return raw;
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}
