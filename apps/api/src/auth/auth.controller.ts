import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { UserRole } from '@shorts/db';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedRequest } from '../common/decorators/current-user.decorator';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { YoutubeOAuthService } from '../youtube/youtube-oauth.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private auth: AuthService,
    private youtubeOAuth: YoutubeOAuthService,
  ) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Public()
  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Body() dto: RefreshDto) {
    return this.auth.logout(dto.refreshToken);
  }

  @Get('me')
  me(@Req() req: AuthenticatedRequest) {
    return this.auth.me(req.user.sub, req.user.orgId);
  }

  // §14.1 step 1: return the Google consent URL as JSON. The frontend does
  // `window.location.href = url` itself — a plain browser navigation can't
  // carry an Authorization header, so we hand back the URL over an
  // authenticated fetch instead of redirecting from here.
  @Get('youtube/connect')
  @Roles(UserRole.ADMIN, UserRole.OWNER) // per §9.2: connect/disconnect channels is Admin+
  connectYoutube(@Req() req: AuthenticatedRequest) {
    return { url: this.youtubeOAuth.buildAuthUrl(req.user.sub, req.user.orgId) };
  }

  // §14.1 step 2: Google redirects the browser here directly (YOUTUBE_REDIRECT_URI).
  // No JWT on this request — identity travels in the signed `state` param instead.
  @Public()
  @Get('youtube/callback')
  async youtubeCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ) {
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';

    if (error) {
      res.redirect(`${frontendUrl}/settings?error=${encodeURIComponent(error)}`);
      return;
    }
    if (!code || !state) {
      res.redirect(`${frontendUrl}/settings?error=missing_code_or_state`);
      return;
    }

    try {
      const claims = this.youtubeOAuth.verifyState(state);
      await this.youtubeOAuth.handleCallback(code, claims.sub, claims.orgId);
      res.redirect(`${frontendUrl}/settings?channelConnected=true`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'youtube_connect_failed';
      res.redirect(`${frontendUrl}/settings?error=${encodeURIComponent(message)}`);
    }
  }
}
