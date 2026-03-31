import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthResponse } from '@syncra/core';
import { DatabaseService } from '../database';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly jwtService: JwtService,
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
        [email, passwordHash],
      );

      const user = result.rows[0];

      const token = this.jwtService.sign(
        { sub: user.id, email: user.email },
        { expiresIn: '24h' },
      );

      return { id: user.id, email: user.email, token };
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

  async login(dto: LoginDto): Promise<{ token: string; expiresIn: number }> {
    const { email, password } = dto;

    const result = await this.db.query<{ id: string; password_hash: string }>(
      `SELECT id, password_hash FROM users WHERE email = $1`,
      [email],
    );

    const user = result.rows[0];

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const token = this.jwtService.sign(
      { sub: user.id },
      { expiresIn: '24h' },
    );

    return { token, expiresIn: 86400 };
  }
}
